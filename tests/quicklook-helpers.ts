import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

// Run the Quick Look renderer (markdown-it + quicklook/render.js) through JXA
// (osascript -l JavaScript), which is JavaScriptCore -- the same engine
// PreviewProvider.swift evaluates it in. Returns the full HTML page.
export function renderInJSC(markdownItPath: string, renderPath: string, src: string): string {
  const script = [
    fs.readFileSync(markdownItPath, 'utf8'),
    fs.readFileSync(renderPath, 'utf8'),
    `renderMarkdown(${JSON.stringify(src)})`,
  ].join('\n;\n');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mde-ql-'));
  const file = path.join(dir, 'render.js');
  fs.writeFileSync(file, script);
  try {
    return execFileSync('osascript', ['-l', 'JavaScript', file], { encoding: 'utf8' });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
