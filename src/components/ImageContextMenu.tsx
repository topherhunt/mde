import React, { useEffect, useRef, useState } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';
import { IMAGE_MENU_EVENT, ImageMenuRequest } from '../utils/imageNode';
import { REVEAL_LABEL } from './FileContextMenu';

// Right-click menu for an image in the document. The image's node view selects it and fires
// IMAGE_MENU_EVENT; this renders the menu.
export default function ImageContextMenu({ editor }: { editor: TipTapEditor }) {
  const [menu, setMenu] = useState<ImageMenuRequest | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const dom = editor.view.dom;
    const onRequest = (e: Event) => setMenu((e as CustomEvent<ImageMenuRequest>).detail);
    dom.addEventListener(IMAGE_MENU_EVENT, onRequest);
    return () => dom.removeEventListener(IMAGE_MENU_EVENT, onRequest);
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

  // A remote or missing image in a read-only tab has nothing to offer.
  if (!menu || (!menu.localPath && !editor.isEditable)) return null;

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(menu.x, window.innerWidth - 200),
    top: Math.min(menu.y, window.innerHeight - 90),
    zIndex: 9500,
  };

  const remove = () => {
    editor.chain().focus().deleteRange({ from: menu.pos, to: menu.pos + 1 }).run();
    setMenu(null);
  };

  const reveal = () => {
    window.mde.revealInFinder(menu.localPath!);
    setMenu(null);
  };

  return (
    <div ref={ref} className="ctx-menu qa-image-menu" style={style}>
      {menu.localPath && (
        <button className="ctx-menu-item qa-image-reveal" onClick={reveal}>
          <i className="bi bi-folder2-open" /> {REVEAL_LABEL}
        </button>
      )}
      {editor.isEditable && (
        <button className="ctx-menu-item ctx-menu-item-danger qa-image-remove" onClick={remove}>
          <i className="bi bi-trash" /> Remove from Document
        </button>
      )}
    </div>
  );
}
