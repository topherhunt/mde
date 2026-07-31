import type { Configuration } from 'webpack';
import { DefinePlugin } from 'webpack';
import { execSync } from 'child_process';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

// Capture the git commit the app is built from so the About window can show it.
// Evaluated at build/package time (there's no .git dir in the packaged app). Falls
// back to 'unknown' if git isn't available (e.g. building from a source tarball).
function gitCommit(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim().slice(0, 7);
  } catch {
    return 'unknown';
  }
}

// Packages the main process `require`s at RUNTIME instead of bundling (see
// `externals` below). Because they aren't bundled, they must be copied into the
// packaged app's node_modules -- forge's webpack plugin ships an EMPTY node_modules
// inside app.asar, so without that copy step every one of these throws
// "Cannot find module" in the packaged app while working fine in dev.
// forge.config.ts's packageAfterCopy hook reads this list; keep them in sync.
export const externalPackages = [
  'pdfjs-dist',
  'mammoth',
  'turndown',
  'turndown-plugin-gfm',
];

export const mainConfig: Configuration = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: './src/index.ts',
  // Put your normal webpack config below here
  module: {
    rules,
  },
  plugins: [
    ...plugins,
    new DefinePlugin({
      'process.env.GIT_COMMIT': JSON.stringify(gitCommit()),
    }),
  ],
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css', '.json'],
  },
  externals: {
    'pdfjs-dist/legacy/build/pdf.mjs': 'commonjs pdfjs-dist/legacy/build/pdf.mjs',
    'pdfjs-dist/legacy/build/pdf.worker.mjs': 'commonjs pdfjs-dist/legacy/build/pdf.worker.mjs',
    'mammoth': 'commonjs mammoth',
    'turndown': 'commonjs turndown',
    'turndown-plugin-gfm': 'commonjs turndown-plugin-gfm',
  },
};
