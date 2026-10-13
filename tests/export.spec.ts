import { test, expect } from '@playwright/test';
import { launchApp } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import JSZip from 'jszip';
import * as mammoth from 'mammoth';

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
  for (const dir of tmpDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

async function openProject(root: string) {
  await app.evaluate(({ BrowserWindow }, r) => {
    BrowserWindow.getAllWindows()[0].webContents.send('open-project', r);
  }, root);
}

async function exportFromSidebar(fileName: string, format: 'pdf' | 'docx') {
  await page.locator('.tree-file').filter({ hasText: fileName }).click({ button: 'right' });
  await page.locator(`.qa-ctx-export-${format}`).click();
}

// Whitespace stripped: pdfjs splits kerned runs into separate items ("Q u a rt e rly").
async function pdfText(file: string): Promise<{ pages: number; text: string }> {
  const pdfjs = require('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), useWorkerFetch: false, isEvalSupported: false }).promise;
  let text = '';
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    text += content.items.map((it: any) => it.str).join('');
  }
  return { pages: doc.numPages, text: text.replace(/\s+/g, '') };
}

async function docxXml(file: string): Promise<string> {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  return zip.file('word/document.xml')!.async('string');
}

async function docxHtml(file: string): Promise<string> {
  return (await mammoth.convertToHtml({ buffer: fs.readFileSync(file) })).value;
}

test.describe('Export', () => {
  test('Export as PDF writes the whole multi-page document beside the source, without the app chrome', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const body = Array.from({ length: 120 }, (_, i) => `Paragraph number ${i + 1} of the report.`).join('\n\n');
    fs.writeFileSync(path.join(dir, 'report.md'), `# Quarterly Report\n\n${body}\n\nThe very last line.\n`);
    await openProject(dir);
    await expect(page.locator('.tree-file')).toContainText('report.md', { timeout: 5000 });

    await exportFromSidebar('report.md', 'pdf');
    const out = path.join(dir, 'report.pdf');
    await expect.poll(() => fs.existsSync(out), { timeout: 10000 }).toBe(true);
    await expect(page.locator('.toast')).toContainText('Exported report.pdf');

    const { pages, text } = await pdfText(out);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain('QuarterlyReport');
    expect(text).toContain('Theverylastline.');
    // A window screenshot would include the sidebar's file list.
    expect(text).not.toContain('report.md');
  });

  test('Export as DOCX maps headings, marks, lists, tasks, tables, links, and colors to real Word structure', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'notes.md'), [
      '# Main Title',
      '',
      '## Section Two',
      '',
      'Some **bold** and *italic* and `code` and [a site](https://example.com) and [a note](other.md).',
      '',
      'A =={blue}blue highlight== and [red words]{red}.',
      '',
      '- first bullet',
      '  - nested bullet',
      '',
      '1. step one',
      '2. step two',
      '',
      '- [ ] open task',
      '- [x] done task',
      '',
      '| Name | Qty |',
      '| --- | --- |',
      '| apple | 3 |',
      '',
      '> quoted words',
      '',
      '```',
      'const x = 1;',
      '```',
      '',
    ].join('\n'));
    await openProject(dir);
    await expect(page.locator('.tree-file')).toContainText('notes.md', { timeout: 5000 });

    await exportFromSidebar('notes.md', 'docx');
    const out = path.join(dir, 'notes.docx');
    await expect.poll(() => fs.existsSync(out), { timeout: 10000 }).toBe(true);

    const html = await docxHtml(out);
    expect(html).toContain('<h1>Main Title</h1>');
    expect(html).toContain('<h2>Section Two</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>italic</em>');
    expect(html).toContain('<a href="https://example.com">a site</a>');
    // A relative link means nothing outside MDE: text kept, link dropped.
    expect(html).toContain('a note');
    expect(html).not.toContain('other.md');
    expect(html).toMatch(/<ul><li>first bullet<ul><li>nested bullet<\/li><\/ul><\/li><\/ul>/);
    expect(html).toContain('<ol><li>step one</li><li>step two</li></ol>');
    expect(html).toContain('<table><thead><tr><th><p><strong>Name</strong></p></th><th><p><strong>Qty</strong></p></th></tr></thead>');
    expect(html).toContain('<tr><td><p>apple</p></td><td><p>3</p></td></tr>');

    const xml = await docxXml(out);
    expect(xml).toContain('w:fill="cfe2fd"'); // blue highlight, light-theme shade
    expect(xml).toContain('w:val="dc2626"'); // red text
    expect(xml).toContain('const x = 1;');
    expect(xml).toContain('quoted words');
    expect(xml).toMatch(/<w:strike\/>(?:(?!<\/w:r>).)*done task/s);
    expect(xml).not.toMatch(/<w:strike\/>(?:(?!<\/w:r>).)*open task/s);
  });

  test('exporting an open tab from the tab bar uses its unsaved edits', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    const file = path.join(dir, 'draft.md');
    fs.writeFileSync(file, '# Draft\n\nSaved text.\n');
    await app.evaluate(({ BrowserWindow }, f) => {
      BrowserWindow.getAllWindows()[0].webContents.send('open-file', f);
    }, file);
    await expect(page.locator('.tab-name')).toContainText('draft.md', { timeout: 5000 });

    await page.locator('.tiptap p').filter({ hasText: 'Saved text.' }).click();
    await page.keyboard.press('End');
    await page.keyboard.type(' Unsaved addition.');

    await page.locator('.tab').first().click({ button: 'right' });
    await page.locator('.qa-ctx-export-docx').click();
    const out = path.join(dir, 'draft.docx');
    await expect.poll(() => fs.existsSync(out), { timeout: 10000 }).toBe(true);

    expect(await docxHtml(out)).toContain('Saved text. Unsaved addition.');
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('Unsaved addition.');
  });

  test('an existing export prompts: Cancel leaves it, Overwrite replaces it, Create Another Copy writes "name 2"', async () => {
    ({ app, page } = await launchApp());
    const dir = makeTmpDir();
    fs.writeFileSync(path.join(dir, 'memo.md'), '# Memo\n');
    const existing = path.join(dir, 'memo.docx');
    fs.writeFileSync(existing, 'OLD EXPORT');
    await openProject(dir);
    await expect(page.locator('.tree-file').filter({ hasText: 'memo.md' })).toBeVisible({ timeout: 5000 });

    await exportFromSidebar('memo.md', 'docx');
    await expect(page.locator('.qa-export-conflict')).toContainText('memo.docx already exists');
    await page.locator('.qa-export-cancel').click();
    await expect(page.locator('.qa-export-conflict')).toHaveCount(0);
    // Give a wrongly-issued write time to land before asserting nothing happened.
    await page.waitForTimeout(500);
    expect(fs.readFileSync(existing, 'utf-8')).toBe('OLD EXPORT');

    await exportFromSidebar('memo.md', 'docx');
    await page.locator('.qa-export-overwrite').click();
    await expect.poll(() => fs.readFileSync(existing).subarray(0, 2).toString(), { timeout: 10000 }).toBe('PK');
    expect(await docxHtml(existing)).toContain('<h1>Memo</h1>');
    const overwritten = fs.readFileSync(existing);

    await exportFromSidebar('memo.md', 'docx');
    await page.locator('.qa-export-copy').click();
    const copy = path.join(dir, 'memo 2.docx');
    await expect.poll(() => fs.existsSync(copy), { timeout: 10000 }).toBe(true);
    expect(await docxHtml(copy)).toContain('<h1>Memo</h1>');
    expect(fs.readFileSync(existing).equals(overwritten)).toBe(true);
    await expect(page.locator('.toast')).toContainText('Exported memo 2.docx');
  });

  test('export lives in the right-click menu only: the File menu has no Export items', async () => {
    ({ app, page } = await launchApp());
    const labels = await app.evaluate(({ Menu }) => {
      const walk = (items: Electron.MenuItem[]): string[] =>
        items.flatMap(i => [i.label, ...(i.submenu ? walk(i.submenu.items) : [])]);
      return walk(Menu.getApplicationMenu()!.items);
    });
    expect(labels).toContain('Save As...');
    expect(labels.filter(l => /export/i.test(l))).toEqual([]);
  });
});
