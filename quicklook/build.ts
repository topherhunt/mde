import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

const SRC = __dirname;

// The spacebar preview and the Finder icon thumbnail are separate extension points,
// so separate appexes. Both run render.js through Shared.swift.
export const EXTENSIONS = [
  { name: 'MDEQuickLook', idSuffix: '.quicklook', plist: 'Preview-Info.plist', swift: ['Shared.swift', 'PreviewProvider.swift'], frameworks: ['QuickLookUI', 'JavaScriptCore'] },
  { name: 'MDEThumbnail', idSuffix: '.thumbnail', plist: 'Thumbnail-Info.plist', swift: ['Shared.swift', 'ThumbnailProvider.swift'], frameworks: ['QuickLookThumbnailing', 'AppKit', 'JavaScriptCore'] },
];

const appexPath = (appPath: string, name: string) => path.join(appPath, 'Contents', 'PlugIns', `${name}.appex`);

// Compile the Quick Look extensions into <app>/Contents/PlugIns and sign each with
// its sandbox entitlements. The caller must re-sign the host app WITHOUT --deep
// afterwards: --deep would re-sign the appexes too and strip their entitlements,
// and an unsandboxed Quick Look extension silently never loads.
export function buildQuickLookExtension(appPath: string, arch: string): void {
  const hostPlist = path.join(appPath, 'Contents', 'Info.plist');
  const target = `${arch === 'x64' ? 'x86_64' : arch}-apple-macos12`;
  for (const ext of EXTENSIONS) {
    const appex = appexPath(appPath, ext.name);
    const contents = path.join(appex, 'Contents');
    fs.rmSync(appex, { recursive: true, force: true });
    fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(contents, 'Resources'), { recursive: true });

    // macOS rejects an extension whose bundle ID is not prefixed by its host's.
    const plist = path.join(contents, 'Info.plist');
    fs.copyFileSync(path.join(SRC, ext.plist), plist);
    for (const key of ['CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion']) {
      let value = execFileSync('plutil', ['-extract', key, 'raw', hostPlist], { encoding: 'utf8' }).trim();
      if (key === 'CFBundleIdentifier') value += ext.idSuffix;
      execFileSync('plutil', ['-insert', key, '-string', value, plist]);
    }

    fs.copyFileSync(path.join(SRC, 'render.js'), path.join(contents, 'Resources', 'render.js'));
    fs.copyFileSync(require.resolve('markdown-it/dist/markdown-it.min.js'), path.join(contents, 'Resources', 'markdown-it.min.js'));

    execFileSync('swiftc', [
      '-O', '-target', target, '-module-name', ext.name, '-parse-as-library', '-application-extension',
      '-Xlinker', '-e', '-Xlinker', '_NSExtensionMain',
      ...ext.frameworks.flatMap((f) => ['-framework', f]),
      ...ext.swift.map((f) => path.join(SRC, f)),
      '-o', path.join(contents, 'MacOS', ext.name),
    ], { stdio: 'inherit' });

    execFileSync('codesign', ['--force', '--sign', '-', '--entitlements', path.join(SRC, 'entitlements.plist'), appex], { stdio: 'inherit' });
  }
}

// `codesign --verify --deep` still passes when a later --deep re-sign stripped an
// appex's entitlements, so check the sandbox entitlement survived the final seal.
export function verifyQuickLookExtension(appPath: string): void {
  for (const ext of EXTENSIONS) {
    const appex = appexPath(appPath, ext.name);
    const entitlements = execFileSync('codesign', ['-d', '--entitlements', '-', '--xml', appex], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (!/<key>com\.apple\.security\.app-sandbox<\/key>\s*<true\/>/.test(entitlements)) {
      throw new Error(`${appex} lost its sandbox entitlement; macOS will never load it. Was the app re-signed with --deep after buildQuickLookExtension?`);
    }
  }
}
