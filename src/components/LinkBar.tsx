import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface LinkBarProps {
  editor: TipTapEditor;
  onClose: () => void;
}

export default function LinkBar({ editor, onClose }: LinkBarProps) {
  const previousUrl = editor.getAttributes('link').href || '';
  const [url, setUrl] = useState(previousUrl);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const apply = useCallback(() => {
    const trimmed = url.trim();
    if (trimmed === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run();
    }
    onClose();
  }, [editor, url, onClose]);

  const cancel = useCallback(() => {
    editor.commands.focus();
    onClose();
  }, [editor, onClose]);

  return (
    <div className="link-bar">
      <div className="link-bar-row">
        <i className="bi bi-link-45deg link-bar-icon" />
        <input
          ref={inputRef}
          className="link-bar-input"
          type="text"
          placeholder="Enter URL..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
            if (e.key === 'Escape') cancel();
          }}
        />
        <button className="find-bar-btn" onMouseDown={(e) => { e.preventDefault(); apply(); }} title="Apply">
          <i className="bi bi-check-lg" />
        </button>
        <button className="find-bar-btn" onMouseDown={(e) => { e.preventDefault(); cancel(); }} title="Cancel (Escape)">
          <i className="bi bi-x-lg" />
        </button>
      </div>
    </div>
  );
}
