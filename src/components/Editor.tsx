import React, { useEffect, useRef } from 'react';
import { useEditor, EditorContent, Editor as TipTapEditor, createNodeFromContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { common, createLowlight } from 'lowlight';
import { Markdown as MarkdownExt } from 'tiptap-markdown';
import { Tab } from '../types';
import TableMenu from './TableMenu';

const lowlight = createLowlight(common);

interface EditorProps {
  tab: Tab;
  onReady: (editor: TipTapEditor) => void;
  onDestroy: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

export default function Editor({ tab, onReady, onDestroy, onDirtyChange }: EditorProps) {
  const loadedRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
      }),
      Highlight,
      Link.configure({
        openOnClick: false,
      }),
      TableKit.configure({
        table: { resizable: true },
      }),
      CodeBlockLowlight.configure({
        lowlight,
      }),
      Placeholder.configure({
        placeholder: 'Start writing...',
      }),
      MarkdownExt.configure({
        html: true,
        breaks: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ],
    onUpdate: () => {
      if (loadedRef.current) {
        onDirtyChange(true);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    onReady(editor);
    return () => onDestroy();
  }, [editor]);

  useEffect(() => {
    if (!editor || !tab.filePath || loadedRef.current) return;

    window.mde.readFile(tab.filePath).then(content => {
      // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
      const html = editor.storage.markdown.parser.parse(content);
      const doc = createNodeFromContent(html, editor.schema, { slice: false });
      const { tr } = editor.state;
      tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
      tr.setMeta('addToHistory', false);
      tr.setMeta('preventUpdate', false);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection(0);
      loadedRef.current = true;
    });
  }, [editor, tab.filePath]);

  if (!editor) return null;

  return (
    <div className="editor-wrapper">
      <EditorContent editor={editor} className="editor-content" />
      <TableMenu editor={editor} />
    </div>
  );
}
