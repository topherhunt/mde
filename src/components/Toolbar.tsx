import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';
import { PALETTE, PaletteColor } from '../utils/colorMarks';

// Platform-aware modifier label for shortcut hints in tooltips.
const MOD = window.mde?.platform === 'darwin' ? 'Cmd' : 'Ctrl';

interface ToolbarProps {
  editor: TipTapEditor | null;
  linkTrigger?: number;
  onToast?: (msg: string, variant?: string) => void;
  onLinkEdit?: () => void;
  leaving: boolean;
}

export const TOGGLE_TOOLBAR_HINT = `${MOD} + Alt + T`;

export default function Toolbar({ editor, linkTrigger, onToast, onLinkEdit, leaving }: ToolbarProps) {
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
    <div className={`toolbar${leaving ? ' toolbar-leaving' : ''}`}>
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
          className="qa-highlight-toggle"
        />
        <ColorPicker
          kind="text-color"
          icon="fonts"
          title="Text color"
          current={editor.getAttributes('textColor').color ?? null}
          onPick={(color) => {
            const chain = editor.chain().focus();
            (color ? chain.setMark('textColor', { color }) : chain.unsetMark('textColor')).run();
          }}
        />
        <ColorPicker
          kind="highlight"
          icon="paint-bucket"
          title="Highlight color"
          current={editor.isActive('highlight') ? (editor.getAttributes('highlight').color ?? 'yellow') : null}
          onPick={(color) => {
            const chain = editor.chain().focus();
            // Yellow is the plain `==text==` highlight, not a named `=={yellow}` one.
            (color ? chain.setMark('highlight', { color: color === 'yellow' ? null : color }) : chain.unsetMark('highlight')).run();
          }}
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

      <div className="toolbar-group ms-auto">
        <ToolbarButton
          icon="chevron-bar-right"
          title={`Hide toolbar (${TOGGLE_TOOLBAR_HINT})`}
          active={false}
          onClick={() => window.mde.setToolbar(false)}
          className="toolbar-collapse qa-toolbar-collapse"
        />
      </div>
    </div>
  );
}

interface ColorPickerProps {
  kind: 'text-color' | 'highlight';
  icon: string;
  title: string;
  current: PaletteColor | null;
  onPick: (color: PaletteColor | null) => void;
}

// Swatches read the same theme variables the editor renders with, so they switch shade
// with light/dark mode on their own.
function ColorPicker({ kind, icon, title, current, onPick }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shade = (color: PaletteColor) => `var(--${kind}-${color})`;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Every control acts on mousedown with preventDefault so the editor keeps its selection.
  const pick = (e: React.MouseEvent, color: PaletteColor | null) => {
    e.preventDefault();
    onPick(color);
    setOpen(false);
  };

  return (
    <div className="color-picker" ref={ref}>
      <button
        className={`toolbar-btn qa-${kind}-btn ${open ? 'active' : ''}`}
        data-tooltip={title}
        aria-label={title}
        aria-expanded={open}
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen(o => !o);
        }}
      >
        <i className={`bi bi-${icon}`} />
        <span className="color-picker-bar" style={{ background: current ? shade(current) : 'transparent' }} />
      </button>
      {open && (
        <div className={`color-picker-menu qa-${kind}-menu`} role="menu">
          <div className="color-picker-grid">
            {PALETTE.map(color => (
              <button
                key={color}
                className={`color-swatch qa-swatch-${color} ${current === color ? 'active' : ''}`}
                style={{ background: shade(color) }}
                data-tooltip={color}
                aria-label={color}
                onMouseDown={(e) => pick(e, color)}
              />
            ))}
          </div>
          <button className="color-picker-none qa-swatch-none" onMouseDown={(e) => pick(e, null)}>
            {kind === 'highlight' ? 'No highlight' : 'Default color'}
          </button>
        </div>
      )}
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
