import { Editor, createNodeFromContent } from '@tiptap/react';

export const Markdown = {
  serialize(editor: Editor): string {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    let md = editor.storage.markdown.getMarkdown() as string;
    return md.endsWith('\n') ? md : md + '\n';
  },

  deserializeInto(editor: Editor, markdown: string): void {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    const html = editor.storage.markdown.parser.parse(markdown);
    const doc = createNodeFromContent(html, editor.schema, { slice: false });
    const { tr } = editor.state;
    tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
    tr.setMeta('addToHistory', false);
    editor.view.dispatch(tr);
  },
};
