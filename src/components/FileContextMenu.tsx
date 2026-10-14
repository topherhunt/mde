import React, { useEffect, useRef } from 'react';
import { FileEntry } from '../types';
import type { ExportFormat } from '../utils/exportDocument';
import { basename } from '../utils/paths';
import { fileKind } from '../utils/fileKinds';

// Single source of truth for the file context menu, shared by the file
// explorer (Sidebar) and the tab bar. Adding or changing a menu item here
// updates both places automatically.

export const REVEAL_LABEL =
  window.mde?.platform === 'darwin' ? 'Reveal in Finder'
  : window.mde?.platform === 'win32' ? 'Show in Explorer'
  : 'Show in Folder';

// A relative path is only meaningful when the file lives under the project root; null otherwise.
export function relativeToProject(filePath: string, projectRoot: string | null): string | null {
  return projectRoot && filePath.startsWith(projectRoot) ? filePath.slice(projectRoot.length + 1) : null;
}

// Copies the project-relative path, or just the file name when there is nothing to be relative to.
export function copyFilePath(filePath: string, projectRoot: string | null, onToast: (msg: string, variant?: string) => void) {
  const relative = relativeToProject(filePath, projectRoot);
  if (relative !== null) {
    navigator.clipboard.writeText(relative);
    onToast(`Copied path: ${relative}`, 'info');
  } else {
    const name = basename(filePath);
    navigator.clipboard.writeText(name);
    onToast(`Copied file name: ${name}`, 'info');
  }
}

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
  // Opens the checkpoint history tab filtered to this one file. Absent when the folder has
  // no checkpoints, so the menu never offers a screen that would be empty by construction.
  // Receives the repo-relative path, since that is what checkpoints are keyed by.
  onViewHistory?: (relativePath: string) => void;
  // Writes <name>.pdf / <name>.docx beside a markdown file. Offered only for markdown files.
  onExport: (sourcePath: string, format: ExportFormat) => void;
}

export function FileContextMenu({
  x, y, target, projectRoot, onClose, onStartRename, onRequestDelete, onToast, onCreateInFolder,
  onViewHistory, onExport,
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

  // Without a relative path, the menu offers "Copy File Name" rather than promising one.
  const relativePath = relativeToProject(target.path, projectRoot);
  const hasRelativePath = relativePath !== null;

  const handleCopyPath = () => {
    copyFilePath(target.path, projectRoot, onToast);
    onClose();
  };

  const handleReveal = () => {
    window.mde.revealInFinder(target.path);
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

  const handleViewHistory = () => {
    onViewHistory!(relativePath!);
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
      {/* A file outside the project root can't appear in this folder's checkpoints, so there
          would be nothing to show. Folders aren't offered: history is per-file. */}
      {onViewHistory && !target.isDirectory && hasRelativePath && (
        <>
          <button className="ctx-menu-item qa-ctx-file-history" onClick={handleViewHistory}>
            <i className="bi bi-clock-history" /> View Change History
          </button>
          <div className="ctx-menu-divider" />
        </>
      )}
      {!target.isDirectory && fileKind(target.name) === 'markdown' && (
        <>
          <button className="ctx-menu-item qa-ctx-export-pdf" onClick={() => { onExport(target.path, 'pdf'); onClose(); }}>
            <i className="bi bi-file-earmark-pdf" /> Export as PDF
          </button>
          <button className="ctx-menu-item qa-ctx-export-docx" onClick={() => { onExport(target.path, 'docx'); onClose(); }}>
            <i className="bi bi-file-earmark-word" /> Export as DOCX
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
        <i className="bi bi-clipboard" /> {hasRelativePath ? 'Copy Relative Path' : 'Copy File Name'}
      </button>
      <button className="ctx-menu-item" onClick={handleReveal}>
        <i className="bi bi-folder2-open" /> {REVEAL_LABEL}
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
          <p className="small text-muted">
            Really delete <code>{target.name}</code>? It will be moved to the Trash.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn" onClick={onCancel}>Cancel</button>
            <button className="settings-btn btn-danger qa-delete-confirm" onClick={onConfirm}>Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ExportConflictDialog({ fileName, onOverwrite, onCopy, onCancel }: {
  fileName: string; onOverwrite: () => void; onCopy: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop qa-export-conflict" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ justifyContent: 'center' }}>
          <span className="fw-bold">File already exists</span>
        </div>
        <div className="modal-body">
          <p className="small text-muted">
            <code>{fileName}</code> already exists. Would you like to overwrite it or create another copy?
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn qa-export-cancel" onClick={onCancel}>Cancel</button>
            <button className="settings-btn qa-export-copy" onClick={onCopy}>Create Another Copy</button>
            <button className="settings-btn btn-danger qa-export-overwrite" onClick={onOverwrite}>Overwrite</button>
          </div>
        </div>
      </div>
    </div>
  );
}
