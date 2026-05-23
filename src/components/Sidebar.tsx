import React, { useEffect, useState, useCallback } from 'react';
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
}

export default function Sidebar({ projectRoot, mode, onSetMode, onOpenFile, onImportFile, activeEditor, activeFilePath, refreshKey }: SidebarProps) {
  return (
    <div className="sidebar">
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
          <FileExplorer projectRoot={projectRoot} onOpenFile={onOpenFile} onImportFile={onImportFile} activeFilePath={activeFilePath} refreshKey={refreshKey} />
        ) : (
          <DocumentOutline editor={activeEditor} />
        )}
      </div>
    </div>
  );
}

interface FileExplorerProps {
  projectRoot: string | null;
  onOpenFile: (filePath: string, tentative?: boolean) => void;
  onImportFile: (filePath: string) => void;
  activeFilePath: string | null;
  refreshKey: number;
}

function isEditable(name: string): boolean {
  return /\.(md|markdown|txt)$/i.test(name);
}

function isImportable(name: string): boolean {
  return /\.(docx|pdf)$/i.test(name);
}

function FileExplorer({ projectRoot, onOpenFile, onImportFile, activeFilePath, refreshKey }: FileExplorerProps) {
  if (!projectRoot) {
    return <div className="sidebar-empty">Open a folder to browse files</div>;
  }

  return <DirectoryNode path={projectRoot} name={projectRoot.split('/').pop() || ''} onOpenFile={onOpenFile} onImportFile={onImportFile} activeFilePath={activeFilePath} refreshKey={refreshKey} isRoot />;
}

interface DirectoryNodeProps {
  path: string;
  name: string;
  onOpenFile: (filePath: string, tentative?: boolean) => void;
  onImportFile: (filePath: string) => void;
  activeFilePath: string | null;
  refreshKey: number;
  isRoot?: boolean;
}

function DirectoryNode({ path, name, onOpenFile, onImportFile, activeFilePath, refreshKey, isRoot }: DirectoryNodeProps) {
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

  if (isRoot) {
    return (
      <div className="tree-node">
        <div className="tree-root-header">{name}</div>
        {entries.map(entry =>
          entry.isDirectory ? (
            <DirectoryNode
              key={entry.path}
              path={entry.path}
              name={entry.name}
              onOpenFile={onOpenFile}
              onImportFile={onImportFile}
              activeFilePath={activeFilePath}
              refreshKey={refreshKey}
            />
          ) : (
            <FileNode key={entry.path} entry={entry} onOpenFile={onOpenFile} onImportFile={onImportFile} active={entry.path === activeFilePath} />
          )
        )}
      </div>
    );
  }

  return (
    <div className="tree-node">
      <div
        className={`tree-item tree-folder ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tree-arrow">{expanded ? '▼' : '▶'}</span>
        <span className="tree-name">{name}</span>
      </div>
      {expanded && (
        <div className="tree-children">
          {entries.map(entry =>
            entry.isDirectory ? (
              <DirectoryNode
                key={entry.path}
                path={entry.path}
                name={entry.name}
                onOpenFile={onOpenFile}
                onImportFile={onImportFile}
                activeFilePath={activeFilePath}
                refreshKey={refreshKey}
              />
            ) : (
              <FileNode key={entry.path} entry={entry} onOpenFile={onOpenFile} onImportFile={onImportFile} active={entry.path === activeFilePath} />
            )
          )}
          {loaded && entries.length === 0 && (
            <div className="tree-empty">Empty folder</div>
          )}
        </div>
      )}
    </div>
  );
}

function FileNode({ entry, onOpenFile, onImportFile, active }: { entry: FileEntry; onOpenFile: (path: string, tentative?: boolean) => void; onImportFile: (path: string) => void; active?: boolean }) {
  const editable = isEditable(entry.name);
  const importable = isImportable(entry.name);
  const clickable = editable || importable;
  return (
    <div
      className={`tree-item tree-file ${clickable ? '' : 'tree-file-disabled'} ${importable ? 'tree-file-importable' : ''} ${active ? 'tree-file-active' : ''}`}
      onClick={editable ? () => onOpenFile(entry.path, true) : importable ? () => onImportFile(entry.path) : undefined}
      onDoubleClick={editable ? () => onOpenFile(entry.path, false) : undefined}
    >
      <span className="tree-name">{entry.name}</span>
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
