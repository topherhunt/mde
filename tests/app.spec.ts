import { test, expect } from '@playwright/test';
import { launchApp, fixturePath } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

let app: ElectronApplication;
let page: Page;
let tmpDirs: string[] = [];

// Create a temp dir whose cleanup is deferred to afterEach -- AFTER the app
// closes. Deleting a temp dir while the app still holds an open file inside it
// hangs app.close() on Windows (the OS keeps the file/dir handle alive), so
// cleanup must happen post-close, never inline in the test body.
function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  tmpDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  if (app) {
    await app.close();
  }
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

// ---------------------------------------------------------------------------
// 1. App launch and basic layout
// ---------------------------------------------------------------------------

test.describe('App launch', () => {
  test('opens a window with the correct layout', async () => {
    ({ app, page } = await launchApp());

    await expect(page.locator('.app')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeVisible();
    await expect(page.locator('.main-area')).toBeVisible();
    await expect(page.locator('.toolbar')).toBeVisible();
  });

  test('shows empty state when no file is open', async () => {
    ({ app, page } = await launchApp());

    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('.empty-state')).toContainText('Open a file');
  });

  test('sidebar shows Files and Outline tabs', async () => {
    ({ app, page } = await launchApp());

    const filesTab = page.locator('.sidebar-tab[title="File Explorer"]');
    const outlineTab = page.locator('.sidebar-tab[title="Document Outline"]');

    await expect(filesTab).toBeVisible();
    await expect(outlineTab).toBeVisible();
    await expect(filesTab).toHaveClass(/active/);
  });
});

// ---------------------------------------------------------------------------
// 2. Opening files via IPC (simulates File > Open)
// ---------------------------------------------------------------------------

test.describe('File opening', () => {
  test('opens a markdown file and displays content in editor', async () => {
    ({ app, page } = await launchApp());

    const samplePath = fixturePath('sample.md');
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, samplePath);

    // Wait for tab to appear
    await expect(page.locator('.tab')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tab-name')).toContainText('sample.md');

    // Wait for editor content to load
    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(editor).toContainText('Sample Document');
    await expect(editor).toContainText('bold');
    await expect(editor).toContainText('italic');
  });

  test('renders headings correctly', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await expect(editor.locator('h1')).toContainText('Sample Document');
    await expect(editor.locator('h2').first()).toContainText('Section One');
    await expect(editor.locator('h3')).toContainText('Subsection');
  });

  test('renders code blocks', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const codeBlock = editor.locator('pre');
    await expect(codeBlock).toBeVisible();
    await expect(codeBlock).toContainText('function hello');
  });

  test('renders links', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    const link = editor.locator('a[href="https://example.com"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('link');
  });

  test('renders lists', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await expect(editor.locator('ul')).toBeVisible();
    await expect(editor.locator('ol')).toBeVisible();
    await expect(editor.locator('li').first()).toContainText('Item one');
  });

  test('renders blockquotes', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await expect(editor.locator('blockquote')).toContainText('This is a blockquote');
  });

  test('renders horizontal rules', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await expect(editor.locator('hr')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3. Tab management
// ---------------------------------------------------------------------------

test.describe('Tabs', () => {
  test('opens multiple files in separate tabs', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    await expect(page.locator('.tab')).toHaveCount(1);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc2.md'));

    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tab').nth(0)).toContainText('doc1.md');
    await expect(page.locator('.tab').nth(1)).toContainText('doc2.md');
  });

  test('switches between tabs', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc2.md'));

    await expect(page.locator('.tab')).toHaveCount(2);

    // Second tab should be active (most recently opened)
    await expect(page.locator('.tab.active')).toContainText('doc2.md');

    // Click first tab
    await page.locator('.tab').nth(0).click();
    await expect(page.locator('.tab.active')).toContainText('doc1.md');

    const visibleEditor = page.locator('.editor-tab-pane:visible .tiptap');
    await expect(visibleEditor).toContainText('Document One');
  });

  test('does not duplicate tab for the same file', async () => {
    ({ app, page } = await launchApp());

    const filePath = fixturePath('test-project/doc1.md');

    await app.evaluate(({ BrowserWindow }, fp) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
    }, filePath);

    await expect(page.locator('.tab')).toHaveCount(1);

    // Open same file again
    await app.evaluate(({ BrowserWindow }, fp) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
    }, filePath);

    await expect(page.locator('.tab')).toHaveCount(1);
  });

  test('closes a tab via close button', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    await expect(page.locator('.tab')).toHaveCount(1);

    await page.locator('.tab-close').click();
    await expect(page.locator('.tab')).toHaveCount(0);
    await expect(page.locator('.empty-state')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. Editing and dirty state
// ---------------------------------------------------------------------------

test.describe('Editing', () => {
  test('typing in editor marks tab as dirty', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // No dirty indicator yet
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);

    // Type in the editor
    await editor.click();
    await editor.press('End');
    await editor.type(' additional text');

    // Dirty indicator should appear
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();
  });

  test('undo after opening file does not clear content', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Document One', { timeout: 5000 });

    // Press Cmd+Z (undo) -- should NOT clear the content
    await editor.click();
    await page.keyboard.press('ControlOrMeta+z');

    await expect(editor).toContainText('Document One');
  });

  test('undo button is disabled when nothing to undo', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Document One', { timeout: 5000 });

    const undoBtn = page.locator('.toolbar-btn[data-tooltip*="Undo"]');
    const redoBtn = page.locator('.toolbar-btn[data-tooltip*="Redo"]');
    await expect(undoBtn).toBeDisabled();
    await expect(redoBtn).toBeDisabled();

    // Type something -- undo should become enabled
    await editor.click();
    await editor.press('End');
    await editor.type(' extra');
    await expect(undoBtn).toBeEnabled();

    // Undo -- redo should become enabled, undo disabled again
    await page.keyboard.press('ControlOrMeta+z');
    await expect(redoBtn).toBeEnabled();
    await expect(undoBtn).toBeDisabled();
  });

  test('undo back to original state clears dirty indicator', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('test-project/doc1.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Document One', { timeout: 5000 });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);

    // Type something -- dirty dot appears
    await editor.click();
    await editor.press('End');
    await editor.type(' extra');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // Undo -- dirty dot should disappear
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);
  });

  test('save clears dirty state', async () => {
    ({ app, page } = await launchApp());

    // Use a temporary copy so we don't modify fixtures
    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'test.md');
    fs.copyFileSync(fixturePath('test-project/doc1.md'), tmpFile);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.click();
    await editor.press('End');
    await editor.type(' more text');

    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // Send save command
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });

    // Wait for dirty dot to disappear
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    // Verify file was actually written
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('more text');

    // Cleanup
  });

  test('save still works after closing a different, inactive tab', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const first = path.join(tmpDir, 'first.md');
    const second = path.join(tmpDir, 'second.md');
    fs.copyFileSync(fixturePath('test-project/doc1.md'), first);
    fs.copyFileSync(fixturePath('test-project/doc2.md'), second);

    for (const filePath of [first, second]) {
      await app.evaluate(({ BrowserWindow }, p) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-file', p);
      }, filePath);
      await expect(page.locator('.tab')).toHaveCount(filePath === first ? 1 : 2);
    }

    // second.md is active; close first.md from its own close button.
    await page.locator('.tab').nth(0).locator('.tab-close').click();
    await expect(page.locator('.tab')).toHaveCount(1);

    const editor = page.locator('.tiptap');
    await editor.click();
    await editor.press('End');
    await editor.type(' saved after close');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });

    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });
    expect(fs.readFileSync(second, 'utf-8')).toContain('saved after close');
  });

  test('closing a tab left of the active one keeps the same file active', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const names = ['left.md', 'middle.md', 'right.md'];
    for (const [i, name] of names.entries()) {
      const filePath = path.join(tmpDir, name);
      fs.copyFileSync(fixturePath('test-project/doc1.md'), filePath);
      await app.evaluate(({ BrowserWindow }, p) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-file', p);
      }, filePath);
      await expect(page.locator('.tab')).toHaveCount(i + 1);
    }

    await page.locator('.tab').nth(1).click();
    await expect(page.locator('.tab.active .tab-name')).toHaveText('middle.md');

    await page.locator('.tab').nth(0).locator('.tab-close').click();
    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tab.active .tab-name')).toHaveText('middle.md');
  });

  test('preserves existing relative links through a load/save round-trip', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'links.md');
    // Cover the variants that exposed the bug: a relative path starting with a
    // lowercase letter and containing a slash (was being stripped), plus ones
    // that survived (leading ./, ../, digit, bare filename) and an absolute URL.
    const original = [
      'See [canon](docs/foo/00-canon.md) for details.',
      '',
      'Also [howler](../client/Howler.md) and [self](./00-canon.md).',
      '',
      'Bare [file](report.md) and [site](https://example.com).',
      '',
    ].join('\n');
    fs.writeFileSync(tmpFile, original);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // All five links should render as anchors (not collapse to plain text).
    await expect(editor.locator('a[href="docs/foo/00-canon.md"]')).toBeVisible();
    await expect(editor.locator('a[href="../client/Howler.md"]')).toBeVisible();
    await expect(editor.locator('a[href="./00-canon.md"]')).toBeVisible();
    await expect(editor.locator('a[href="report.md"]')).toBeVisible();
    await expect(editor.locator('a[href="https://example.com"]')).toBeVisible();

    // Make the doc dirty, then save.
    await editor.click();
    await editor.press('End');
    await editor.type(' edited');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    // Every link must still be present in the saved Markdown.
    const content = fs.readFileSync(tmpFile, 'utf-8');
    expect(content).toContain('[canon](docs/foo/00-canon.md)');
    expect(content).toContain('[howler](../client/Howler.md)');
    expect(content).toContain('[self](./00-canon.md)');
    expect(content).toContain('[file](report.md)');
    expect(content).toContain('[site](https://example.com)');
  });
});

// ---------------------------------------------------------------------------
// 4b. Following relative links (Cmd/Ctrl+click)
// ---------------------------------------------------------------------------

test.describe('Following links', () => {
  // 'ControlOrMeta' = Meta on macOS, Control elsewhere -- matches the app's
  // handler, which follows a link on either metaKey or ctrlKey.
  const MOD = 'ControlOrMeta' as const;

  test('Cmd+click on a relative link opens the target file in a new tab', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'Go to [the target](target.md) now.\n');
    fs.writeFileSync(path.join(tmpDir, 'target.md'), '# Target Heading\n\nHello from the target.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tab')).toHaveCount(1);

    await editor.locator('a[href="target.md"]').click({ modifiers: [MOD] });

    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tab').nth(1)).toContainText('target.md');
    // A second tab adds a second (hidden) .tiptap pane; assert against the visible one.
    await expect(page.locator('.tiptap:visible')).toContainText('Hello from the target');
  });

  test('Cmd+click resolves links relative to the source file folder', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    // index.md lives in sub/, links up-and-over to ../notes/deep.md
    fs.mkdirSync(path.join(tmpDir, 'notes'));
    fs.writeFileSync(path.join(tmpDir, 'sub', 'index.md'), 'See [deep](../notes/deep.md).\n');
    fs.writeFileSync(path.join(tmpDir, 'notes', 'deep.md'), '# Deep\n\nResolved correctly.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'sub', 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="../notes/deep.md"]').click({ modifiers: [MOD] });

    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tab').nth(1)).toContainText('deep.md');
    await expect(page.locator('.tiptap:visible')).toContainText('Resolved correctly');
  });

  test('plain click on a relative link does not open it', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'Go to [the target](target.md) now.\n');
    fs.writeFileSync(path.join(tmpDir, 'target.md'), '# Target\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="target.md"]').click();

    // A plain click places the cursor for editing -- it must not open a tab.
    await expect(page.locator('.tab')).toHaveCount(1);
  });

  test('Cmd+click on a missing link offers to create the file', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'Start a [new note](new-note.md) here.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="new-note.md"]').click({ modifiers: [MOD] });

    const dialog = page.locator('.modal-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("doesn");
    await expect(dialog).toContainText('new-note.md');

    expect(fs.existsSync(path.join(tmpDir, 'new-note.md'))).toBe(false);

    await dialog.getByRole('button', { name: 'Create & Open' }).click();

    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tab').nth(1)).toContainText('new-note.md');
    expect(fs.existsSync(path.join(tmpDir, 'new-note.md'))).toBe(true);
  });

  test('Cmd+click on a missing link can be cancelled without creating it', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'Start a [new note](nope.md) here.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="nope.md"]').click({ modifiers: [MOD] });

    const dialog = page.locator('.modal-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.tab')).toHaveCount(1);
    expect(fs.existsSync(path.join(tmpDir, 'nope.md'))).toBe(false);
  });

  test('bare relative paths resolve against the current file, not the project root', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'sub'));
    // Two files named target.md: one at the project root, one beside index.md.
    // A bare link must follow CommonMark semantics and pick the sibling, even
    // though a project root is loaded.
    fs.writeFileSync(path.join(tmpDir, 'target.md'), '# Root\n\nFrom project root.\n');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'target.md'), '# Sibling\n\nFrom current folder.\n');
    fs.writeFileSync(path.join(tmpDir, 'sub', 'index.md'), 'Bare [link](target.md) here.\n');

    await app.evaluate(({ BrowserWindow }, dir) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', dir);
    }, tmpDir);
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'sub', 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="target.md"]').click({ modifiers: [MOD] });

    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tiptap:visible')).toContainText('From current folder');
    await expect(page.locator('.tiptap:visible')).not.toContainText('From project root');
  });

  test('Cmd+click on an external link does not open a tab or a create dialog', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), 'Visit [the site](https://example.com) online.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="https://example.com"]').click({ modifiers: [MOD] });

    // External URLs route to the system browser, not a tab or the create dialog.
    await expect(page.locator('.tab')).toHaveCount(1);
    await expect(page.locator('.modal-dialog')).toHaveCount(0);
  });

  // Distance from the scroller's top edge to the heading's top edge, in px.
  async function headingOffset(heading: string): Promise<number> {
    return page.evaluate((text) => {
      const scroller = document.querySelector('.editor-content') as HTMLElement;
      const h = [...scroller.querySelectorAll('h1, h2, h3')].find((el) => el.textContent === text) as HTMLElement;
      return h.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }, heading);
  }

  const filler = Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');

  test('Cmd+click on an anchor link smooth-scrolls to the matching heading', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), `[Jump down](#the-details)\n\n${filler}\n\n## The Details\n\nDetail body.\n\n${filler}\n`);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });
    expect(await headingOffset('The Details')).toBeGreaterThan(500);

    // An instant jump fires one scroll event; an animated one fires many.
    await page.evaluate(() => {
      (window as any).__scrollEvents = 0;
      document.querySelector('.editor-content')!.addEventListener('scroll', () => (window as any).__scrollEvents++);
    });

    await editor.locator('a[href="#the-details"]').click({ modifiers: [MOD] });

    await expect.poll(() => headingOffset('The Details'), { timeout: 3000 }).toBeLessThan(40);
    expect(await page.evaluate(() => (window as any).__scrollEvents)).toBeGreaterThan(1);
    await expect(page.locator('.tab')).toHaveCount(1);
  });

  test('anchor links use GitHub slugs, including punctuation and duplicate headings', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'index.md'),
      `[second setup](#setup-1) and [news](#whats-new-in-v2)\n\n## Setup\n\n${filler}\n\n## What's New in v2?\n\n${filler}\n\n## Setup\n\nThe second one.\n\n${filler}\n`,
    );

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="#whats-new-in-v2"]').click({ modifiers: [MOD] });
    await expect.poll(() => headingOffset("What's New in v2?"), { timeout: 3000 }).toBeLessThan(40);

    await editor.locator('a[href="#setup-1"]').click({ modifiers: [MOD] });
    // The second "Setup" lands at the top; the first one is far above it.
    const setupOffsets = () => page.evaluate(() => {
      const scroller = document.querySelector('.editor-content') as HTMLElement;
      const setups = [...scroller.querySelectorAll('h2')].filter((el) => el.textContent === 'Setup');
      return setups.map((el) => el.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    });
    await expect.poll(async () => (await setupOffsets())[1], { timeout: 3000 }).toBeLessThan(40);
    expect((await setupOffsets())[0]).toBeLessThan(0);
  });

  test('Cmd+click on an anchor into a folded section unfolds it and scrolls there', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), `[inner](#inner)\n\n## Outer\n\n${filler}\n\n### Inner\n\nInner body.\n\n${filler}\n\n## After\n`);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('h2', { hasText: 'Outer' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press(`${MOD}+.`);
    const inner = editor.locator('h3', { hasText: 'Inner' });
    await expect(inner).toBeHidden();

    await editor.locator('a[href="#inner"]').click({ modifiers: [MOD] });

    await expect(inner).toBeVisible();
    await expect.poll(() => headingOffset('Inner'), { timeout: 3000 }).toBeLessThan(40);
  });

  test('Cmd+click on an anchor with no matching heading says so', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.md'), `[broken](#nowhere)\n\n## Somewhere\n\nBody.\n`);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, path.join(tmpDir, 'index.md'));

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.locator('a[href="#nowhere"]').click({ modifiers: [MOD] });

    await expect(page.locator('.toast')).toContainText('#nowhere');
    await expect(page.locator('.modal-dialog')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 5. Toolbar
// ---------------------------------------------------------------------------

test.describe('Toolbar', () => {
  test('toolbar is visible when a file is open', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    await expect(page.locator('.toolbar-select')).toBeVisible({ timeout: 10000 });

    await expect(page.locator('.toolbar')).toBeVisible();
    await expect(page.locator('.toolbar-btn').first()).toBeVisible();
  });

  test('bold button toggles bold on selected text', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'toolbar-test.md');
    fs.writeFileSync(tmpFile, '# Test\n\nSome plain text here.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.toolbar-select')).toBeVisible({ timeout: 10000 });

    const editor = page.locator('.tiptap');
    const paragraph = editor.locator('p');
    await paragraph.click();
    await page.keyboard.press('ControlOrMeta+a');

    const boldBtn = page.locator('.toolbar-btn[data-tooltip*="Bold"]');
    await boldBtn.click();

    await expect(boldBtn).toHaveClass(/active/);

  });

  test('heading dropdown changes heading level', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'heading-test.md');
    fs.writeFileSync(tmpFile, 'Just a paragraph.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.toolbar-select')).toBeVisible({ timeout: 10000 });

    const editor = page.locator('.tiptap');
    await editor.locator('p').click();

    await page.locator('.toolbar-select').selectOption('2');

    await expect(editor.locator('h2')).toBeVisible();

  });

  // Visibility persists in the real mde-state.json the whole suite shares, so every
  // test that hides the toolbar must show it again or later toolbar tests fail.
  test('collapse caret hides the toolbar, expand button restores it, and the choice survives a relaunch', async () => {
    ({ app, page } = await launchApp());
    try {
      await app.evaluate(({ BrowserWindow }, filePath) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
      }, fixturePath('sample.md'));
      await expect(page.locator('.toolbar-select')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.qa-toolbar-expand')).toHaveCount(0);

      const editorTop = () => page.locator('.tiptap').evaluate(el => el.getBoundingClientRect().top);
      const toolbarHeight = await page.locator('.toolbar').evaluate(el => el.getBoundingClientRect().height);
      const topWithToolbar = await editorTop();

      await page.locator('.qa-toolbar-collapse').click();
      await expect(page.locator('.toolbar')).toHaveCount(0);
      await expect(page.locator('.qa-toolbar-expand')).toBeVisible();

      // The expand button floats over the text: it reclaims the toolbar's full height
      // and stays button-sized rather than stretching across the editor.
      expect(topWithToolbar - await editorTop()).toBeCloseTo(toolbarHeight, 0);
      const expandBox = (await page.locator('.qa-toolbar-expand').boundingBox())!;
      expect(expandBox.width).toBeLessThan(60);

      await app.close();
      ({ app, page } = await launchApp());
      await app.evaluate(({ BrowserWindow }, filePath) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
      }, fixturePath('sample.md'));
      await expect(page.locator('.tiptap')).toBeVisible({ timeout: 10000 });
      await expect(page.locator('.qa-toolbar-expand')).toBeVisible();
      await expect(page.locator('.toolbar')).toHaveCount(0);

      await page.locator('.qa-toolbar-expand').click();
      await expect(page.locator('.toolbar-select')).toBeVisible();
      await expect(page.locator('.qa-toolbar-expand')).toHaveCount(0);
    } finally {
      await page.evaluate(() => window.mde.setToolbar(true));
    }
  });

  test('View > Toggle Toolbar hides and shows the toolbar', async () => {
    ({ app, page } = await launchApp());
    try {
      await app.evaluate(({ BrowserWindow }, filePath) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
      }, fixturePath('sample.md'));
      await expect(page.locator('.toolbar-select')).toBeVisible({ timeout: 10000 });

      const clickToggle = () => app.evaluate(({ Menu }) => {
        const view = Menu.getApplicationMenu()!.items.find(i => i.label === 'View')!;
        view.submenu!.items.find(i => i.label === 'Toggle Toolbar')!.click();
      });

      await clickToggle();
      await expect(page.locator('.toolbar')).toHaveCount(0);
      await expect(page.locator('.qa-toolbar-expand')).toBeVisible();

      await clickToggle();
      await expect(page.locator('.toolbar-select')).toBeVisible();
      await expect(page.locator('.qa-toolbar-expand')).toHaveCount(0);
    } finally {
      await page.evaluate(() => window.mde.setToolbar(true));
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Document outline
// ---------------------------------------------------------------------------

test.describe('Document outline', () => {
  test('shows headings in the outline sidebar', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    await expect(page.locator('.tiptap')).toBeVisible({ timeout: 5000 });

    // Switch to outline tab
    await page.locator('.sidebar-tab[title="Document Outline"]').click();

    // Should show headings
    await expect(page.locator('.outline-item')).not.toHaveCount(0, { timeout: 5000 });
    await expect(page.locator('.outline-h1')).toContainText('Sample Document');
    await expect(page.locator('.outline-h2').first()).toContainText('Section One');
    await expect(page.locator('.outline-h3')).toContainText('Subsection');
  });

  test('clicking outline heading scrolls to it', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    await expect(page.locator('.tiptap')).toBeVisible({ timeout: 5000 });

    await page.locator('.sidebar-tab[title="Document Outline"]').click();
    await expect(page.locator('.outline-item')).not.toHaveCount(0, { timeout: 5000 });

    // Click "Section Two" in outline
    await page.locator('.outline-item', { hasText: 'Section Two' }).click();

    // The editor should have focus
    await expect(page.locator('.tiptap')).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// 7. File explorer sidebar
// ---------------------------------------------------------------------------

test.describe('File explorer', () => {
  test('shows project files when project root is set', async () => {
    ({ app, page } = await launchApp());

    const projectDir = fixturePath('test-project');
    await app.evaluate(({ BrowserWindow }, dir) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', dir);
    }, projectDir);

    // File explorer should show the project root header
    await expect(page.locator('.tree-root-header')).toBeVisible({ timeout: 5000 });

    // Should see .md files
    await expect(page.locator('.tree-file', { hasText: 'doc1.md' })).toBeVisible();
    await expect(page.locator('.tree-file', { hasText: 'doc2.md' })).toBeVisible();
  });

  test('clicking a file in explorer opens it', async () => {
    ({ app, page } = await launchApp());

    const projectDir = fixturePath('test-project');
    await app.evaluate(({ BrowserWindow }, dir) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', dir);
    }, projectDir);

    await expect(page.locator('.tree-file', { hasText: 'doc1.md' })).toBeVisible({ timeout: 5000 });

    await page.locator('.tree-file', { hasText: 'doc1.md' }).click();

    // Tab should appear
    await expect(page.locator('.tab')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tab')).toContainText('doc1.md');

    // Content should be loaded
    await expect(page.locator('.tiptap')).toContainText('Document One');
  });

  test('expandable subfolder in explorer', async () => {
    ({ app, page } = await launchApp());

    const projectDir = fixturePath('test-project');
    await app.evaluate(({ BrowserWindow }, dir) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', dir);
    }, projectDir);

    await expect(page.locator('.tree-folder', { hasText: 'subfolder' })).toBeVisible({ timeout: 5000 });

    // Click to expand subfolder
    await page.locator('.tree-folder', { hasText: 'subfolder' }).click();

    // Should see nested file
    await expect(page.locator('.tree-file', { hasText: 'nested.md' })).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 8. Find and replace
// ---------------------------------------------------------------------------

test.describe('Find and replace', () => {
  test('opens find bar with Cmd+F via IPC', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    await expect(page.locator('.tiptap')).toBeVisible({ timeout: 5000 });

    // Trigger find via IPC (simulates menu Cmd+F)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('toggle-find');
    });

    await expect(page.locator('.find-bar')).toBeVisible();
    await expect(page.locator('.find-bar-input').first()).toBeFocused();
  });

  test('searching highlights matches and shows count', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    await expect(page.locator('.tiptap')).toBeVisible({ timeout: 5000 });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('toggle-find');
    });

    const searchInput = page.locator('.find-bar-input').first();
    await searchInput.fill('Section');

    // Should show match count
    const count = page.locator('.find-bar-count');
    await expect(count).not.toHaveText('', { timeout: 3000 });
    await expect(count).toContainText('/');
  });

  test('close find bar with Escape', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));

    await expect(page.locator('.tiptap')).toBeVisible({ timeout: 5000 });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('toggle-find');
    });

    await expect(page.locator('.find-bar')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('.find-bar')).toBeHidden();
  });

  test('cross-file Replace in All Files writes to disk through the guarded path', async () => {
    // FindBar's bulk replace now routes through writeFileIfUnchanged (the only write path).
    // This proves that swap still writes files on disk correctly.
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const fileA = path.join(tmpDir, 'a.md');
    const fileB = path.join(tmpDir, 'b.md');
    fs.writeFileSync(fileA, '# Doc A\n\nContains FINDME here.\n');
    fs.writeFileSync(fileB, '# Doc B\n\nAlso FINDME twice: FINDME.\n');

    // Set the project root, then open one file so the editor + FindBar are available.
    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fileA);
    await expect(page.locator('.tiptap')).toContainText('Doc A', { timeout: 5000 });

    // Open find, switch to all-files mode, search.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('toggle-find');
    });
    await page.locator('button[title="Search all project files"]').click();
    await page.locator('input[placeholder="Find..."]').fill('FINDME');

    // Wait for the cross-file search to find matches (count shows "N in Mf").
    await expect(page.locator('.find-bar-count')).toContainText('in', { timeout: 5000 });

    // Enter a replacement and run Replace in All Files -> confirm.
    await page.locator('input[placeholder="Replace..."]').fill('REPLACED');
    await page.locator('button:has-text("Replace in All Files")').click();
    await page.locator('.find-bar-confirm-label').waitFor({ timeout: 3000 });
    await page.locator('.find-bar-btn.btn-primary').click();

    // Both files on disk must be rewritten with the replacement.
    await expect.poll(() => fs.readFileSync(fileA, 'utf-8'), { timeout: 5000 })
      .toBe('# Doc A\n\nContains REPLACED here.\n');
    await expect.poll(() => fs.readFileSync(fileB, 'utf-8'), { timeout: 5000 })
      .toBe('# Doc B\n\nAlso REPLACED twice: REPLACED.\n');
  });
});

// ---------------------------------------------------------------------------
// 9. File conflict detection
// ---------------------------------------------------------------------------

test.describe('File conflict detection', () => {
  test('silently reloads when file changes and buffer is clean', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'conflict.md');
    fs.writeFileSync(tmpFile, '# Original Content\n\nHello world.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.tiptap')).toContainText('Original Content', { timeout: 5000 });

    // Modify file on disk
    fs.writeFileSync(tmpFile, '# Updated Content\n\nChanged externally.\n');

    // Trigger the file-changed event manually (since watcher timing varies)
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file-changed', filePath);
    }, tmpFile);

    // Should silently reload -- no conflict banner, no dirty dot
    await expect(page.locator('.tiptap')).toContainText('Updated Content', { timeout: 5000 });
    await expect(page.locator('.conflict-banner')).toBeHidden();
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);

    // Second external change should also silently reload (not show conflict)
    fs.writeFileSync(tmpFile, '# Second Update\n\nChanged again.\n');
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file-changed', filePath);
    }, tmpFile);

    await expect(page.locator('.tiptap')).toContainText('Second Update', { timeout: 5000 });
    await expect(page.locator('.conflict-banner')).toBeHidden();
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);

  });

  test('shows conflict banner when file changes and buffer is dirty', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'conflict.md');
    fs.writeFileSync(tmpFile, '# Original\n\nSome text.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Make the buffer dirty
    await editor.click();
    await editor.press('End');
    await editor.type(' my local changes');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // Modify file on disk
    fs.writeFileSync(tmpFile, '# Changed on Disk\n\nExternal edit.\n');

    // Trigger file-changed
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file-changed', filePath);
    }, tmpFile);

    // Conflict banner should appear
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.conflict-banner-text')).toContainText('modified on disk');

    // Should have Reload and Save As buttons
    await expect(page.locator('.conflict-btn-reload')).toBeVisible();
    await expect(page.locator('.conflict-btn-saveas')).toBeVisible();

  });

  test('reload from disk dismisses conflict banner', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'conflict.md');
    fs.writeFileSync(tmpFile, '# Original\n\nText.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Dirty the buffer
    await editor.click();
    await editor.type(' dirty');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // External change
    fs.writeFileSync(tmpFile, '# Reloaded Content\n\nNew stuff.\n');
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file-changed', filePath);
    }, tmpFile);

    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 5000 });

    // Click reload
    await page.locator('.conflict-btn-reload').click();

    // Banner should go away, content should update
    await expect(page.locator('.conflict-banner')).toBeHidden({ timeout: 5000 });
    await expect(editor).toContainText('Reloaded Content');
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);

  });

  test('save REFUSES to overwrite a file that changed on disk without a watcher event', async () => {
    // The bulletproof backstop: even if the file watcher misses an external change
    // entirely (no file-changed event fires), a save must NOT clobber the newer
    // on-disk version. It must detect the hash mismatch and raise the conflict banner.
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'guard.md');
    fs.writeFileSync(tmpFile, '# Original\n\nAs loaded.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('As loaded', { timeout: 5000 });

    // Make local edits (dirty buffer).
    await editor.click();
    await editor.press('End');
    await editor.type(' plus my local edit');
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // Someone else rewrites the file on disk -- and crucially we DO NOT send a
    // file-changed event, simulating a watcher that failed to notice.
    const externalContent = '# Someone Elses Important Work\n\nMust not be lost.\n';
    fs.writeFileSync(tmpFile, externalContent);

    // Attempt to save.
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });

    // The save must be refused: conflict banner appears, dirty dot remains.
    await expect(page.locator('.conflict-banner')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tab-dirty-dot')).toBeVisible();

    // And the on-disk file must STILL be the external version, untouched.
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe(externalContent);
  });

  test('auto-reload shows a blue reload-notice banner that auto-dismisses after ~5s', async () => {
    // Positive proof to the user that live change-detection is working.
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'notice.md');
    fs.writeFileSync(tmpFile, '# Original\n\nText.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Original', { timeout: 5000 });

    // External change on a clean buffer -> silent reload.
    fs.writeFileSync(tmpFile, '# Reloaded\n\nFresh from disk.\n');
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('file-changed', filePath);
    }, tmpFile);

    await expect(editor).toContainText('Reloaded', { timeout: 5000 });

    // The blue banner appears and names the file.
    const notice = page.locator('.reload-notice');
    await expect(notice).toBeVisible({ timeout: 5000 });
    await expect(notice).toContainText('notice.md');

    // It overlays the editor rather than pushing the buffer down: the notice sits at
    // the very top of the editor area, above where the editor text begins.
    const noticeBox = await notice.boundingBox();
    const editorBox = await editor.boundingBox();
    expect(noticeBox!.y).toBeLessThan(editorBox!.y + 8);

    // And it auto-dismisses after ~5s, without any typing.
    await expect(notice).toBeHidden({ timeout: 8000 });
  });

  test('auto-reload survives an atomic replace (write temp + rename) via the real watcher', async () => {
    // The actual regression: editors and Claude save atomically (write a temp file,
    // then rename it over the target). fs.watch on the file's inode dies on that
    // rename; watching the directory survives it. No manual file-changed here --
    // this exercises the real watcher end to end.
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'atomic.md');
    fs.writeFileSync(tmpFile, '# Before\n\nOriginal body.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Before', { timeout: 5000 });

    // Give the watcher a beat to attach, then replace atomically.
    await page.waitForTimeout(300);
    const tmpNew = path.join(tmpDir, '.atomic.md.tmp');
    fs.writeFileSync(tmpNew, '# After Atomic Replace\n\nRenamed into place.\n');
    fs.renameSync(tmpNew, tmpFile);

    // The editor should auto-reload from the real watcher event -- no conflict.
    await expect(editor).toContainText('After Atomic Replace', { timeout: 10000 });
    await expect(page.locator('.conflict-banner')).toBeHidden();
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);
    await expect(page.locator('.reload-notice')).toBeVisible({ timeout: 5000 });
  });

  test('closing a file in one window does not stop another window from auto-reloading it', async () => {
    // Watches are shared by every window. If one window's unwatch drops the file for all of
    // them, the other window silently shows a stale buffer from then on.
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'shared.md');
    fs.writeFileSync(tmpFile, '# Before\n\nOriginal body.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);
    await expect(page.locator('.tiptap')).toContainText('Before', { timeout: 5000 });

    // A second window on the same folder, with the same file open.
    const secondWindowPromise = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }, dir) => {
      electronApp.emit('open-file', { preventDefault() {} }, dir);
    }, tmpDir);
    const page2 = await secondWindowPromise;
    await page2.waitForSelector('.app', { timeout: 10000 });
    const win2 = await app.browserWindow(page2);
    await win2.evaluate((w, filePath) => w.webContents.send('open-file', filePath), tmpFile);
    await expect(page2.locator('.tiptap')).toContainText('Before', { timeout: 5000 });

    // The second window closes its tab.
    await page2.locator('.tab-close').click();
    await expect(page2.locator('.tab')).toHaveCount(0);

    // Replace the file atomically, and let the REAL watcher report it.
    await page.waitForTimeout(300);
    const tmpNew = path.join(tmpDir, '.shared.md.tmp');
    fs.writeFileSync(tmpNew, '# After\n\nWritten by someone else.\n');
    fs.renameSync(tmpNew, tmpFile);

    await expect(page.locator('.tiptap')).toContainText('After', { timeout: 10000 });
    await expect(page.locator('.reload-notice')).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// 10. Markdown round-trip
// ---------------------------------------------------------------------------

test.describe('Markdown round-trip', () => {
  test('save preserves markdown structure', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'roundtrip.md');
    const original = '# Heading\n\nA paragraph with **bold** and *italic*.\n\n- List item\n';
    fs.writeFileSync(tmpFile, original);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Add a small change so we can save
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' appended');

    // Save
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });

    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    const saved = fs.readFileSync(tmpFile, 'utf-8');
    expect(saved).toContain('# Heading');
    expect(saved).toContain('**bold**');
    expect(saved).toContain('*italic*');
    expect(saved).toContain('appended');

  });

  test('an ordered list nested as the first block of a bullet item round-trips unchanged', async () => {
    ({ app, page } = await launchApp());
    const source = [
      '- Plan',
      '  - Header block',
      '  - 1. Regenwatervolume',
      '    - Algemeen',
      '    - Dakoppervlakte',
      '  - 2. Infiltratie',
      '       - Tuindelen',
      '  - Bijlage',
      '',
      'end',
    ].join('\n') + '\n';
    const tmpFile = await openMarkdown(source);
    const ed = page.locator('.tiptap');

    await expect(ed.locator('ul ul > li > ol[start="2"] > li > p')).toHaveText('Infiltratie');
    // CommonMark: `    - Algemeen` sits short of `1. `'s content column, so it is a sibling list
    // inside the same bullet item, not a child of the numbered one.
    await expect(ed.locator('ul ul > li > ol + ul > li')).toHaveText(['Algemeen', 'Dakoppervlakte']);
    await expect(ed.locator('ol[start="2"] > li > ul > li')).toHaveText('Tuindelen');

    await ed.locator('p').last().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');

    expect(await saveAndRead(tmpFile)).toBe(source.replace('end\n', 'end!\n'));
  });
});

// ---------------------------------------------------------------------------
// 11. PDF / DOCX import conversion
// ---------------------------------------------------------------------------

test.describe('Import conversion', () => {
  test('converts PDF to markdown', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const pdfSrc = fixturePath('sample-20-page-pdf-a4-size.pdf');
    const pdfDst = path.join(tmpDir, 'sample.pdf');
    fs.copyFileSync(pdfSrc, pdfDst);

    const result: any = await page.evaluate(
      (fp: string) => (window as any).mde.convertImport(fp),
      pdfDst
    );

    expect(result).toHaveProperty('mdPath');
    expect(result.mdPath).toBe(path.join(tmpDir, 'sample.pdf.md'));
    expect(fs.existsSync(result.mdPath)).toBe(true);
    const content = fs.readFileSync(result.mdPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    // The source is left exactly where it was -- no rename, no backup, no hiding.
    expect(fs.existsSync(pdfDst)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'sample.bak.pdf'))).toBe(false);

  });

  test('converts DOCX to markdown', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const docxSrc = fixturePath('sample-files.com-large-document.docx');
    const docxDst = path.join(tmpDir, 'sample.docx');
    fs.copyFileSync(docxSrc, docxDst);

    const result: any = await page.evaluate(
      (fp: string) => (window as any).mde.convertImport(fp),
      docxDst
    );

    expect(result).toHaveProperty('mdPath');
    expect(result.mdPath).toBe(path.join(tmpDir, 'sample.docx.md'));
    expect(fs.existsSync(result.mdPath)).toBe(true);
    const content = fs.readFileSync(result.mdPath, 'utf-8');
    expect(content.length).toBeGreaterThan(0);
    expect(fs.existsSync(docxDst)).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, 'sample.bak.docx'))).toBe(false);

  });

  test('the converted source stays visible in the sidebar', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'report.docx'), 'not really a docx');
    fs.writeFileSync(path.join(tmpDir, 'report.docx.md'), '# Converted\n');

    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    const names = page.locator('.sidebar .tree-name');
    await expect(names.filter({ hasText: /^report\.docx\.md$/ })).toHaveCount(1, { timeout: 5000 });
    // Previously the source would have been renamed to report.bak.docx and hidden from
    // the listing entirely; now it stays put under its own name.
    await expect(names.filter({ hasText: /^report\.docx$/ })).toHaveCount(1);
  });

  test('clicking an already-converted file offers to open the Markdown, not reconvert', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const docxSrc = fixturePath('sample-files.com-large-document.docx');
    const docxDst = path.join(tmpDir, 'sample.docx');
    fs.copyFileSync(docxSrc, docxDst);
    fs.writeFileSync(path.join(tmpDir, 'sample.docx.md'), '# Already converted\n\nEdited by hand.\n');

    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    await page.locator('.sidebar .tree-name').filter({ hasText: /^sample\.docx$/ }).click();

    const dialog = page.locator('.qa-import-exists');
    await expect(dialog).toBeVisible({ timeout: 5000 });
    await expect(dialog).toContainText('Already converted');
    // The convert-from-scratch dialog must NOT be the one shown.
    await expect(page.locator('.qa-import-confirm')).toHaveCount(0);

    await dialog.locator('.qa-open-existing').click();

    // Opens the existing Markdown, with its hand edits intact -- nothing reconverted.
    await expect(page.locator('.tiptap')).toContainText('Edited by hand', { timeout: 5000 });
    expect(fs.readFileSync(path.join(tmpDir, 'sample.docx.md'), 'utf-8')).toContain('Edited by hand');
    expect(fs.existsSync(path.join(tmpDir, 'sample.docx.2.md'))).toBe(false);
  });

  test('"Convert again" writes a numbered copy and never overwrites the existing Markdown', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const docxSrc = fixturePath('sample-files.com-large-document.docx');
    const docxDst = path.join(tmpDir, 'sample.docx');
    fs.copyFileSync(docxSrc, docxDst);
    const existingMd = path.join(tmpDir, 'sample.docx.md');
    fs.writeFileSync(existingMd, '# Already converted\n\nEdited by hand.\n');

    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    await page.locator('.sidebar .tree-name').filter({ hasText: /^sample\.docx$/ }).click();
    await page.locator('.qa-import-exists .qa-reconvert').click();

    const secondMd = path.join(tmpDir, 'sample.docx.2.md');
    await expect.poll(() => fs.existsSync(secondMd), { timeout: 15000 }).toBe(true);

    // The hand-edited original is untouched, and the new copy holds real converted text.
    expect(fs.readFileSync(existingMd, 'utf-8')).toBe('# Already converted\n\nEdited by hand.\n');
    expect(fs.readFileSync(secondMd, 'utf-8').length).toBeGreaterThan(100);
    expect(fs.existsSync(docxDst)).toBe(true);

    // A third conversion numbers upward rather than reusing .2.
    const third: any = await page.evaluate(
      (fp: string) => (window as any).mde.convertImport(fp, { newCopy: true }),
      docxDst
    );
    expect(third.mdPath).toBe(path.join(tmpDir, 'sample.docx.3.md'));
  });
});

// ---------------------------------------------------------------------------
// 12. Todo lists
// ---------------------------------------------------------------------------

test.describe('Todo lists', () => {
  test('todo list toolbar button creates a task list', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'todo.md');
    fs.writeFileSync(tmpFile, '# Todo\n\nSome text.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('My task');

    // Select the line
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+End');

    // Click todo list toolbar button
    await page.locator('.toolbar-btn[data-tooltip*="Todo"]').click();

    // Verify task item is rendered with data-checked attribute
    await expect(editor.locator('li[data-checked]')).toBeVisible();

  });

  test('todo list round-trips through markdown save', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'todo.md');
    fs.writeFileSync(tmpFile, '# Tasks\n\n- [ ] Unchecked\n- [x] Checked\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toBeVisible({ timeout: 5000 });

    // Verify both task items render
    await expect(editor.locator('li[data-checked]')).toHaveCount(2);

    // Add a change to trigger save
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');

    // Save
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    const saved = fs.readFileSync(tmpFile, 'utf-8');
    expect(saved).toContain('- [ ]');
    expect(saved).toContain('- [x]');

  });

  test('mixed bullet and task items render without spurious checkboxes', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'mixed.md');
    fs.writeFileSync(tmpFile, '- one\n- [ ] two\n- three\n- [x] four\n- five\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('one', { timeout: 5000 });

    // Only 2 task items (for "two" and "four"), not 3 or 5
    await expect(editor.locator('li[data-checked]')).toHaveCount(2);

    // Bullet items should be plain list items without data-checked
    const bulletItems = editor.locator('li:not([data-checked])');
    await expect(bulletItems).toHaveCount(3);
    await expect(bulletItems.nth(0)).toContainText('one');
    await expect(bulletItems.nth(1)).toContainText('three');
    await expect(bulletItems.nth(2)).toContainText('five');

    // Task items should have correct checked state
    const taskItems = editor.locator('li[data-checked]');
    await expect(taskItems).toHaveCount(2);
    await expect(taskItems.nth(0)).toContainText('two');
    await expect(taskItems.nth(1)).toContainText('four');
    await expect(taskItems.nth(0)).toHaveAttribute('data-checked', 'false');
    await expect(taskItems.nth(1)).toHaveAttribute('data-checked', 'true');

    // All items should be in a single <ul> (no list splitting)
    await expect(editor.locator('ul')).toHaveCount(1);

    // Round-trip: save and verify markdown is correct
    await editor.click();
    await page.keyboard.type(' ');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    const saved = fs.readFileSync(tmpFile, 'utf-8');
    expect(saved).toContain('- one');
    expect(saved).toContain('- [ ] two');
    expect(saved).toContain('- three');
    expect(saved).toContain('- [x] four');
    expect(saved).toContain('- five');
    // No blank lines between adjacent list items
    expect(saved).not.toMatch(/^- .+\n\n- /m);

  });

  test('save after cycling statuses has no blank lines between list items', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'cycle-gaps.md');
    fs.writeFileSync(tmpFile, '- alpha\n- beta\n- gamma\n- delta\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('alpha', { timeout: 5000 });

    // Select beta+gamma via mouse drag and cycle a few times
    const betaP = editor.locator('li:nth-child(2) p');
    const gammaP = editor.locator('li:nth-child(3) p');
    const betaBox = await betaP.boundingBox();
    const gammaBox = await gammaP.boundingBox();
    await page.mouse.move(betaBox!.x + 2, betaBox!.y + betaBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(gammaBox!.x + gammaBox!.width - 2, gammaBox!.y + gammaBox!.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Cycle: bullet -> unchecked -> checked -> bullet
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(100);
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(100);
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    // Save and check for gaps
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    // Wait for the save to actually hit disk. The dirty-dot already cleared
    // because the 3x cycle reverted items to their original bullet state, so
    // it can't gate the write -- poll the file to avoid racing writeFile's
    // truncate-then-write window (which would read an empty string).
    await expect.poll(() => fs.readFileSync(tmpFile, 'utf-8')).toContain('- alpha');

    const saved = fs.readFileSync(tmpFile, 'utf-8');
    // All items should be contiguous with no blank lines between them
    expect(saved).not.toMatch(/^- .+\n\n+- /m);
    expect(saved).toContain('- beta');
    expect(saved).toContain('- gamma');
    expect(saved).toContain('- delta');

  });

  test('copy single list item omits leading hyphen', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'copy.md');
    fs.writeFileSync(tmpFile, '- alpha\n- beta\n- gamma\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('alpha', { timeout: 5000 });

    // Select just "beta" text by clicking and Cmd+A within the item (use triple-click)
    const betaLi = editor.locator('li', { hasText: 'beta' });
    await betaLi.click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+c');

    // Read clipboard
    const clipSingle = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipSingle.trim()).toBe('beta');

    // Now select all three items and copy
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    const clipMulti = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipMulti).toContain('- alpha');
    expect(clipMulti).toContain('- beta');
    expect(clipMulti).toContain('- gamma');
    // No blank lines between items
    expect(clipMulti).not.toMatch(/^- .+\n\n+- /m);

  });

  test('nested mixed bullet and task items render correctly', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'nested.md');
    fs.writeFileSync(tmpFile, '- foo\n- [ ] bar\n  - baz\n  - [x] done\n- plain\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('foo', { timeout: 5000 });

    // All items should render
    await expect(editor).toContainText('baz');
    await expect(editor).toContainText('done');

    // Correct task item count: "bar" (unchecked) and "done" (checked)
    await expect(editor.locator('li[data-checked]')).toHaveCount(2);
    await expect(editor.locator('li[data-checked="false"]')).toHaveCount(1);
    await expect(editor.locator('li[data-checked="true"]')).toHaveCount(1);

    // Nested list exists
    await expect(editor.locator('ul ul')).toHaveCount(1);

    // Round-trip save
    await editor.click();
    await page.keyboard.type(' ');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    const saved = fs.readFileSync(tmpFile, 'utf-8');
    expect(saved).toContain('- foo');
    expect(saved).toContain('- [ ] bar');
    expect(saved).toContain('  - baz');
    expect(saved).toContain('  - [x] done');
    expect(saved).toContain('- plain');

  });
});

// ---------------------------------------------------------------------------
// 13. Keyboard Shortcuts help page
// ---------------------------------------------------------------------------

test.describe('Keyboard Shortcuts', () => {
  test('opens keyboard shortcuts tab from Help menu', async () => {
    ({ app, page } = await launchApp());

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('show-keyboard-shortcuts');
    });

    const tab = page.locator('.tab');
    await expect(tab).toBeVisible({ timeout: 5000 });
    await expect(tab.locator('.tab-name')).toContainText('Keyboard Shortcuts');

    const editor = page.locator('.tiptap');
    // The shortcuts doc is authored with macOS key names; the app maps Cmd -> Ctrl
    // for Windows/Linux, so assert against the label for the current platform.
    const modLabel = process.platform === 'darwin' ? 'Cmd' : 'Ctrl';
    await expect(editor).toContainText(`${modLabel} + O`);
    await expect(editor).toContainText('Bold');
  });

  test('empty state shows keyboard shortcuts link', async () => {
    ({ app, page } = await launchApp());

    const link = page.locator('.empty-state-link');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Keyboard Shortcuts');

    await link.click();

    const tab = page.locator('.tab');
    await expect(tab).toBeVisible({ timeout: 5000 });
    await expect(tab.locator('.tab-name')).toContainText('Keyboard Shortcuts');
  });

  test('read-only tab hides toolbar and editing controls', async () => {
    ({ app, page } = await launchApp());

    // Open a normal file first so we can verify toolbar is initially visible
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, fixturePath('sample.md'));
    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 5000 });

    // Open keyboard shortcuts (read-only tab)
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('show-keyboard-shortcuts');
    });
    await expect(page.locator('.tab.active')).toContainText('Keyboard Shortcuts', { timeout: 5000 });

    // Toolbar should be hidden for read-only tab
    await expect(page.locator('.toolbar')).toBeHidden();

    // Editor should have transparent caret (read-only CSS class applied)
    await expect(page.locator('.editor-readonly')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 14. Markdown special characters
// ---------------------------------------------------------------------------

test.describe('Markdown special characters', () => {
  test('angle brackets and special chars survive round-trip', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'special.md');
    fs.writeFileSync(tmpFile, '# Comparisons\n\nApples > oranges.\n\nUse <div> tags carefully.\n\n3 < 5 is true.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Apples > oranges', { timeout: 5000 });

    // Make a trivial edit so we can save
    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

    const saved = fs.readFileSync(tmpFile, 'utf-8');
    expect(saved).toContain('Apples > oranges');
    expect(saved).toContain('<div>');
    expect(saved).toContain('3 < 5');
    // Must NOT contain HTML entities
    expect(saved).not.toContain('&gt;');
    expect(saved).not.toContain('&lt;');

  });
});

// ---------------------------------------------------------------------------
// 15. List keyboard interactions
// ---------------------------------------------------------------------------

test.describe('List keyboard interactions', () => {
  test('Tab indents list items and stays in editor at max depth', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'list.md');
    fs.writeFileSync(tmpFile, '- Alpha\n- Beta\n- Gamma\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Beta', { timeout: 5000 });

    // Focus the editor by clicking the second list item's text
    const betaText = editor.locator('p', { hasText: 'Beta' });
    await betaText.click();
    // Confirm we can type here
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect(editor).toContainText('Beta!');

    // Tab should indent the list item
    await page.keyboard.press('Tab');
    await expect(editor.locator('ul ul')).toBeVisible({ timeout: 2000 });

    // More Tabs at max nesting -- must not lose focus
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.type('X');
    await expect(editor).toContainText('Beta!X');

    // Shift+Tab outdents
    await page.keyboard.press('Shift+Tab');
    await expect(editor).toContainText('Beta!X');

  });

  test('Cmd+Enter cycles bullet, unchecked task, checked task', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'cycle.md');
    fs.writeFileSync(tmpFile, 'A plain paragraph.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('plain paragraph', { timeout: 5000 });

    // Click into the paragraph
    await editor.locator('p', { hasText: 'plain paragraph' }).click();

    // 1st Cmd+Enter: paragraph -> bullet list
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(editor.locator('li:not([data-checked])')).toBeVisible();

    // 2nd Cmd+Enter: bullet -> unchecked task
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);
    await expect(editor.locator('li[data-checked="false"]')).toBeVisible();

    // 3rd Cmd+Enter: unchecked -> checked
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);
    await expect(editor.locator('li[data-checked="true"]')).toBeVisible();

    // 4th Cmd+Enter: checked -> bullet (NOT paragraph)
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(editor.locator('li:not([data-checked])')).toBeVisible();
    await expect(editor.locator('li[data-checked]')).toHaveCount(0);

  });

  test('Cmd+Enter on mixed bullet+task selection converts all items uniformly', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'mixed.md');
    fs.writeFileSync(tmpFile, '- [ ] task item\n- bullet item\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('task item', { timeout: 5000 });

    // Select all content (Cmd+A reliably creates a ProseMirror AllSelection)
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');

    // First item is unchecked task -> target is checked task
    // Both items should become checked tasks
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked="true"]')).toHaveCount(2);

    // Cmd+Enter again WITHOUT re-selecting: selection should be preserved
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked]')).toHaveCount(0);
    await expect(editor.locator('li')).toHaveCount(2);

    // And again: bullet items -> unchecked tasks (still no re-select)
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked="false"]')).toHaveCount(2);

  });

  test('Cmd+Enter on mixed checked+unchecked tasks converts all uniformly', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'mixed3.md');
    fs.writeFileSync(tmpFile, '- [ ] alpha\n- [x] beta\n- [ ] gamma\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('alpha', { timeout: 5000 });

    // Verify initial state: 3 tasks, first unchecked
    await expect(editor.locator('li[data-checked]')).toHaveCount(3);
    await expect(editor.locator('li[data-checked]').nth(0)).toHaveAttribute('data-checked', 'false');
    await expect(editor.locator('li[data-checked]').nth(1)).toHaveAttribute('data-checked', 'true');
    await expect(editor.locator('li[data-checked]').nth(2)).toHaveAttribute('data-checked', 'false');

    // Select all: first item is unchecked task -> target = checked task
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    // All 3 should be checked
    await expect(editor.locator('li[data-checked="true"]')).toHaveCount(3);

    // Again without re-selecting (selection preserved): checked -> bullet
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked]')).toHaveCount(0);
    await expect(editor.locator('li')).toHaveCount(3);

    // Again: bullet -> unchecked task
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked="false"]')).toHaveCount(3);

  });

  test('Cmd+Enter with multi-item bullet list converts all items to tasks', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'multi.md');
    fs.writeFileSync(tmpFile, '- one\n- two\n- three\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('one', { timeout: 5000 });

    // Select all and convert bullets -> tasks
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    // All 3 items should be unchecked tasks
    await expect(editor.locator('li[data-checked="false"]')).toHaveCount(3);

    // Check all tasks
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked="true"]')).toHaveCount(3);

    // Back to bullets
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked]')).toHaveCount(0);
    await expect(editor.locator('li')).toHaveCount(3);

  });

  test('Cmd+Enter on partial selection only converts selected items, not entire list', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'partial.md');
    fs.writeFileSync(tmpFile, '- alpha\n- beta\n- gamma\n- delta\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('alpha', { timeout: 5000 });

    // Select only "beta" and "gamma" by mouse drag
    const betaP = editor.locator('li:nth-child(2) p');
    const gammaP = editor.locator('li:nth-child(3) p');
    const betaBox = await betaP.boundingBox();
    const gammaBox = await gammaP.boundingBox();
    await page.mouse.move(betaBox!.x + 2, betaBox!.y + betaBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(gammaBox!.x + gammaBox!.width - 2, gammaBox!.y + gammaBox!.height / 2);
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Cmd+Enter: only beta+gamma should become unchecked tasks
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    // alpha and delta should still be plain bullet items
    await expect(editor.locator('li[data-checked]')).toHaveCount(2);
    await expect(editor.locator('li:not([data-checked])')).toHaveCount(2);

    // The task items should be beta and gamma
    const taskItems = editor.locator('li[data-checked]');
    await expect(taskItems.nth(0)).toContainText('beta');
    await expect(taskItems.nth(1)).toContainText('gamma');

    // All items stay in one <ul> (no list splitting)
    await expect(editor.locator('ul')).toHaveCount(1);

    // Cmd+Enter again (selection preserved): unchecked -> checked
    await page.keyboard.press('ControlOrMeta+Enter');
    await page.waitForTimeout(200);

    await expect(editor.locator('li[data-checked="true"]')).toHaveCount(2);
    // alpha and delta still bullets
    await expect(editor.locator('li:not([data-checked])')).toHaveCount(2);

  });
});

// ---------------------------------------------------------------------------
// Move block (Cmd+Alt+Up/Down)
// ---------------------------------------------------------------------------

test.describe('Move block', () => {
  test('Cmd+Alt+Down moves a paragraph below the next paragraph', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'move.md');
    fs.writeFileSync(tmpFile, 'First paragraph\n\nSecond paragraph\n\nThird paragraph\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('First paragraph', { timeout: 5000 });

    // Click at start of "First paragraph"
    await editor.locator('p').first().click();
    await page.waitForTimeout(100);

    // Move it down
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await page.waitForTimeout(200);

    // Now order should be: Second, First, Third
    const paragraphs = editor.locator('p');
    await expect(paragraphs.nth(0)).toContainText('Second paragraph');
    await expect(paragraphs.nth(1)).toContainText('First paragraph');
    await expect(paragraphs.nth(2)).toContainText('Third paragraph');

  });

  test('Cmd+Alt+Up moves a list item above its sibling', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'moveli.md');
    fs.writeFileSync(tmpFile, '- Apple\n- Banana\n- Cherry\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Banana', { timeout: 5000 });

    // Click on "Banana" (second list item)
    await editor.locator('li:nth-child(2) p').click();
    await page.waitForTimeout(100);

    // Move it up
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await page.waitForTimeout(200);

    // Now order should be: Banana, Apple, Cherry
    const items = editor.locator('li');
    await expect(items.nth(0)).toContainText('Banana');
    await expect(items.nth(1)).toContainText('Apple');
    await expect(items.nth(2)).toContainText('Cherry');

  });
});

// ---------------------------------------------------------------------------
// Scroll position preservation
// ---------------------------------------------------------------------------

test.describe('Scroll position', () => {
  test('switching tabs preserves scroll position', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    // Create a long file
    const longContent = Array.from({ length: 100 }, (_, i) => `## Heading ${i}\n\nParagraph ${i} content.\n`).join('\n');
    const file1 = path.join(tmpDir, 'long.md');
    const file2 = path.join(tmpDir, 'short.md');
    fs.writeFileSync(file1, longContent);
    fs.writeFileSync(file2, '# Short file\n\nJust some text.\n');

    // Open first file
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, file1);
    await expect(page.locator('.tiptap')).toContainText('Heading 0', { timeout: 5000 });

    // Scroll down substantially via the active pane's editor-content
    await page.evaluate(() => {
      const pane = document.querySelector('.editor-tab-pane[style*="flex"]');
      const el = pane?.querySelector('.editor-content');
      if (el) el.scrollTop = 500;
    });
    await page.waitForTimeout(100);

    const scrollBefore = await page.evaluate(() => {
      const pane = document.querySelector('.editor-tab-pane[style*="flex"]');
      const el = pane?.querySelector('.editor-content');
      return el ? el.scrollTop : 0;
    });
    expect(scrollBefore).toBeGreaterThanOrEqual(400);

    // Open second file
    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, file2);
    await expect(page.locator('.tab.active')).toContainText('short.md', { timeout: 5000 });

    // Switch back to first file
    await page.locator('.tab').first().click();
    await page.waitForTimeout(500);

    // Check scroll position is restored
    const scrollAfter = await page.evaluate(() => {
      const pane = document.querySelector('.editor-tab-pane[style*="flex"]');
      const el = pane?.querySelector('.editor-content');
      return el ? el.scrollTop : 0;
    });
    expect(scrollAfter).toBeGreaterThanOrEqual(400);

  });
});

// ---------------------------------------------------------------------------
// Context menu features
// ---------------------------------------------------------------------------

test.describe('Context menu', () => {
  test('right-click on folder shows New File and New Folder options', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const subDir = path.join(tmpDir, 'subfolder');
    fs.mkdirSync(subDir);
    fs.writeFileSync(path.join(tmpDir, 'test.md'), '# Test\n');

    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    await expect(page.locator('.tree-folder')).toContainText('subfolder', { timeout: 5000 });

    // Right-click on the folder
    await page.locator('.tree-folder').filter({ hasText: 'subfolder' }).click({ button: 'right' });
    await page.waitForTimeout(200);

    // Should see New File and New Folder in context menu
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'New File' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'New Folder' })).toBeVisible();

  });

  test('Esc dismisses context menu', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'test.md'), '# Test\n');

    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    await expect(page.locator('.tree-file')).toContainText('test.md', { timeout: 5000 });

    // Right-click on the file
    await page.locator('.tree-file').filter({ hasText: 'test.md' }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await expect(page.locator('.ctx-menu')).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await expect(page.locator('.ctx-menu')).not.toBeVisible();

  });

  test('right-click on file does not show New File/New Folder', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'test.md'), '# Test\n');

    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    await expect(page.locator('.tree-file')).toContainText('test.md', { timeout: 5000 });

    // Right-click on the file
    await page.locator('.tree-file').filter({ hasText: 'test.md' }).click({ button: 'right' });
    await page.waitForTimeout(200);
    await expect(page.locator('.ctx-menu')).toBeVisible();

    // Should NOT have New File or New Folder
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'New File' })).not.toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'New Folder' })).not.toBeVisible();

    // But should still have Rename, Delete, and (since a project folder is
    // set) a real "Copy Relative Path" -- not the "Copy File Name" fallback.
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Rename' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Delete' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Copy Relative Path' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Copy File Name' })).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Click-based code folding (gray hover caret)
// ---------------------------------------------------------------------------

test.describe('Click-based code folding', () => {
  test('hovering a foldable item shows a gray caret that folds on click', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'list.md');
    fs.writeFileSync(tmpFile, '# List\n\n- Parent item\n    - Child item\n- Sibling\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Parent item', { timeout: 5000 });

    // No caret until we hover a foldable item.
    await expect(page.locator('.fold-caret')).toHaveCount(0);

    // Hover the parent item's own paragraph (it has a child sublist -> foldable).
    const parentPara = editor.locator('li', { hasText: 'Parent item' }).locator('> p').first();
    await parentPara.hover();

    const caret = page.locator('.fold-caret');
    await expect(caret).toBeVisible({ timeout: 3000 });

    // Clicking the caret folds the item: the sublist hides and the "..." badge appears.
    await caret.click();
    await expect(editor.locator('li.folded')).toBeVisible();
    await expect(editor.locator('.fold-badge')).toBeVisible();
    // The sublist is hidden (collapsed), though its text remains in the DOM.
    await expect(editor.getByText('Child item')).not.toBeVisible();

  });

  test('leaf list items show no fold caret on hover', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'list.md');
    fs.writeFileSync(tmpFile, '# List\n\n- Parent item\n    - Child item\n- Sibling\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Sibling', { timeout: 5000 });

    // "Sibling" is a leaf item (no children) -> hovering it must not show a caret.
    await editor.locator('li', { hasText: 'Sibling' }).locator('> p').first().hover();
    await page.waitForTimeout(200);
    await expect(page.locator('.fold-caret')).toHaveCount(0);

  });
});

// ---------------------------------------------------------------------------
// Fold stability across edits (fold flags live on the nodes, not on positions)
// ---------------------------------------------------------------------------

test.describe('Fold stability', () => {
  // Opens a doc where "Parent item" (with a child) is folded, plus siblings around it.
  async function openFoldedList(body: string) {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'folds.md');
    fs.writeFileSync(tmpFile, body);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Parent item', { timeout: 5000 });

    // Fold "Parent item" with Cmd+.
    await editor.locator('li', { hasText: 'Parent item' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+.');
    await expect(editor.locator('li.folded')).toContainText('Parent item');
    await expect(editor.locator('.fold-badge')).toHaveCount(1);

    return { editor, tmpFile };
  }

  test('a folded item stays folded when the sibling below it is moved above it', async () => {
    const { editor } = await openFoldedList('- Above\n- Parent item\n    - Child item\n- Below\n');

    // Cursor in the sibling BELOW the folded item, then move it up past the folded item.
    await editor.locator('li', { hasText: 'Below' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+Alt+ArrowUp');
    await page.waitForTimeout(200);

    // The folded item moved down one slot but is still folded -- and the badge did NOT
    // jump onto the item that moved.
    const items = page.locator('.tiptap > ul > li');
    await expect(items.nth(1)).toContainText('Below');
    await expect(items.nth(2)).toContainText('Parent item');
    await expect(editor.locator('.fold-badge')).toHaveCount(1);
    await expect(editor.locator('li.folded')).toContainText('Parent item');
    await expect(editor.getByText('Child item')).not.toBeVisible();
  });

  test('a folded item stays folded when the sibling above it is moved below it', async () => {
    const { editor } = await openFoldedList('- Above\n- Parent item\n    - Child item\n- Below\n');

    // Cursor in the item ABOVE the folded item, then move it down past the folded item.
    await editor.locator('li', { hasText: 'Above' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await page.waitForTimeout(200);

    const items = page.locator('.tiptap > ul > li');
    await expect(items.nth(0)).toContainText('Parent item');
    await expect(items.nth(1)).toContainText('Above');
    // Exactly one badge, and it is on the item that owns the hidden child.
    await expect(editor.locator('.fold-badge')).toHaveCount(1);
    await expect(editor.locator('li.folded')).toContainText('Parent item');
    await expect(editor.getByText('Child item')).not.toBeVisible();
  });

  test('Enter at the start of a folded item keeps the fold on the text, not the new item', async () => {
    const { editor } = await openFoldedList('- Parent item\n    - Child item\n- Below\n');

    // Put the cursor at the very start of the folded item and split it.
    await editor.locator('li', { hasText: 'Parent item' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);

    const items = page.locator('.tiptap > ul > li');
    await expect(items.nth(0)).toHaveText('');
    await expect(items.nth(1)).toContainText('Parent item');
    // The fold followed the text down; the new empty item above carries no badge.
    await expect(editor.locator('.fold-badge')).toHaveCount(1);
    await expect(editor.locator('li.folded')).toContainText('Parent item');
    await expect(editor.getByText('Child item')).not.toBeVisible();
  });

  test('Tab on the item below a folded item unfolds it instead of hiding the cursor', async () => {
    const { editor } = await openFoldedList('- Parent item\n    - Child item\n- Below\n');

    // Indenting "Below" makes it a child of the folded item -- it would vanish mid-edit.
    await editor.locator('li', { hasText: 'Below' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);

    // The fold released, so both the pre-existing child and the newly indented item show.
    await expect(editor.locator('li.folded')).toHaveCount(0);
    await expect(editor.locator('.fold-badge')).toHaveCount(0);
    await expect(editor.getByText('Child item')).toBeVisible();
    await expect(editor.getByText('Below')).toBeVisible();

    const top = page.locator('.tiptap > ul > li');
    await expect(top).toHaveCount(1);
    await expect(top.nth(0).locator('> ul > li')).toHaveCount(2);
  });

  test('Enter at the end of a folded item creates a sibling below the folded subtree', async () => {
    const { editor } = await openFoldedList('- Parent item\n    - Child item\n- Below\n');

    await editor.locator('li', { hasText: 'Parent item' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('New sibling');
    await page.waitForTimeout(200);

    // The new item is a top-level sibling sitting between the folded item and "Below" --
    // NOT a first child inside the hidden sublist.
    const top = page.locator('.tiptap > ul > li');
    await expect(top).toHaveCount(3);
    await expect(top.nth(0)).toContainText('Parent item');
    await expect(top.nth(1)).toHaveText('New sibling');
    await expect(top.nth(2)).toContainText('Below');
    // And the fold survived untouched.
    await expect(editor.locator('.fold-badge')).toHaveCount(1);
    await expect(editor.getByText('Child item')).not.toBeVisible();
  });

  test('Enter at the end of an UNFOLDED parent item still creates a first child', async () => {
    const { editor } = await openFoldedList('- Parent item\n    - Child item\n- Below\n');

    await editor.locator('li', { hasText: 'Parent item' }).locator('> p').first().click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+.'); // unfold
    await expect(editor.locator('li.folded')).toHaveCount(0);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.type('New child');
    await page.waitForTimeout(200);

    const top = page.locator('.tiptap > ul > li');
    await expect(top).toHaveCount(2);
    const children = top.nth(0).locator('> ul > li');
    await expect(children).toHaveCount(2);
    await expect(children.nth(0)).toHaveText('New child');
    await expect(children.nth(1)).toContainText('Child item');
  });

  test('folding does not mark a clean buffer dirty', async () => {
    await openFoldedList('- Parent item\n    - Child item\n- Below\n');

    // The fold flag is a node attribute, so it changes the doc -- but not the file.
    await page.waitForTimeout(300);
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Heading folding
// ---------------------------------------------------------------------------

test.describe('Heading folding', () => {
  const DOC = [
    '# Title',
    '',
    'Intro text.',
    '',
    '## Section A',
    '',
    'Body of A.',
    '',
    '### Subsection A1',
    '',
    'Body of A1.',
    '',
    '## Section B',
    '',
    'Body of B.',
    '',
  ].join('\n');

  async function openDoc() {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'headings.md');
    fs.writeFileSync(tmpFile, DOC);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Body of A', { timeout: 5000 });
    return { editor, tmpFile };
  }

  test('Cmd+. on a heading hides everything down to the next same-level heading', async () => {
    const { editor } = await openDoc();

    await editor.locator('h2', { hasText: 'Section A' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+.');
    await page.waitForTimeout(200);

    // Everything under "Section A" -- including its deeper subsection -- is hidden.
    await expect(editor.locator('h2.folded')).toContainText('Section A');
    await expect(editor.getByText('Body of A.', { exact: true })).not.toBeVisible();
    await expect(editor.getByText('Subsection A1')).not.toBeVisible();
    await expect(editor.getByText('Body of A1.')).not.toBeVisible();
    // The next same-level heading and its body are untouched.
    await expect(editor.locator('h2', { hasText: 'Section B' })).toBeVisible();
    await expect(editor.getByText('Body of B.')).toBeVisible();
    // ...and so is everything above it.
    await expect(editor.getByText('Intro text.')).toBeVisible();
  });

  test('clicking the badge unfolds a folded heading', async () => {
    const { editor } = await openDoc();

    await editor.locator('h2', { hasText: 'Section A' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+.');
    await expect(editor.locator('.fold-badge')).toHaveCount(1);

    await editor.locator('.fold-badge').click();
    await page.waitForTimeout(200);

    await expect(editor.locator('.fold-badge')).toHaveCount(0);
    await expect(editor.getByText('Body of A.', { exact: true })).toBeVisible();
    await expect(editor.getByText('Subsection A1')).toBeVisible();
  });

  test('a folded heading round-trips its hidden content back to disk unchanged', async () => {
    const { editor, tmpFile } = await openDoc();

    await editor.locator('h2', { hasText: 'Section A' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+.');
    await page.waitForTimeout(200);

    // Type into the still-visible top heading, then save.
    await editor.locator('h1').click();
    await page.waitForTimeout(150);
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('save-file');
    });
    await page.waitForTimeout(500);

    // Hidden is a rendering state, not a content state: nothing was dropped.
    expect(fs.readFileSync(tmpFile, 'utf8')).toBe(DOC.replace('# Title', '# Title!'));
  });

  test('the hover caret on a heading that just fits its line does not reflow the page', async () => {
    const { editor } = await openDoc();

    const heading = editor.locator('h2', { hasText: 'Section B' });
    // Narrow the scroller so the heading's text fills its line with 3px to spare. (Styling
    // the <h2> itself does nothing: ProseMirror rewrites its attributes on hover.)
    await heading.evaluate((h) => {
      const range = document.createRange();
      range.selectNodeContents(h);
      const spare = h.clientWidth - parseFloat(getComputedStyle(h).paddingRight) - range.getBoundingClientRect().width;
      const scroller = h.closest('.editor-content') as HTMLElement;
      scroller.style.boxSizing = 'border-box';
      scroller.style.maxWidth = `${scroller.offsetWidth - spare + 3}px`;
    });
    const layout = () => heading.evaluate((h) => ({
      height: h.getBoundingClientRect().height,
      nextTop: (h.nextElementSibling as HTMLElement).getBoundingClientRect().top,
    }));
    const before = await layout();

    await heading.hover();
    await expect(page.locator('.fold-caret')).toBeVisible({ timeout: 3000 });

    expect(await layout()).toEqual(before);
    // Nor may the caret or its (invisible but laid-out) tooltip widen the scroll area.
    const overflow = await heading.evaluate((h) => {
      const scroller = h.closest('.editor-content') as HTMLElement;
      return scroller.scrollWidth - scroller.clientWidth;
    });
    expect(overflow).toBe(0);
  });

  test('hovering a heading shows a fold caret that folds its section on click', async () => {
    const { editor } = await openDoc();

    await editor.locator('h2', { hasText: 'Section B' }).hover();
    const caret = page.locator('.fold-caret');
    await expect(caret).toBeVisible({ timeout: 3000 });
    expect(await caret.getAttribute('data-tooltip')).toContain('section');

    await caret.click();
    await expect(editor.locator('h2.folded')).toContainText('Section B');
    await expect(editor.getByText('Body of B.')).not.toBeVisible();
  });

  test('a subsection folds only down to the next heading of its own level', async () => {
    const { editor } = await openDoc();

    await editor.locator('h3', { hasText: 'Subsection A1' }).click();
    await page.waitForTimeout(150);
    await page.keyboard.press('ControlOrMeta+.');
    await page.waitForTimeout(200);

    await expect(editor.getByText('Body of A1.')).not.toBeVisible();
    // The ### fold stops at the following ## -- it does not swallow the next section.
    await expect(editor.locator('h2', { hasText: 'Section B' })).toBeVisible();
    await expect(editor.getByText('Body of B.')).toBeVisible();
    // ...and the ## above it keeps its own body visible.
    await expect(editor.getByText('Body of A.', { exact: true })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Toolbar tooltips
// ---------------------------------------------------------------------------

test.describe('Toolbar tooltips', () => {
  test('toolbar buttons expose styled tooltips hinting their shortcut', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(tmpFile, '# Heading\n\nSome text.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.toolbar')).toBeVisible({ timeout: 5000 });

    // The bold button advertises the shortcut via a data-tooltip (styled, not native title).
    const boldTooltip = await page.locator('.toolbar-btn[data-tooltip*="Bold"]').getAttribute('data-tooltip');
    expect(boldTooltip).toContain('Bold');
    expect(boldTooltip).toMatch(/Cmd|Ctrl/);
    expect(boldTooltip).toContain('B');

  });
});

// ---------------------------------------------------------------------------
// Outline default when no project folder is set
// ---------------------------------------------------------------------------

test.describe('Sidebar default mode', () => {
  test('defaults to the outline tab when a file opens with no project folder', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'doc.md');
    fs.writeFileSync(tmpFile, '# Heading One\n\n## Heading Two\n\nText.\n');

    // Explorer is the default before any file opens.
    await expect(page.locator('.sidebar-tab[title="File Explorer"]')).toHaveClass(/active/);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    // With no project folder set, the outline tab becomes active.
    await expect(page.locator('.sidebar-tab[title="Document Outline"]')).toHaveClass(/active/, { timeout: 5000 });
    await expect(page.locator('.outline-item').first()).toContainText('Heading One');

  });
});

// ---------------------------------------------------------------------------
// Opening a file when no window is open (pending-file path)
// ---------------------------------------------------------------------------

test.describe('Open file with no window', () => {
  test('creates a window and loads the file when none is open', async () => {
    test.skip(process.platform === 'win32', 'open-file/dock-reopen is macOS-only; Windows quits on window-all-closed');
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'pending.md');
    fs.writeFileSync(tmpFile, '# Pending File\n\nLoaded via pending-file path.\n');

    // Close every window but keep the app running (mac dock scenario).
    // close() is async, so wait until no windows remain -- otherwise the
    // open-file handler may still see the dying window and route the IPC to it.
    await app.evaluate(async ({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((w) => w.close());
      await new Promise<void>((resolve) => {
        const check = () => {
          if (BrowserWindow.getAllWindows().length === 0) resolve();
          else setTimeout(check, 20);
        };
        check();
      });
    });

    // Simulate a dock-drop / double-click arriving while no window exists.
    const newWindowPromise = app.waitForEvent('window');
    await app.evaluate(({ app: electronApp }, filePath) => {
      electronApp.emit('open-file', { preventDefault() {} }, filePath);
    }, tmpFile);

    const newPage = await newWindowPromise;
    await newPage.waitForSelector('.app', { timeout: 10000 });

    // The file must load (this was the intermittent empty-screen bug).
    await expect(newPage.locator('.tiptap')).toContainText('Pending File', { timeout: 5000 });

  });
});

// ---------------------------------------------------------------------------
// Copying from a table (plain-text clipboard)
// ---------------------------------------------------------------------------

test.describe('Table cell copy', () => {
  test('copying a single cell yields just its text, not "[table]"', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'table.md');
    fs.writeFileSync(tmpFile, '# Doc\n\n| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('one', { timeout: 5000 });

    // Select just the text of one cell and copy.
    await editor.locator('td', { hasText: 'one' }).click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+c');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip.trim()).toBe('one');
    expect(clip).not.toContain('[table]');

  });

  test('copying multiple cells yields tab-separated rows', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'table.md');
    fs.writeFileSync(tmpFile, '# Doc\n\n| A | B |\n| --- | --- |\n| one | two |\n| three | four |\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('four', { timeout: 5000 });

    // Drag from the first body cell to the last -> a CellSelection across all 4 body cells.
    const startCell = editor.locator('td', { hasText: 'one' });
    const endCell = editor.locator('td', { hasText: 'four' });
    const a = await startCell.boundingBox();
    const b = await endCell.boundingBox();
    if (!a || !b) throw new Error('cell bounding boxes not found');
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await page.mouse.up();

    // Confirm a multi-cell selection is active before copying.
    await expect(editor.locator('td.selectedCell')).toHaveCount(4, { timeout: 3000 });
    await page.keyboard.press('ControlOrMeta+c');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).not.toContain('[table]');
    // Cells tab-separated, rows newline-separated.
    expect(clip).toBe('one\ttwo\nthree\tfour');

  });

  test('select-all copy on mixed content keeps the prose AND the table', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'mixed.md');
    fs.writeFileSync(
      tmpFile,
      '# Big Heading\n\nIntro paragraph here.\n\n- first bullet\n- second bullet\n\n'
      + '| A | B |\n| --- | --- |\n| one | two |\n\nClosing paragraph.\n'
    );

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Closing paragraph', { timeout: 5000 });

    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // Everything selected must survive the copy -- the table used to be the only
    // thing that made it onto the clipboard.
    expect(clip).toContain('Big Heading');
    expect(clip).toContain('Intro paragraph here.');
    expect(clip).toContain('first bullet');
    expect(clip).toContain('second bullet');
    expect(clip).toContain('Closing paragraph.');
    // ...and the table comes along as a real Markdown table, not "[table]".
    expect(clip).toMatch(/\|\s*one\s*\|\s*two\s*\|/);
    expect(clip).not.toContain('[table]');

  });
});

// ---------------------------------------------------------------------------
// React render-loop guard (minified React error #185)
// ---------------------------------------------------------------------------

test.describe('Editor render stability', () => {
  // Editor's `extensions` / `editorProps` must keep a stable identity across
  // renders: useEditor diffs them on EVERY render and calls editor.setOptions()
  // -> view.setProps() + view.updateState() when they differ, which re-syncs the
  // DOM selection from React's commit phase and can be read back as a transaction
  // -> render -> setOptions -> ... until React aborts with "Maximum update depth
  // exceeded" (#185).
  //
  // CAVEAT: this is a smoke guard, not a precise reproducer. The real-world crash
  // was intermittent (roughly once a day under heavy use), so a passing run here
  // does not prove the loop is absent -- it only catches a gross regression that
  // throws during ordinary editing. The mechanism itself was verified separately
  // with temporary setOptions instrumentation (10 calls per 10 keystrokes before
  // the fix, 0 after); asserting that permanently would need a test-only global.
  test('heavy editing raises no uncaught React errors', async () => {
    ({ app, page } = await launchApp());

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'stress.md');
    fs.writeFileSync(tmpFile, '# Stress\n\nSeed paragraph.\n\n- alpha\n- beta\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Seed paragraph', { timeout: 5000 });

    await editor.locator('p', { hasText: 'Seed paragraph' }).click();
    await page.keyboard.press('End');

    // A burst of transactions: typing, mark toggles, undo/redo, selection moves --
    // each one re-renders Toolbar/TableMenu/LinkPreview and dispatches MARK_DIRTY.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.type(' word' + i, { delay: 0 });
      await page.keyboard.press('ControlOrMeta+b');
      await page.keyboard.press('ControlOrMeta+b');
    }
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ArrowRight');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ControlOrMeta+z');

    await expect(editor).toContainText('Stress');
    expect(errors.filter(m => /Minified React error #185|Maximum update depth/.test(m))).toEqual([]);
    expect(errors).toEqual([]);

  });
});

// ---------------------------------------------------------------------------
// Tools -> Word Count
// ---------------------------------------------------------------------------

test.describe('Word Count dialog', () => {
  // 12 words, 3 of them on the first line.
  const DOC = 'one two three\n\nfour five six seven eight nine ten eleven twelve\n';

  test('reports selection and whole-document word, character, and page counts', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'words.md');
    fs.writeFileSync(tmpFile, DOC);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('twelve', { timeout: 5000 });

    // Select the first paragraph only ("one two three" -- 3 words, 13 chars).
    await editor.locator('p', { hasText: 'one two three' }).click({ clickCount: 3 });

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('show-word-count');
    });

    const dialog = page.locator('.qa-word-count');
    await expect(dialog).toBeVisible({ timeout: 3000 });

    const values = dialog.locator('.word-count-value');
    await expect(values.nth(0)).toHaveText('3 / 12');
    // 13 chars selected; whole doc is both paragraphs joined by a newline.
    await expect(values.nth(1)).toHaveText(`13 / ${DOC.trim().replace(/\n\n/g, '\n').length}`);
    // 3/300 and 12/300 pages.
    await expect(values.nth(2)).toHaveText('0.0 / 0.0');

    await expect(dialog).toContainText('Word count:');
    await expect(dialog).toContainText('Character count:');
    await expect(dialog).toContainText('Est. page count:');

    // Escape closes it.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

  });

  test('shows whole-document figures alone when nothing is selected', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'words2.md');
    fs.writeFileSync(tmpFile, DOC);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('twelve', { timeout: 5000 });
    await editor.click();

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('show-word-count');
    });

    const dialog = page.locator('.qa-word-count');
    const values = dialog.locator('.word-count-value');
    // No "0 / " prefix -- just the document's own numbers.
    await expect(values.nth(0)).toHaveText('12', { timeout: 3000 });
    await expect(values.nth(2)).toHaveText('0.0');
    await expect(dialog).toContainText('Whole document');
    await expect(dialog).not.toContainText('Selection /');

  });
});

// ---------------------------------------------------------------------------
// Outline highlights the heading at the current scroll position
// ---------------------------------------------------------------------------

test.describe('Outline active heading', () => {
  test('highlights the heading scrolled to the top of the viewport', async () => {
    ({ app, page } = await launchApp());

    const filler = Array.from({ length: 20 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'long.md');
    fs.writeFileSync(tmpFile, `# First\n\n${filler}\n\n# Second\n\n${filler}\n\n# Third\n\n${filler}\n`);

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.tiptap')).toContainText('First', { timeout: 5000 });
    await page.locator('.sidebar-tab[title="Document Outline"]').click();

    const items = page.locator('.outline-item');
    await expect(items).toHaveCount(3);

    // At the top of the document, the first heading is active.
    await expect(items.nth(0)).toHaveClass(/active/, { timeout: 3000 });

    // Clicking "Second" scrolls it to the top; the outline highlight follows.
    await items.nth(1).click();
    await expect(items.nth(1)).toHaveClass(/active/, { timeout: 3000 });
    await expect(items.nth(0)).not.toHaveClass(/active/);
    await expect(items.nth(2)).not.toHaveClass(/active/);

  });
});

// ---------------------------------------------------------------------------
// Paste behavior: no auto-linking; Cmd+Shift+V plain text
// ---------------------------------------------------------------------------

test.describe('Paste behavior', () => {
  test('pasting a plain-text path does not auto-link it', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'paste.md');
    fs.writeFileSync(tmpFile, 'Start here.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Start here', { timeout: 5000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await page.evaluate(() => navigator.clipboard.writeText('docs/gameplay/09-creature-abilities.md'));
    await page.keyboard.press('ControlOrMeta+v');

    await expect(editor).toContainText('09-creature-abilities.md', { timeout: 3000 });
    // The pasted text must remain literal -- no <a> link created.
    await expect(editor.locator('a')).toHaveCount(0);
  });

  test('Cmd+Shift+V pastes as plain text without parsing Markdown', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'plain.md');
    fs.writeFileSync(tmpFile, 'Plain start.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Plain start', { timeout: 5000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await page.evaluate(() => navigator.clipboard.writeText('**not bold** text'));
    await page.keyboard.press('ControlOrMeta+Shift+V');

    // Asterisks stay literal and no bold formatting is applied.
    await expect(editor).toContainText('**not bold** text', { timeout: 3000 });
    await expect(editor.locator('strong')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Tab context menu (shares the file explorer's menu)
// ---------------------------------------------------------------------------

test.describe('Tab context menu', () => {
  test('right-clicking a tab shows the same file options as the explorer', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'tabmenu.md');
    fs.writeFileSync(tmpFile, '# Tab Menu\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.tab-name')).toContainText('tabmenu.md', { timeout: 5000 });

    await page.locator('.tab').first().click({ button: 'right' });
    await expect(page.locator('.ctx-menu')).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Rename' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Delete' })).toBeVisible();
    // No project folder is set, so there's no relative path to copy -- the
    // item degrades to "Copy File Name" rather than promising a relative path.
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Copy File Name' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Copy Relative Path' })).toHaveCount(0);
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Reveal in Finder' })).toBeVisible();
    // A file (not a folder) -- no New File / New Folder.
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'New File' })).toHaveCount(0);
  });

  test('with no project folder, Copy File Name copies just the file name', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'standalone.md');
    fs.writeFileSync(tmpFile, '# Standalone\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.tab-name')).toContainText('standalone.md', { timeout: 5000 });

    await page.locator('.tab').first().click({ button: 'right' });
    await page.locator('.ctx-menu-item').filter({ hasText: 'Copy File Name' }).click();

    // The toast echoes exactly what was copied -- the bare file name, not a
    // path. (The clipboard write itself can't be asserted in a headless
    // renderer: navigator.clipboard.writeText is rejected without window focus.)
    await expect(page.locator('.toast')).toContainText('Copied file name: standalone.md');
  });

  test('Reveal in Finder asks the OS to show the file', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'reveal.md');
    fs.writeFileSync(tmpFile, '# Reveal\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.tab-name')).toContainText('reveal.md', { timeout: 5000 });

    // Stub shell.showItemInFolder so the test stays headless (it would
    // otherwise pop open Finder/Explorer) and record what it was asked to show.
    await app.evaluate(({ shell }) => {
      (globalThis as Record<string, unknown>).__revealed = [];
      shell.showItemInFolder = (p: string) => {
        (((globalThis as Record<string, unknown>).__revealed) as string[]).push(p);
      };
    });

    await page.locator('.tab').first().click({ button: 'right' });
    await page.locator('.ctx-menu-item').filter({ hasText: 'Reveal in Finder' }).click();

    const revealed = await app.evaluate(() => (globalThis as Record<string, unknown>).__revealed);
    expect(revealed).toEqual([tmpFile]);
  });

  test('renaming a file from the tab context menu renames it on disk', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'old.md');
    fs.writeFileSync(tmpFile, '# Old\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.tab-name')).toContainText('old.md', { timeout: 5000 });

    await page.locator('.tab').first().click({ button: 'right' });
    await page.locator('.ctx-menu-item').filter({ hasText: 'Rename' }).click();

    const input = page.locator('.modal-dialog input');
    await expect(input).toBeVisible();
    await input.fill('renamed.md');
    await page.keyboard.press('Enter');

    await expect(page.locator('.tab-name')).toContainText('renamed.md', { timeout: 5000 });
    expect(fs.existsSync(path.join(tmpDir, 'renamed.md'))).toBe(true);
    expect(fs.existsSync(tmpFile)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Link bar remove-link button
// ---------------------------------------------------------------------------

test.describe('Link bar', () => {
  test('the remove-link button removes an existing link', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'link.md');
    fs.writeFileSync(tmpFile, 'hello world\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('hello world', { timeout: 5000 });

    // Select all and create a link via the link bar.
    await editor.click();
    await page.keyboard.press('ControlOrMeta+a');
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('insert-link');
    });
    await expect(page.locator('.link-bar')).toBeVisible();
    await page.locator('.link-bar-input').fill('http://example.com');
    await page.keyboard.press('Enter');
    await expect(editor.locator('a')).toHaveCount(1);

    // Put the cursor in the link, reopen the link bar, and remove the link.
    await editor.locator('a').click();
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('insert-link');
    });
    await expect(page.locator('.link-bar')).toBeVisible();
    await page.locator('.link-bar button[title="Remove link"]').click();

    await expect(editor.locator('a')).toHaveCount(0);
    await expect(editor).toContainText('hello world');
  });
});

// ---------------------------------------------------------------------------
// Enter in empty nested list items
// ---------------------------------------------------------------------------

test.describe('Enter in empty nested list items', () => {
  test('Enter on an empty FINAL sub-item outdents to the parent level', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'nested.md');
    // beta is nested under alpha (4-space indent).
    fs.writeFileSync(tmpFile, '- alpha\n    - beta\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('beta', { timeout: 5000 });
    await expect(editor.locator('ul ul')).toContainText('beta');

    // Cursor at end of beta. Enter once: create an empty final sub-item.
    // Enter again: outdent it to the top level.
    await editor.locator('ul ul p', { hasText: 'beta' }).click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('gamma');

    // gamma should have left the nested list (outdented to top level).
    await expect(editor.locator('ul ul')).not.toContainText('gamma');
    await expect(editor.locator('ul ul')).toContainText('beta');
    await expect(editor).toContainText('gamma');
  });

  test('Enter on an empty NON-final sub-item creates a sibling (stays nested)', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'nested2.md');
    // z and w are both nested under a (4-space indent).
    fs.writeFileSync(tmpFile, '- a\n    - z\n    - w\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('w', { timeout: 5000 });
    await expect(editor.locator('ul ul')).toContainText('w');

    // Cursor at end of z -> Enter makes an empty item between z and w (not final).
    await editor.locator('ul ul p', { hasText: 'z' }).click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Enter again should create a sibling within the sublist, not outdent.
    await page.keyboard.press('Enter');
    await page.keyboard.type('MARK');

    // MARK stays nested (sibling of z and w), and w is still below it.
    await expect(editor.locator('ul ul')).toContainText('MARK');
    await expect(editor.locator('ul ul')).toContainText('w');
  });
});

// ---------------------------------------------------------------------------
// Error banner for uncaught failures
// ---------------------------------------------------------------------------

test.describe('Error banner', () => {
  test('an uncaught promise rejection shows a dismissable red banner', async () => {
    ({ app, page } = await launchApp());

    await expect(page.locator('.app')).toBeVisible();

    await page.evaluate(() => { Promise.reject(new Error('boom test failure')); });

    await expect(page.locator('.error-banner')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.error-banner-text')).toContainText('boom test failure');

    await page.locator('.error-banner button').click();
    await expect(page.locator('.error-banner')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Move block keeps a plain cursor (does not expand to a range selection)
// ---------------------------------------------------------------------------

test.describe('Move block cursor', () => {
  test('Cmd+Alt+Down with only a cursor keeps a collapsed cursor in the moved item', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'movecursor.md');
    fs.writeFileSync(tmpFile, '- one\n- two\n- three\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('two', { timeout: 5000 });

    // Place a plain cursor in "two" (no range selected).
    await editor.locator('li:nth-child(2) p').click();
    await page.waitForTimeout(100);
    await page.keyboard.press('End');

    await page.keyboard.press('ControlOrMeta+Alt+ArrowDown');
    await page.waitForTimeout(200);

    // Order is now one, three, two.
    const items = editor.locator('li');
    await expect(items.nth(0)).toContainText('one');
    await expect(items.nth(1)).toContainText('three');
    await expect(items.nth(2)).toContainText('two');

    // The selection must still be a collapsed cursor, not an expanded range.
    const sel = await page.evaluate(() => {
      const s = window.getSelection()!;
      return { collapsed: s.isCollapsed, text: s.toString(), anchor: s.anchorNode?.textContent ?? '' };
    });
    expect(sel.collapsed).toBe(true);
    expect(sel.text).toBe('');
    expect(sel.anchor).toContain('two');
  });
});

// ---------------------------------------------------------------------------
// Cmd+Left / Cmd+Right: wrapped-line boundary, then paragraph/list-item boundary
// ---------------------------------------------------------------------------

test.describe('Line-then-block cursor motion', () => {
  // A list item long enough to wrap across multiple visual lines.
  const longText = 'This is a deliberately very long bullet list item written so that it wraps across several visual lines in the editor, which lets us verify that the two stage cursor motion first reaches the wrapped line boundary and then the whole item boundary.';

  test('Cmd+Shift+Right/Left twice selects the whole wrapped list item', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'wrapline.md');
    fs.writeFileSync(tmpFile, '- ' + longText + '\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('deliberately', { timeout: 5000 });

    const li = editor.locator('li').first();
    const box = await li.boundingBox();
    // The item must actually wrap (more than one visual line) for this test to mean anything.
    expect(box!.height).toBeGreaterThan(40);

    // Cursor at the very start of the item.
    await li.click({ position: { x: 3, y: 6 } });
    await page.waitForTimeout(100);

    // First press: extend to the end of the wrapped line. Second: to the item end.
    await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowRight');
    const selectedRight = await page.evaluate(() => window.getSelection()!.toString().trim());
    expect(selectedRight).toBe(longText);

    // Collapse to the item end, then walk back: wrapped-line start, then item start.
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft');
    const selectedLeft = await page.evaluate(() => window.getSelection()!.toString().trim());
    expect(selectedLeft).toBe(longText);
  });
});

// ---------------------------------------------------------------------------
// Backtick wraps a selection in inline code
// ---------------------------------------------------------------------------

test.describe('Backtick wrap', () => {
  test('pressing ` with a single-line selection wraps it in inline code', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'backtick.md');
    fs.writeFileSync(tmpFile, 'Hello world here.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Hello world here', { timeout: 5000 });

    // Triple-click selects the whole (single-line) paragraph; typing a backtick
    // wraps that selection in inline code instead of replacing it.
    await editor.locator('p', { hasText: 'Hello world here' }).click({ clickCount: 3 });
    await expect.poll(() => page.evaluate(() => window.getSelection()!.toString().trim()))
      .toBe('Hello world here.');
    await page.keyboard.type('`');

    // The selection is now inline code, and no literal backtick was inserted.
    await expect(editor.locator('code')).toHaveCount(1);
    await expect(editor.locator('code')).toHaveText('Hello world here.');
    await expect(editor).not.toContainText('`');
  });

  test('pressing ` with no selection inserts a literal backtick', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'backtick2.md');
    fs.writeFileSync(tmpFile, 'Plain.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Plain', { timeout: 5000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.type('`');

    // A collapsed cursor is unaffected: the backtick is literal, no code mark.
    await expect(editor).toContainText('Plain.`');
    await expect(editor.locator('code')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Copying from within a code fence yields plain text (no ``` gates)
// ---------------------------------------------------------------------------

test.describe('Code fence copy', () => {
  test('copying content from inside a code block is plain text, not fenced', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'code.md');
    fs.writeFileSync(tmpFile, '# Title\n\n```\nconst x = 1;\nconst y = 2;\n```\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('const x = 1;', { timeout: 5000 });

    // Triple-click inside the code block selects its content (an interior selection).
    await editor.locator('pre').click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+c');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // No fence gates -- the raw code text is on the clipboard so it pastes back
    // into the same (or any) code fence as plain text.
    expect(clip).not.toContain('```');
    expect(clip).toContain('const x = 1;');
  });

  test('pasting code copied from a fence into prose stays plain text, not a new code block', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'code2.md');
    fs.writeFileSync(tmpFile, 'Intro line.\n\n```\nhello world\n```\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('hello world', { timeout: 5000 });

    // Exactly one code block to start.
    await expect(editor.locator('pre')).toHaveCount(1);

    // Copy the interior of the code block...
    await editor.locator('pre').click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+c');

    // ...then paste it into the prose paragraph above.
    await editor.locator('p', { hasText: 'Intro line' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' ');
    await page.keyboard.press('ControlOrMeta+v');

    // The paste landed as plain text -- still just the one original code block,
    // and the prose paragraph now contains the pasted code text.
    await expect(editor.locator('p', { hasText: 'Intro line. hello world' })).toBeVisible({ timeout: 3000 });
    await expect(editor.locator('pre')).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------
// Pasting an indented (Obsidian) mixed list stays a list, not a code fence
// ---------------------------------------------------------------------------

test.describe('Indented list paste', () => {
  test('pasting a tab-indented mixed bullet/task list yields a list, not a code block', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'obsidian.md');
    fs.writeFileSync(tmpFile, 'Start.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Start', { timeout: 5000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    // Every line shares a leading tab (as when copying a nested Obsidian sub-tree);
    // markdown-it would otherwise read the uniform indent as an indented code block.
    await page.evaluate(() =>
      navigator.clipboard.writeText('\t- item one\n\t- [ ] task two\n\t- item three'));
    await page.keyboard.press('ControlOrMeta+v');

    await expect(editor).toContainText('item one', { timeout: 3000 });
    // It parsed as a real list -- no code block, and the task item kept its checkbox.
    await expect(editor.locator('pre')).toHaveCount(0);
    await expect(editor.locator('li')).toHaveCount(3);
    await expect(editor.locator('li[data-checked="false"]')).toHaveCount(1);
  });

  // The real Obsidian case: the clipboard carries text/plain AND text/html. That
  // used to force ProseMirror down the HTML path, bypassing the dedent entirely --
  // producing a code fence for an indented sub-tree and empty-bullet/ordered noise
  // for "- 1. x" bullets. handlePaste now routes list-shaped plain text through the
  // file-load markdown pipeline regardless of any HTML on the clipboard.
  test('pasting an Obsidian list with text/html present stays a clean nested list', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'obsidian2.md');
    fs.writeFileSync(tmpFile, 'Start.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('Start', { timeout: 5000 });

    await editor.click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');

    // Dispatch a synthetic paste carrying BOTH representations. The text/html is a
    // <pre> (the worst case -- what would have rendered as a code fence); handlePaste
    // must ignore it and use the plain-text markdown list instead.
    await editor.evaluate((el) => {
      const plain = [
        '- Questions',
        '    - 1. SIS & roster sync?',
        '        - Focus -',
        '        - GC.',
        '    - 2. All students have Google accounts? - Yes.',
        '- Notes',
      ].join('\n');
      const dt = new DataTransfer();
      dt.setData('text/plain', plain);
      dt.setData('text/html', '<pre>' + plain + '</pre>');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    await expect(editor).toContainText('SIS & roster sync?', { timeout: 3000 });
    // No code fence.
    await expect(editor.locator('pre')).toHaveCount(0);
    // "- 1. x" stayed a literal bullet -- no ordered list, and the "1." reads inline
    // with its text rather than being split into a separate empty bullet + "1." item.
    await expect(editor.locator('ol')).toHaveCount(0);
    await expect(editor).toContainText('1. SIS & roster sync?');
    // No stray empty bullets from the collapsed ordered sub-lists.
    await expect(editor.locator('li p:empty')).toHaveCount(0);
    // No spurious hard break before a nested sub-list (the "ugly newline" after every
    // parent item). A real <br> lacks the trailing-break placeholder class.
    await expect(editor.locator('li p br:not(.ProseMirror-trailingBreak)')).toHaveCount(0);
    // The "Questions" item's own paragraph is exactly its text -- nothing trailing.
    const questionsText = await editor.evaluate((root) =>
      [...root.querySelectorAll('li > p')].find((p) => p.textContent?.includes('Questions'))?.textContent,
    );
    expect(questionsText).toBe('Questions');
    // Nesting preserved: "Focus" sits three lists deep (Questions > SIS > Focus),
    // not flattened up to the top level.
    const focusDepth = await editor.evaluate((root) => {
      const li = [...root.querySelectorAll('li')].find(
        (el) => el.querySelector(':scope > p')?.textContent?.trim() === 'Focus -',
      );
      let depth = 0;
      for (let n = li?.parentElement; n && n !== root; n = n.parentElement) {
        if (n.tagName === 'UL') depth++;
      }
      return depth;
    });
    expect(focusDepth).toBe(3);
  });

  // Pasting a list while the cursor sits inside an existing bullet merges the pasted
  // items into that SAME list (one <ul>) rather than starting a detached list or a
  // code fence. (Exact item boundaries are left to ProseMirror's list-paste merging.)
  test('pasting a list inside an existing bullet merges into the same list', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'merge.md');
    fs.writeFileSync(tmpFile, '- existing\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor.locator('li')).toHaveText(['existing']);

    // Cursor on a fresh empty bullet below "existing", then paste a two-item list.
    await editor.locator('li').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await editor.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData('text/plain', '- pasted one\n- pasted two');
      dt.setData('text/html', '<pre>- pasted one\n- pasted two</pre>');
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    });

    await expect(editor).toContainText('pasted two', { timeout: 3000 });
    // Stayed one list -- not a detached second <ul> and not a code fence.
    await expect(editor.locator(':scope > ul')).toHaveCount(1);
    await expect(editor.locator('pre')).toHaveCount(0);
    await expect(editor).toContainText('existing');
    await expect(editor).toContainText('pasted one');
  });
});

// ---------------------------------------------------------------------------
// A document never begins with a code fence
// ---------------------------------------------------------------------------

test.describe('Leading code fence guard', () => {
  test('a file starting with a code block gets an empty paragraph above it', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'leadingcode.md');
    fs.writeFileSync(tmpFile, '```\ncode line\n```\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    const editor = page.locator('.tiptap');
    await expect(editor).toContainText('code line', { timeout: 5000 });

    // The code block still renders, but a paragraph now sits above it so the
    // cursor can be placed before the fence.
    await expect(editor.locator('pre')).toHaveCount(1);
    const firstTag = await editor.evaluate((el) => el.firstElementChild?.tagName);
    expect(firstTag).toBe('P');
    const firstText = await editor.evaluate((el) => el.firstElementChild?.textContent);
    expect(firstText).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Task list editing: Enter, checkbox hit area, backspace, clipboard
// ---------------------------------------------------------------------------

// Open a markdown file and wait for it to render. Returns the file path.
async function openMarkdown(content: string, name = 'tasks.md'): Promise<string> {
  const tmpFile = path.join(makeTmpDir(), name);
  fs.writeFileSync(tmpFile, content);
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  await expect(page.locator('.tiptap:visible').locator('li, p').first()).toBeVisible({ timeout: 5000 });
  return tmpFile;
}

async function saveAndRead(tmpFile: string): Promise<string> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('save-file');
  });
  await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });
  return fs.readFileSync(tmpFile, 'utf-8');
}

test.describe('Enter inside a task item', () => {
  test('splitting a checked task in the middle leaves BOTH halves checked', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- [x] alpha beta\n');

    await page.locator('.tiptap li p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowRight');
    // Let ProseMirror observe the native arrow-key selection before the keymap runs.
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');

    expect(await saveAndRead(tmpFile)).toBe('- [x] alpha\n- [x]  beta\n');
  });

  test('Enter at the START of a checked task keeps the check with the text', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- [x] alpha beta\n');

    await page.locator('.tiptap li p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');

    // The blank line pushed above is a fresh UNCHECKED task; the completed text
    // carries its checkmark down with it.
    expect(await saveAndRead(tmpFile)).toBe('- [ ] \n- [x] alpha beta\n');
  });

  test('Enter at the END of a checked task starts a new UNCHECKED task', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- [x] alpha beta\n');

    await page.locator('.tiptap li p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.keyboard.type('next thing');

    expect(await saveAndRead(tmpFile)).toBe('- [x] alpha beta\n- [ ] next thing\n');
  });
});

test.describe('Checkbox click target', () => {
  test('clicking the checkbox toggles it', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- [ ] first task\n');

    const li = page.locator('.tiptap li').first();
    const box = (await li.boundingBox())!;
    // The checkbox is drawn at left:-18px, top:5px, 14x14 (see index.css).
    await page.mouse.click(box.x - 11, box.y + 12);

    await expect(li).toHaveAttribute('data-checked', 'true', { timeout: 2000 });
    expect(await saveAndRead(tmpFile)).toBe('- [x] first task\n');
  });

  test('clicking the first character of the text places the cursor, does not toggle', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- [ ] first task\n');

    const li = page.locator('.tiptap li').first();
    const box = (await li.boundingBox())!;
    // 2px into the text -- previously anything left of (li.left + 4px) toggled.
    await page.mouse.click(box.x + 2, box.y + 12);
    await page.waitForTimeout(150);
    await page.keyboard.type('X');

    await expect(li).toHaveAttribute('data-checked', 'false');
    expect(await saveAndRead(tmpFile)).toBe('- [ ] Xfirst task\n');
  });
});

test.describe('Backspace on an empty list item', () => {
  test('an empty middle item is deleted, joining the cursor to the item above', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- one\n- \n- three\n');

    await page.locator('.tiptap > ul > li p').first().click();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('!');

    // The list is NOT split and "one" is NOT demoted to a paragraph.
    expect(await saveAndRead(tmpFile)).toBe('- one!\n- three\n');
  });

  test('an empty middle item in a NESTED list stays nested', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('- parent\n  - one\n  - \n  - three\n');

    await page.locator('.tiptap li li p').first().click();
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Backspace');
    await page.keyboard.type('!');

    expect(await saveAndRead(tmpFile)).toBe('- parent\n  - one!\n  - three\n');
  });

  test('backspace in the FIRST item still outdents rather than deleting it', async () => {
    ({ app, page } = await launchApp());
    await openMarkdown('- parent\n  - one\n  - three\n');

    // Empty the first sub-item by selecting its text and deleting it.
    await page.locator('.tiptap li li p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowLeft');
    await page.keyboard.press('Shift+ControlOrMeta+ArrowRight');
    await page.waitForTimeout(150);
    await page.keyboard.press('Backspace');
    await expect(page.locator('.tiptap li li')).toHaveCount(2);

    await page.keyboard.press('Backspace');

    // Lifted out of the sublist, not removed -- there is no item above it to join to,
    // so all three items survive and only one is still nested.
    await expect(page.locator('.tiptap li')).toHaveCount(3);
    await expect(page.locator('.tiptap li li')).toHaveCount(1);
  });
});

test.describe('Copying a task item', () => {
  test('copying the text of a nested task yields the text alone, no "- [ ]" markers', async () => {
    ({ app, page } = await launchApp());
    await openMarkdown('- [ ] parent task\n  - [x] nested **bold** task\n');

    await page.locator('.tiptap li li p').first().click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+c');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    // Was "- [ ] - [x] nested **bold** task": the slice carries the ancestor item too,
    // so both its marker and the nested one were serialized onto the same line.
    expect(clip).toBe('nested **bold** task');
  });

  test('copying more than one task still keeps the list markers', async () => {
    ({ app, page } = await launchApp());
    await openMarkdown('- [ ] one\n- [x] two\n');

    await page.locator('.tiptap').click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+c');

    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('- [ ] one');
    expect(clip).toContain('- [x] two');
  });
});

test.describe('Tilde escaping', () => {
  test('a lone ~ is neither escaped on save nor on copy', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('approx ~5 items\n');

    await page.locator('.tiptap p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type(' here');

    expect(await saveAndRead(tmpFile)).toBe('approx ~5 items here\n');

    await page.locator('.tiptap p').first().click({ clickCount: 3 });
    await page.keyboard.press('ControlOrMeta+c');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe('approx ~5 items here');
  });

  test('a literal ~~ stays escaped so it does not become a strikethrough', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('literal \\~\\~notstruck\\~\\~ and ~~struck~~ here\n');

    // Round-trips: the escaped pair is text, the unescaped pair is a strike mark.
    await expect(page.locator('.tiptap s')).toHaveText('struck');
    await expect(page.locator('.tiptap p').first()).toContainText('~~notstruck~~');

    await page.locator('.tiptap p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');

    expect(await saveAndRead(tmpFile)).toBe('literal \\~\\~notstruck\\~\\~ and ~~struck~~ here!\n');
  });
});

test.describe('Highlights and text colors', () => {
  // Select the last n characters of the first paragraph ("beta" in "alpha beta").
  async function selectLastChars(n: number) {
    await page.locator('.tiptap p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    for (let i = 0; i < n; i++) await page.keyboard.press('Shift+ArrowLeft');
  }

  test('a toolbar highlight is saved to disk as ==text==', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('alpha beta\n');

    await selectLastChars(4);
    await page.locator('.qa-highlight-toggle').click();

    expect(await saveAndRead(tmpFile)).toBe('alpha ==beta==\n');
  });

  test('colored highlights, text colors, and their nesting with links and code round-trip unchanged', async () => {
    ({ app, page } = await launchApp());
    const source = [
      '=={blue}blue hl== and ==plain hl== and =={yellow}named yellow==',
      '[red text]{red} and **bold [red]{red}**',
      'x [see [docs](a.md) here]{red} y',
      '=={purple}see [docs](b.md) here==',
      '[read the [docs]{green}](c.md)',
      '==a `code` b== and [c `d`]{orange}',
      'end',
    ].join('\n\n') + '\n';
    const tmpFile = await openMarkdown(source);
    const ed = page.locator('.tiptap');

    await expect(ed.locator('mark[data-color="blue"]')).toHaveText('blue hl');
    await expect(ed.locator('mark:not([data-color])')).toHaveText(['plain hl', 'a code b']);
    await expect(ed.locator('mark[data-color="yellow"]')).toHaveText('named yellow');
    await expect(ed.locator('span[data-text-color="red"] strong')).toHaveText('red');
    await expect(ed.locator('span[data-text-color="red"] a[href="a.md"]')).toHaveText('docs');
    // ONE continuous highlight element with the link inside it, not three pieces around it.
    await expect(ed.locator('mark[data-color="purple"]')).toHaveCount(1);
    await expect(ed.locator('mark[data-color="purple"] a[href="b.md"]')).toHaveText('docs');
    // A colored span inside link text leaves it a link: every word still carries the href.
    await expect(ed.locator('a[href="c.md"]')).toHaveText(['read the ', 'docs']);
    await expect(ed.locator('span[data-text-color="green"] a[href="c.md"]')).toHaveText('docs');
    // Inline code keeps the highlight / color around it instead of excluding it.
    await expect(ed.locator('mark code')).toHaveText('code');
    await expect(ed.locator('span[data-text-color="orange"] code')).toHaveText('d');

    await ed.locator('p').last().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');

    expect(await saveAndRead(tmpFile)).toBe(source.replace(/end\n$/, 'end!\n'));
  });

  test('a link inside colored text or a highlight keeps link styling and still follows on Cmd+click', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('[plain](a.md) then [red [inred](a.md) text]{red} then =={blue}[inhl](a.md)==\n');
    fs.writeFileSync(path.join(path.dirname(tmpFile), 'a.md'), '# Target\n\nHello from a.\n');
    const ed = page.locator('.tiptap');

    const style = (sel: string) => ed.locator(sel).evaluate(el => {
      const s = getComputedStyle(el);
      return `${s.color} ${s.textDecorationLine}`;
    });
    const plain = await style('a:text("plain")');
    expect(plain).toContain('underline');
    expect(await style('span[data-text-color="red"] a')).toBe(plain);
    expect(await style('mark[data-color="blue"] a')).toBe(plain);

    await ed.locator('span[data-text-color="red"] a').click({ modifiers: ['ControlOrMeta'] });
    await expect(page.locator('.tab')).toHaveCount(2);
    await expect(page.locator('.tiptap:visible')).toContainText('Hello from a.');
  });

  test('an unknown color name is literal text, not a colored span', async () => {
    ({ app, page } = await launchApp());
    await openMarkdown('unknown [x]{chartreuse} stays\n');

    await expect(page.locator('.tiptap p').first()).toHaveText('unknown [x]{chartreuse} stays');
    await expect(page.locator('.tiptap span[data-text-color]')).toHaveCount(0);
  });

  test('literal == typed as prose is escaped on save so it never reloads as a highlight', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('x\n');

    await page.locator('.tiptap p').first().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('a==b==c and p == q');

    // Spaced `==` can never open or close a highlight, so it is left alone.
    const saved = await saveAndRead(tmpFile);
    expect(saved).toBe('xa\\=\\=b\\=\\=c and p == q\n');

    await openMarkdown(saved, 'reloaded.md');
    await expect(page.locator('.tiptap:visible p').first()).toHaveText('xa==b==c and p == q');
    await expect(page.locator('.tiptap:visible mark')).toHaveCount(0);
  });

  test('the palette menus set and clear text color and highlight color', async () => {
    ({ app, page } = await launchApp());
    const tmpFile = await openMarkdown('alpha beta\n');

    await selectLastChars(4);

    await page.locator('.qa-text-color-btn').click();
    await page.locator('.qa-text-color-menu .qa-swatch-red').click();
    await expect(page.locator('.qa-text-color-menu')).toHaveCount(0);
    expect(await saveAndRead(tmpFile)).toBe('alpha [beta]{red}\n');

    await page.locator('.qa-highlight-btn').click();
    await page.locator('.qa-highlight-menu .qa-swatch-blue').click();
    expect(await saveAndRead(tmpFile)).toBe('alpha =={blue}[beta]{red}==\n');

    // Picking yellow is the plain highlight, not a named one.
    await page.locator('.qa-highlight-btn').click();
    await page.locator('.qa-highlight-menu .qa-swatch-yellow').click();
    expect(await saveAndRead(tmpFile)).toBe('alpha ==[beta]{red}==\n');

    await page.locator('.qa-text-color-btn').click();
    await page.locator('.qa-text-color-menu .qa-swatch-none').click();
    await page.locator('.qa-highlight-btn').click();
    await page.locator('.qa-highlight-menu .qa-swatch-none').click();
    expect(await saveAndRead(tmpFile)).toBe('alpha beta\n');
  });

  test('palette colors switch to theme-appropriate shades in dark mode', async () => {
    ({ app, page } = await launchApp());
    await openMarkdown('=={blue}blue== and [red]{red}\n');

    const luminance = (sel: string, prop: 'backgroundColor' | 'color') => page.locator(sel).first().evaluate((el, p) => {
      const [r, g, b] = getComputedStyle(el)[p as 'color'].match(/\d+/g)!.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }, prop);
    const setTheme = (t: string) => page.evaluate(th => document.documentElement.setAttribute('data-theme', th), t);

    await page.locator('.qa-highlight-btn').click();
    const swatch = '.qa-highlight-menu .qa-swatch-blue';

    await setTheme('light');
    const light = { mark: await luminance('.tiptap mark', 'backgroundColor'), swatch: await luminance(swatch, 'backgroundColor'), text: await luminance('.tiptap span[data-text-color]', 'color') };
    await setTheme('dark');
    const dark = { mark: await luminance('.tiptap mark', 'backgroundColor'), swatch: await luminance(swatch, 'backgroundColor'), text: await luminance('.tiptap span[data-text-color]', 'color') };

    // Pale highlight in light mode, deep one in dark mode; text colors go the other way.
    expect(dark.mark).toBeLessThan(light.mark - 60);
    expect(dark.swatch).toBeLessThan(light.swatch - 60);
    expect(dark.text).toBeGreaterThan(light.text + 30);
  });

  // Without a color-scheme, Chromium draws legacy (always-shown) macOS scrollbars bright white in dark mode.
  test('the color-scheme follows the theme so native scrollbars match it', async () => {
    ({ app, page } = await launchApp());
    const schemeFor = (t: string) => page.evaluate(th => {
      document.documentElement.setAttribute('data-theme', th);
      return getComputedStyle(document.documentElement).colorScheme;
    }, t);

    expect(await schemeFor('dark')).toBe('dark');
    expect(await schemeFor('light')).toBe('light');
  });
});

test.describe('Paragraph spacing', () => {
  test('paragraph-to-paragraph gap is double the gap under a heading', async () => {
    ({ app, page } = await launchApp());
    await openMarkdown('# Title\n\nUnder heading.\n\nSecond paragraph.\n\n- a list item\n\nAfter the list.\n');

    const margins = await page.evaluate(() => {
      const paras = Array.from(document.querySelectorAll('.tiptap > p')) as HTMLElement[];
      const top = (el: HTMLElement) => parseFloat(getComputedStyle(el).marginTop);
      return {
        underHeading: top(paras[0]),
        betweenParas: top(paras[1]),
        afterList: top(paras[2]),
      };
    });

    expect(margins.betweenParas).toBeCloseTo(margins.underHeading * 2, 1);
    expect(margins.afterList).toBeCloseTo(margins.betweenParas, 1);
  });
});

test.describe('Save guard against our own writes', () => {
  test('a write whose content already matches the file is not a conflict', async () => {
    // The guard exists to stop us clobbering a version the user has not seen. When the
    // bytes on disk are IDENTICAL to what we were about to write, there is nothing to
    // lose, so a stale hash must not raise a phantom conflict.
    ({ app, page } = await launchApp());
    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'guard.md');
    fs.writeFileSync(tmpFile, '# Same\n');

    const same = await page.evaluate(
      (fp) => window.mde.writeFileIfUnchanged(fp, '# Same\n', 'stalehash'),
      tmpFile
    );
    expect(same.conflict).toBe(false);
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('# Same\n');

    // ...but a genuine divergence still refuses the write.
    const diverged = await page.evaluate(
      (fp) => window.mde.writeFileIfUnchanged(fp, '# Clobbered\n', 'stalehash'),
      tmpFile
    );
    expect(diverged.conflict).toBe(true);
    expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('# Same\n');
  });

  test('an autosave queued before a manual save writes instead of raising a conflict', async () => {
    // The reported hair-trigger: Cmd+S while an autosave is pending. The queued timer
    // held a pre-save snapshot of the tab, so it quoted the hash from before our own
    // save and the guard refused it -- a red banner on a file nothing else touched.
    ({ app, page } = await launchApp());
    const tmpDir = makeTmpDir();
    const tmpFile = path.join(tmpDir, 'autosave.md');
    fs.writeFileSync(tmpFile, 'start\n');

    const wasOn = await page.evaluate(() => window.mde.getAutosave());
    try {
      await page.evaluate(() => window.mde.setAutosave(true));
      await app.evaluate(({ BrowserWindow }, fp) => {
        BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
      }, tmpFile);
      const editor = page.locator('.tiptap');
      await expect(editor).toContainText('start', { timeout: 5000 });

      await editor.click();
      await page.keyboard.press('ControlOrMeta+ArrowRight');
      await page.keyboard.type(' one');
      // Manual save while the autosave debounce is still running.
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('save-file');
      });
      await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });
      // More typing, so the autosave that follows has genuinely new content to write.
      await page.keyboard.type(' two');
      await expect(page.locator('.tab-dirty-dot')).toHaveCount(1);

      // The autosave (1s debounce) must land, not conflict.
      await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });
      await expect(page.locator('.conflict-banner')).toHaveCount(0);
      expect(fs.readFileSync(tmpFile, 'utf-8')).toBe('start one two\n');
    } finally {
      await page.evaluate((on) => window.mde.setAutosave(on), wasOn);
    }
  });
});

test.describe('Code fences are not list structure', () => {
  test('a list inside a code fence does not get a {LIST_SEPARATOR} placeholder', async () => {
    // splitLooseLists inserts a placeholder to break loose lists apart. Inside a fence
    // that text is the user's code sample -- it showed up in the editor and was written
    // straight back to their file on save.
    ({ app, page } = await launchApp());
    const source = '# Doc\n\n```\n- one\n\n- two\n```\n\n- real one\n\n- real two\n';
    const tmpFile = await openMarkdown(source, 'fenced.md');

    await expect(page.locator('.tiptap pre')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('.tiptap')).not.toContainText('LIST_SEPARATOR');
    // The loose list OUTSIDE the fence still splits into two lists.
    await expect(page.locator('.tiptap > ul')).toHaveCount(2);

    await page.locator('.tiptap h1').click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');
    expect(await saveAndRead(tmpFile)).toBe(source.replace('# Doc', '# Doc!'));
  });
});

test.describe('Sidebar layout', () => {
  test('the project header stays pinned while the file list scrolls', async () => {
    ({ app, page } = await launchApp());
    const tmpDir = makeTmpDir();
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(tmpDir, `file-${String(i).padStart(2, '0')}.md`), `# ${i}\n`);
    }
    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    const header = page.locator('.tree-root-header');
    await expect(header).toBeVisible({ timeout: 5000 });

    const offsets = await page.evaluate(async () => {
      const scroller = document.querySelector('.sidebar-content') as HTMLElement;
      const head = document.querySelector('.tree-root-header') as HTMLElement;
      const before = head.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      scroller.scrollTop = 300;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        scrolled: scroller.scrollTop,
        after: head.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
        before,
      };
    });

    expect(offsets.scrolled).toBeGreaterThan(0); // the list really did scroll
    expect(offsets.after).toBeLessThanOrEqual(offsets.before + 1); // header did not scroll away
    await expect(header).toBeVisible();
  });

  test('the pinned header sits flush with the top of the scroll area, with no gap above it', async () => {
    // The scrollport's own padding-top became a transparent band ABOVE the pinned header
    // that file rows visibly scrolled through.
    ({ app, page } = await launchApp());
    const tmpDir = makeTmpDir();
    for (let i = 0; i < 60; i++) {
      fs.writeFileSync(path.join(tmpDir, `file-${String(i).padStart(2, '0')}.md`), `# ${i}\n`);
    }
    await app.evaluate(({ BrowserWindow }, root) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-project', root);
    }, tmpDir);

    await expect(page.locator('.tree-root-header')).toBeVisible({ timeout: 5000 });

    const gap = await page.evaluate(async () => {
      const scroller = document.querySelector('.sidebar-content') as HTMLElement;
      const head = document.querySelector('.tree-root-header') as HTMLElement;
      scroller.scrollTop = 300;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return head.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    });

    expect(gap).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

// A 1x1 PNG.
const PNG_BYTES = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

test.describe('Images', () => {
  test('every form of image reference survives load, edit, and save byte-for-byte', async () => {
    ({ app, page } = await launchApp());
    // Each of these is one markdown-it would normalize if rebuilt from attrs: angle brackets
    // and a space, non-ASCII, an entity, a title, inline markup in the alt, a link wrapper.
    const source = [
      '# Gallery',
      '![a cat](cat.png)',
      'Text before ![inline *pic*_x_](img/a.png "A title") and after.',
      '![spaced](<my cat.png>) and ![accent](café.png) and ![amp](a&amp;b.png)',
      '[![badge](https://example.com/badge.svg)](https://example.com)',
      '> ![quoted](q.png)',
      '- ![in a list](l.png)\n- [ ] ![in a task](t.png)',
      '| a | b |\n| --- | --- |\n| ![cell](c.png) | x |',
      '![remote](https://example.com/x.png)',
      'end',
    ].join('\n\n') + '\n';
    const tmpFile = await openMarkdown(source, 'gallery.md');
    const ed = page.locator('.tiptap');
    await expect(ed.locator('.image-node')).toHaveCount(11);

    await ed.locator('p').last().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');

    expect(await saveAndRead(tmpFile)).toBe(source.replace(/end\n$/, 'end!\n'));
  });

  test('image syntax inside code stays literal code, not an image', async () => {
    ({ app, page } = await launchApp());
    const source = 'Write `![alt](path.png)` inline.\n\n```markdown\n![a cat](cat.png)\n```\n\nend\n';
    const tmpFile = await openMarkdown(source, 'syntax-guide.md');
    const ed = page.locator('.tiptap');
    await expect(ed.locator('code').first()).toHaveText('![alt](path.png)');
    await expect(ed.locator('.image-node')).toHaveCount(0);

    await ed.locator('p').last().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');
    expect(await saveAndRead(tmpFile)).toBe(source.replace(/end\n$/, 'end!\n'));
  });

  test('a relative image path displays the file from beside the document', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.mkdirSync(path.join(dir, 'pics'));
    fs.writeFileSync(path.join(dir, 'pics', 'dot one.png'), PNG_BYTES);
    const file = path.join(dir, 'doc.md');
    fs.writeFileSync(file, '![a dot](<pics/dot one.png>)\n\n![a dot](./pics/dot%20one.png)\n');
    await app.evaluate(({ BrowserWindow }, f) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', f);
    }, file);

    const imgs = page.locator('.tiptap .image-node img');
    await expect(imgs).toHaveCount(2, { timeout: 5000 });
    await expect.poll(() => imgs.evaluateAll(els => els.map(e => (e as HTMLImageElement).naturalWidth))).toEqual([1, 1]);
    await expect(page.locator('.qa-image-missing')).toHaveCount(0);
  });

  test('a missing image shows a placeholder naming the path, and saving leaves the reference intact', async () => {
    ({ app, page } = await launchApp());
    const source = '![gone](nope/missing.png)\n\nend\n';
    const tmpFile = await openMarkdown(source, 'missing.md');
    const missing = page.locator('.qa-image-missing');
    await expect(missing).toHaveCount(1, { timeout: 5000 });
    await expect(missing).toContainText("nope/missing.png can't be found");

    await page.locator('.tiptap p').last().click();
    await page.keyboard.press('ControlOrMeta+ArrowRight');
    await page.keyboard.type('!');
    expect(await saveAndRead(tmpFile)).toBe('![gone](nope/missing.png)\n\nend!\n');
  });

  test('a file that is not an image says it cannot be displayed rather than not found', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'broken.png'), 'not really a png');
    const file = path.join(dir, 'doc.md');
    fs.writeFileSync(file, '![x](broken.png)\n');
    await app.evaluate(({ BrowserWindow }, f) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', f);
    }, file);
    await expect(page.locator('.qa-image-missing')).toContainText("broken.png can't be displayed", { timeout: 5000 });
  });
});
