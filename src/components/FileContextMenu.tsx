import React, { useEffect, useRef } from 'react';
import { FileEntry } from '../types';

// Single source of truth for the file context menu, shared by the file
// explorer (Sidebar) and the tab bar. Adding or changing a menu item here
// updates both places automatically.

interface FileContextMenuProps {
  x: number;
  y: number;
  target: FileEntry;
  projectRoot: string | null;
  onClose: () => void;
  onStartRename: (target: FileEntry) => void;
  onRequestDelete: (target: FileEntry) => void;
  onToast: (msg: string, variant?: string) => void;
  // Only provided (and only shown) when the target is a folder that supports
  // creating children -- the file explorer passes it, the tab bar does not.
  onCreateInFolder?: (folderPath: string, type: 'file' | 'folder') => void;
}

export function FileContextMenu({
  x, y, target, projectRoot, onClose, onStartRename, onRequestDelete, onToast, onCreateInFolder,
}: FileContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(x, window.innerWidth - 180),
    top: Math.min(y, window.innerHeight - 120),
    zIndex: 9500,
  };

  const relativePath = projectRoot && target.path.startsWith(projectRoot)
    ? target.path.slice(projectRoot.length + 1)
    : target.path;

  const handleCopyPath = () => {
    navigator.clipboard.writeText(relativePath);
    onToast(`Copied path: ${relativePath}`, 'info');
    onClose();
  };

  const handleRename = () => {
    onStartRename(target);
    onClose();
  };

  const handleDelete = () => {
    onRequestDelete(target);
    onClose();
  };

  return (
    <div ref={ref} className="ctx-menu" style={style}>
      {target.isDirectory && onCreateInFolder && (
        <>
          <button className="ctx-menu-item" onClick={() => { onCreateInFolder(target.path, 'file'); onClose(); }}>
            <i className="bi bi-file-earmark-plus" /> New File
          </button>
          <button className="ctx-menu-item" onClick={() => { onCreateInFolder(target.path, 'folder'); onClose(); }}>
            <i className="bi bi-folder-plus" /> New Folder
          </button>
          <div className="ctx-menu-divider" />
        </>
      )}
      <button className="ctx-menu-item" onClick={handleRename}>
        <i className="bi bi-pencil" /> Rename
      </button>
      <button className="ctx-menu-item ctx-menu-item-danger" onClick={handleDelete}>
        <i className="bi bi-trash" /> Delete
      </button>
      <div className="ctx-menu-divider" />
      <button className="ctx-menu-item" onClick={handleCopyPath}>
        <i className="bi bi-clipboard" /> Copy Relative Path
      </button>
    </div>
  );
}

export function DeleteConfirmDialog({ target, onConfirm, onCancel }: { target: FileEntry; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ justifyContent: 'center' }}>
          <span className="fw-bold">Delete {target.isDirectory ? 'folder' : 'file'}</span>
        </div>
        <div className="modal-body">
          <p className="text-muted fs-sm">
            Really delete <code>{target.name}</code>? It will be moved to the Trash.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn" onClick={onCancel}>Cancel</button>
            <button className="settings-btn btn-danger" onClick={onConfirm}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}
