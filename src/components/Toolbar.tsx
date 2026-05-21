import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface ToolbarProps {
  editor: TipTapEditor | null;
}

export default function Toolbar({ editor }: ToolbarProps) {
  const [, forceUpdate] = useState(0);
  const [linkInput, setLinkInput] = useState<{ visible: boolean; url: string }>({ visible: false, url: '' });
  const linkInputRef = useRef<HTMLInputElement>(null);

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

  const startSetLink = useCallback(() => {
    if (!editor) return;
    if (editor.state.selection.empty && !editor.isActive('link')) {
      alert('Select some text first.');
      return;
    }
    const previousUrl = editor.getAttributes('link').href || '';
    setLinkInput({ visible: true, url: previousUrl });
    setTimeout(() => linkInputRef.current?.focus(), 0);
  }, [editor]);

  const applyLink = useCallback(() => {
    if (!editor) return;
    const url = linkInput.url.trim();
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
    }
    setLinkInput({ visible: false, url: '' });
  }, [editor, linkInput.url]);

  const cancelLink = useCallback(() => {
    setLinkInput({ visible: false, url: '' });
    editor?.commands.focus();
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
        <ToolbarButton
          label="↩"
          title="Undo (Cmd+Z)"
          active={false}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          label="↪"
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
          label="1."
          title="Ordered List (Cmd+Shift+7)"
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          label="•"
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
          onClick={startSetLink}
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

      {linkInput.visible && (
        <div className="toolbar-link-input">
          <input
            ref={linkInputRef}
            type="text"
            placeholder="Enter URL..."
            value={linkInput.url}
            onChange={(e) => setLinkInput({ ...linkInput, url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyLink();
              if (e.key === 'Escape') cancelLink();
            }}
          />
          <button className="toolbar-btn" onMouseDown={(e) => { e.preventDefault(); applyLink(); }}>✓</button>
          <button className="toolbar-btn" onMouseDown={(e) => { e.preventDefault(); cancelLink(); }}>✕</button>
        </div>
      )}
    </div>
  );
}

interface ToolbarButtonProps {
  label: string;
  title: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}

function ToolbarButton({ label, title, active, disabled, onClick, className }: ToolbarButtonProps) {
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
      {label}
    </button>
  );
}
