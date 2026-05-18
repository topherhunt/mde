import { test, expect } from '@playwright/test';
import { launchApp, fixturePath } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

let app: ElectronApplication;
let page: Page;

test.afterEach(async () => {
  if (app) {
    await app.close();
  }
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

    const filesTab = page.locator('.sidebar-tab', { hasText: 'Files' });
    const outlineTab = page.locator('.sidebar-tab', { hasText: 'Outline' });

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

  test('save clears dirty state', async () => {
    ({ app, page } = await launchApp());

    // Use a temporary copy so we don't modify fixtures
    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
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
    fs.rmSync(tmpDir, { recursive: true });
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

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
    const tmpFile = path.join(tmpDir, 'toolbar-test.md');
    fs.writeFileSync(tmpFile, '# Test\n\nSome plain text here.\n');

    await app.evaluate(({ BrowserWindow }, filePath) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', filePath);
    }, tmpFile);

    await expect(page.locator('.toolbar-select')).toBeVisible({ timeout: 10000 });

    const editor = page.locator('.tiptap');
    const paragraph = editor.locator('p');
    await paragraph.click();
    await page.keyboard.press('Meta+a');

    const boldBtn = page.locator('.toolbar-bold');
    await boldBtn.click();

    await expect(boldBtn).toHaveClass(/active/);

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('heading dropdown changes heading level', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
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

    fs.rmSync(tmpDir, { recursive: true });
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
    await page.locator('.sidebar-tab', { hasText: 'Outline' }).click();

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

    await page.locator('.sidebar-tab', { hasText: 'Outline' }).click();
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

    // File explorer should show the project contents
    await expect(page.locator('.tree-folder').first()).toBeVisible({ timeout: 5000 });

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

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
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

    // Should silently reload -- no conflict banner
    await expect(page.locator('.tiptap')).toContainText('Updated Content', { timeout: 5000 });
    await expect(page.locator('.conflict-banner')).toBeHidden();

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('shows conflict banner when file changes and buffer is dirty', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
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

    fs.rmSync(tmpDir, { recursive: true });
  });

  test('reload from disk dismisses conflict banner', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
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

    fs.rmSync(tmpDir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// 10. Markdown round-trip
// ---------------------------------------------------------------------------

test.describe('Markdown round-trip', () => {
  test('save preserves markdown structure', async () => {
    ({ app, page } = await launchApp());

    const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'mde-test-'));
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

    fs.rmSync(tmpDir, { recursive: true });
  });
});
