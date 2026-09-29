import { test, expect } from '@playwright/test';
import * as path from 'path';
import { renderInJSC } from './quicklook-helpers';

// The Quick Look extension itself runs in QuickLookUIService, out of Playwright's
// reach. What we CAN test is its renderer, in the engine it really runs in.

const ROOT = path.resolve(__dirname, '..');

const body = (src: string) => {
  const html = renderInJSC(
    path.join(ROOT, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'),
    path.join(ROOT, 'quicklook', 'render.js'),
    src,
  );
  expect(html).toContain('<!doctype html>');
  return html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>')).trim();
};

test.describe('Quick Look preview renderer', () => {
  test.skip(process.platform !== 'darwin', 'Quick Look and JXA are macOS-only');

  test('renders headings, emphasis, tables and code blocks as HTML', () => {
    const html = body('# Title\n\nSome **bold** and `code`.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```\nx = 1\n```');
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<th>A</th>');
    expect(html).toContain('<td>2</td>');
    expect(html).toContain('<pre><code>x = 1\n</code></pre>');
  });

  test('task items are tagged with their checked state and lose the [ ] marker', () => {
    const html = body('- [ ] open\n- [x] done\n- plain');
    expect(html).toMatch(/<li class="task" data-checked="false">\s*<p>open<\/p>\s*<\/li>/);
    expect(html).toMatch(/<li class="task" data-checked="true">\s*<p>done<\/p>\s*<\/li>/);
    expect(html).toContain('<li>plain</li>');
    expect(html).not.toContain('[ ]');
    expect(html).not.toContain('[x]');
  });

  test('a checked item wraps only its own text, not its nested list', () => {
    const html = body('- [x] parent\n  - child');
    expect(html).toMatch(/<li class="task" data-checked="true">\s*<p>parent<\/p>\s*<ul>\s*<li>child<\/li>/);
  });

  test('brackets that are not a leading task marker are left alone', () => {
    const html = body('- see [x] later\n\n[ ] not a list');
    expect(html).toContain('<li>see [x] later</li>');
    expect(html).toContain('<p>[ ] not a list</p>');
  });

  test('raw HTML is shown as literal text, matching the editor', () => {
    expect(body('<b>raw</b> & <script>x</script>')).toBe('<p>&lt;b&gt;raw&lt;/b&gt; &amp; &lt;script&gt;x&lt;/script&gt;</p>');
  });

  test('a single newline is a line break, matching the editor', () => {
    expect(body('one\ntwo')).toBe('<p>one<br>\ntwo</p>');
  });

  test('an image reference is shown as its alt text, not a broken <img>', () => {
    const html = body('before ![a <pic>](img.png) after');
    expect(html).not.toContain('<img');
    expect(html).toContain('<span class="image-ref">[a &lt;pic&gt;]</span>');
  });
});

// The Finder thumbnail draws these blocks natively (ThumbnailProvider.swift).
const blocks = (src: string) => JSON.parse(renderInJSC(
  path.join(ROOT, 'node_modules', 'markdown-it', 'dist', 'markdown-it.min.js'),
  path.join(ROOT, 'quicklook', 'render.js'),
  src,
  'thumbnailBlocks',
));

test.describe('Quick Look thumbnail blocks', () => {
  test.skip(process.platform !== 'darwin', 'Quick Look and JXA are macOS-only');

  test('headings, paragraphs and quotes come out as plain text with their kind', () => {
    expect(blocks('# Big **idea**\n\nSome `code` and\na break.\n\n> quoted')).toEqual([
      { kind: 'h1', text: 'Big idea' },
      { kind: 'p', text: 'Some code and a break.' },
      { kind: 'quote', text: 'quoted' },
    ]);
  });

  test('bullets, numbered items and tasks keep their markers as data', () => {
    expect(blocks('- one\n  - nested\n\n3. three\n4. four\n\n- [x] done\n- [ ] todo')).toEqual([
      { kind: 'bullet', text: 'one' },
      { kind: 'bullet', text: 'nested' },
      { kind: 'ordered', text: 'three', n: '3' },
      { kind: 'ordered', text: 'four', n: '4' },
      { kind: 'task', text: 'done', checked: true },
      { kind: 'task', text: 'todo', checked: false },
    ]);
  });

  test('code blocks are kept and table cells are skipped', () => {
    expect(blocks('```\nx = 1\n```\n\n| A |\n|---|\n| 1 |')).toEqual([{ kind: 'code', text: 'x = 1' }]);
  });

  test('only the first 40 blocks are returned', () => {
    const src = Array.from({ length: 60 }, (_, i) => `para ${i}`).join('\n\n');
    const out = blocks(src);
    expect(out).toHaveLength(40);
    expect(out[39]).toEqual({ kind: 'p', text: 'para 39' });
  });
});
