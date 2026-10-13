import { Editor, getHTMLFromFragment, createNodeFromContent } from '@tiptap/core';
import type { Node as PMNode, Mark } from '@tiptap/pm/model';
import {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink, HeadingLevel, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, LevelFormat, AlignmentType, Bookmark, InternalHyperlink,
  type IRunOptions, type IParagraphOptions, type ILevelsOptions,
} from 'docx';
import { buildExtensions } from '../components/Editor';
import { markdownToHtml, headingAnchors, normalizeAnchor } from './markdown';
import { PALETTE, PaletteColor } from './colorMarks';
import { resolveImageSrc, displaySrc } from './imageNode';

// Export as PDF / DOCX (right-click menu or File > Export). Both formats are built from the ProseMirror document --
// the same model the editor shows -- never from the rendered window.

export type ExportFormat = 'pdf' | 'docx';

// Exports are for paper and other people's screens, so they always use the light-theme shades
// (the values of --highlight-<name> / --text-color-<name> in index.css's :root).
const HIGHLIGHT: Record<PaletteColor, string> = {
  gray: 'e5e7eb', brown: 'ead8c8', red: 'fecaca', orange: 'fed7aa', yellow: 'fef08a',
  lime: 'd9f99d', green: 'bbf7d0', blue: 'cfe2fd', purple: 'e9d5ff', pink: 'fbcfe8',
};
const TEXT_COLOR: Record<PaletteColor, string> = {
  gray: '6b7280', brown: '8b5a3c', red: 'dc2626', orange: 'c2410c', yellow: 'a16207',
  lime: '4d7c0f', green: '15803d', blue: '2563eb', purple: '9333ea', pink: 'db2777',
};

// What a link becomes in an export: a URL with a scheme stays external, a `#heading` in this
// document becomes an internal jump, and anything else (another .md, a missing heading) means
// nothing outside MDE, so it keeps its text and loses the link.
type LinkTarget = { external: string } | { slug: string } | null;

function resolveLink(href: string, slugs: { has(slug: string): boolean }): LinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { external: href };
  if (!href.startsWith('#')) return null;
  const slug = normalizeAnchor(href.slice(1));
  return slugs.has(slug) ? { slug } : null;
}

// Exports can't show the editor's missing-image box, so an image that won't load becomes this.
const missingImageText = (src: string) => `[image not found: ${displaySrc(src)}]`;

function imageSrcs(doc: PMNode): Set<string> {
  const srcs = new Set<string>();
  doc.descendants(node => { if (node.type.name === 'image') srcs.add(node.attrs.src); });
  return srcs;
}

async function loadImage(src: string, baseDir: string | null): Promise<HTMLImageElement | null> {
  const source = resolveImageSrc(src, baseDir);
  if (!source) return null;
  const img = new Image();
  // Lets a loaded image be drawn to a canvas and read back (mde-file: sends the CORS header).
  img.crossOrigin = 'anonymous';
  img.src = source.url;
  try { await img.decode(); } catch { return null; }
  return img.naturalWidth ? img : null;
}

let parserEditor: Editor | null = null;

// Parses markdown exactly as opening the file would, without mounting an editor.
export function markdownToDoc(markdown: string): PMNode {
  parserEditor ??= new Editor({ extensions: buildExtensions() });
  return createNodeFromContent(markdownToHtml(parserEditor, markdown), parserEditor.schema, { slice: false }) as PMNode;
}

// --- PDF: a standalone HTML page, printed by the main process ---

const PDF_CSS = `
@page { margin: 0.5in; }
body { margin: 0; color: #1a1a1a; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; font-size: 11pt; line-height: 1.5; }
h1 { font-size: 2em; font-weight: 700; line-height: 1.2; margin: 1.2em 0 0.5em; }
h2 { font-size: 1.5em; font-weight: 600; line-height: 1.3; margin: 1.2em 0 0.4em; }
h3 { font-size: 1.25em; font-weight: 600; margin: 1.1em 0 0.3em; }
h4, h5, h6 { font-size: 1em; font-weight: 600; margin: 1em 0 0.3em; }
h1, h2, h3, h4, h5, h6 { break-after: avoid; }
body > :first-child { margin-top: 0; }
p { margin: 0.5em 0; }
li > p { margin: 0.15em 0; }
a { color: #2563eb; }
code { background: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 3px; padding: 0.05em 0.3em; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.9em; }
pre { background: #f5f5f5; border: 1px solid #e5e5e5; border-radius: 6px; padding: 0.75em 1em; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; border: none; padding: 0; }
blockquote { margin: 0.8em 0; padding-left: 1em; border-left: 3px solid #d4d4d4; color: #666; }
table { border-collapse: collapse; margin: 0.8em 0; }
th, td { border: 1px solid #d4d4d4; padding: 0.3em 0.6em; vertical-align: top; text-align: left; }
th { background: #f5f5f5; }
th > p, td > p { margin: 0; }
img { max-width: 100%; }
tr { break-inside: avoid; }
hr { border: none; border-top: 1px solid #d4d4d4; margin: 1.5em 0; }
li[data-checked] { list-style: none; position: relative; }
li[data-checked]::before { content: ""; position: absolute; left: -1.4em; top: 0.3em; width: 0.9em; height: 0.9em; border: 1.5px solid #666; border-radius: 3px; box-sizing: border-box; }
li[data-checked="true"]::before { background: #2563eb center / 100% no-repeat url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 14 14'%3E%3Cpath d='M3.5 7.5L6 10l4.5-5' stroke='white' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E"); border-color: #2563eb; }
li[data-checked="true"] > p { color: #666; text-decoration: line-through; }
mark { background: #${HIGHLIGHT.yellow}; color: inherit; padding: 0.1em 0.2em; border-radius: 2px; }
${PALETTE.map(c => `mark[data-color="${c}"] { background: #${HIGHLIGHT[c]}; }\nspan[data-text-color="${c}"] { color: #${TEXT_COLOR[c]}; }`).join('\n')}
`;

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function docToPdfHtml(doc: PMNode, title: string, baseDir: string | null): Promise<string> {
  const container = document.createElement('div');
  container.innerHTML = getHTMLFromFragment(doc.content, doc.type.schema);
  const loaded = new Map<string, string | null>();
  await Promise.all(Array.from(imageSrcs(doc), async src => loaded.set(src, (await loadImage(src, baseDir))?.src ?? null)));
  for (const img of Array.from(container.querySelectorAll('img'))) {
    const src = img.getAttribute('src')!;
    const url = loaded.get(src);
    if (url) {
      img.setAttribute('src', url);
      img.removeAttribute('data-markdown');
    } else {
      img.replaceWith(missingImageText(src));
    }
  }
  // The DOM lists headings in the same document order headingAnchors walks.
  const anchors = headingAnchors(doc);
  const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
  if (headings.length !== anchors.length) throw new Error(`PDF export: ${headings.length} rendered headings but ${anchors.length} in the document`);
  headings.forEach((h, i) => { h.id = anchors[i].slug; });
  const slugs = new Set(anchors.map(a => a.slug));
  for (const a of Array.from(container.querySelectorAll('a'))) {
    const target = resolveLink(a.getAttribute('href') || '', slugs);
    if (!target) a.replaceWith(...Array.from(a.childNodes));
    else if ('slug' in target) a.setAttribute('href', `#${target.slug}`);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${PDF_CSS}</style></head><body>${container.innerHTML}</body></html>`;
}

// --- DOCX: built node by node, so Word gets real headings, lists, and tables ---

const FONT = 'Arial';
const MONO = 'Courier New';
const MUTED = '666666';
const BORDER = 'd4d4d4';
const CODE_BG = 'f5f5f5';
const INDENT = 360; // twips per list level / quote depth

// Inherited from enclosing blocks: a quote greys and indents its text, a checked task strikes
// it, a header cell bolds it.
interface Ctx { quoteDepth: number; listLevel: number; muted?: boolean; strike?: boolean; bold?: boolean }

function listLevels(text: (level: number) => string, format: typeof LevelFormat[keyof typeof LevelFormat], start = 1): ILevelsOptions[] {
  return Array.from({ length: 9 }, (_, level) => ({
    level, format, start, text: text(level), alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: INDENT * (level + 1) + INDENT, hanging: INDENT } } },
  }));
}

const BULLETS = ['•', '◦', '▪'];

// Widest an embedded image may be, in the CSS pixels docx sizes images in: the 6.5in text
// column of a Letter page with 1in margins.
const MAX_IMAGE_PX = 624;

// Word needs the bytes, in a format it reads. Drawing to a canvas covers every type the editor
// can show (webp, svg, ...) with one PNG path.
type DocxImage = { data: Uint8Array; width: number; height: number };

async function rasterize(src: string, baseDir: string | null): Promise<DocxImage | null> {
  const img = await loadImage(src, baseDir);
  if (!img) return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  // A remote image without CORS headers fails to decode above; this throws only on a bug.
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(`DOCX export: could not encode image ${src}`);
  const scale = Math.min(1, MAX_IMAGE_PX / img.naturalWidth);
  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    width: Math.round(img.naturalWidth * scale),
    height: Math.round(img.naturalHeight * scale),
  };
}

// Word bookmark names allow only letters, digits, and underscores, so a heading slug can't be
// used directly; the leading underscore hides them from Word's Bookmarks dialog.
const bookmarkName = (headingIndex: number) => `_heading${headingIndex}`;

class DocxBuilder {
  private orderedStarts = new Set<number>();
  private orderedInstance = 0;
  private headingSlugs: string[] = [];
  private headingIndex = 0;
  // Only headings some link points at get a bookmark, so Word users aren't handed clutter.
  private bookmarkBySlug = new Map<string, string>();

  constructor(private images: Map<string, DocxImage | null>) {}

  build(doc: PMNode): Promise<Blob> {
    this.headingSlugs = headingAnchors(doc).map(a => a.slug);
    const slugs = new Set(this.headingSlugs);
    doc.descendants(node => {
      for (const mark of node.marks) {
        const target = mark.type.name === 'link' ? resolveLink(mark.attrs.href, slugs) : null;
        if (target && 'slug' in target) this.bookmarkBySlug.set(target.slug, bookmarkName(this.headingSlugs.indexOf(target.slug)));
      }
    });
    const children = this.blocks(doc, { quoteDepth: 0, listLevel: 0 });
    const document = new Document({
      styles: {
        default: {
          document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 120, line: 276 } } },
          heading1: { run: { font: FONT, size: 40, bold: true, color: '1a1a1a' }, paragraph: { spacing: { before: 360, after: 120 } } },
          heading2: { run: { font: FONT, size: 32, bold: true, color: '1a1a1a' }, paragraph: { spacing: { before: 320, after: 100 } } },
          heading3: { run: { font: FONT, size: 26, bold: true, color: '1a1a1a' }, paragraph: { spacing: { before: 280, after: 80 } } },
          heading4: { run: { font: FONT, size: 22, bold: true, color: '1a1a1a' }, paragraph: { spacing: { before: 240, after: 80 } } },
          heading5: { run: { font: FONT, size: 22, bold: true, color: '1a1a1a' }, paragraph: { spacing: { before: 240, after: 80 } } },
          heading6: { run: { font: FONT, size: 22, bold: true, color: MUTED }, paragraph: { spacing: { before: 240, after: 80 } } },
          hyperlink: { run: { color: '2563eb', underline: {} } },
        },
      },
      numbering: {
        config: [
          { reference: 'bullet', levels: listLevels(l => BULLETS[l % BULLETS.length], LevelFormat.BULLET) },
          { reference: 'task-open', levels: listLevels(() => '☐', LevelFormat.BULLET) },
          { reference: 'task-done', levels: listLevels(() => '☑', LevelFormat.BULLET) },
          ...Array.from(this.orderedStarts, start => ({
            reference: `ordered-${start}`, levels: listLevels(l => `%${l + 1}.`, LevelFormat.DECIMAL, start),
          })),
        ],
      },
      sections: [{ properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children }],
    });
    return Packer.toBlob(document);
  }

  private blocks(parent: PMNode, ctx: Ctx): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [];
    parent.forEach(node => out.push(...this.block(node, ctx)));
    return out;
  }

  private quoteProps(ctx: Ctx): IParagraphOptions {
    if (!ctx.quoteDepth) return {};
    return {
      indent: { left: INDENT * ctx.quoteDepth },
      border: { left: { style: BorderStyle.SINGLE, size: 18, color: BORDER, space: 8 } },
    };
  }

  private block(node: PMNode, ctx: Ctx): (Paragraph | Table)[] {
    switch (node.type.name) {
      case 'paragraph':
        return [new Paragraph({ ...this.quoteProps(ctx), children: this.inline(node, ctx) })];
      case 'heading': {
        // Visited in the same document order headingAnchors walks.
        const bookmark = this.bookmarkBySlug.get(this.headingSlugs[this.headingIndex++]);
        const children = this.inline(node, ctx);
        return [new Paragraph({
          ...this.quoteProps(ctx),
          heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6][node.attrs.level - 1],
          children: bookmark ? [new Bookmark({ id: bookmark, children })] : children,
        })];
      }
      case 'blockquote':
        return this.blocks(node, { ...ctx, quoteDepth: ctx.quoteDepth + 1, muted: true });
      case 'codeBlock':
        return [new Paragraph({
          ...this.quoteProps(ctx),
          shading: { type: ShadingType.CLEAR, color: 'auto', fill: CODE_BG },
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 }, bottom: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 }, left: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 }, right: { style: BorderStyle.SINGLE, size: 4, color: BORDER, space: 4 } },
          children: node.textContent.split('\n').map((line, i) => new TextRun({ text: line, font: MONO, size: 19, ...(i ? { break: 1 } : {}) })),
        })];
      case 'horizontalRule':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BORDER, space: 1 } }, children: [] })];
      case 'bulletList':
        return this.list(node, ctx, () => 'bullet');
      case 'orderedList': {
        const start = node.attrs.start ?? 1;
        this.orderedStarts.add(start);
        const instance = ++this.orderedInstance;
        return this.list(node, ctx, () => `ordered-${start}`, instance);
      }
      case 'table':
        return [this.table(node, ctx)];
      default:
        throw new Error(`DOCX export: no mapping for block node "${node.type.name}"`);
    }
  }

  // An item's first paragraph carries the marker; anything after it (more paragraphs, a
  // sublist) sits at the item's indent without one.
  private list(node: PMNode, ctx: Ctx, reference: () => string, instance?: number): (Paragraph | Table)[] {
    const out: (Paragraph | Table)[] = [];
    node.forEach(item => {
      const checked: boolean | null = item.attrs.checked ?? null;
      const ref = checked === null ? reference() : checked ? 'task-done' : 'task-open';
      const itemCtx: Ctx = { ...ctx, strike: ctx.strike || checked === true, muted: ctx.muted || checked === true };
      item.forEach((child, _offset, index) => {
        if (index === 0 && child.type.name === 'paragraph') {
          out.push(new Paragraph({
            numbering: { reference: ref, level: ctx.listLevel, ...(instance && checked === null ? { instance } : {}) },
            spacing: { after: 40 },
            children: this.inline(child, itemCtx),
          }));
        } else if (child.type.name === 'bulletList' || child.type.name === 'orderedList') {
          out.push(...this.block(child, { ...ctx, listLevel: ctx.listLevel + 1 }));
        } else if (child.type.name === 'paragraph') {
          out.push(new Paragraph({
            indent: { left: INDENT * (ctx.listLevel + 2) + INDENT * ctx.quoteDepth },
            spacing: { after: 40 },
            children: this.inline(child, itemCtx),
          }));
        } else {
          out.push(...this.block(child, { ...ctx, listLevel: ctx.listLevel + 1 }));
        }
      });
    });
    return out;
  }

  private table(node: PMNode, ctx: Ctx): Table {
    const rows: TableRow[] = [];
    node.forEach(row => {
      const cells: TableCell[] = [];
      row.forEach(cell => {
        const header = cell.type.name === 'tableHeader';
        const paragraphs = this.blocks(cell, { quoteDepth: 0, listLevel: 0, muted: ctx.muted, bold: header });
        cells.push(new TableCell({
          columnSpan: cell.attrs.colspan > 1 ? cell.attrs.colspan : undefined,
          rowSpan: cell.attrs.rowspan > 1 ? cell.attrs.rowspan : undefined,
          shading: header ? { type: ShadingType.CLEAR, color: 'auto', fill: CODE_BG } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: paragraphs.length ? paragraphs : [new Paragraph({ children: [] })],
        }));
      });
      // `tableHeader: false` writes <w:tblHeader w:val="off"/>, which simpler readers (mammoth,
      // and so MDE's own import) take as ON -- every row would become a header. Omit it instead.
      const header = rows.length === 0 && row.firstChild?.type.name === 'tableHeader';
      rows.push(new TableRow({ children: cells, ...(header ? { tableHeader: true } : {}) }));
    });
    const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER };
    return new Table({
      rows,
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
    });
  }

  private inline(node: PMNode, ctx: Ctx): (TextRun | ImageRun | ExternalHyperlink | InternalHyperlink)[] {
    const out: (TextRun | ImageRun | ExternalHyperlink | InternalHyperlink)[] = [];
    node.forEach(child => {
      if (child.type.name === 'hardBreak') {
        out.push(new TextRun({ break: 1 }));
        return;
      }
      let run: TextRun | ImageRun;
      if (child.type.name === 'image') {
        const image = this.images.get(child.attrs.src);
        run = image
          ? new ImageRun({ type: 'png', data: image.data, transformation: { width: image.width, height: image.height }, altText: { name: child.attrs.alt || 'image', description: child.attrs.alt || '' } })
          : new TextRun({ text: missingImageText(child.attrs.src), italics: true, color: MUTED });
      } else if (child.isText) {
        run = this.run(child.text!, child.marks, ctx);
      } else {
        throw new Error(`DOCX export: no mapping for inline node "${child.type.name}"`);
      }
      const link = child.marks.find(m => m.type.name === 'link');
      const target = link ? resolveLink(link.attrs.href, this.bookmarkBySlug) : null;
      if (!target) out.push(run);
      else if ('external' in target) out.push(new ExternalHyperlink({ link: target.external, children: [run] }));
      else out.push(new InternalHyperlink({ anchor: this.bookmarkBySlug.get(target.slug)!, children: [run] }));
    });
    return out;
  }

  private run(text: string, marks: readonly Mark[], ctx: Ctx): TextRun {
    const opts: { -readonly [K in keyof IRunOptions]: IRunOptions[K] } = { text };
    if (ctx.muted) opts.color = MUTED;
    if (ctx.strike) opts.strike = true;
    if (ctx.bold) opts.bold = true;
    for (const mark of marks) {
      switch (mark.type.name) {
        case 'bold': opts.bold = true; break;
        case 'italic': opts.italics = true; break;
        case 'strike': opts.strike = true; break;
        case 'underline': opts.underline = {}; break;
        case 'code':
          opts.font = MONO;
          opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: CODE_BG };
          break;
        case 'highlight':
          opts.shading = { type: ShadingType.CLEAR, color: 'auto', fill: HIGHLIGHT[(mark.attrs.color as PaletteColor | null) ?? 'yellow'] };
          break;
        case 'textColor': opts.color = TEXT_COLOR[mark.attrs.color as PaletteColor]; break;
        case 'link':
          if (resolveLink(mark.attrs.href, this.bookmarkBySlug)) opts.style = 'Hyperlink';
          break;
        default:
          throw new Error(`DOCX export: no mapping for mark "${mark.type.name}"`);
      }
    }
    return new TextRun(opts);
  }
}

export async function docToDocx(doc: PMNode, baseDir: string | null): Promise<Uint8Array> {
  const images = new Map<string, DocxImage | null>();
  await Promise.all(Array.from(imageSrcs(doc), async src => images.set(src, await rasterize(src, baseDir))));
  const blob = await new DocxBuilder(images).build(doc);
  return new Uint8Array(await blob.arrayBuffer());
}
