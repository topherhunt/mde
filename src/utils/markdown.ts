import { Editor, createNodeFromContent } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';

const SEPARATOR = '{LIST_SEPARATOR}';

// Mark every line that lives inside a fenced code block (the fence lines themselves
// included). List syntax in there is CONTENT, not structure -- inserting a separator
// into a fence puts a literal {LIST_SEPARATOR} in the user's code sample, which then
// gets saved back to disk.
function fencedLines(lines: string[]): boolean[] {
  const fenceRe = /^ {0,3}(`{3,}|~{3,})/;
  const inFence = new Array<boolean>(lines.length).fill(false);
  let open: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(fenceRe);
    if (open === null) {
      if (m) {
        open = m[1][0].repeat(m[1].length);
        inFence[i] = true;
      }
    } else {
      inFence[i] = true;
      // A closing fence is the same character, at least as long, with nothing after it.
      if (m && m[1][0] === open[0] && m[1].length >= open.length && lines[i].slice(m[0].length).trim() === '') {
        open = null;
      }
    }
  }
  return inFence;
}

export function splitLooseLists(md: string): string {
  const lines = md.split('\n');
  const inFence = fencedLines(lines);
  const output: string[] = [];
  const markerRe = /^([ \t]*)([-*+]|\d+[.)]) /;

  for (let i = 0; i < lines.length; i++) {
    output.push(lines[i]);

    if (i + 2 >= lines.length || lines[i + 1] !== '') continue;
    if (inFence[i] || inFence[i + 1] || inFence[i + 2]) continue;

    const nextMatch = lines[i + 2].match(markerRe);
    if (!nextMatch) continue;
    const nextIndent = nextMatch[1].length;

    let currentIndent = -1;
    for (let j = i; j >= 0; j--) {
      if (inFence[j]) break;
      const m = lines[j].match(markerRe);
      if (m) {
        currentIndent = m[1].length;
        break;
      }
      if (lines[j].trim() === '') break;
    }

    if (currentIndent >= 0 && nextIndent <= currentIndent) {
      output.push('');
      output.push(SEPARATOR);
      output.push('');
      i++;
    }
  }

  return output.join('\n');
}

export function cleanParsedListHtml(html: string): string {
  let clean = html;
  // Replace separator placeholders with empty paragraphs
  clean = clean.replace(/<p>\{LIST_SEPARATOR\}<\/p>/g, '<p></p>');
  // Force all lists tight so tiptap-markdown won't add blank lines between items on save
  clean = clean.replace(/<(ul|ol)>/g, '<$1 data-tight="true">');
  // Unwrap <p> inside <li> (loose list artifact) so items serialize as tight
  clean = clean.replace(/<li>\s*<p>([\s\S]*?)<\/p>\s*<\/li>/g, '<li>$1</li>');
  return clean;
}

function countOccurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// Inline `code spans`. Image syntax inside one is literal text that survives the round trip
// untouched, so it must not raise the warning.
const CODE_SPAN = /(`+)[^`]*?\1/g;
// Inline and reference-style images: ![alt](path) and ![alt][ref]. Escaped \![ is not one.
const IMAGE_SYNTAX = /(^|[^\\])!\[[^\]\n]*\](\([^)\n]*\)|\[[^\]\n]*\])/g;

/**
 * Every image reference in `md` that the editor would DESTROY on the next save.
 *
 * There is no image node in the editor's schema (StarterKit does not bundle one), so markdown ->
 * HTML makes an `<img>`, ProseMirror's parser finds no node type to put it in and drops it, and
 * serializing back writes a document that never had an image. This finds them so the user can be
 * told before that happens, since nothing else in the app would say a word.
 *
 * Fenced blocks and inline code spans are excluded: image syntax in there is CONTENT, round-trips
 * intact, and warning about it would be crying wolf on any file that documents Markdown. Raw
 * `<img>` HTML is not matched either -- tiptap-markdown runs with `html: false`, so those are
 * literal text and survive. Indented (4-space) code blocks are a known blind spot; they would
 * produce a false warning, which is the safe direction to be wrong in.
 */
export function findImageReferences(md: string): string[] {
  const lines = md.split('\n');
  const inFence = fencedLines(lines);
  const found: string[] = [];

  lines.forEach((line, i) => {
    if (inFence[i]) return;
    const bare = line.replace(CODE_SPAN, m => ' '.repeat(m.length));
    for (const m of bare.matchAll(IMAGE_SYNTAX)) {
      // Slice from the ORIGINAL line: the code-span blanking is only for finding positions.
      const start = m.index + m[1].length;
      found.push(line.slice(start, start + m[0].length - m[1].length));
    }
  });

  return found;
}

// GitHub's heading slug (github-slugger): lowercase, drop punctuation, each space -> '-'.
function headingSlug(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
}

// Position of the heading an in-page `#anchor` link points at, or null. Repeated
// slugs get GitHub's `-1`, `-2` suffixes in document order, so `#setup-1` is the second "Setup".
export function findHeadingByAnchor(doc: PMNode, anchor: string): number | null {
  let wanted = anchor.toLowerCase();
  try {
    wanted = decodeURIComponent(wanted);
  } catch {
    // A malformed %-escape is matched literally.
  }
  const seen = new Set<string>();
  let found: number | null = null;
  doc.descendants((node, pos) => {
    if (found !== null) return false;
    if (node.type.name !== 'heading') return;
    const base = headingSlug(node.textContent);
    let slug = base;
    for (let n = 1; seen.has(slug); n++) slug = `${base}-${n}`;
    seen.add(slug);
    if (slug === wanted) found = pos;
    return false;
  });
  return found;
}

// THE single markdown -> editor-HTML pipeline. Every path that puts markdown into the
// document (file load, external reload, paste, help pages) goes through here so the
// separator placeholder is always accounted for in exactly one place.
export function markdownToHtml(editor: Editor, md: string): string {
  // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
  const html = cleanParsedListHtml(editor.storage.markdown.parser.parse(splitLooseLists(md)) as string);
  // A placeholder that survives into the rendered document is a bug in this pipeline --
  // it would be visible in the editor AND written back to the user's file on save. Any
  // occurrence beyond the ones the source itself contained is ours and must not ship.
  const expected = countOccurrences(md, SEPARATOR);
  const leaked = countOccurrences(html, SEPARATOR) - expected;
  if (leaked > 0) {
    console.error(`MDE: ${leaked} ${SEPARATOR} placeholder(s) leaked into the rendered document -- splitLooseLists inserted a separator that cleanParsedListHtml could not remove.`);
    // Safe to scrub only when the source had none of its own; otherwise we cannot tell
    // the user's literal text from ours, and deleting their content is the worse failure.
    if (expected === 0) return html.split(SEPARATOR).join('');
  }
  return html;
}

export const Markdown = {
  serialize(editor: Editor): string {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    let md = editor.storage.markdown.getMarkdown() as string;
    // Collapse triple+ newlines to double (adjacent lists + empty paragraph)
    md = md.replace(/\n{3,}/g, '\n\n');
    return md.endsWith('\n') ? md : md + '\n';
  },

  deserializeInto(editor: Editor, markdown: string): void {
    const doc = createNodeFromContent(markdownToHtml(editor, markdown), editor.schema, { slice: false });
    const { tr } = editor.state;
    tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  },
};
