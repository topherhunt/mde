import React, { useCallback, useState, useEffect } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

// Platform-aware modifier label for shortcut hints in tooltips.
const MOD = window.mde?.platform === 'darwin' ? 'Cmd' : 'Ctrl';

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
          title={`Undo (${MOD} + Z)`}
          active={false}
          disabled={!editor.can().undo()}
          onClick={() => editor.chain().focus().undo().run()}
        />
        <ToolbarButton
          icon="arrow-clockwise"
          title={`Redo (${MOD} + Shift + Z)`}
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
          title={`Bold selection (${MOD} + B)`}
          active={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          icon="type-italic"
          title={`Italic selection (${MOD} + I)`}
          active={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          icon="type-strikethrough"
          title={`Strikethrough selection (${MOD} + Shift + X)`}
          active={editor.isActive('strike')}
          onClick={() => editor.chain().focus().toggleStrike().run()}
        />
        <ToolbarButton
          icon="highlighter"
          title="Highlight selection"
          active={editor.isActive('highlight')}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="list-ol"
          title={`Ordered list (${MOD} + Shift + 7)`}
          active={editor.isActive('orderedList')}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          icon="list-ul"
          title={`Bullet list (${MOD} + Shift + 8)`}
          active={editor.isActive('bulletList') && !editor.isActive('listItem', { checked: true }) && !editor.isActive('listItem', { checked: false })}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          icon="ui-checks"
          title={`Todo list (${MOD} + Enter)`}
          active={editor.isActive('listItem', { checked: true }) || editor.isActive('listItem', { checked: false })}
          onClick={() => {
            const { state } = editor;
            const { $from } = state.selection;
            let liDepth = -1;
            for (let d = $from.depth; d > 0; d--) {
              if ($from.node(d).type.name === 'listItem') { liDepth = d; break; }
            }
            if (liDepth === -1) {
              editor.chain().focus().toggleBulletList().run();
              const { $from: $new } = editor.state.selection;
              for (let d = $new.depth; d > 0; d--) {
                if ($new.node(d).type.name === 'listItem') {
                  editor.view.dispatch(
                    editor.state.tr.setNodeMarkup($new.before(d), undefined, { ...$new.node(d).attrs, checked: false })
                  );
                  break;
                }
              }
            } else {
              const node = $from.node(liDepth);
              const pos = $from.before(liDepth);
              editor.view.dispatch(
                state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: node.attrs.checked !== null ? null : false })
              );
            }
            editor.commands.focus();
          }}
        />
        <ToolbarButton
          icon="quote"
          title={`Blockquote (${MOD} + Shift + B)`}
          active={editor.isActive('blockquote')}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="code"
          title={`Inline code (${MOD} + E)`}
          active={editor.isActive('code')}
          onClick={() => editor.chain().focus().toggleCode().run()}
        />
        <ToolbarButton
          icon="code-square"
          title={`Code block (${MOD} + Shift + E)`}
          active={editor.isActive('codeBlock')}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        />
      </div>

      <div className="toolbar-separator" />

      <div className="toolbar-group">
        <ToolbarButton
          icon="link-45deg"
          title={`Insert link (${MOD} + K)`}
          active={editor.isActive('link')}
          onClick={startSetLink}
        />
        <ToolbarButton
          icon="table"
          title="Insert table"
          active={false}
          onClick={insertTable}
        />
        <ToolbarButton
          icon="hr"
          title="Horizontal rule"
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
      data-tooltip={title}
      aria-label={title}
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
