import { Editor, createNodeFromContent } from '@tiptap/react';

const SEPARATOR = '{LIST_SEPARATOR}';

export function splitLooseLists(md: string): string {
  const lines = md.split('\n');
  const output: string[] = [];
  const markerRe = /^([ \t]*)([-*+]|\d+[.)]) /;

  for (let i = 0; i < lines.length; i++) {
    output.push(lines[i]);

    if (i + 2 >= lines.length || lines[i + 1] !== '') continue;

    const nextMatch = lines[i + 2].match(markerRe);
    if (!nextMatch) continue;
    const nextIndent = nextMatch[1].length;

    let currentIndent = -1;
    for (let j = i; j >= 0; j--) {
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

export const Markdown = {
  serialize(editor: Editor): string {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    let md = editor.storage.markdown.getMarkdown() as string;
    // Collapse triple+ newlines to double (adjacent lists + empty paragraph)
    md = md.replace(/\n{3,}/g, '\n\n');
    return md.endsWith('\n') ? md : md + '\n';
  },

  deserializeInto(editor: Editor, markdown: string): void {
    const processed = splitLooseLists(markdown);
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    const html = editor.storage.markdown.parser.parse(processed) as string;
    const doc = createNodeFromContent(cleanParsedListHtml(html), editor.schema, { slice: false });
    const { tr } = editor.state;
    tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  },
};
