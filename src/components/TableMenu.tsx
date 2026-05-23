import React, { useState, useEffect, useRef } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface TableMenuProps {
  editor: TipTapEditor | null;
}

export default function TableMenu({ editor }: TableMenuProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const cellPosRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      if (!editor.isActive('table')) {
        setPosition(null);
        setOpen(false);
        cellPosRef.current = null;
        return;
      }

      const { $from } = editor.state.selection;
      let cp: number | null = null;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cp = $from.before(d);
          break;
        }
      }
      cellPosRef.current = cp;
      if (cp === null) { setPosition(null); return; }
      recalc();
    };

    const recalc = () => {
      if (cellPosRef.current === null) return;
      try {
        const dom = editor.view.nodeDOM(cellPosRef.current);
        if (dom instanceof HTMLElement) {
          const wrapper = editor.view.dom.closest('.editor-wrapper');
          const cellRect = dom.getBoundingClientRect();
          const wrapperRect = wrapper?.getBoundingClientRect();
          if (wrapperRect) {
            setPosition({
              top: cellRect.top - wrapperRect.top,
              left: cellRect.right - wrapperRect.left,
            });
          }
        }
      } catch {}
    };

    const scrollEl = editor.view.dom.closest('.editor-content');

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    scrollEl?.addEventListener('scroll', recalc);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
      scrollEl?.removeEventListener('scroll', recalc);
    };
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (!position || !editor) return null;

  const action = (fn: () => void) => {
    fn();
    setOpen(false);
  };

  return (
    <div className="table-menu" style={{ top: position.top, left: position.left }} ref={menuRef}>
      <button
        className="table-menu-trigger"
        onMouseDown={(e) => { e.preventDefault(); setOpen(!open); }}
      >
        <i className="bi bi-three-dots" />
      </button>
      {open && (
        <div className="table-menu-dropdown">
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addRowBefore().run()); }}><i className="bi bi-layout-sidebar-inset table-icon-row-before" /> Insert row above</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addRowAfter().run()); }}><i className="bi bi-layout-sidebar-inset table-icon-row-after" /> Insert row below</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().deleteRow().run()); }}><i className="bi bi-trash" /> Delete row</button>
          <div className="table-menu-divider" />
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addColumnBefore().run()); }}><i className="bi bi-layout-sidebar-inset" /> Insert column before</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addColumnAfter().run()); }}><i className="bi bi-layout-sidebar-inset table-icon-col-after" /> Insert column after</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().deleteColumn().run()); }}><i className="bi bi-trash" /> Delete column</button>
        </div>
      )}
    </div>
  );
}
