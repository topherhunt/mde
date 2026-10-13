import { test, expect } from '@playwright/test';
import { launchApp, clickMenuItem } from './electron-helpers';
import { ElectronApplication, Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// The File menu's file actions mirror the right-click file menu, applied to the active tab,
// so nothing is reachable only by right-clicking.

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

// A project folder with notes/plan.md open in a tab.
async function openFileInProject(): Promise<{ dir: string; file: string }> {
  ({ app, page } = await launchApp());
  const dir = makeTmpDir();
  fs.mkdirSync(path.join(dir, 'notes'));
  const file = path.join(dir, 'notes', 'plan.md');
  fs.writeFileSync(file, '# Plan\n');
  await app.evaluate(({ BrowserWindow }, args) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.send('open-project', args.dir);
    wc.send('open-file', args.file);
  }, { dir, file });
  await expect(page.locator('.tab-name')).toContainText('plan.md', { timeout: 5000 });
  return { dir, file };
}

test.describe('File menu file actions', () => {
  test('File > Rename... renames the active tab\'s file on disk and retitles the tab', async () => {
    const { dir, file } = await openFileInProject();
    await clickMenuItem(app, 'File', 'Rename...');
    await expect(page.locator('.qa-rename-dialog input')).toHaveValue('plan.md');
    // The base name is pre-selected, so typing replaces it and keeps the extension.
    await page.keyboard.type('roadmap');
    await page.keyboard.press('Enter');

    const renamed = path.join(dir, 'notes', 'roadmap.md');
    await expect.poll(() => fs.existsSync(renamed)).toBe(true);
    expect(fs.existsSync(file)).toBe(false);
    await expect(page.locator('.tab-name')).toContainText('roadmap.md');
  });

  test('File > Move to Trash... asks first, then trashes the file and closes its tab', async () => {
    const { file } = await openFileInProject();
    await clickMenuItem(app, 'File', process.platform === 'darwin' ? 'Move to Trash...' : 'Delete...');
    await expect(page.locator('.qa-delete-confirm')).toBeVisible();
    expect(fs.existsSync(file)).toBe(true);

    await page.locator('.qa-delete-confirm').click();
    await expect.poll(() => fs.existsSync(file)).toBe(false);
    await expect(page.locator('.tab-name')).toHaveCount(0);
  });

  test('File > Copy Relative Path copies the active file\'s path relative to the project folder', async () => {
    await openFileInProject();
    await clickMenuItem(app, 'File', 'Copy Relative Path');
    await expect(page.locator('.toast')).toContainText('Copied path: notes/plan.md');
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('notes/plan.md');
  });

  test('File > Reveal in Finder shows the active file in the OS file manager', async () => {
    const { file } = await openFileInProject();
    await app.evaluate(({ shell }) => {
      (globalThis as { revealed?: string }).revealed = undefined;
      shell.showItemInFolder = (p: string) => { (globalThis as { revealed?: string }).revealed = p; };
    });
    const label = process.platform === 'darwin' ? 'Reveal in Finder' : process.platform === 'win32' ? 'Show in Explorer' : 'Show in Folder';
    await clickMenuItem(app, 'File', label);
    await expect.poll(() => app.evaluate(() => (globalThis as { revealed?: string }).revealed)).toBe(file);
  });

  test('File > View Change History explains that checkpoints are off instead of opening an empty view', async () => {
    await openFileInProject();
    await clickMenuItem(app, 'File', 'View Change History');
    await expect(page.locator('.toast')).toContainText('Checkpoints are off for this folder');
    await expect(page.locator('.tab-name')).toHaveCount(1);
  });

  test('with no file open, a file action says so instead of doing nothing', async () => {
    ({ app, page } = await launchApp());
    await clickMenuItem(app, 'File', 'Copy Relative Path');
    await expect(page.locator('.toast')).toContainText('Open a file first.');
  });
});
