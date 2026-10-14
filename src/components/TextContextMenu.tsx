import React, { useEffect, useRef, useState } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

// Right-click menu over selected text: Copy (literal text) or Copy as Markdown. Opens
// only when the click lands inside a non-empty selection; an image's own menu wins.
export default function TextContextMenu({ editor, copyAsMarkdown }: {
  editor: TipTapEditor;
  copyAsMarkdown: (editor: TipTapEditor) => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const onContextMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const { from, to, empty } = editor.state.selection;
      const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
      if (empty || !at || at.pos < from || at.pos > to) return;
      e.preventDefault();
      setMenu({ x: e.clientX, y: e.clientY });
    };
    dom.addEventListener('contextmenu', onContextMenu);
    return () => dom.removeEventListener('contextmenu', onContextMenu);
  }, [editor]);

  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setMenu(null); }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [menu]);

  if (!menu) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 90),
    zIndex: 9500,
  };

  // execCommand('copy') runs the editor's own copy handling, so this matches Cmd+C exactly.
  const copy = () => {
    editor.view.focus();
    document.execCommand('copy');
    setMenu(null);
  };

  const copyMarkdown = () => {
    copyAsMarkdown(editor);
    editor.view.focus();
    setMenu(null);
  };

  return (
    <div ref={ref} className="ctx-menu qa-text-menu" style={style}>
      <button className="ctx-menu-item qa-text-copy" onClick={copy}>
        <i className="bi bi-clipboard" /> Copy
      </button>
      <button className="ctx-menu-item qa-text-copy-markdown" onClick={copyMarkdown}>
        <i className="bi bi-markdown" /> Copy as Markdown
      </button>
    </div>
  );
}
