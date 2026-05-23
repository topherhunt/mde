import React, { useCallback, useState, useEffect } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface ToolbarProps {
  editor: TipTapEditor | null;
  linkTrigger?: number;
  onToast?: (msg: string, variant?: string) => void;
  onLinkEdit?: () => void;
}

export default function Toolbar({ editor, linkTrigger, onToast, onLinkEdit }: ToolbarProps) {
  const [, forceUpdate] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const handler = () => forceUpdate(n => n + 1);
    editor.on('selectionUpdate', handler);
    editor.on('transaction', handler);
    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('transaction', handler);
    };
  }, [editor]);

  useEffect(() => {
    if (linkTrigger && linkTrigger > 0) startSetLink();
  }, [linkTrigger]);

  const startSetLink = useCallback(() => {
    if (!editor) return;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      onToast?.('Select some text first.', 'danger');
      return;
    }
    onLinkEdit?.();
  }, [editor, onToast, onLinkEdit]);

  const insertTable = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) {
    return <div className="toolbar disabled" />;
  }

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <ToolbarButton
          icon="arrow-counterclockwise"
          title="Undo (Cmd+Z)"
          active={false}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          icon="arrow-clockwise"
          title="Redo (Cmd+Shift+Z)"
          active={false}
          disabled={!editor.can().redo()}
          onClick={() => editor.chain().focus().redo().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <select
          className="toolbar-select"
          value={
            editor.isActive('heading', { level: 1 }) ? '1' :
            editor.isActive('heading', { level: 2 }) ? '2' :
            editor.isActive('heading', { level: 3 }) ? '3' :
            editor.isActive('heading', { level: 4 }) ? '4' :
            editor.isActive('heading', { level: 5 }) ? '5' :
            editor.isActive('heading', { level: 6 }) ? '6' : '0'
          }
          onChange={(e) => {
            const level = parseInt(e.target.value);
            if (level === 0) {
              editor.chain().focus().setParagraph().run();
            } else {
              editor.chain().focus().toggleHeading({ level: level as 1|2|3|4|5|6 }).run();
            }
          }}
        >
          <option value="0">Paragraph</option>
          <option value="1">Heading 1</option>
          <option value="2">Heading 2</option>
          <option value="3">Heading 3</option>
          <option value="4">Heading 4</option>
          <option value="5">Heading 5</option>
          <option value="6">Heading 6</option>
        </select>
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="type-bold"
          title="Bold (Cmd+B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon="type-italic"
          title="Italic (Cmd+I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon="type-strikethrough"
          title="Strikethrough (Cmd+Shift+X)"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          icon="highlighter"
          title="Highlight"
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="list-ol"
          title="Ordered List (Cmd+Shift+7)"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon="list-ul"
          title="Unordered List (Cmd+Shift+8)"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon="quote"
          title="Blockquote (Cmd+Shift+B)"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="code"
          title="Inline Code (Cmd+E)"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <ToolbarButton
          icon="code-square"
          title="Code Block (Cmd+Shift+E)"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="link-45deg"
          title="Link (Cmd+K)"
          active={editor.isActive('link')}
          onClick={startSetLink}
        />
        <ToolbarButton
          icon="table"
          title="Insert Table"
          active={false}
          onClick={insertTable}
        />
        <ToolbarButton
          icon="hr"
          title="Horizontal Rule"
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  icon?: string;
  label?: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}

function ToolbarButton({ icon, label, title, active, disabled, onClick, className }: ToolbarButtonProps) {
  return (
    <button
      className={`toolbar-btn ${active ? 'active' : ''} ${disabled ? 'disabled' : ''} ${className || ''}`}
      title={title}
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        if (!disabled) onClick();
      }}
    >
      {icon ? <i className={`bi bi-${icon}`} /> : label}
    </button>
  );
}
