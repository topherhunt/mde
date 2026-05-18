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
    if (fs.existsSync(path.join(c, 'index.js'))) return c;
  }
  throw new Error(
    'Webpack main bundle not found. Run "npx electron-forge package" first.'
  );
}

export async function launchApp(): Promise<{ app: ElectronApplication; page: Page }> {
  const mainPath = findWebpackMain();

  const app = await electron.launch({
    args: [mainPath, '--test-headless'],
  });

  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForSelector('.app', { timeout: 10000 });

  return { app, page };
}

export function fixturePath(name: string): string {
  return path.resolve(__dirname, 'fixtures', name);
}
