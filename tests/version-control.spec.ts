import { test, expect } from '@playwright/test';
import { launchApp } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildDiff } from '../src/utils/prosediff';
import { describeChanges } from '../src/git/checkpoint';

let app: ElectronApplication;
let page: Page;
let tmpDirs: string[] = [];

function makeTmpDir(): string {
  // realpath: macOS hands out /var/folders/... which is a symlink to /private/var/...,
  // and isomorphic-git resolves it. Without this the renderer's projectRoot and the
  // main process's repo root are two different strings and every event is dropped.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mde-vc-')));
  tmpDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  if (app) await app.close();
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

async function openProject(dir: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, root) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
  }, dir);
}

/** Open a folder and switch to the Checkpoints tab. */
async function openCheckpoints(dir: string): Promise<void> {
  await openProject(dir);
  await page.locator('.qa-vc-tab').click();
  await expect(page.locator('.qa-vc-panel')).toBeVisible();
}

/** Run the full opt-in flow and wait for the first checkpoint to land. */
async function enableCheckpoints(): Promise<void> {
  await page.locator('.qa-vc-enable').click();
  await expect(page.locator('.qa-vc-init-dialog')).toBeVisible();
  await page.locator('.qa-vc-init-confirm').click();
  await expect(page.locator('.qa-vc-checkpoint').first()).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Opt-in gate
// ---------------------------------------------------------------------------

test.describe('Checkpoints opt-in', () => {
  test('tab is dimmed and the panel explains checkpoints are off', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), '# Note\n');

    await openCheckpoints(dir);

    await expect(page.locator('.qa-vc-tab')).toHaveClass(/sidebar-tab-dim/);
    await expect(page.locator('.qa-vc-intro')).toContainText('Checkpoints are off for this folder');
    await expect(page.locator('.qa-vc-enable')).toBeVisible();
    // Nothing to save into: the checkpoint controls must not exist yet.
    await expect(page.locator('.qa-vc-save')).toHaveCount(0);
  });

  test('turning checkpoints on creates a repo, an initial checkpoint, and undims the tab', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'chapter1.md'), '# Chapter One\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    expect(fs.existsSync(path.join(dir, '.git'))).toBe(true);
    // The marker is what grants write mode; nothing else does.
    const config = fs.readFileSync(path.join(dir, '.git', 'config'), 'utf8');
    expect(config).toMatch(/managed\s*=\s*true/);
    // A .gitignore is seeded so OS junk never shows up as a "change".
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('.DS_Store');

    await expect(page.locator('.qa-vc-tab')).not.toHaveClass(/sidebar-tab-dim/);
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Started tracking changes');
    await expect(page.locator('.qa-vc-changes-empty')).toContainText('saved to history');
  });

  test('the how-it-works recap opens from the question mark and after first setup', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'hello\n');

    await openCheckpoints(dir);
    await expect(page.locator('.qa-vc-help')).toHaveCount(0);

    await page.locator('.qa-vc-help-toggle').click();
    await expect(page.locator('.qa-vc-help')).toContainText('How checkpoints work');
    await expect(page.locator('.qa-vc-help')).toContainText('Added words are');

    await page.locator('.qa-vc-help-toggle').click();
    await expect(page.locator('.qa-vc-help')).toHaveCount(0);

    // Turning it on for the first time surfaces the recap unprompted.
    await enableCheckpoints();
    await expect(page.locator('.qa-vc-help')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Guardrails
// ---------------------------------------------------------------------------

test.describe('Checkpoints guardrails', () => {
  test('refuses to track a folder nested inside another tracked folder', async () => {
    ({ app, page } = await launchApp());
    const outer = makeTmpDir();
    fs.mkdirSync(path.join(outer, '.git'));
    const inner = path.join(outer, 'book');
    fs.mkdirSync(inner);
    fs.writeFileSync(path.join(inner, 'ch1.md'), 'text\n');

    await openCheckpoints(inner);
    await page.locator('.qa-vc-enable').click();

    await expect(page.locator('.qa-vc-blocked')).toContainText("can't be tracked on its own");
    // The only guardrail that blocks: there must be no way through.
    await expect(page.locator('.qa-vc-init-confirm')).toHaveCount(0);
    await page.locator('.qa-vc-init-cancel').click();
    expect(fs.existsSync(path.join(inner, '.git'))).toBe(false);
  });

  test('warns about a large folder but still lets the user proceed', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'hi\n');
    // Sparse: reported as 60MB, costs no real disk.
    const fd = fs.openSync(path.join(dir, 'video.mov'), 'w');
    fs.ftruncateSync(fd, 60 * 1024 * 1024);
    fs.closeSync(fd);

    await openCheckpoints(dir);
    await page.locator('.qa-vc-enable').click();

    await expect(page.locator('.qa-vc-warning-large')).toContainText('big folder');
    await expect(page.locator('.qa-vc-warning-large')).toContainText('mileage may vary');
    // A warning, not a block.
    await expect(page.locator('.qa-vc-init-confirm')).toBeVisible();
  });

  test('warns that nested tracked folders will be skipped', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, 'vendor'));
    fs.mkdirSync(path.join(dir, 'vendor', '.git'));
    fs.writeFileSync(path.join(dir, 'note.md'), 'hi\n');

    await openCheckpoints(dir);
    await page.locator('.qa-vc-enable').click();

    await expect(page.locator('.qa-vc-warning-child')).toContainText('vendor');
    await expect(page.locator('.qa-vc-init-confirm')).toBeVisible();
  });

  test('a repo MDE did not create stays read-only', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'hi\n');

    // Build a foreign repo through MDE's own init, then strip the marker -- exactly the
    // shape of a repo created by some other tool.
    await openCheckpoints(dir);
    await enableCheckpoints();
    const configPath = path.join(dir, '.git', 'config');
    fs.writeFileSync(
      configPath,
      fs
        .readFileSync(configPath, 'utf8')
        .split('\n')
        .filter(line => !/^\s*managed\s*=/.test(line))
        .join('\n')
    );

    // Reopen so the state is resolved fresh from disk.
    await openProject(makeTmpDir());
    await openProject(dir);
    await expect(page.locator('.qa-vc-readonly')).toContainText('MDE did not create');
    await expect(page.locator('.qa-vc-save')).toHaveCount(0);
    // ...but it can be adopted deliberately.
    await page.locator('.qa-vc-adopt').click();
    await expect(page.locator('.qa-vc-save')).toBeVisible();
  });

  test('a managed folder that grows a remote steps back to read-only', async () => {
    // The marker says "mine", but live evidence outranks the marker: someone (or Claude
    // Code) ran `git remote add`, and MDE must stop writing rather than commit into
    // something that now syncs elsewhere.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'hi\n');

    await openCheckpoints(dir);
    await enableCheckpoints();
    await expect(page.locator('.qa-vc-save')).toBeVisible();

    const configPath = path.join(dir, '.git', 'config');
    fs.appendFileSync(
      configPath,
      '\n[remote "origin"]\n\turl = https://example.com/book.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
    );

    await openProject(makeTmpDir());
    await openProject(dir);
    await expect(page.locator('.qa-vc-readonly')).toContainText('stepped back to read-only');
    await expect(page.locator('.qa-vc-save')).toHaveCount(0);
    // Not adoptable either -- adopting would be the same mistake by another route.
    await expect(page.locator('.qa-vc-adopt')).toHaveCount(0);
    // History stays readable, which is the whole point of read-only rather than off.
    await expect(page.locator('.qa-vc-checkpoint').first()).toBeVisible();
  });

  test('the marker survives renaming the folder', async () => {
    // Managed-ness lives in .git/config, not in a path key in mde-state.json. Renaming a
    // book folder is an ordinary thing to do and must not silently turn checkpoints off.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'hi\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    const renamed = path.join(path.dirname(dir), path.basename(dir) + '-renamed');
    tmpDirs.push(renamed);
    await openProject(makeTmpDir()); // release the watcher on the old path first
    fs.renameSync(dir, renamed);

    await openProject(renamed);
    await expect(page.locator('.qa-vc-save')).toBeVisible();
    await expect(page.locator('.qa-vc-readonly')).toHaveCount(0);
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Started tracking');
  });
});

// ---------------------------------------------------------------------------
// Change detection
// ---------------------------------------------------------------------------

test.describe('Checkpoint change detection', () => {
  test('an external edit shows up in Changes and on the tab badge', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'chapter1.md'), '# Chapter One\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    // Simulate the agent: one edit, one new file.
    fs.writeFileSync(path.join(dir, 'chapter1.md'), '# Chapter One\n\nRewritten by Claude.\n');
    fs.writeFileSync(path.join(dir, 'chapter2.md'), '# Chapter Two\n');

    await expect(page.locator('.qa-vc-change-row')).toHaveCount(2, { timeout: 15000 });
    await expect(page.locator('.qa-vc-badge')).toHaveText('2');
    await expect(page.locator('.qa-vc-changes')).toContainText('chapter2.md');
  });

  test('ignored files never count as changes', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'hi\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(path.join(dir, '.DS_Store'), 'junk');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
    fs.writeFileSync(path.join(dir, 'real.md'), 'real\n');

    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('.qa-vc-changes')).toContainText('real.md');
  });

  test('a same-size rewrite in the same second as a checkpoint is still detected', async () => {
    // The racy-clean trap. isomorphic-git trusts the stats cached in the index, and mtime
    // granularity is one second -- so a rewrite of identical byte length landing in the same
    // second as the checkpoint's `git.add` looks unchanged, and stays that way until
    // something else touches the file. Silence here would mean an empty changes list over a
    // file that really did change.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, 'version one\n');

    await openCheckpoints(dir);
    await enableCheckpoints();
    // No delay: this must run inside the same second as the checkpoint to be a real test.
    fs.writeFileSync(file, 'version two\n');
    expect(fs.statSync(file).size).toBe(12);

    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('.qa-vc-changes')).toContainText('note.md');
  });

  test('a deleted file counts as a change and the checkpoint records the deletion', async () => {
    // isomorphic-git has no `add -A`, so deletions only get in if the walk calls `remove`
    // for them. Forgetting that half is silent: the checkpoint succeeds and simply does not
    // contain the deletion, so restoring past it would resurrect nothing.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'keep.md'), 'keep\n');
    fs.writeFileSync(path.join(dir, 'doomed.md'), 'delete me\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.unlinkSync(path.join(dir, 'doomed.md'));

    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await expect(page.locator('.qa-vc-change-row .bi-dash-lg')).toBeVisible();
    await expect(page.locator('.qa-vc-changes')).toContainText('doomed.md');

    await page.locator('.qa-vc-message').fill('Removed a chapter');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Removed a chapter');

    // The commit's own tree diff must show the deletion, not an empty change set.
    await page.locator('.qa-vc-checkpoint').first().click();
    await expect(page.locator('.qa-vc-checkpoint-file')).toHaveCount(1);
    await expect(page.locator('.qa-vc-checkpoint-file')).toContainText('doomed.md');
    await expect(page.locator('.qa-vc-checkpoint-file .bi-dash-lg')).toBeVisible();
  });

  test('saving a checkpoint records the message and clears the changes list', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'first\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(path.join(dir, 'note.md'), 'second\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });

    await page.locator('.qa-vc-message').fill('Finished the opening scene');
    await page.locator('.qa-vc-save').click();

    await expect(page.locator('.qa-vc-checkpoint').first())
      .toContainText('Finished the opening scene');
    await expect(page.locator('.qa-vc-changes-empty')).toBeVisible();
    await expect(page.locator('.qa-vc-badge')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------

test.describe('Checkpoint diffs', () => {
  test('clicking a changed file shows the words that changed', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'The quick brown fox jumps over the lazy dog.\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(path.join(dir, 'note.md'), 'The quick red fox leaps over the lazy dog.\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });

    await page.locator('.qa-vc-change-row').click();
    await expect(page.locator('.qa-diff-view')).toBeVisible();
    await expect(page.locator('.qa-diff-path')).toHaveText('note.md');
    // The content arrives over IPC; allTextContents() below does not retry, so wait for
    // the rendered diff first.
    await expect(page.locator('.qa-diff-summary')).toBeVisible();

    // Word-level, not line-level: only the changed words are marked. A plain unified diff
    // would mark the whole sentence, which is exactly what this view exists to avoid.
    const removedWords = await page.locator('.diff-removed .diff-word').allTextContents();
    const addedWords = await page.locator('.diff-added .diff-word').allTextContents();
    expect(removedWords).toContain('brown');
    expect(removedWords).toContain('jumps');
    expect(addedWords).toContain('red');
    expect(addedWords).toContain('leaps');
    // The unchanged remainder must stay outside the highlights.
    expect(removedWords.join(' ')).not.toContain('lazy');
    expect(addedWords.join(' ')).not.toContain('lazy');
    // ...but it is still on screen as context within the row.
    await expect(page.locator('.diff-removed')).toContainText('over the lazy dog');

    await page.keyboard.press('Escape');
    await expect(page.locator('.qa-diff-view')).toHaveCount(0);
  });

  test('a history entry lists its files and diffs them against the previous checkpoint', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'original text\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(path.join(dir, 'note.md'), 'revised text\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Second pass');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Second pass');

    await page.locator('.qa-vc-checkpoint').first().click();
    await expect(page.locator('.qa-vc-checkpoint-file')).toHaveCount(1);
    await page.locator('.qa-vc-checkpoint-file').click();

    await expect(page.locator('.qa-diff-view')).toBeVisible();
    await expect(page.locator('.diff-removed')).toContainText('original');
    await expect(page.locator('.diff-added')).toContainText('revised');
  });
});

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

test.describe('Checkpoint restore', () => {
  test('restoring one file rewrites it and appends a new checkpoint', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, 'original text\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(file, 'ruined by an agent\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Agent rewrite');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Agent rewrite');

    const countBefore = await page.locator('.qa-vc-checkpoint').count();

    // Go back to the FIRST checkpoint (the initial one) and put that version back.
    // Its file list also holds the seeded .gitignore, so pick note.md by name.
    await page.locator('.qa-vc-checkpoint').last().click();
    await page.locator('.qa-vc-checkpoint-file', { hasText: 'note.md' }).click();
    await expect(page.locator('.qa-diff-view')).toBeVisible();
    await page.locator('.qa-diff-restore').click();

    await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15000 })
      .toBe('original text\n');

    // Append-only: history grew, and the ruined version is still reachable.
    await expect.poll(() => page.locator('.qa-vc-checkpoint').count(), { timeout: 15000 })
      .toBeGreaterThan(countBefore);
    await expect(page.locator('.qa-vc-history')).toContainText('Agent rewrite');
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Restored note.md');
  });

  test('restoring the whole folder removes files added since that point', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const kept = path.join(dir, 'kept.md');
    const added = path.join(dir, 'added-later.md');
    fs.writeFileSync(kept, 'version one\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(kept, 'version two\n');
    fs.writeFileSync(added, 'a file the agent invented\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(2, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Agent went wild');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Agent went wild');

    await page.locator('.qa-vc-checkpoint').last().click();
    await page.locator('.qa-vc-restore-all').click();
    await expect(page.locator('.qa-vc-restore-dialog')).toBeVisible();
    await page.locator('.qa-vc-restore-confirm').click();

    await expect.poll(() => fs.readFileSync(kept, 'utf8'), { timeout: 15000 })
      .toBe('version one\n');
    // The union bug: forgetting the deletion half leaves this file behind.
    await expect.poll(() => fs.existsSync(added), { timeout: 15000 }).toBe(false);
    // Still recoverable -- the safety checkpoint captured it before the restore.
    await expect(page.locator('.qa-vc-history')).toContainText('Agent went wild');
  });

  test('restoring never corrupts a binary file it did not change', async () => {
    // A real corruption bug, reported from live use: edit one line of a Markdown file, make a
    // checkpoint, restore that checkpoint, and a PDF sitting untouched in the same folder
    // came back blank. Restore read every blob as a utf8 STRING and wrote it back as one, so
    // every byte that is not valid UTF-8 became U+FFFD. Markdown survives that round trip;
    // nothing else does.
    //
    // The bytes below are deliberately not valid UTF-8 (lone continuation bytes, a NUL, an
    // 0xFF that can never appear in UTF-8) -- exactly what a real PDF is full of.
    const binary = Buffer.from([
      0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a,
      0xff, 0xfe, 0x00, 0x80, 0x81, 0x9f, 0xc3, 0x28, 0xed, 0xa0, 0x80,
      0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46, 0x0a,
    ]);

    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const pdf = path.join(dir, 'report.pdf');
    const note = path.join(dir, 'DETAILS.md');
    fs.writeFileSync(pdf, binary);
    fs.writeFileSync(note, '# Details\n\nline one\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    // One line of Markdown changes. The PDF is not touched.
    fs.writeFileSync(note, '# Details\n\nline one changed\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Update DETAILS.md');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Update DETAILS.md');

    // Restore the checkpoint that represents the CURRENT state -- the exact reported case.
    await page.locator('.qa-vc-checkpoint').first().click();
    await page.locator('.qa-vc-restore-all').click();
    await expect(page.locator('.qa-vc-restore-dialog')).toBeVisible();
    await page.locator('.qa-vc-restore-confirm').click();
    await expect(page.locator('.qa-vc-restore-dialog')).toHaveCount(0, { timeout: 15000 });

    // Byte-for-byte identical. A utf8 round trip would have replaced 6 of these 27 bytes.
    expect(fs.readFileSync(pdf).equals(binary)).toBe(true);
  });

  test('restoring the checkpoint that is already current leaves everything alone', async () => {
    // The "Restore everything" button on the newest checkpoint used to rewrite every file in
    // the tree with identical content, which is how an untouched PDF ended up in a diff. It
    // must be a no-op, and must say so rather than reporting a restore that did nothing.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const note = path.join(dir, 'note.md');
    const other = path.join(dir, 'other.md');
    fs.writeFileSync(note, 'first\n');
    fs.writeFileSync(other, 'untouched\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(note, 'second\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Second pass');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2);

    const otherMtime = fs.statSync(other).mtimeMs;

    await page.locator('.qa-vc-checkpoint').first().click();
    await page.locator('.qa-vc-restore-all').click();
    await page.locator('.qa-vc-restore-confirm').click();

    await expect(page.locator('.toast')).toContainText('already', { timeout: 15000 });
    // No new checkpoint, no rewritten files, no disturbed mtimes.
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2);
    expect(fs.readFileSync(note, 'utf8')).toBe('second\n');
    expect(fs.statSync(other).mtimeMs).toBe(otherMtime);
  });

  test('restoring over a file with unsaved edits raises the conflict banner', async () => {
    // Restore deliberately bypasses write-file-if-unchanged (that guard is for renderer
    // buffers) and writes straight to disk. The payoff is that the existing conflict
    // machinery handles the open-tab case for free: the directory watcher fires, the hash
    // no longer matches, and a DIRTY buffer must raise the red banner rather than be
    // silently overwritten. Nothing the user typed is allowed to vanish.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '# Original\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(file, '# Agent version\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Agent rewrite');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Agent rewrite');

    // Open it and leave unsaved edits in the buffer.
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, file);
    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await editor.press('End');
    await editor.type(' plus my own edit');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // Restore the pre-agent version from the initial checkpoint.
    await page.locator('.qa-vc-tab').click();
    await page.locator('.qa-vc-checkpoint').last().click();
    await page.locator('.qa-vc-checkpoint-file', { hasText: 'note.md' }).click();
    await expect(page.locator('.qa-diff-view')).toBeVisible();
    await page.locator('.qa-diff-restore').click();

    await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15000 })
      .toContain('# Original');
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.conflict-banner-text')).toContainText('modified on disk');
    // The unsaved edit is still in the buffer, not clobbered.
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();
    await expect(editor).toContainText('plus my own edit');
  });
});

// ---------------------------------------------------------------------------
// Automatic checkpoints
// ---------------------------------------------------------------------------

test.describe('Automatic checkpoints', () => {
  // The real cadence is "10 minutes since the last checkpoint, then 60s of quiet". The
  // flags collapse both to a fraction of a second so the identical code path is exercised.
  test('a quiet period after changes produces an automatic checkpoint', async () => {
    ({ app, page } = await launchApp(['--vc-eligibility-ms=0', '--vc-poll-ms=200']));
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'start\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(path.join(dir, 'note.md'), 'edited by an agent\n');

    // Two identical polls in a row are required before it commits, so this proves the
    // settle window ran, not just that a change was noticed.
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2, { timeout: 25000 });
    await expect(page.locator('.qa-vc-checkpoint').first()).toContainText('Updated note.md');
    await expect(page.locator('.qa-vc-changes-empty')).toBeVisible();
  });

  test('no automatic checkpoint is created while nothing has changed', async () => {
    ({ app, page } = await launchApp(['--vc-eligibility-ms=0', '--vc-poll-ms=200']));
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'start\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    // Many poll cycles with an untouched folder must not manufacture empty checkpoints.
    await page.waitForTimeout(3000);
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(1);
  });

  test('no checkpoint lands mid-burst while a file is being rewritten repeatedly', async () => {
    // THE COARSE-ENUM TRAP. statusMatrix's workdir field is a three-valued enum, not a
    // content hash, so every poll during this burst sees the byte-identical row
    // [note.md, 1, 2, 1]. A signature built from the matrix alone would compare equal on two
    // consecutive polls and commit halfway through the rewrite -- the exact thing the settle
    // window exists to prevent. Folding mtime and size into the signature is what saves it.
    //
    // Each write is the SAME LENGTH, so size alone cannot carry the test and mtime must be
    // doing real work.
    ({ app, page } = await launchApp(['--vc-eligibility-ms=0', '--vc-poll-ms=400']));
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, 'draft 000\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    // ~14 writes over ~3.5s against a 400ms poll: several polls necessarily land inside it.
    for (let i = 1; i <= 14; i++) {
      fs.writeFileSync(file, `draft ${String(i).padStart(3, '0')}\n`);
      await page.waitForTimeout(250);
    }
    // Still exactly the initial checkpoint: nothing was captured mid-rewrite.
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(1);

    // And once the burst ends, the pending work is captured rather than stranded.
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2, { timeout: 25000 });
    await expect(page.locator('.qa-vc-changes-empty')).toBeVisible();
    expect(fs.readFileSync(file, 'utf8')).toBe('draft 014\n');
  });

  test('a checkpoint does not trigger another one from its own .git writes', async () => {
    // Committing writes to .git/, the recursive watcher sees it, and sawChange goes true.
    // Two independent things must stop the loop: the resulting status is empty, and the
    // eligibility clock was just reset. A regression here spins forever, one commit per poll.
    ({ app, page } = await launchApp(['--vc-eligibility-ms=0', '--vc-poll-ms=200']));
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'start\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(path.join(dir, 'note.md'), 'real work\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2);

    // ~15 poll cycles after a real commit. The count must not move.
    await page.waitForTimeout(3000);
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2);
  });
});

// ---------------------------------------------------------------------------
// Prose diff engine (pure function, no app needed)
// ---------------------------------------------------------------------------

test.describe('Checkpoint titles', () => {
  // A generated title has one job: let someone scanning History recognise which moment this
  // was. "6 files changed" fails that completely, so every title names files.
  const f = (path: string, kind: 'added' | 'modified' | 'deleted') => ({ path, kind } as const);

  test('names the files instead of only counting them', () => {
    expect(describeChanges([f('note.md', 'modified')])).toBe('Updated note.md');
    expect(describeChanges([f('a.md', 'modified'), f('b.md', 'modified')]))
      .toBe('Updated a.md and b.md');
    expect(describeChanges([
      f('a.md', 'modified'), f('b.md', 'modified'), f('c.md', 'modified'),
    ])).toBe('Updated a.md, b.md and 1 more');
  });

  test('leads with the largest group and sweeps the rest into the count', () => {
    // Four edits and two new files: it reads as an editing session, not "6 files changed".
    const files = [
      f('ch1.md', 'modified'), f('ch2.md', 'modified'),
      f('ch3.md', 'modified'), f('ch4.md', 'modified'),
      f('new1.md', 'added'), f('new2.md', 'added'),
    ];
    expect(describeChanges(files)).toBe('Updated ch1.md, ch2.md and 4 more');

    // Flip the balance and the verb follows it.
    const mostlyNew = [
      f('new1.md', 'added'), f('new2.md', 'added'), f('new3.md', 'added'),
      f('ch1.md', 'modified'),
    ];
    expect(describeChanges(mostlyNew)).toBe('Added new1.md, new2.md and 2 more');

    expect(describeChanges([f('old.md', 'deleted'), f('gone.md', 'deleted')]))
      .toBe('Deleted old.md and gone.md');
  });

  test('never claims a change when there is none', () => {
    expect(describeChanges([])).toBe('No changes');
  });
});

// ---------------------------------------------------------------------------
// The full-page history tab
// ---------------------------------------------------------------------------

/** The sha the branch currently points at, read straight off disk. */
function headSha(dir: string): string {
  const head = fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8').trim();
  const ref = head.replace(/^ref:\s*/, '');
  return fs.readFileSync(path.join(dir, '.git', ref), 'utf8').trim();
}

test.describe('Checkpoint history tab', () => {
  test('opens as an ordinary tab and drills list -> checkpoint -> file diff and back', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, 'one\ntwo\nthree\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(file, 'one\ntwo CHANGED\nthree\nfour\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Second pass');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2);

    await page.locator('.qa-vc-browse').click();
    // It really is a tab, sitting alongside any documents -- not a mode that replaced the app.
    await expect(page.locator('.tab', { hasText: 'Checkpoint History' })).toBeVisible();
    await expect(page.locator('.qa-hist-view')).toBeVisible();
    await expect(page.locator('.qa-hist-checkpoint')).toHaveCount(2);
    await expect(page.locator('.qa-hist-checkpoint').first()).toContainText('Second pass');

    // Level 2: the files in that checkpoint, with how much each one moved.
    await page.locator('.qa-hist-checkpoint').first().locator('.qa-hist-open').click();
    await expect(page.locator('.qa-hist-detail')).toBeVisible();
    await expect(page.locator('.qa-hist-file')).toHaveCount(1);
    await expect(page.locator('.qa-hist-file')).toContainText('note.md');
    // 'two' -> 'two CHANGED' plus an appended 'four': two added lines, one removed.
    const counts = page.locator('.qa-hist-counts');
    await expect(counts).toContainText('+2');
    await expect(counts).toContainText('−1');

    // Level 3: the prose diff, inline in the page rather than floating over the sidebar.
    await page.locator('.qa-hist-file').locator('.history-file-main').click();
    await expect(page.locator('.qa-hist-diff')).toBeVisible();
    await expect(page.locator('.qa-diff-path')).toContainText('note.md');
    await expect(page.locator('.qa-hist-crumb-file')).toContainText('note.md');

    // And the breadcrumb walks back up both levels.
    await page.locator('.qa-hist-crumb-checkpoint').click();
    await expect(page.locator('.qa-hist-detail')).toBeVisible();
    await page.locator('.qa-hist-crumb-root').click();
    await expect(page.locator('.qa-hist-checkpoint')).toHaveCount(2);
  });

  test('browsing history leaves an open document and its unsaved edits alone', async () => {
    // This is the whole reason history is a TAB and not an app-wide mode: a mode would have to
    // unmount the editor (losing the buffer and its undo history) or keep a hidden one alive.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '# Note\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, file);
    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await editor.click();
    await editor.press('End');
    await editor.type(' with an unsaved thought');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    await page.locator('.qa-vc-tab').click();
    await page.locator('.qa-vc-browse').click();
    await expect(page.locator('.qa-hist-view')).toBeVisible();
    // Hidden, NOT unmounted -- that distinction is the whole benefit of a tab over a mode.
    await expect(editor).toBeHidden();
    await expect(editor).toHaveCount(1);

    // Back to the document: the buffer, the edit and the dirty flag all survived.
    await page.locator('.tab', { hasText: 'note.md' }).click();
    await expect(page.locator('.tiptap')).toContainText('with an unsaved thought');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();
    // Nothing was written to disk behind the user's back.
    expect(fs.readFileSync(file, 'utf8')).toBe('# Note\n');
  });

  test('restores a single file from the history tab', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'note.md');
    fs.writeFileSync(file, '# Original\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    fs.writeFileSync(file, '# Rewritten by an agent\n');
    await expect(page.locator('.qa-vc-change-row')).toHaveCount(1, { timeout: 15000 });
    await page.locator('.qa-vc-message').fill('Agent rewrite');
    await page.locator('.qa-vc-save').click();
    await expect(page.locator('.qa-vc-checkpoint')).toHaveCount(2);

    await page.locator('.qa-vc-browse').click();
    // The OLDEST checkpoint is the one holding the original text. It also carries the seeded
    // .gitignore, so restore the one row that matters rather than everything in it.
    await page.locator('.qa-hist-checkpoint').last().locator('.qa-hist-open').click();
    const noteRow = page.locator('.qa-hist-file', { hasText: 'note.md' });
    await expect(noteRow).toHaveCount(1);
    await noteRow.locator('.qa-hist-restore-file').click();

    await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 15000 })
      .toBe('# Original\n');
    await expect(page.locator('.toast')).toContainText('still in your history');
  });
});

test.describe('Editing a checkpoint description', () => {
  test('the pencil renames a checkpoint without touching history', async () => {
    // A title is a label, not a fact about the files, so it is stored BESIDE the history in
    // .git/mde-titles.json. Rewriting the commit would change its sha and every descendant's,
    // stranding the MDE-Restore trailers that name them. The sha assertion is the point of
    // this test: history must be byte-identical after a rename.
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'start\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    const shaBefore = headSha(dir);

    await page.locator('.qa-vc-browse').click();
    const row = page.locator('.qa-hist-checkpoint').first();
    await expect(row).toContainText('Started tracking changes');

    await row.locator('.qa-hist-title-edit').click();
    await page.locator('.qa-hist-title-input').fill('Before Claude touched anything');
    await page.locator('.qa-hist-title-save').click();

    await expect(page.locator('.qa-hist-checkpoint').first())
      .toContainText('Before Claude touched anything');

    // History is untouched; the label lives in a sidecar. Both halves of this were
    // mutation-verified: making the handler also commit turns each of them red.
    expect(headSha(dir)).toBe(shaBefore);
    const titles = JSON.parse(fs.readFileSync(path.join(dir, '.git', 'mde-titles.json'), 'utf8'));
    expect(titles[shaBefore]).toBe('Before Claude touched anything');

    // And the sidebar list agrees -- one name for one moment, wherever it is shown.
    await page.locator('.qa-vc-tab').click();
    await expect(page.locator('.qa-vc-checkpoint').first())
      .toContainText('Before Claude touched anything');
  });

  test('the automatic description can be put back', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'note.md'), 'start\n');

    await openCheckpoints(dir);
    await enableCheckpoints();

    await page.locator('.qa-vc-browse').click();
    const row = page.locator('.qa-hist-checkpoint').first();
    await row.locator('.qa-hist-title-edit').click();
    await page.locator('.qa-hist-title-input').fill('A name I regret');
    await page.locator('.qa-hist-title-save').click();
    await expect(page.locator('.qa-hist-checkpoint').first()).toContainText('A name I regret');

    // The reset button only exists once a custom title is in play.
    await page.locator('.qa-hist-checkpoint').first().locator('.qa-hist-title-edit').click();
    await page.locator('.qa-hist-title-reset').click();

    await expect(page.locator('.qa-hist-checkpoint').first())
      .toContainText('Started tracking changes');
    const titles = JSON.parse(fs.readFileSync(path.join(dir, '.git', 'mde-titles.json'), 'utf8'));
    expect(Object.keys(titles)).toHaveLength(0);
  });
});

test.describe('Prose diff', () => {
  test('marks only the words that changed inside a rewritten paragraph', () => {
    const before = 'She walked slowly to the door and paused.\n';
    const after = 'She walked quickly to the door and paused.\n';
    const diff = buildDiff(before, after);

    expect(diff.identical).toBe(false);
    const removed = diff.rows.find(r => r.type === 'removed');
    const added = diff.rows.find(r => r.type === 'added');
    expect(removed?.segments.filter(s => s.changed).map(s => s.text)).toEqual(['slowly']);
    expect(added?.segments.filter(s => s.changed).map(s => s.text)).toEqual(['quickly']);
    // The rest of the sentence must survive as unchanged context within the row.
    expect(removed?.segments.some(s => !s.changed && s.text.includes('to the door'))).toBe(true);
  });

  test('reports identical content instead of an empty diff', () => {
    const diff = buildDiff('same\n', 'same\n');
    expect(diff.identical).toBe(true);
    expect(diff.rows).toHaveLength(0);
  });

  test('handles a file that did not exist before', () => {
    const diff = buildDiff(null, 'brand new\nsecond line\n');
    expect(diff.identical).toBe(false);
    expect(diff.rows.every(r => r.type === 'added')).toBe(true);
    expect(diff.added).toBe(2);
    expect(diff.removed).toBe(0);
  });

  test('collapses long stretches of unchanged text', () => {
    const body = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n') + '\n';
    const diff = buildDiff(body, body.replace('line 0', 'line zero'));
    const gaps = diff.rows.filter(r => r.type === 'gap');
    expect(gaps).toHaveLength(1);
    expect(gaps[0].hiddenCount).toBeGreaterThan(30);
    // Context is kept next to the change so the reader can see where they are.
    expect(diff.rows.some(r => r.type === 'context' && r.segments[0].text === 'line 1')).toBe(true);
  });
});
