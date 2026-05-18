import { Editor } from '@tiptap/react';

export const Markdown = {
  serialize(editor: Editor): string {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    return editor.storage.markdown.getMarkdown();
  },

  deserializeInto(editor: Editor, markdown: string): void {
    // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
    editor.commands.setContent(editor.storage.markdown.parser.parse(markdown));
  },
};
