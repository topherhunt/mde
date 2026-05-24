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
}

export default function Sidebar({ projectRoot, mode, onSetMode, onOpenFile, onImportFile, activeEditor, activeFilePath, refreshKey, onToast }: SidebarProps) {
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const resizing = useRef(false);

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

  return (
    <div className="sidebar" style={{ width: sidebarWidth }}>
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
          <FileExplorer projectRoot={projectRoot} onOpenFile={onOpenFile} onImportFile={onImportFile} activeFilePath={activeFilePath} refreshKey={refreshKey} onToast={onToast} />
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
  onDeleted: () => void;
  onToast: (msg: string, variant?: string) => void;
}

function ContextMenu({ menu, projectRoot, onClose, onStartRename, onDeleted, onToast }: ContextMenuProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
    onToast(`✅ Copied path: ${relativePath}`, 'info');
    onClose();
  };

  const handleRename = () => {
    onStartRename(menu.entry);
    onClose();
  };

  const handleDelete = async () => {
    await window.mde.trashFile(menu.entry.path);
    onDeleted();
    onClose();
  };

  return (
    <div ref={ref} className="ctx-menu" style={style}>
      <button className="ctx-menu-item" onClick={handleRename}>
        <i className="bi bi-pencil" /> Rename
      </button>
      {!confirmingDelete ? (
        <button className="ctx-menu-item ctx-menu-item-danger" onClick={() => setConfirmingDelete(true)}>
          <i className="bi bi-trash" /> Delete
        </button>
      ) : (
        <button className="ctx-menu-item ctx-menu-item-danger" onClick={handleDelete}>
          <i className="bi bi-trash" /> Move to Trash?
        </button>
      )}
      <div className="ctx-menu-divider" />
      <button className="ctx-menu-item" onClick={handleCopyPath}>
        <i className="bi bi-clipboard" /> Copy Relative Path
      </button>
    </div>
  );
}

function FileExplorer({ projectRoot, onOpenFile, onImportFile, activeFilePath, refreshKey, onToast }: FileExplorerProps) {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingEntry, setRenamingEntry] = useState<FileEntry | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);
  const [creating, setCreating] = useState<'file' | 'folder' | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const triggerRefresh = useCallback(() => setLocalRefresh(n => n + 1), []);

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
      // We need to know if selectedPath is a directory or file
      // Use getFileStats to check
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

  // Handle Enter to rename -- only when focus is NOT in an editable element
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const editable = (e.target as HTMLElement)?.isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;
      if (e.key === 'Enter' && selectedPath && !renamingEntry && !creating) {
        e.preventDefault();
        window.mde.getFileStats(selectedPath).then(stats => {
          if (stats) {
            const name = selectedPath.split('/').pop() || '';
            setRenamingEntry({ path: selectedPath, name, isDirectory: stats.isDirectory });
          }
        });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [selectedPath, renamingEntry, creating]);

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
      />
      {contextMenu && (
        <ContextMenu
          menu={contextMenu}
          projectRoot={projectRoot}
          onClose={() => setContextMenu(null)}
          onStartRename={setRenamingEntry}
          onDeleted={triggerRefresh}
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
}

function DirectoryNode({ path, name, onOpenFile, onImportFile, activeFilePath, refreshKey, isRoot, onContextMenu, renamingEntry, onRenameComplete, creating, onSetCreating, onCreate, selectedPath, onSelect }: DirectoryNodeProps) {
  const [expanded, setExpanded] = useState(isRoot || false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isRoot || expanded) {
      window.mde.listDirectory(path).then(result => {
        setEntries(result);
        setLoaded(true);
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

  if (isRoot) {
    return (
      <div className="tree-node">
        <div className="tree-root-header">
          <span>{name}</span>
          <span className="tree-root-actions">
            <button className="tree-root-btn" title="New File" onClick={() => onSetCreating?.('file')}>
              <i className="bi bi-file-earmark-plus" />
            </button>
            <button className="tree-root-btn" title="New Folder" onClick={() => onSetCreating?.('folder')}>
              <i className="bi bi-folder-plus" />
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
        className={`tree-item tree-folder ${expanded ? 'expanded' : ''} ${isSelected ? 'tree-item-selected' : ''}`}
        onClick={() => { setExpanded(!expanded); onSelect(dirEntry); }}
        onContextMenu={(e) => onContextMenu(e, dirEntry)}
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
        <div className="tree-children">
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

function FileNode({ entry, onOpenFile, onImportFile, active, selected, onContextMenu, isRenaming, onRenameComplete, onSelect }: {
  entry: FileEntry;
  onOpenFile: (path: string, tentative?: boolean) => void;
  onImportFile: (path: string) => void;
  active?: boolean;
  selected?: boolean;
  onContextMenu: (e: React.MouseEvent, entry: FileEntry) => void;
  isRenaming?: boolean;
  onRenameComplete: (entry: FileEntry, newName: string) => void;
  onSelect: (entry: FileEntry) => void;
}) {
  const editable = isEditable(entry.name);
  const importable = isImportable(entry.name);
  const clickable = editable || importable;

  const handleClick = () => {
    onSelect(entry);
    if (editable) onOpenFile(entry.path, true);
    else if (importable) onImportFile(entry.path);
  };

  return (
    <div
      className={`tree-item tree-file ${clickable ? '' : 'tree-file-disabled'} ${importable ? 'tree-file-importable' : ''} ${active ? 'tree-file-active' : ''} ${selected ? 'tree-item-selected' : ''}`}
      onClick={handleClick}
      onDoubleClick={editable ? () => onOpenFile(entry.path, false) : undefined}
      onContextMenu={(e) => onContextMenu(e, entry)}
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
