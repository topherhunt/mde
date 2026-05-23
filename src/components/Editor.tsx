import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent, Editor as TipTapEditor, createNodeFromContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { common, createLowlight } from 'lowlight';
import { Markdown as MarkdownExt } from 'tiptap-markdown';
import { TextSelection } from '@tiptap/pm/state';
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
  const cleanDocRef = useRef<string | null>(null);

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
    editorProps: {
      handleTripleClickOn(view, pos, node, nodePos) {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          const from = nodePos + 1;
          const to = nodePos + 1 + node.content.size;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor: e }) => {
      if (loadedRef.current) {
        const current = JSON.stringify(e.state.doc.toJSON());
        onDirtyChange(current !== cleanDocRef.current);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    onReady(editor);
    return () => onDestroy();
  }, [editor]);

  const prevDirtyRef = useRef(tab.dirty);
  useEffect(() => {
    if (prevDirtyRef.current && !tab.dirty && editor) {
      cleanDocRef.current = JSON.stringify(editor.state.doc.toJSON());
    }
    prevDirtyRef.current = tab.dirty;
  }, [tab.dirty, editor]);

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
      cleanDocRef.current = JSON.stringify(editor.state.doc.toJSON());
      loadedRef.current = true;
    });
  }, [editor, tab.filePath]);

  if (!editor) return null;

  return (
    <div className="editor-wrapper">
      <EditorContent editor={editor} className="editor-content" />
      <LinkPreview editor={editor} />
      <TableMenu editor={editor} />
      <CodeCopyButton editor={editor} />
    </div>
  );
}

function LinkPreview({ editor }: { editor: TipTapEditor }) {
  const [link, setLink] = useState<{ url: string; top: number; left: number } | null>(null);

  const update = useCallback(() => {
    if (!editor.isActive('link')) {
      setLink(null);
      return;
    }
    const href = editor.getAttributes('link').href;
    if (!href) { setLink(null); return; }

    const { $from } = editor.state.selection;
    const linkMark = $from.marks().find(m => m.type.name === 'link');
    if (!linkMark) { setLink(null); return; }

    let linkStart = $from.pos;
    const parent = $from.parent;
    const parentOffset = $from.start();
    parent.forEach((child, offset) => {
      const childStart = parentOffset + offset;
      const childEnd = childStart + child.nodeSize;
      if (child.marks.some(m => m.eq(linkMark)) && childStart <= $from.pos && childEnd >= $from.pos) {
        linkStart = childStart;
      }
    });

    const coords = editor.view.coordsAtPos(linkStart);
    const wrapper = editor.view.dom.closest('.editor-wrapper');
    if (!wrapper) { setLink(null); return; }
    const rect = wrapper.getBoundingClientRect();
    setLink({
      url: href,
      top: coords.bottom - rect.top + 4,
      left: coords.left - rect.left,
    });
  }, [editor]);

  useEffect(() => {
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor, update]);

  if (!link) return null;

  return (
    <div className="link-preview" style={{ top: link.top, left: link.left }}>
      <a
        href={link.url}
        onClick={(e) => {
          e.preventDefault();
          window.mde.openExternal(link.url);
        }}
      >
        {link.url}
      </a>
      <button
        className="link-preview-unlink"
        title="Remove link"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
        }}
      >
        ✕
      </button>
    </div>
  );
}

function CodeCopyButton({ editor }: { editor: TipTapEditor }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [hoverBlock, setHoverBlock] = useState<HTMLElement | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateFromCursor = useCallback(() => {
    if (editor.isActive('codeBlock')) {
      const { $from } = editor.state.selection;
      let codePos: number | null = null;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'codeBlock') {
          codePos = $from.before(d);
          break;
        }
      }
      if (codePos !== null) {
        const dom = editor.view.nodeDOM(codePos);
        if (dom instanceof HTMLElement) {
          positionFromDom(dom);
          return;
        }
      }
    }
    if (!hoverBlock) setPos(null);
  }, [editor, hoverBlock]);

  const positionFromDom = useCallback((pre: HTMLElement) => {
    const wrapper = editor.view.dom.closest('.editor-wrapper');
    if (!wrapper) return;
    const wRect = wrapper.getBoundingClientRect();
    const pRect = pre.getBoundingClientRect();
    setPos({
      top: pRect.top - wRect.top + 6,
      right: wRect.right - pRect.right + 6,
    });
  }, [editor]);

  useEffect(() => {
    editor.on('selectionUpdate', updateFromCursor);
    editor.on('transaction', updateFromCursor);
    return () => {
      editor.off('selectionUpdate', updateFromCursor);
      editor.off('transaction', updateFromCursor);
    };
  }, [editor, updateFromCursor]);

  useEffect(() => {
    const editorDom = editor.view.dom;
    const onEnter = (e: Event) => {
      const target = (e.target as HTMLElement).closest('pre');
      if (target && editorDom.contains(target)) {
        setHoverBlock(target);
        positionFromDom(target);
      }
    };
    const onLeave = (e: Event) => {
      const target = (e.target as HTMLElement).closest('pre');
      if (target) {
        setHoverBlock(null);
        updateFromCursor();
      }
    };
    editorDom.addEventListener('mouseenter', onEnter, true);
    editorDom.addEventListener('mouseleave', onLeave, true);
    return () => {
      editorDom.removeEventListener('mouseenter', onEnter, true);
      editorDom.removeEventListener('mouseleave', onLeave, true);
    };
  }, [editor, positionFromDom, updateFromCursor]);

  useEffect(() => {
    if (hoverBlock) positionFromDom(hoverBlock);
  }, [hoverBlock, positionFromDom]);

  const handleCopy = useCallback(() => {
    const target = hoverBlock || (() => {
      if (!editor.isActive('codeBlock')) return null;
      const { $from } = editor.state.selection;
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'codeBlock') {
          const dom = editor.view.nodeDOM($from.before(d));
          return dom instanceof HTMLElement ? dom : null;
        }
      }
      return null;
    })();
    if (!target) return;
    const code = target.querySelector('code');
    const text = code ? code.textContent || '' : target.textContent || '';
    navigator.clipboard.writeText(text);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), 1500);
  }, [editor, hoverBlock]);

  if (!pos) return null;

  return (
    <button
      className="code-copy-btn"
      style={{ top: pos.top, right: pos.right }}
      onMouseDown={(e) => { e.preventDefault(); handleCopy(); }}
      title="Copy code"
    >
      <i className={`bi bi-${copied ? 'check-lg' : 'clipboard'}`} />
    </button>
  );
}
