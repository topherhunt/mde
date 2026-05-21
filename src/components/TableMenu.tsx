import React, { useState, useEffect, useRef } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface TableMenuProps {
  editor: TipTapEditor | null;
}

export default function TableMenu({ editor }: TableMenuProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editor) return;

    const update = () => {
      if (!editor.isActive('table')) {
        setPosition(null);
        setOpen(false);
        return;
      }

      const { $from } = editor.state.selection;
      let cellPos: number | null = null;
      for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          cellPos = $from.before(d);
          break;
        }
      }
      if (cellPos === null) {
        setPosition(null);
        return;
      }

      const dom = editor.view.nodeDOM(cellPos);
      if (dom instanceof HTMLElement) {
        const editorRect = editor.view.dom.closest('.editor-content')?.getBoundingClientRect();
        const cellRect = dom.getBoundingClientRect();
        if (editorRect) {
          setPosition({
            top: cellRect.top - editorRect.top,
            left: cellRect.right - editorRect.left + 4,
          });
        }
      }
    };

    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
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
        ···
      </button>
      {open && (
        <div className="table-menu-dropdown">
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addColumnBefore().run()); }}>Insert column before</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addColumnAfter().run()); }}>Insert column after</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().deleteColumn().run()); }}>Delete column</button>
          <div className="table-menu-divider" />
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addRowBefore().run()); }}>Insert row before</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().addRowAfter().run()); }}>Insert row after</button>
          <button onMouseDown={(e) => { e.preventDefault(); action(() => editor.chain().focus().deleteRow().run()); }}>Delete row</button>
        </div>
      )}
    </div>
  );
}
