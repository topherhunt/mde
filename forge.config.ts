import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

import { mainConfig, externalPackages } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('./package.json');

// Locate a package the way Node would: walk up from `fromDir` looking in each
// node_modules, so nested (version-conflicting) installs resolve correctly.
function resolvePackageDir(name: string, fromDir: string): string {
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(`Cannot package: runtime dependency "${name}" is not installed (searched up from ${fromDir}). Run npm install.`);
    }
    dir = parent;
  }
}

// Every directory needed to `require()` the externals at runtime: the packages
// themselves plus their transitive production dependencies.
function collectRuntimeDeps(seeds: string[], projectRoot: string): string[] {
  const dirs = new Set<string>();
  const walk = (name: string, fromDir: string) => {
    const dir = resolvePackageDir(name, fromDir);
    if (dirs.has(dir)) return;
    dirs.add(dir);
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    for (const dep of Object.keys(manifest.dependencies || {})) walk(dep, dir);
  };
  for (const seed of seeds) walk(seed, projectRoot);
  return [...dirs];
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    name: 'MDE',
    icon: './icon',
    extendInfo: {
      CFBundleDocumentTypes: [
        {
          CFBundleTypeName: 'Markdown Document',
          CFBundleTypeRole: 'Editor',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['net.daringfireball.markdown', 'public.plain-text'],
          CFBundleTypeExtensions: ['md', 'markdown'],
        },
        {
          CFBundleTypeName: 'Folder',
          CFBundleTypeRole: 'Viewer',
          LSHandlerRank: 'Alternate',
          LSItemContentTypes: ['public.folder'],
        },
      ],
    },
  },
  rebuildConfig: {},
  hooks: {
    // Copy the webpack `externals` (and their prod dep trees) into the packaged
    // app's node_modules. The webpack plugin assumes everything is bundled and
    // leaves node_modules empty inside app.asar, so `require('turndown')` from the
    // main bundle fails at runtime in the packaged app -- while working in dev,
    // where the project's own node_modules is right there. That asymmetry is why
    // this can't be caught by the E2E suite (Playwright launches from the dev tree);
    // it's verified by tests/packaged.spec.ts, which inspects the built app.asar.
    packageAfterCopy: async (_forgeConfig, buildPath) => {
      const projectRoot = __dirname;
      for (const dir of collectRuntimeDeps(externalPackages, projectRoot)) {
        const dest = path.join(buildPath, path.relative(projectRoot, dir));
        fs.cpSync(dir, dest, { recursive: true, dereference: true });
      }
    },

    // Repair the macOS ad-hoc code signature, then PROVE it is valid.
    //
    // FusesPlugin ad-hoc signs the bundle during `packageAfterCopy` (it must --
    // flipping fuses rewrites the Mach-O, and arm64 refuses to run unsigned code).
    // But packager then keeps working on the bundle: it renames the helper apps
    // (`Electron Helper.app` -> `MDE Helper.app`) and rewrites Info.plist to inject
    // the ElectronAsarIntegrity hash our EnableEmbeddedAsarIntegrityValidation fuse
    // needs. The signature is left describing a bundle that no longer exists, and
    // `codesign --verify` reports "invalid Info.plist (plist or signature have been
    // modified)". See electron/forge#3757 -- closed as not planned, so it is ours.
    //
    // This matters far more than it looks. A missing signature just makes Gatekeeper
    // say "unidentified developer", and the user can still click Open Anyway in
    // System Settings. A BROKEN signature makes it say "MDE is damaged and can't be
    // opened. You should move it to the Trash." -- with no override button at all,
    // because macOS is reporting tampering, not unknown provenance. The only way out
    // is `xattr -dr com.apple.quarantine`, which is not a thing we can ask users to do.
    //
    // Runs for `make`, `package`, and `pretest` alike, since postPackage is part of
    // the package step. Guarded on darwin: `codesign` does not exist on the Windows
    // runner, which builds via the same `npm run release`.
    postPackage: async (_forgeConfig, { platform, outputPaths }) => {
      if (platform !== 'darwin') return;
      for (const outputPath of outputPaths) {
        const appPath = path.join(outputPath, 'MDE.app');
        execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
        // Fail the build loudly rather than shipping a "damaged" app. Without this
        // the breakage is invisible until it reaches a user's Downloads folder.
        execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
      }
    },
  },
  makers: [
    new MakerSquirrel({
      setupIcon: './icon.ico',
      setupExe: `MDE-${pkg.version} Windows Setup.exe`,
    }),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({
      name: `MDE v${pkg.version} Apple Silicon`,
    }),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.tsx',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
        ],
      },
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      // OFF deliberately. This fuse makes Chromium create a "MDE Safe Storage"
      // keychain item, and macOS ties a keychain ACL to the app's code signature.
      // Our signature is ad-hoc, whose designated requirement is `cdhash H"..."` --
      // pinned to one exact binary. Every build has a different cdhash, so macOS
      // sees an unrecognized app each release and prompts the user for their login
      // keychain password; "Always Allow" only holds until the next build. MDE uses
      // neither cookies nor safeStorage (nothing in src/ touches either), so this
      // was buying us no protection and costing a password prompt per update.
      // If we ever get a Developer ID cert, the DR becomes team-identifier based and
      // stable across builds, and this can go back to true.
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
