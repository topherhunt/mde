import React, { useEffect, useState, useCallback } from 'react';
import { FileEntry } from '../types';
import { Editor as TipTapEditor } from '@tiptap/react';

interface SidebarProps {
  projectRoot: string | null;
  mode: 'explorer' | 'outline';
  onSetMode: (mode: 'explorer' | 'outline') => void;
  onOpenFile: (filePath: string) => void;
  activeEditor: TipTapEditor | null;
}

export default function Sidebar({ projectRoot, mode, onSetMode, onOpenFile, activeEditor }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-tabs">
        <button
          className={`sidebar-tab ${mode === 'explorer' ? 'active' : ''}`}
          onClick={() => onSetMode('explorer')}
          title="File Explorer"
        >
          Files
        </button>
        <button
          className={`sidebar-tab ${mode === 'outline' ? 'active' : ''}`}
          onClick={() => onSetMode('outline')}
          title="Document Outline"
        >
          Outline
        </button>
      </div>
      <div className="sidebar-content">
        {mode === 'explorer' ? (
          <FileExplorer projectRoot={projectRoot} onOpenFile={onOpenFile} />
        ) : (
          <DocumentOutline editor={activeEditor} />
        )}
      </div>
    </div>
  );
}

interface FileExplorerProps {
  projectRoot: string | null;
  onOpenFile: (filePath: string) => void;
}

function FileExplorer({ projectRoot, onOpenFile }: FileExplorerProps) {
  if (!projectRoot) {
    return <div className="sidebar-empty">Open a folder to browse files</div>;
  }

  return <DirectoryNode path={projectRoot} name={projectRoot.split('/').pop() || ''} onOpenFile={onOpenFile} isRoot />;
}

interface DirectoryNodeProps {
  path: string;
  name: string;
  onOpenFile: (filePath: string) => void;
  isRoot?: boolean;
}

function DirectoryNode({ path, name, onOpenFile, isRoot }: DirectoryNodeProps) {
  const [expanded, setExpanded] = useState(isRoot || false);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (expanded && !loaded) {
      window.mde.listDirectory(path).then(result => {
        setEntries(result);
        setLoaded(true);
      });
    }
  }, [expanded, loaded, path]);

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
              />
            ) : (
              <div
                key={entry.path}
                className="tree-item tree-file"
                onClick={() => onOpenFile(entry.path)}
              >
                <span className="tree-name">{entry.name}</span>
              </div>
            )
          )}
          {loaded && entries.length === 0 && (
            <div className="tree-empty">No markdown files</div>
          )}
        </div>
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
            editor.commands.focus();
            editor.commands.setTextSelection(h.pos);
            const domNode = editor.view.domAtPos(h.pos);
            if (domNode.node instanceof HTMLElement) {
              domNode.node.scrollIntoView({ behavior: 'smooth', block: 'center' });
            } else if (domNode.node.parentElement) {
              domNode.node.parentElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }}
        >
          {h.text || '(empty heading)'}
        </div>
      ))}
    </div>
  );
}
