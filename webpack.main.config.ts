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
