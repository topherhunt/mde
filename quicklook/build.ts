import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SRC = __dirname;
export const APPEX_NAME = 'MDEQuickLook.appex';

// Compile the Quick Look preview extension into <app>/Contents/PlugIns and sign it
// with its sandbox entitlements. The caller must re-sign the host app WITHOUT
// --deep afterwards: --deep would re-sign this appex too and strip its
// entitlements, and an unsandboxed preview extension silently never loads.
export function buildQuickLookExtension(appPath: string, arch: string): void {
  const appex = path.join(appPath, 'Contents', 'PlugIns', APPEX_NAME);
  const contents = path.join(appex, 'Contents');
  fs.rmSync(appex, { recursive: true, force: true });
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });

  // macOS rejects an extension whose bundle ID is not prefixed by its host's.
  const hostPlist = path.join(appPath, 'Contents', 'Info.plist');
  const plist = path.join(contents, 'Info.plist');
  fs.copyFileSync(path.join(SRC, 'Info.plist'), plist);
  for (const key of ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion']) {
    let value = execFileSync('plutil', ['-extract', key, 'raw', hostPlist], { encoding: 'utf8' }).trim();
    if (key === 'CFBundleIdentifier') value += '.quicklook';
    execFileSync('plutil', ['-insert', key, '-string', value, plist]);
  }

  fs.copyFileSync(path.join(SRC, 'render.js'), path.join(contents, 'Resources', 'render.js'));
  fs.copyFileSync(require.resolve('markdown-it/dist/markdown-it.min.js'), path.join(contents, 'Resources', 'markdown-it.min.js'));

  const target = `${arch === 'x64' ? 'x86_64' : arch}-apple-macos12`;
  execFileSync('swiftc', [
    '-O', '-target', target, '-module-name', 'MDEQuickLook', '-parse-as-library', '-application-extension',
    '-Xlinker', '-e', '-Xlinker', '_NSExtensionMain',
    '-framework', 'QuickLookUI', '-framework', 'JavaScriptCore',
    path.join(SRC, 'PreviewProvider.swift'),
    '-o', path.join(contents, 'MacOS', 'MDEQuickLook'),
  ], { stdio: 'inherit' });

  execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', path.join(SRC, 'entitlements.plist'), appex], { stdio: 'inherit' });
}

// `codesign --verify --deep` still passes when a later --deep re-sign stripped the
// appex's entitlements, so check the sandbox entitlement survived the final seal.
export function verifyQuickLookExtension(appPath: string): void {
  const appex = path.join(appPath, 'Contents', 'PlugIns', APPEX_NAME);
  const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', appex], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (!/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/.test(entitlements)) {
    throw new Error(`${appex} lost its sandbox entitlement; macOS will never load it. Was the app re-signed with --deep after buildQuickLookExtension?`);
  }
}
