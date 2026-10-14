import { test, expect } from '@playwright/test';
import { launchApp } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Plain-text files open in a literal editor: what is saved is exactly what was loaded, plus the
// user's own edits -- no whitespace, line-ending, or formatting cleanup.

let app: ElectronApplication;
let page: Page;
let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  tmpDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  if (app) await app.close();
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

async function send(channel: string, arg?: string) {
  await app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows()[0].webContents.send(a.channel, a.arg);
  }, { channel, arg });
}

// Opens `name` holding `bytes` and waits for the plain-text editor to show it. Launches the app
// unless the test already did.
async function openPlainFile(name: string, bytes: string | Buffer, launch = true): Promise<string> {
  if (launch) ({ app, page } = await launchApp());
  const file = path.join(makeTmpDir(), name);
  fs.writeFileSync(file, bytes);
  await send('open-file', file);
  await expect(page.locator('.qa-plaintext-editor .cm-content')).toBeVisible({ timeout: 5000 });
  return file;
}

async function save() {
  await send('save-file');
  await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });
}

const ROUND_TRIP_CASES: Record<string, string> = {
  'trailing whitespace and blank lines': 'line one   \n\t\n\n\nline two\t \n\n\n',
  'no final newline': 'alpha\nbeta',
  'tabs and indentation': '\tone\n\t\ttwo\n    four spaces\n',
  'CRLF line endings': 'first\r\nsecond\r\n\r\nthird\r\n',
  'lone CR line endings': 'first\rsecond\r',
  'mixed line endings': 'lf\ncrlf\r\nlf again\ncr\rend',
  'byte order mark and non-ASCII text': '\uFEFF{ "name": "Zoë", "emoji": "🎉", "dash": "\u2014" }\n',
  'markdown-looking text': '# not a heading\n* not   a list\n1) nor this\n\n> quote   \n',
};

test.describe('Plain-text files: literal round trip', () => {
  for (const [label, original] of Object.entries(ROUND_TRIP_CASES)) {
    test(`saving after one edit changes only the edited byte (${label})`, async () => {
      const file = await openPlainFile('sample.txt', original);
      await page.locator('.cm-content').click();
      await page.keyboard.press('ControlOrMeta+Home');
      await page.keyboard.type('X');
      await expect(page.locator('.tab-dirty-dot')).toHaveCount(1);
      await save();
      // A BOM is a character of its own, so typing at the very start lands before it.
      expect(fs.readFileSync(file, 'utf-8')).toBe('X' + original);
    });
  }

  test('typing at the end of a CRLF line and pressing Enter keeps every line ending CRLF', async () => {
    const file = await openPlainFile('windows.txt', 'one\r\ntwo\r\n');
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await page.keyboard.press('Enter');
    await page.keyboard.type('inserted');
    await save();
    expect(fs.readFileSync(file, 'utf-8')).toBe('one!\r\ninserted\r\ntwo\r\n');
  });

  test('a file that mixes line endings shows its carriage returns rather than hiding them', async () => {
    await openPlainFile('mixed.txt', 'a\r\nb\nc\n');
    await expect(page.locator('.cm-content .cm-specialChar')).toHaveCount(1);
  });

  test('Tab inserts a literal tab character', async () => {
    const file = await openPlainFile('Makefile', 'build:\n');
    await page.locator('.cm-content').click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Tab');
    await page.keyboard.type('make all');
    await save();
    expect(fs.readFileSync(file, 'utf-8')).toBe('build:\n\tmake all');
  });

  test('undoing back to the loaded text marks the buffer clean again', async () => {
    await openPlainFile('notes.json', '{}\n');
    await page.locator('.cm-content').click();
    await page.keyboard.type('xy');
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(1);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);
  });

  test('autosave writes the buffer literally', async () => {
    ({ app, page } = await launchApp());
    const wasOn = await page.evaluate(() => window.mde.getAutosave());
    try {
      await page.evaluate(() => window.mde.setAutosave(true));
      const file = await openPlainFile('config.yaml', 'key:   value   \r\n', false);
      await page.locator('.cm-content').click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.type('next: 1');
      await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });
      expect(fs.readFileSync(file, 'utf-8')).toBe('key:   value   \r\nnext: 1');
    } finally {
      await page.evaluate((on) => window.mde.setAutosave(on), wasOn);
    }
  });
});

test.describe('Plain-text files: editor', () => {
  test('a plain-text file opens without the formatting toolbar or the rich editor', async () => {
    await openPlainFile('data.csv', 'a,b\n1,2\n');
    await expect(page.locator('.cm-content')).toContainText('1,2');
    await expect(page.locator('.tiptap')).toHaveCount(0);
    await expect(page.locator('.toolbar')).toHaveCount(0);
    await expect(page.locator('.qa-toolbar-expand')).toHaveCount(0);
  });

  test('a file that is not valid UTF-8 is refused with a toast instead of opened', async () => {
    ({ app, page } = await launchApp());
    const file = path.join(makeTmpDir(), 'latin1.txt');
    fs.writeFileSync(file, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a])); // "café\n" in Latin-1
    await send('open-file', file);
    await expect(page.locator('.toast')).toContainText('latin1.txt is not UTF-8 text');
    await expect(page.locator('.tab')).toHaveCount(0);
    expect(fs.readFileSync(file)).toEqual(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]));
  });

  test('an outside change silently reloads a clean buffer with the new text', async () => {
    const file = await openPlainFile('log.log', 'first\n');
    fs.writeFileSync(file, 'first\nsecond  \n');
    await expect(page.locator('.cm-content')).toContainText('second', { timeout: 5000 });
    await expect(page.locator('.reload-notice')).toBeVisible();
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);
  });

  test('an outside change to a dirty buffer raises the conflict banner and does not overwrite it', async () => {
    const file = await openPlainFile('script.sh', 'echo hi\n');
    await page.locator('.cm-content').click();
    await page.keyboard.type('mine ');
    fs.writeFileSync(file, 'theirs\n');
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 5000 });
    await send('save-file');
    await expect(page.locator('.conflict-banner')).toBeVisible();
    expect(fs.readFileSync(file, 'utf-8')).toBe('theirs\n');
  });

  test('Find opens the plain-text search panel', async () => {
    await openPlainFile('page.html', '<p>needle</p>\n');
    await send('toggle-find');
    await expect(page.locator('.cm-panels .cm-search')).toBeVisible();
    await expect(page.locator('.find-bar')).toHaveCount(0);
  });
});

test.describe('Plain-text files: file explorer', () => {
  test('each file kind gets its own icon, and only allowlisted dotfiles are listed', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    for (const name of ['notes.md', 'data.json', '.gitignore', '.env', 'Dockerfile', 'report.pdf', 'letter.docx', 'photo.png', '.hidden', '.eslintrc']) {
      fs.writeFileSync(path.join(dir, name), '');
    }
    await send('open-project', dir);
    const row = (name: string) => page.locator('.tree-file').filter({ has: page.locator('.tree-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });
    await expect(row('notes.md')).toBeVisible({ timeout: 5000 });

    await expect(row('notes.md').locator('.qa-tree-file-icon')).toHaveClass(/bi-markdown/);
    for (const name of ['data.json', '.gitignore', '.env', 'Dockerfile']) {
      await expect(row(name)).toHaveClass(/qa-tree-file-plaintext/);
      await expect(row(name).locator('.qa-tree-file-icon')).toHaveClass(/bi-code-slash/);
    }
    await expect(row('report.pdf').locator('.qa-tree-file-icon')).toHaveClass(/bi-file-earmark-pdf/);
    await expect(row('letter.docx').locator('.qa-tree-file-icon')).toHaveClass(/bi-file-earmark-word/);
    await expect(row('photo.png').locator('.qa-tree-file-icon')).not.toHaveClass(/bi-/);
    await expect(row('photo.png')).toHaveClass(/tree-file-disabled/);
    await expect(row('.hidden')).toHaveCount(0);
    await expect(row('.eslintrc')).toHaveCount(0);
  });

  test('clicking a plain-text file in the explorer opens it, and it offers no export', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
    await send('open-project', dir);
    const row = page.locator('.qa-tree-file-plaintext');
    await row.click();
    await expect(page.locator('.cm-content')).toContainText('node_modules/', { timeout: 5000 });
    await row.click({ button: 'right' });
    await expect(page.locator('.qa-ctx-export-pdf')).toHaveCount(0);
    await expect(page.locator('.qa-ctx-export-docx')).toHaveCount(0);
  });
});
