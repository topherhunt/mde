import { test, expect } from '@playwright/test';
import { launchApp } from './electron-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

test('HR shows blue outline when selected', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'hr.md');
  fs.writeFileSync(tmpFile, 'above\n\n---\n\nbelow\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('above', { timeout: 5000 });

  // Click just before the HR, then arrow down to select it
  await page.locator('.tiptap p').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('ArrowDown');

  const hr = page.locator('.tiptap hr');
  await expect(hr).toHaveClass(/ProseMirror-selectednode/, { timeout: 2000 });

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Enter at end of parent list item creates first child', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'nested.md');
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('parent', { timeout: 5000 });

  // Place cursor at end of "parent" text
  // Click precisely on the text node of the first <p>
  const parentP = editor.locator(':scope > ul > li > p').first();
  await expect(parentP).toHaveText('parent');
  await parentP.click({ position: { x: 50, y: 10 } });
  await page.keyboard.press('End');
  await page.waitForTimeout(50);
  await page.keyboard.press('Enter');
  await page.keyboard.type('new item');
  await page.waitForTimeout(100);

  // "new item" should be the first child in the sublist, before child1
  const sublistItems = editor.locator('li > ul > li > p');
  await expect(sublistItems.first()).toHaveText('new item', { timeout: 2000 });
  expect(await sublistItems.count()).toBe(3);
  expect(await sublistItems.nth(1).innerText()).toBe('child1');
  expect(await sublistItems.nth(2).innerText()).toBe('child2');

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Cmd+. folds and unfolds list items with children', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'fold.md');
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n- sibling\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('parent', { timeout: 5000 });

  // Click in "parent" and fold
  await page.locator('.tiptap li').first().locator('p').first().click();
  await page.keyboard.press('ControlOrMeta+.');

  // Parent should have folded class
  const parentLi = page.locator('.tiptap li').first();
  await expect(parentLi).toHaveClass(/folded/, { timeout: 2000 });

  // Children should be hidden
  const childList = parentLi.locator('ul');
  await expect(childList).toBeHidden();

  // "sibling" should still be visible
  await expect(editor).toContainText('sibling');

  // Unfold
  await page.keyboard.press('ControlOrMeta+.');
  await expect(parentLi).not.toHaveClass(/folded/, { timeout: 2000 });
  await expect(childList).toBeVisible();

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Enter on empty nested item creates sibling, not bare paragraph', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'nested.md');
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('child1', { timeout: 5000 });

  // Click at end of child1, press Enter twice to create two empty siblings
  const child1P = editor.locator('li > ul > li > p').first();
  await expect(child1P).toHaveText('child1');
  // Triple-click to select all text, then press End to collapse to end
  await child1P.click({ clickCount: 3 });
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  // Should have 4 child items (child1, empty, empty, child2), no bare <p> in the <li>
  const childItems = editor.locator('li > ul > li');
  expect(await childItems.count()).toBe(4);
  // No bare <p> siblings to the inner <ul>
  const bareParagraphs = editor.locator('li > p + p');
  expect(await bareParagraphs.count()).toBe(0);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('Cmd+. on childless nested item does nothing', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'nested.md');
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('child1', { timeout: 5000 });

  // Click in child1 (which has no children) and try to fold
  const child1P = editor.locator('li > ul > li > p').first();
  await expect(child1P).toHaveText('child1');
  await child1P.click({ position: { x: 20, y: 8 } });
  await page.waitForTimeout(100);
  await page.keyboard.press('ControlOrMeta+.');

  // Parent should NOT be folded
  const foldedItems = editor.locator('li.folded');
  expect(await foldedItems.count()).toBe(0);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('loose list split with nested items', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'nested.md');
  fs.writeFileSync(tmpFile, '- item 1\n\n  - item 2\n    - item 3\n  - item 4\n\n- item 5\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('item 1', { timeout: 5000 });
  await page.waitForTimeout(300);

  const ulCount = await editor.locator(':scope > ul').count();
  expect(ulCount).toBe(2);

  const firstList = editor.locator(':scope > ul').first();
  await expect(firstList).toContainText('item 1');
  await expect(firstList).toContainText('item 4');

  const secondList = editor.locator(':scope > ul').last();
  await expect(secondList).toContainText('item 5');

  const pBetween = editor.locator(':scope > ul + p + ul');
  expect(await pBetween.count()).toBe(1);

  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ');
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('save-file');
  });
  await expect(page.locator('.tab-dirty-dot')).toHaveCount(0, { timeout: 5000 });

  const saved = fs.readFileSync(tmpFile, 'utf-8');
  expect(saved).toMatch(/item 1/);
  expect(saved).toMatch(/item 5/);
  expect(saved).toMatch(/item 4\n\n.*item 5/s);

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('fold state persists across file close and reopen', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'fold-persist.md');
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n- sibling\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('parent', { timeout: 5000 });

  // Fold "parent"
  const parentP = editor.locator(':scope > ul > li > p').first();
  await parentP.click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('ControlOrMeta+.');
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });

  // Close the tab
  await page.keyboard.press('ControlOrMeta+w');
  await page.waitForTimeout(300);

  // Reopen the same file
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  await expect(editor).toContainText('parent', { timeout: 5000 });
  await page.waitForTimeout(500);

  // "parent" should still be folded
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });
  // Children should be hidden
  await expect(editor.locator('li.folded > ul')).toBeHidden();
  // Sibling should be visible
  await expect(editor).toContainText('sibling');

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('fold state survives external file change', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'ext-change.md');
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n- sibling\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('parent', { timeout: 5000 });

  // Fold "parent"
  const parentP = editor.locator(':scope > ul > li > p').first();
  await parentP.click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('ControlOrMeta+.');
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });

  // Simulate external edit: change sibling text but keep parent+children intact
  await page.waitForTimeout(1100);
  fs.writeFileSync(tmpFile, '- parent\n  - child1\n  - child2\n- changed sibling\n');
  // Wait for file watcher to detect change and reload
  await expect(editor).toContainText('changed sibling', { timeout: 10000 });

  // Fold should be preserved after external reload
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });
  await expect(editor.locator('li.folded > ul')).toBeHidden();

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('fold state works with bold text in folded item', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'bold.md');
  fs.writeFileSync(tmpFile, '- **bold parent**\n  - child1\n  - child2\n');
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('bold parent', { timeout: 5000 });

  // Fold "bold parent"
  const parentP = editor.locator(':scope > ul > li > p').first();
  await parentP.click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('ControlOrMeta+.');
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });

  // Close and reopen
  await page.keyboard.press('ControlOrMeta+w');
  await page.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  await expect(editor).toContainText('bold parent', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Fold should be restored despite bold formatting
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });
  await expect(editor.locator('li.folded > ul')).toBeHidden();

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('fold state works with special chars and escapes', async () => {
  const { app, page } = await launchApp();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  const tmpFile = path.join(tmpDir, 'special.md');
  const specialLine = '**True WYSIWYG** -- like Obsidian > & . ! ( \\\\, formatted text';
  fs.writeFileSync(tmpFile, `- ${specialLine}\n  - child1\n  - child2\n`);
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  const editor = page.locator('.tiptap');
  await expect(editor).toContainText('True WYSIWYG', { timeout: 5000 });

  // Fold
  const parentP = editor.locator(':scope > ul > li > p').first();
  await parentP.click({ position: { x: 20, y: 8 } });
  await page.keyboard.press('ControlOrMeta+.');
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });

  // Close and reopen
  await page.keyboard.press('ControlOrMeta+w');
  await page.waitForTimeout(300);
  await app.evaluate(({ BrowserWindow }, fp) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-file', fp);
  }, tmpFile);
  await expect(editor).toContainText('True WYSIWYG', { timeout: 5000 });
  await page.waitForTimeout(500);

  // Fold should be restored despite special characters
  await expect(editor.locator('li.folded')).toHaveCount(1, { timeout: 2000 });

  await app.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
