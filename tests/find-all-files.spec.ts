import { test, expect } from '@playwright/test';
import { launchApp } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Find and Replace across the project: only markdown and allowlisted plain-text files are read or
// written, and a rewritten file changes in nothing but the replaced text.

let app: ElectronApplication;
let page: Page;
let tmpDirs: string[] = [];
// The "Show hidden files" value to put back, since the setting persists in the real mde-state.json.
let hiddenToRestore: boolean | null = null;

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-test-'));
  tmpDirs.push(dir);
  return dir;
}

test.afterEach(async () => {
  if (app) {
    if (hiddenToRestore !== null) await page.evaluate((v) => window.mde.setShowHiddenFiles(v), hiddenToRestore);
    await app.close();
  }
  hiddenToRestore = null;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

async function send(channel: string, arg?: string) {
  await app.evaluate(({ BrowserWindow }, a) => {
    BrowserWindow.getAllWindows()[0].webContents.send(a.channel, a.arg);
  }, { channel, arg });
}

async function setShowHidden(on: boolean) {
  if (hiddenToRestore === null) hiddenToRestore = await page.evaluate(() => window.mde.getShowHiddenFiles());
  await page.evaluate((v) => window.mde.setShowHiddenFiles(v), on);
}

// Writes `files` into a new project folder, opens it, and opens a match-free host document so the
// find bar is available. Hidden files are off unless `showHidden` says otherwise.
async function openProject(files: Record<string, string | Buffer>, showHidden = false): Promise<string> {
  ({ app, page } = await launchApp());
  await setShowHidden(showHidden);
  const dir = makeTmpDir();
  for (const [name, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), bytes);
  }
  fs.writeFileSync(path.join(dir, 'host.md'), '# Host\n');
  await send('open-project', dir);
  await send('open-file', path.join(dir, 'host.md'));
  await expect(page.locator('.tiptap')).toContainText('Host', { timeout: 5000 });
  return dir;
}

async function searchAllFiles(term: string) {
  await send('toggle-find');
  await page.locator('.qa-find-all-files').click();
  await page.locator('input[placeholder="Find..."]').fill(term);
  await expect(page.locator('.find-bar-file-status', { hasText: 'Searching' })).toHaveCount(0, { timeout: 5000 });
}

async function replaceAllFiles(replacement: string): Promise<string> {
  await page.locator('input[placeholder="Replace..."]').fill(replacement);
  await page.locator('.qa-find-replace-all-files').click();
  const label = (await page.locator('.qa-find-confirm-label').textContent())!;
  await page.locator('.qa-find-confirm-yes').click();
  await expect(page.locator('.toast')).toBeVisible({ timeout: 5000 });
  return label;
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]), Buffer.from('FINDME'), Buffer.from([0xff, 0x00])]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n(FINDME) Tj\n'), Buffer.from([0xe2, 0xe3, 0xcf, 0xd3, 0x0a])]);
const LATIN1 = Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from(' FINDME\n')]);

test.describe('Find in all files: which files', () => {
  test('Replace in All Files rewrites only markdown and plain-text files, leaving every other file byte-identical', async () => {
    const untouched: Record<string, Buffer> = {
      'photo.png': PNG,
      'report.pdf': PDF,
      'letter.docx': Buffer.from('PK\x03\x04FINDME'),
      'notes.xyz': Buffer.from('a text file of no known kind: FINDME\n'),
      'latin1.txt': LATIN1,
      '.env': Buffer.from('SECRET=FINDME\n'),
    };
    const dir = await openProject({
      'a.md': 'one FINDME\n',
      'sub/b.md': 'two FINDME\n',
      'c.txt': 'three FINDME\n',
      'd.json': '{"x": "FINDME", "y": "FINDME"}\n',
      ...untouched,
    });
    await searchAllFiles('FINDME');
    await expect(page.locator('.qa-find-file-match')).toHaveCount(4);

    await replaceAllFiles('DONE');
    await expect(page.locator('.toast')).toContainText('Replaced 5 occurrences in 2 markdown and 2 plain-text files.');
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe('one DONE\n');
    expect(fs.readFileSync(path.join(dir, 'sub/b.md'), 'utf-8')).toBe('two DONE\n');
    expect(fs.readFileSync(path.join(dir, 'c.txt'), 'utf-8')).toBe('three DONE\n');
    expect(fs.readFileSync(path.join(dir, 'd.json'), 'utf-8')).toBe('{"x": "DONE", "y": "DONE"}\n');
    for (const [name, bytes] of Object.entries(untouched)) {
      expect(fs.readFileSync(path.join(dir, name)), name).toEqual(bytes);
    }
  });

  test('a plain-text file that is not UTF-8 is skipped by search, reported, and never rewritten', async () => {
    const dir = await openProject({ 'latin1.txt': LATIN1, 'ok.md': 'FINDME\n' });
    await searchAllFiles('FINDME');
    await expect(page.locator('.qa-find-file-match')).toHaveCount(1);
    await expect(page.locator('.qa-find-unreadable')).toContainText('Skipped 1 file that is not UTF-8 text.');

    await replaceAllFiles('DONE');
    await expect(page.locator('.toast')).toContainText('Skipped 1 file that is not UTF-8 text.');
    expect(fs.readFileSync(path.join(dir, 'latin1.txt'))).toEqual(LATIN1);
    expect(fs.readFileSync(path.join(dir, 'ok.md'), 'utf-8')).toBe('DONE\n');
  });

  test('a file with unsaved changes in an open tab is skipped and reported', async () => {
    const dir = await openProject({ 'other.md': 'FINDME\n' });
    fs.writeFileSync(path.join(dir, 'host.md'), '# Host\n\nFINDME\n');
    await expect(page.locator('.tiptap')).toContainText('FINDME', { timeout: 5000 });
    await page.locator('.tiptap h1').click();
    await page.keyboard.type(' edited');
    await expect(page.locator('.tab-dirty-dot')).toHaveCount(1);

    await searchAllFiles('FINDME');
    await replaceAllFiles('DONE');
    await expect(page.locator('.toast')).toContainText('Skipped 1 file with unsaved changes.');
    expect(fs.readFileSync(path.join(dir, 'host.md'), 'utf-8')).toBe('# Host\n\nFINDME\n');
    expect(fs.readFileSync(path.join(dir, 'other.md'), 'utf-8')).toBe('DONE\n');
  });
});

test.describe('Find in all files: confirmation', () => {
  test('the confirmation names how many files of each kind will change', async () => {
    await openProject({ 'a.md': 'FINDME\n', 'b.md': 'FINDME FINDME\n', 'c.txt': 'FINDME\n', 'd.yaml': 'k: FINDME\n', 'e.csv': 'nothing\n' });
    await searchAllFiles('FINDME');
    expect(await replaceAllFiles('DONE')).toBe('Replace 5 in 2 markdown and 2 plain-text files?');
  });

  test('the confirmation names a single kind, and a single file in the singular', async () => {
    await openProject({ 'a.md': 'FINDME\n', 'b.md': 'FINDME\n', 'only.txt': 'ZAPME\n' });
    await searchAllFiles('FINDME');
    expect(await replaceAllFiles('DONE')).toBe('Replace 2 in 2 markdown files?');
    await page.locator('input[placeholder="Find..."]').fill('ZAPME');
    await expect(page.locator('.qa-find-file-match')).toHaveCount(1, { timeout: 5000 });
    expect(await replaceAllFiles('DONE')).toBe('Replace 1 in 1 plain-text file?');
  });

  test('the confirmed count is exactly the number of replacements made, even for overlapping text', async () => {
    const dir = await openProject({ 'a.md': 'aaaa\n' });
    await searchAllFiles('aa');
    expect(await replaceAllFiles('b')).toBe('Replace 2 in 1 markdown file?');
    await expect(page.locator('.toast')).toContainText('Replaced 2 occurrences in 1 markdown file.');
    expect(fs.readFileSync(path.join(dir, 'a.md'), 'utf-8')).toBe('bb\n');
  });
});

test.describe('Find in all files: literal rewrite', () => {
  test('replacing changes only the matched text: line endings, BOM, whitespace, and non-ASCII survive', async () => {
    const files = {
      'crlf.txt': '﻿key: FINDME   \r\n\tindented\r\n\r\n',
      'mixed.md': '# Café\r\nFINDME\n* item  \r\nlast line, no newline FINDME',
      'regexy.md': 'cost $& FINDME $1\n',
    };
    const dir = await openProject(files);
    await searchAllFiles('FINDME');
    await replaceAllFiles('$&-new');
    for (const [name, original] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(dir, name)), name).toEqual(Buffer.from(original.split('FINDME').join('$&-new'), 'utf-8'));
    }
  });

  test('whole-word replace leaves the term alone inside a longer word', async () => {
    const dir = await openProject({ 'a.txt': 'cat catalog bobcat cat.\n' });
    await searchAllFiles('cat');
    await page.locator('button[title="Whole Word"]').click();
    await expect(page.locator('.find-bar-count')).toContainText('2 in 1f', { timeout: 5000 });
    await replaceAllFiles('dog');
    expect(fs.readFileSync(path.join(dir, 'a.txt'), 'utf-8')).toBe('dog catalog bobcat dog.\n');
  });
});

test.describe('Show hidden files setting', () => {
  const row = (name: string) => page.locator('.tree-file').filter({ has: page.locator('.tree-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });

  test('while off, hidden files are absent from the file explorer, Quick Open, and Find in all files', async () => {
    const dir = await openProject({ '.gitignore': 'FINDME\n', '.env': 'FINDME\n', 'notes.md': 'FINDME\n' }, false);
    await expect(row('notes.md')).toBeVisible({ timeout: 5000 });
    await expect(row('.gitignore')).toHaveCount(0);
    await expect(row('.env')).toHaveCount(0);

    await send('quick-open');
    await expect(page.locator('.quick-open-item', { hasText: 'notes.md' })).toBeVisible();
    await expect(page.locator('.quick-open-item', { hasText: '.gitignore' })).toHaveCount(0);
    await expect(page.locator('.quick-open-item', { hasText: '.env' })).toHaveCount(0);
    await page.keyboard.press('Escape');

    await searchAllFiles('FINDME');
    await expect(page.locator('.qa-find-file-match')).toHaveCount(1);
    await replaceAllFiles('DONE');
    expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8')).toBe('FINDME\n');
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toBe('FINDME\n');
  });

  test('turning it on in Settings lists the allowlisted dotfiles right away, and other dotfiles stay hidden', async () => {
    await openProject({ '.gitignore': 'FINDME\n', '.eslintrc': 'FINDME\n', 'notes.md': 'FINDME\n' }, false);
    await expect(row('notes.md')).toBeVisible({ timeout: 5000 });
    await expect(row('.gitignore')).toHaveCount(0);

    await send('open-settings');
    const toggle = page.locator('.qa-settings-show-hidden');
    await expect(toggle).not.toBeChecked();
    await page.locator('.settings-toggle', { has: toggle }).click();
    await expect(toggle).toBeChecked();
    await page.locator('.qa-settings-close').click();

    await expect(row('.gitignore')).toBeVisible({ timeout: 5000 });
    await expect(row('.eslintrc')).toHaveCount(0);
    await send('quick-open');
    await expect(page.locator('.quick-open-item', { hasText: '.gitignore' })).toBeVisible();
    await page.keyboard.press('Escape');
    await searchAllFiles('FINDME');
    await expect(page.locator('.qa-find-file-match')).toHaveCount(2);

    await send('open-settings');
    await page.locator('.settings-toggle', { has: page.locator('.qa-settings-show-hidden') }).click();
    await page.locator('.qa-settings-close').click();
    await expect(row('.gitignore')).toHaveCount(0, { timeout: 5000 });
  });
});
