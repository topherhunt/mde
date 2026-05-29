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

  test('renders code blocks with syntax highlighting', async () => {
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
    expect(fs.existsSync(path.join(tmpDir, 'sample.bak.pdf'))).toBe(true);

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
    expect(fs.existsSync(path.join(tmpDir, 'sample.bak.docx'))).toBe(true);

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

    // But should still have Rename, Delete, Copy Path
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Rename' })).toBeVisible();
    await expect(page.locator('.ctx-menu-item').filter({ hasText: 'Delete' })).toBeVisible();

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
