import { test, expect } from '@playwright/test';
import * as asar from '@electron/asar';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Packaged-app guard: the webpack `externals` must be require-able from app.asar
//
// This is the one class of bug the rest of the suite structurally CANNOT catch.
// Playwright launches Electron against the dev tree (.webpack/main + the project's
// own node_modules), so `require('turndown')` resolves there and DOCX/PDF import
// pass -- while the packaged app ships an EMPTY node_modules inside app.asar and
// dies with "Cannot find module 'turndown'" on the user's machine.
//
// We can't just launch the packaged binary instead: the Fuses config disables
// RunAsNode / node CLI inspect arguments, so Playwright's Electron driver can't
// attach to it. So we go at the artifact directly -- extract the asar and resolve
// (and actually load) each external from it in a real Node process, which exercises
// the whole transitive dependency tree, not merely "the directory exists".
// ---------------------------------------------------------------------------

// The exact specifiers src/index.ts require()s at runtime (kept out of the bundle
// via `externals` in webpack.main.config.ts).
const EXTERNAL_SPECIFIERS = [
  'mammoth',
  'turndown',
  'turndown-plugin-gfm',
  'pdfjs-dist/legacy/build/pdf.mjs',
  'pdfjs-dist/legacy/build/pdf.worker.mjs',
];

// CommonJS subset -- these we can fully require() and smoke-test. The pdfjs entries
// are ESM (.mjs) and are checked for resolvability + readability only.
const CJS_SPECIFIERS = ['mammoth', 'turndown', 'turndown-plugin-gfm'];

function findPackagedAsar(): string {
  const outDir = path.resolve(__dirname, '..', 'out');
  if (!fs.existsSync(outDir)) {
    throw new Error(`No out/ directory. Run "npx electron-forge package" (npm test does this via pretest).`);
  }
  // darwin: <out>/MDE-darwin-arm64/MDE.app/Contents/Resources/app.asar
  // win/linux: <out>/MDE-<platform>-<arch>/resources/app.asar
  const candidates: string[] = [];
  for (const entry of fs.readdirSync(outDir)) {
    const base = path.join(outDir, entry);
    candidates.push(
      path.join(base, 'MDE.app', 'Contents', 'Resources', 'app.asar'),
      path.join(base, 'resources', 'app.asar'),
    );
  }
  const found = candidates.find(c => fs.existsSync(c));
  if (!found) {
    throw new Error(`No app.asar found under ${outDir}. Looked at:\n${candidates.join('\n')}`);
  }
  return found;
}

let extractDir: string;

test.beforeAll(() => {
  extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-asar-'));
  asar.extractAll(findPackagedAsar(), extractDir);
});

test.afterAll(() => {
  if (extractDir) fs.rmSync(extractDir, { recursive: true, force: true });
});

test.describe('Packaged app runtime dependencies', () => {
  test('every webpack external resolves from inside app.asar', () => {
    const unresolvable: string[] = [];
    for (const spec of EXTERNAL_SPECIFIERS) {
      try {
        require.resolve(spec, { paths: [extractDir] });
      } catch (err) {
        unresolvable.push(`${spec}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
    expect(unresolvable, 'externals missing from the packaged node_modules').toEqual([]);
  });

  test('the CommonJS externals actually load, with their transitive deps', () => {
    // A real require() -- so a missing nested dependency (jszip, lop, underscore,
    // @mixmark-io/domino ...) fails here just as it would in the packaged app.
    for (const spec of CJS_SPECIFIERS) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(require.resolve(spec, { paths: [extractDir] }));
      expect(mod, `${spec} loaded but exported nothing`).toBeTruthy();
    }

    const mammoth = require(require.resolve('mammoth', { paths: [extractDir] }));
    expect(typeof mammoth.convertToHtml).toBe('function');

    const TurndownService = require(require.resolve('turndown', { paths: [extractDir] }));
    const gfm = require(require.resolve('turndown-plugin-gfm', { paths: [extractDir] }));
    const td = new TurndownService();
    td.use(gfm.gfm);
    // The DOCX import path end to end in miniature: HTML table -> Markdown table.
    const md = td.turndown('<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>');
    expect(md).toContain('| A |');
    expect(md).toContain('| b |');
  });

  test('the pdfjs ESM entry points are present and readable', () => {
    for (const spec of ['pdfjs-dist/legacy/build/pdf.mjs', 'pdfjs-dist/legacy/build/pdf.worker.mjs']) {
      const resolved = require.resolve(spec, { paths: [extractDir] });
      expect(fs.statSync(resolved).size).toBeGreaterThan(0);
    }
  });
});
