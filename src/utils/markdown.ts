import { Editor } from '@tiptap/react';

export const Markdown = {
  serialize(editor: Editor): string {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    const md = editor.storage.markdown.getMarkdown() as string;
    return md.endsWith('\n') ? md : md + '\n';
  },

  deserializeInto(editor: Editor, markdown: string): void {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    editor.commands.setContent(editor.storage.markdown.parser.parse(markdown));
  },
};
