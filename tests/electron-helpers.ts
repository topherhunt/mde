import { _electron as electron, ElectronApplication, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const APP_DIR = path.resolve(__dirname, '..');

function findWebpackMain(): string {
  // electron-forge puts webpack output under .webpack/<arch>/main or .webpack/main
  const candidates = [
    path.join(APP_DIR, '.webpack', 'arm64', 'main'),
    path.join(APP_DIR, '.webpack', 'x64', 'main'),
    path.join(APP_DIR, '.webpack', 'main'),
  ];
  for (const c of candidates) {
    const entry = path.join(c, 'index.cjs');
    if (fs.existsSync(entry)) return entry;
  }
  throw new Error(
    'Webpack main bundle not found. Run "npx electron-forge package" first.'
  );
}

/** The built status worker, for tests that import src/git/status.ts directly. */
export function builtStatusWorkerPath(): string {
  return path.join(path.dirname(findWebpackMain()), 'statusWorker.cjs');
}

export async function launchApp(
  extraArgs: string[] = []
): Promise<{ app: ElectronApplication; page: Page }> {
  const mainPath = findWebpackMain();

  const app = await electron.launch({
    args: [mainPath, '--test-headless', ...extraArgs],
  });

  // Never let a test open the user's browser. URLs are recorded for tests to assert on instead.
  await app.evaluate(({ shell }) => {
    const opened: string[] = (globalThis as any).__openedExternal = [];
    shell.openExternal = async (url: string) => { opened.push(url); };
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.app', { timeout: 10000 });

  return { app, page };
}

// Clicks an application-menu item by its label path, e.g. ('File', 'Export', 'as .PDF'). The
// window is passed as Electron's click argument, since a headless window is never focused.
export async function clickMenuItem(app: ElectronApplication, ...labels: string[]): Promise<void> {
  await app.evaluate(({ Menu, BrowserWindow }, labelPath) => {
    let items = Menu.getApplicationMenu()?.items ?? [];
    let item: Electron.MenuItem | undefined;
    for (const label of labelPath) {
      item = items.find(i => i.label === label);
      if (!item) throw new Error(`No menu item "${label}" on the path ${labelPath.join(' > ')}`);
      items = item.submenu ? item.submenu.items : [];
    }
    (item!.click as (event: unknown, win: Electron.BrowserWindow) => void)(undefined, BrowserWindow.getAllWindows()[0]);
  }, labels);
}

export function fixturePath(name: string): string {
  return path.resolve(__dirname, 'fixtures', name);
}
