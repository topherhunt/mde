import React, { useCallback, useState, useEffect } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface ToolbarProps {
  editor: TipTapEditor | null;
}

export default function Toolbar({ editor }: ToolbarProps) {
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
  const setLink = useCallback(() => {
    if (!editor) return;
    const previousUrl = editor.getAttributes('link').href;
    const url = window.prompt('URL', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

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
          label="B"
          title="Bold (Cmd+B)"
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
          className="toolbar-bold"
        />
        <ToolbarButton
          label="I"
          title="Italic (Cmd+I)"
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          className="toolbar-italic"
        />
        <ToolbarButton
          label="S"
          title="Strikethrough (Cmd+Shift+X)"
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          className="toolbar-strike"
        />
        <ToolbarButton
          label="H"
          title="Highlight"
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
          className="toolbar-highlight"
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          label="OL"
          title="Ordered List (Cmd+Shift+7)"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="UL"
          title="Unordered List (Cmd+Shift+8)"
          active={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          label="❝"
          title="Blockquote (Cmd+Shift+B)"
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          label="<>"
          title="Inline Code (Cmd+E)"
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <ToolbarButton
          label="[>]"
          title="Code Block (Cmd+Shift+E)"
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          label="🔗"
          title="Link (Cmd+K)"
          active={editor.isActive('link')}
          onClick={setLink}
        />
        <ToolbarButton
          label="⊞"
          title="Insert Table"
          active={false}
          onClick={insertTable}
        />
        <ToolbarButton
          label="―"
          title="Horizontal Rule"
          active={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
        />
      </div>
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}

function ToolbarButton({ label, title, active, onClick, className }: ToolbarButtonProps) {
  return (
    <button
      className={`toolbar-btn ${active ? 'active' : ''} ${className || ''}`}
      title={title}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
    >
      {label}
    </button>
  );
}
