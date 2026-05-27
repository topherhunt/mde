import React, { useEffect, useState, useCallback, useRef } from 'react';
import { FileEntry } from '../types';
import { Editor as TipTapEditor } from '@tiptap/react';

interface SidebarProps {
  projectRoot: string | null;
  mode: 'explorer' | 'outline';
  onSetMode: (mode: 'explorer' | 'outline') => void;
  onOpenFile: (filePath: string, tentative?: boolean) => void;
  onImportFile: (filePath: string) => void;
  activeEditor: TipTapEditor | null;
  activeFilePath: string | null;
  refreshKey: number;
  onToast: (msg: string, variant?: string) => void;
  onDeleteFile: (filePath: string) => void;
}

export default function Sidebar({ projectRoot, mode, onSetMode, onOpenFile, onImportFile, activeEditor, activeFilePath, refreshKey, onToast, onDeleteFile }: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const resizing = useRef(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Initialize root as expanded when projectRoot changes
  useEffect(() => {
    if (projectRoot) {
      setExpandedPaths(prev => {
        const next = new Set(prev);
        next.add(projectRoot);
        return next;
      });
    }
  }, [projectRoot]);

  useEffect(() => {
    window.mde.getSidebarWidth().then(w => { if (w) setSidebarWidth(w); });
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;

    const onMove = (ev: MouseEvent) => {
      const newWidth = Math.max(140, Math.min(600, startWidth + ev.clientX - startX));
      setSidebarWidth(newWidth);
    };
    const onUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      setSidebarWidth(w => { window.mde.setSidebarWidth(w); return w; });
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [sidebarWidth]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setExpandedPaths(prev => {
      const next = new Set<string>();
      // Keep root expanded
      if (projectRoot) next.add(projectRoot);
      return next;
    });
  }, [projectRoot]);

  return (
    <div className="sidebar" ref={sidebarRef} style={{ width: sidebarWidth }}>
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${mode === 'explorer' ? 'active' : ''}`}
          onClick={() => onSetMode('explorer')}
          title="File Explorer"
        >
          <i className="bi bi-folder" />
        </button>
        <button
          className={`sidebar-tab ${mode === 'outline' ? 'active' : ''}`}
          onClick={() => onSetMode('outline')}
          title="Document Outline"
        >
          <i className="bi bi-list-nested" />
        </button>
      </div>
      <div className="sidebar-content">
        {mode === 'explorer' ? (
          <FileExplorer
            projectRoot={projectRoot}
            onOpenFile={onOpenFile}
            onImportFile={onImportFile}
            activeFilePath={activeFilePath}
            refreshKey={refreshKey}
            onToast={onToast}
            expandedPaths={expandedPaths}
            onToggleExpanded={toggleExpanded}
            onCollapseAll={collapseAll}
            sidebarRef={sidebarRef}
            onDeleteFile={onDeleteFile}
          />
        ) : (
          <DocumentOutline editor={activeEditor} />
        )}
      </div>
      <div className="sidebar-resize-handle" onMouseDown={handleMouseDown} />
    </div>
  );
}

interface FileExplorerProps {
  projectRoot: string | null;
  onOpenFile: (filePath: string, tentative?: boolean) => void;
  onImportFile: (filePath: string) => void;
  activeFilePath: string | null;
  refreshKey: number;
  onToast: (msg: string, variant?: string) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (path: string) => void;
  onCollapseAll: () => void;
  sidebarRef: React.RefObject<HTMLDivElement>;
  onDeleteFile: (filePath: string) => void;
}

function isEditable(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

function isImportable(name: string): boolean {
  return /\.(docx|pdf)$/i.test(name);
}

interface ContextMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

interface ContextMenuProps {
  menu: ContextMenuState;
  projectRoot: string;
  onClose: () => void;
  onStartRename: (entry: FileEntry) => void;
  onRequestDelete: (entry: FileEntry) => void;
  onToast: (msg: string, variant?: string) => void;
}

function ContextMenu({ menu, projectRoot, onClose, onStartRename, onRequestDelete, onToast }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [onClose]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: Math.min(menu.x, window.innerWidth - 180),
    top: Math.min(menu.y, window.innerHeight - 120),
    zIndex: 9500,
  };

  const relativePath = menu.entry.path.startsWith(projectRoot)
    ? menu.entry.path.slice(projectRoot.length + 1)
    : menu.entry.path;

  const handleCopyPath = () => {
    navigator.clipboard.writeText(relativePath);
    onToast(`Copied path: ${relativePath}`, 'info');
    onClose();
  };

  const handleRename = () => {
    onStartRename(menu.entry);
    onClose();
  };

  const handleDelete = () => {
    onRequestDelete(menu.entry);
    onClose();
  };

  return (
    <div ref={ref} className="ctx-menu" style={style}>
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

function DeleteConfirmDialog({ entry, onConfirm, onCancel }: { entry: FileEntry; onConfirm: () => void; onCancel: () => void }) {
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
          <span className="fw-bold">Delete {entry.isDirectory ? 'folder' : 'file'}</span>
        </div>
        <div className="modal-body">
          <p className="text-muted fs-sm">
            Really delete <code>{entry.name}</code>? It will be moved to the Trash.
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

function flattenVisibleEntries(
  entries: FileEntry[],
  expandedPaths: Set<string>,
  entriesCache: Map<string, FileEntry[]>,
): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    result.push(entry);
    if (entry.isDirectory && expandedPaths.has(entry.path)) {
      const children = entriesCache.get(entry.path) || [];
      result.push(...flattenVisibleEntries(children, expandedPaths, entriesCache));
    }
  }
  return result;
}

function FileExplorer({ projectRoot, onOpenFile, onImportFile, activeFilePath, refreshKey, onToast, expandedPaths, onToggleExpanded, onCollapseAll, sidebarRef, onDeleteFile }: FileExplorerProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [deletingEntry, setDeletingEntry] = useState<FileEntry | null>(null);
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  // Cache of loaded directory entries for arrow key navigation
  const entriesCacheRef = useRef<Map<string, FileEntry[]>>(new Map());

  const triggerRefresh = useCallback(() => setLocalRefresh(n => n + 1), []);

  const confirmDelete = useCallback(async () => {
    if (!deletingEntry) return;
    await window.mde.trashFile(deletingEntry.path);
    onDeleteFile(deletingEntry.path);
    if (selectedPath === deletingEntry.path) setSelectedPath(null);
    setDeletingEntry(null);
    triggerRefresh();
  }, [deletingEntry, selectedPath, triggerRefresh, onDeleteFile]);

  const handleContextMenu = useCallback((e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, entry });
  }, []);

  const handleRenameComplete = useCallback(async (entry: FileEntry, newName: string) => {
    if (newName && newName !== entry.name) {
      const parentDir = entry.path.substring(0, entry.path.lastIndexOf('/'));
      const newPath = parentDir + '/' + newName;
      await window.mde.renameFile(entry.path, newPath);
      triggerRefresh();
    }
    setRenamingEntry(null);
  }, [triggerRefresh]);

  const handleSelect = useCallback((entry: FileEntry) => {
    setSelectedPath(entry.path);
  }, []);

  const handleCreate = useCallback(async (name: string, type: 'file' | 'folder') => {
    if (!projectRoot || !name) {
      setCreating(null);
      return;
    }
    // Determine target directory based on selection
    let targetDir = projectRoot;
    if (selectedPath) {
      const stats = await window.mde.getFileStats(selectedPath);
      if (stats?.isDirectory) {
        targetDir = selectedPath;
      } else if (stats) {
        targetDir = selectedPath.substring(0, selectedPath.lastIndexOf('/'));
      }
    }

    if (type === 'file') {
      const finalName = name.includes('.') ? name : name + '.md';
      const finalPath = targetDir + '/' + finalName;
      await window.mde.createFile(finalPath);
      triggerRefresh();
      onOpenFile(finalPath, false);
    } else {
      const newPath = targetDir + '/' + name;
      await window.mde.createDirectory(newPath);
      triggerRefresh();
    }
    setCreating(null);
  }, [projectRoot, selectedPath, triggerRefresh, onOpenFile]);

  const handleDragStart = useCallback((entryPath: string) => {
    setDragSourcePath(entryPath);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragSourcePath(null);
    setDropTargetPath(null);
  }, []);

  const handleDropOnFolder = useCallback(async (targetDir: string) => {
    if (!dragSourcePath || dragSourcePath === targetDir) return;
    const fileName = dragSourcePath.split('/').pop() || '';
    const parentDir = dragSourcePath.substring(0, dragSourcePath.lastIndexOf('/'));
    if (parentDir === targetDir) return;
    const newPath = targetDir + '/' + fileName;
    try {
      await window.mde.renameFile(dragSourcePath, newPath);
      triggerRefresh();
    } catch (err: any) {
      onToast(err.message || 'Failed to move file', 'danger');
    }
    setDragSourcePath(null);
    setDropTargetPath(null);
  }, [dragSourcePath, triggerRefresh, onToast]);

  const registerEntries = useCallback((path: string, entries: FileEntry[]) => {
    entriesCacheRef.current.set(path, entries);
  }, []);

  // Deselect when clicking outside sidebar
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setSelectedPath(null);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [sidebarRef]);

  // Keyboard shortcuts: Enter (rename), Cmd+Backspace (delete), Arrow keys (navigation)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      // Enter -> rename
      if (e.key === 'Enter' && selectedPath && !renamingEntry && !creating) {
        e.preventDefault();
        window.mde.getFileStats(selectedPath).then(stats => {
          if (stats) {
            const name = selectedPath.split('/').pop() || '';
            setRenamingEntry({ path: selectedPath, name, isDirectory: stats.isDirectory });
          }
        });
        return;
      }

      // Cmd+Backspace -> delete with confirmation dialog
      if (e.key === 'Backspace' && e.metaKey && selectedPath && !renamingEntry && !creating) {
        e.preventDefault();
        window.mde.getFileStats(selectedPath).then(stats => {
          if (stats) {
            const name = selectedPath.split('/').pop() || '';
            setDeletingEntry({ path: selectedPath, name, isDirectory: stats.isDirectory });
          }
        });
        return;
      }

      // Arrow keys for navigation (plain arrows only, not with modifiers)
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') && projectRoot && !e.metaKey && !e.altKey && !e.ctrlKey) {
        e.preventDefault();

        const rootEntries = entriesCacheRef.current.get(projectRoot) || [];
        const visibleList = flattenVisibleEntries(rootEntries, expandedPaths, entriesCacheRef.current);

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          if (!selectedPath) {
            // Select first item
            if (visibleList.length > 0) setSelectedPath(visibleList[0].path);
            return;
          }
          const idx = visibleList.findIndex(entry => entry.path === selectedPath);
          if (idx < 0) return;
          const newIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
          if (newIdx >= 0 && newIdx < visibleList.length) {
            const newEntry = visibleList[newIdx];
            setSelectedPath(newEntry.path);
            // Open file on arrow key selection (tentative)
            if (!newEntry.isDirectory && isEditable(newEntry.name)) {
              onOpenFile(newEntry.path, true);
            }
          }
        } else if (e.key === 'ArrowRight' && selectedPath) {
          // Expand folder
          const entry = visibleList.find(e => e.path === selectedPath);
          if (entry?.isDirectory && !expandedPaths.has(selectedPath)) {
            onToggleExpanded(selectedPath);
          }
        } else if (e.key === 'ArrowLeft' && selectedPath) {
          // Collapse folder
          const entry = visibleList.find(e => e.path === selectedPath);
          if (entry?.isDirectory && expandedPaths.has(selectedPath)) {
            onToggleExpanded(selectedPath);
          }
        }
        return;
      }

      // Escape -> deselect
      if (e.key === 'Escape' && selectedPath && !renamingEntry && !creating) {
        e.preventDefault();
        setSelectedPath(null);
        return;
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPath, renamingEntry, creating, projectRoot, expandedPaths, onToggleExpanded, triggerRefresh, onOpenFile]);

  if (!projectRoot) {
    return <div className="sidebar-empty">Open a folder to browse files</div>;
  }

  return (
    <>
      <DirectoryNode
        path={projectRoot}
        name={projectRoot.split('/').pop() || ''}
        onOpenFile={onOpenFile}
        onImportFile={onImportFile}
        activeFilePath={activeFilePath}
        refreshKey={refreshKey + localRefresh}
        isRoot
        onContextMenu={handleContextMenu}
        renamingEntry={renamingEntry}
        onRenameComplete={handleRenameComplete}
        creating={creating}
        onSetCreating={setCreating}
        onCreate={handleCreate}
        selectedPath={selectedPath}
        onSelect={handleSelect}
        expandedPaths={expandedPaths}
        onToggleExpanded={onToggleExpanded}
        onCollapseAll={onCollapseAll}
        onRegisterEntries={registerEntries}
        dragSourcePath={dragSourcePath}
        dropTargetPath={dropTargetPath}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDropOnFolder={handleDropOnFolder}
        onSetDropTarget={setDropTargetPath}
      />
      {deletingEntry && (
        <DeleteConfirmDialog
          entry={deletingEntry}
          onConfirm={confirmDelete}
          onCancel={() => setDeletingEntry(null)}
        />
      )}
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          projectRoot={projectRoot}
          onClose={() => setContextMenu(null)}
          onStartRename={setRenamingEntry}
          onRequestDelete={setDeletingEntry}
          onToast={onToast}
        />
      )}
    </>
  );
}

interface DirectoryNodeProps {
  path: string;
  name: string;
  onOpenFile: (filePath: string, tentative?: boolean) => void;
  onImportFile: (filePath: string) => void;
  activeFilePath: string | null;
  refreshKey: number;
  isRoot?: boolean;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  renamingEntry: FileEntry | null;
  onRenameComplete: (entry: FileEntry, newName: string) => void;
  creating?: 'file' | 'folder' | null;
  onSetCreating?: (type: 'file' | 'folder' | null) => void;
  onCreate?: (name: string, type: 'file' | 'folder') => void;
  selectedPath: string | null;
  onSelect: (entry: FileEntry) => void;
  expandedPaths: Set<string>;
  onToggleExpanded: (path: string) => void;
  onCollapseAll?: () => void;
  onRegisterEntries?: (path: string, entries: FileEntry[]) => void;
  dragSourcePath: string | null;
  dropTargetPath: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onDropOnFolder: (targetDir: string) => void;
  onSetDropTarget: (path: string | null) => void;
}

function DirectoryNode({ path, name, onOpenFile, onImportFile, activeFilePath, refreshKey, isRoot, onContextMenu, renamingEntry, onRenameComplete, creating, onSetCreating, onCreate, selectedPath, onSelect, expandedPaths, onToggleExpanded, onCollapseAll, onRegisterEntries, dragSourcePath, dropTargetPath, onDragStart, onDragEnd, onDropOnFolder, onSetDropTarget }: DirectoryNodeProps) {
  const expanded = expandedPaths.has(path);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isRoot || expanded) {
      window.mde.listDirectory(path).then(result => {
        setEntries(result);
        setLoaded(true);
        onRegisterEntries?.(path, result);
      });
    }
  }, [isRoot, expanded, path, refreshKey]);

  // Show inline create input inside the selected directory, or at root
  const showCreateHere = creating && (
    (isRoot && (!selectedPath || selectedPath === path)) ||
    (!isRoot && selectedPath === path)
  );

  const renderEntry = (entry: FileEntry) => {
    if (entry.isDirectory) {
      return (
        <DirectoryNode
          key={entry.path}
          path={entry.path}
          name={entry.name}
          onOpenFile={onOpenFile}
          onImportFile={onImportFile}
          activeFilePath={activeFilePath}
          refreshKey={refreshKey}
          onContextMenu={onContextMenu}
          renamingEntry={renamingEntry}
          onRenameComplete={onRenameComplete}
          selectedPath={selectedPath}
          onSelect={onSelect}
          creating={creating}
          onSetCreating={onSetCreating}
          onCreate={onCreate}
          expandedPaths={expandedPaths}
          onToggleExpanded={onToggleExpanded}
          onRegisterEntries={onRegisterEntries}
          dragSourcePath={dragSourcePath}
          dropTargetPath={dropTargetPath}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDropOnFolder={onDropOnFolder}
          onSetDropTarget={onSetDropTarget}
        />
      );
    }

    // Show inline create input after the selected file (as sibling)
    const showCreateAfter = creating && selectedPath === entry.path;

    return (
      <React.Fragment key={entry.path}>
        <FileNode
          entry={entry}
          onOpenFile={onOpenFile}
          onImportFile={onImportFile}
          active={entry.path === activeFilePath}
          selected={entry.path === selectedPath}
          onContextMenu={onContextMenu}
          isRenaming={renamingEntry?.path === entry.path}
          onRenameComplete={onRenameComplete}
          onSelect={onSelect}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          parentPath={path}
          dragSourcePath={dragSourcePath}
          dropTargetPath={dropTargetPath}
          onSetDropTarget={onSetDropTarget}
          onDropOnFolder={onDropOnFolder}
        />
        {showCreateAfter && (
          <InlineCreateInput
            type={creating}
            onSubmit={(n) => onCreate?.(n, creating)}
            onCancel={() => onSetCreating?.(null)}
          />
        )}
      </React.Fragment>
    );
  };

  const isDropTarget = dropTargetPath === path;
  const isDragSource = dragSourcePath === path;

  const handleFolderDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSourcePath || dragSourcePath === path) return;
    // Can't drop into own descendant
    if (dragSourcePath.startsWith(path + '/')) return;
    // Already in this folder -- no-op
    const parentDir = dragSourcePath.substring(0, dragSourcePath.lastIndexOf('/'));
    if (parentDir === path) return;
    onSetDropTarget(path);
  };

  const handleFolderDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    if (dropTargetPath === path) onSetDropTarget(null);
  };

  const handleFolderDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDropOnFolder(path);
  };

  if (isRoot) {
    return (
      <div
        className="tree-node"
        onDragOver={handleFolderDragOver}
        onDragLeave={handleFolderDragLeave}
        onDrop={handleFolderDrop}
      >
        <div
          className={`tree-root-header ${isDropTarget ? 'tree-drop-target' : ''}`}
        >
          <span>{name}</span>
          <span className="tree-root-actions">
            <button className="tree-root-btn" title="New File" onClick={() => onSetCreating?.('file')}>
              <i className="bi bi-file-earmark-plus" />
            </button>
            <button className="tree-root-btn" title="New Folder" onClick={() => onSetCreating?.('folder')}>
              <i className="bi bi-folder-plus" />
            </button>
            <button className="tree-root-btn" title="Collapse All" onClick={() => onCollapseAll?.()}>
              <i className="bi bi-arrows-collapse" />
            </button>
          </span>
        </div>
        {showCreateHere && (
          <InlineCreateInput
            type={creating}
            onSubmit={(n) => onCreate?.(n, creating)}
            onCancel={() => onSetCreating?.(null)}
          />
        )}
        {entries.map(renderEntry)}
      </div>
    );
  }

  const dirEntry: FileEntry = { name, path, isDirectory: true };
  const isRenaming = renamingEntry?.path === path;
  const isSelected = selectedPath === path;
  return (
    <div className="tree-node">
      <div
        className={`tree-item tree-folder ${expanded ? 'expanded' : ''} ${isSelected ? 'tree-item-selected' : ''} ${isDropTarget ? 'tree-drop-target' : ''} ${isDragSource ? 'tree-item-dragging' : ''}`}
        onClick={() => { onToggleExpanded(path); onSelect(dirEntry); }}
        onContextMenu={(e) => onContextMenu(e, dirEntry)}
        draggable
        onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(path); }}
        onDragEnd={onDragEnd}
        onDragOver={handleFolderDragOver}
        onDragLeave={handleFolderDragLeave}
        onDrop={handleFolderDrop}
      >
        <span className="tree-arrow">{expanded ? '▼' : '▶'}</span>
        {isRenaming ? (
          <InlineRenameInput
            initialName={name}
            onSubmit={(newName) => onRenameComplete(dirEntry, newName)}
            onCancel={() => onRenameComplete(dirEntry, name)}
          />
        ) : (
          <span className="tree-name">{name}</span>
        )}
      </div>
      {expanded && (
        <div
          className="tree-children"
          onDragOver={handleFolderDragOver}
          onDragLeave={handleFolderDragLeave}
          onDrop={handleFolderDrop}
        >
          {showCreateHere && (
            <InlineCreateInput
              type={creating!}
              onSubmit={(n) => onCreate?.(n, creating!)}
              onCancel={() => onSetCreating?.(null)}
            />
          )}
          {entries.map(renderEntry)}
          {loaded && entries.length === 0 && !showCreateHere && (
            <div className="tree-empty">Empty folder</div>
          )}
        </div>
      )}
    </div>
  );
}

function InlineRenameInput({ initialName, onSubmit, onCancel }: { initialName: string; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initialName);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      const dotIdx = initialName.lastIndexOf('.');
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : initialName.length);
    }
  }, [initialName]);

  return (
    <input
      ref={inputRef}
      className="tree-rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onSubmit(value.trim());
        if (e.key === 'Escape') onCancel();
        e.stopPropagation();
      }}
      onBlur={() => onSubmit(value.trim())}
      onClick={(e) => e.stopPropagation()}
    />
  );
}

function InlineCreateInput({ type, onSubmit, onCancel }: { type: 'file' | 'folder'; onSubmit: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="tree-item tree-file" style={{ paddingLeft: 26 }}>
      <i className={`bi ${type === 'file' ? 'bi-file-earmark-plus' : 'bi-folder-plus'}`} style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }} />
      <input
        ref={inputRef}
        className="tree-rename-input"
        value={value}
        placeholder={type === 'file' ? 'filename.md' : 'folder name'}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit(value.trim());
          if (e.key === 'Escape') onCancel();
          e.stopPropagation();
        }}
        onBlur={() => {
          if (value.trim()) onSubmit(value.trim());
          else onCancel();
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function FileNode({ entry, onOpenFile, onImportFile, active, selected, onContextMenu, isRenaming, onRenameComplete, onSelect, onDragStart, onDragEnd, parentPath, dragSourcePath, dropTargetPath, onSetDropTarget, onDropOnFolder }: {
  entry: FileEntry;
  onOpenFile: (path: string, tentative?: boolean) => void;
  onImportFile: (path: string) => void;
  active?: boolean;
  selected?: boolean;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  isRenaming?: boolean;
  onRenameComplete: (entry: FileEntry, newName: string) => void;
  onSelect: (entry: FileEntry) => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  parentPath: string;
  dragSourcePath: string | null;
  dropTargetPath: string | null;
  onSetDropTarget: (path: string | null) => void;
  onDropOnFolder: (targetDir: string) => void;
}) {
  const editable = isEditable(entry.name);
  const importable = isImportable(entry.name);
  const clickable = editable || importable;

  const handleClick = () => {
    onSelect(entry);
    if (editable) onOpenFile(entry.path, true);
    else if (importable) onImportFile(entry.path);
  };

  const handleFileDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSourcePath || dragSourcePath === entry.path) return;
    const srcParent = dragSourcePath.substring(0, dragSourcePath.lastIndexOf('/'));
    if (srcParent === parentPath) return;
    onSetDropTarget(parentPath);
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    if (dropTargetPath === parentPath) onSetDropTarget(null);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDropOnFolder(parentPath);
  };

  return (
    <div
      className={`tree-item tree-file ${clickable ? '' : 'tree-file-disabled'} ${importable ? 'tree-file-importable' : ''} ${active ? 'tree-file-active' : ''} ${selected ? 'tree-item-selected' : ''}`}
      onClick={handleClick}
      onDoubleClick={editable ? () => onOpenFile(entry.path, false) : undefined}
      onContextMenu={(e) => onContextMenu(e, entry)}
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(entry.path); }}
      onDragEnd={onDragEnd}
      onDragOver={handleFileDragOver}
      onDragLeave={handleFileDragLeave}
      onDrop={handleFileDrop}
    >
      {isRenaming ? (
        <InlineRenameInput
          initialName={entry.name}
          onSubmit={(newName) => onRenameComplete(entry, newName)}
          onCancel={() => onRenameComplete(entry, entry.name)}
        />
      ) : (
        <span className="tree-name">{entry.name}</span>
      )}
    </div>
  );
}

interface DocumentOutlineProps {
  editor: TipTapEditor | null;
}

interface HeadingItem {
  level: number;
  text: string;
  pos: number;
}

function DocumentOutline({ editor }: DocumentOutlineProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  const extractHeadings = useCallback(() => {
    if (!editor) {
      setHeadings([]);
      return;
    }

    const items: HeadingItem[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        items.push({
          level: node.attrs.level,
          text: node.textContent,
          pos,
        });
      }
    });
    setHeadings(items);
  }, [editor]);

  useEffect(() => {
    extractHeadings();
    if (!editor) return;
    editor.on('update', extractHeadings);
    return () => { editor.off('update', extractHeadings); };
  }, [editor, extractHeadings]);

  if (!editor) {
    return <div className="sidebar-empty">No document open</div>;
  }

  if (headings.length === 0) {
    return <div className="sidebar-empty">No headings found</div>;
  }

  return (
    <div className="outline">
      {headings.map((h, i) => (
        <div
          key={i}
          className={`outline-item outline-h${h.level}`}
          onClick={() => {
            editor.view.dom.focus();
            const { tr } = editor.state;
            const { TextSelection } = require('@tiptap/pm/state');
            tr.setSelection(TextSelection.create(tr.doc, h.pos));
            editor.view.dispatch(tr);
            const dom = editor.view.nodeDOM(h.pos);
            if (dom instanceof HTMLElement) {
              dom.scrollIntoView({ block: 'start' });
            }
          }}
        >
          {h.text || '(empty heading)'}
        </div>
      ))}
    </div>
  );
}
