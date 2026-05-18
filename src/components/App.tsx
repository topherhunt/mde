import React, { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { Tab } from '../types';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import Toolbar from './Toolbar';
import Editor from './Editor';
import ConflictBanner from './ConflictBanner';
import FindBar from './FindBar';
import { Editor as TipTapEditor } from '@tiptap/react';

interface AppState {
  tabs: Tab[];
  activeTabIndex: number;
  sidebarMode: 'explorer' | 'outline';
  projectRoot: string | null;
  findBarOpen: boolean;
}

type Action =
  | { type: 'SET_PROJECT_ROOT'; root: string }
  | { type: 'OPEN_TAB'; tab: Tab }
  | { type: 'CLOSE_TAB'; index: number }
  | { type: 'SET_ACTIVE_TAB'; index: number }
  | { type: 'MARK_DIRTY'; tabId: string; dirty: boolean }
  | { type: 'MARK_CONFLICT'; tabId: string; conflict: boolean }
  | { type: 'UPDATE_TAB_PATH'; tabId: string; filePath: string; fileName: string; mtime: number }
  | { type: 'UPDATE_TAB_MTIME'; tabId: string; mtime: number }
  | { type: 'SET_SIDEBAR_MODE'; mode: 'explorer' | 'outline' }
  | { type: 'TOGGLE_FIND_BAR' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PROJECT_ROOT':
      return { ...state, projectRoot: action.root };

    case 'OPEN_TAB': {
      const existing = state.tabs.findIndex(t => t.filePath === action.tab.filePath);
      if (existing >= 0) {
        return { ...state, activeTabIndex: existing };
      }
      return {
        ...state,
        tabs: [...state.tabs, action.tab],
        activeTabIndex: state.tabs.length,
      };
    }

    case 'CLOSE_TAB': {
      const tabs = state.tabs.filter((_, i) => i !== action.index);
      let activeTabIndex = state.activeTabIndex;
      if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
      if (activeTabIndex < 0) activeTabIndex = 0;
      return { ...state, tabs, activeTabIndex };
    }

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabIndex: action.index };

    case 'MARK_DIRTY':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId ? { ...t, dirty: action.dirty } : t
        ),
      };

    case 'MARK_CONFLICT':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId ? { ...t, conflict: action.conflict } : t
        ),
      };

    case 'UPDATE_TAB_PATH':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId
            ? { ...t, filePath: action.filePath, fileName: action.fileName, diskMtime: action.mtime }
            : t
        ),
      };

    case 'UPDATE_TAB_MTIME':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId ? { ...t, diskMtime: action.mtime } : t
        ),
      };

    case 'SET_SIDEBAR_MODE':
      return { ...state, sidebarMode: action.mode };

    case 'TOGGLE_FIND_BAR':
      return { ...state, findBarOpen: !state.findBarOpen };

    default:
      return state;
  }
}

const initialState: AppState = {
  tabs: [],
  activeTabIndex: 0,
  sidebarMode: 'explorer',
  projectRoot: null,
  findBarOpen: false,
};

let tabIdCounter = 0;
function nextTabId(): string {
  return `tab-${++tabIdCounter}`;
}

function fileNameFromPath(filePath: string): string {
  return filePath.split('/').pop() || 'Untitled';
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const editorsRef = useRef<Map<string, TipTapEditor>>(new Map());
  const [activeEditor, setActiveEditor] = useState<TipTapEditor | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 4000);
  }, []);

  const activeTab = state.tabs[state.activeTabIndex] || null;

  useEffect(() => {
    setActiveEditor(activeTab ? editorsRef.current.get(activeTab.id) || null : null);
  }, [activeTab?.id]);

  const openFile = useCallback(async (filePath: string) => {
    const existing = state.tabs.find(t => t.filePath === filePath);
    if (existing) {
      const idx = state.tabs.indexOf(existing);
      dispatch({ type: 'SET_ACTIVE_TAB', index: idx });
      return;
    }

    const stats = await window.mde.getFileStats(filePath);
    const tab: Tab = {
      id: nextTabId(),
      filePath,
      fileName: fileNameFromPath(filePath),
      dirty: false,
      diskMtime: stats?.mtimeMs ?? null,
      conflict: false,
    };
    dispatch({ type: 'OPEN_TAB', tab });
    window.mde.watchFile(filePath);
  }, [state.tabs]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab || !activeEditor) return;
    if (activeTab.conflict) return;

    let filePath = activeTab.filePath;
    if (!filePath) {
      filePath = await window.mde.showSaveDialog();
      if (!filePath) return;
    }

    const { Markdown } = await import('../utils/markdown');
    const markdown = Markdown.serialize(activeEditor);
    const mtime = await window.mde.writeFile(filePath, markdown);

    if (activeTab.filePath !== filePath) {
      dispatch({
        type: 'UPDATE_TAB_PATH',
        tabId: activeTab.id,
        filePath,
        fileName: fileNameFromPath(filePath),
        mtime,
      });
      window.mde.watchFile(filePath);
    } else {
      dispatch({ type: 'UPDATE_TAB_MTIME', tabId: activeTab.id, mtime });
    }
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
  }, [activeTab, activeEditor]);

  const saveActiveTabAs = useCallback(async () => {
    if (!activeTab || !activeEditor) return;

    const filePath = await window.mde.showSaveDialog(activeTab.filePath || undefined);
    if (!filePath) return;

    const { Markdown } = await import('../utils/markdown');
    const markdown = Markdown.serialize(activeEditor);
    const mtime = await window.mde.writeFile(filePath, markdown);

    dispatch({
      type: 'UPDATE_TAB_PATH',
      tabId: activeTab.id,
      filePath,
      fileName: fileNameFromPath(filePath),
      mtime,
    });
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    dispatch({ type: 'MARK_CONFLICT', tabId: activeTab.id, conflict: false });
    window.mde.watchFile(filePath);
  }, [activeTab, activeEditor]);

  const reloadActiveTab = useCallback(async () => {
    if (!activeTab || !activeEditor || !activeTab.filePath) return;

    const content = await window.mde.readFile(activeTab.filePath);
    const stats = await window.mde.getFileStats(activeTab.filePath);
    const { Markdown } = await import('../utils/markdown');
    Markdown.deserializeInto(activeEditor, content);

    dispatch({ type: 'UPDATE_TAB_MTIME', tabId: activeTab.id, mtime: stats?.mtimeMs ?? null });
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    dispatch({ type: 'MARK_CONFLICT', tabId: activeTab.id, conflict: false });
  }, [activeTab, activeEditor]);

  const registerEditor = useCallback((tabId: string, editor: TipTapEditor) => {
    editorsRef.current.set(tabId, editor);
    if (activeTab && tabId === activeTab.id) {
      setActiveEditor(editor);
    }
  }, [activeTab]);

  const unregisterEditor = useCallback((tabId: string) => {
    editorsRef.current.delete(tabId);
    if (activeTab && tabId === activeTab.id) {
      setActiveEditor(null);
    }
  }, [activeTab]);

  const handleCloseTab = useCallback((index: number) => {
    const tab = state.tabs[index];
    if (!tab) return;
    if (tab.dirty) {
      const confirmed = window.confirm(
        `"${tab.fileName}" has unsaved changes. Close anyway and lose them?`
      );
      if (!confirmed) return;
    }
    if (tab.filePath) {
      window.mde.unwatchFile(tab.filePath);
    }
    unregisterEditor(tab.id);
    dispatch({ type: 'CLOSE_TAB', index });
  }, [state.tabs, unregisterEditor]);

  useEffect(() => {
    const cleanups = [
      window.mde.onOpenFile(openFile),
      window.mde.onOpenProject((root) => dispatch({ type: 'SET_PROJECT_ROOT', root })),
      window.mde.onCloseTab(() => {
        if (state.tabs.length > 0) {
          handleCloseTab(state.activeTabIndex);
        } else {
          window.mde.closeWindow();
        }
      }),
      window.mde.onSaveFile(saveActiveTab),
      window.mde.onSaveFileAs(saveActiveTabAs),
      window.mde.onToggleFind(() => dispatch({ type: 'TOGGLE_FIND_BAR' })),
      window.mde.onExportPDF(async () => {
        await window.mde.exportPDF();
      }),
      window.mde.onFileChanged(async (filePath) => {
        const tab = state.tabs.find(t => t.filePath === filePath);
        if (!tab) return;

        const stats = await window.mde.getFileStats(filePath);
        if (!stats) return;

        if (tab.diskMtime !== null && stats.mtimeMs > tab.diskMtime) {
          if (tab.dirty) {
            dispatch({ type: 'MARK_CONFLICT', tabId: tab.id, conflict: true });
          } else {
            const editor = editorsRef.current.get(tab.id);
            if (editor) {
              const content = await window.mde.readFile(filePath);
              const { Markdown } = await import('../utils/markdown');
              Markdown.deserializeInto(editor, content);
            }
            dispatch({ type: 'UPDATE_TAB_MTIME', tabId: tab.id, mtime: stats.mtimeMs });
          }
        }
      }),
    ];

    return () => cleanups.forEach(fn => fn());
  }, [openFile, saveActiveTab, saveActiveTabAs, handleCloseTab, state.tabs, state.activeTabIndex]);

  useEffect(() => {
    window.mde.getProjectRoot().then(root => {
      if (root) dispatch({ type: 'SET_PROJECT_ROOT', root });
    });
  }, []);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!e.dataTransfer) return;
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        const filePath = window.mde.getPathForFile(file);
        if (!filePath) continue;
        const stats = await window.mde.getFileStats(filePath);
        if (stats && stats.isDirectory) {
          if (state.projectRoot || state.tabs.length > 0) {
            window.mde.openFolderInNewWindow(filePath);
          } else {
            dispatch({ type: 'SET_PROJECT_ROOT', root: filePath });
          }
          return;
        }
        if (/\.(md|markdown)$/i.test(filePath)) {
          openFile(filePath);
        } else {
          const ext = filePath.split('/').pop() || filePath;
          showToast(`Unsupported file type: ${ext} -- only .md and .markdown files are supported`);
        }
      }
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('drop', handleDrop);
    };
  }, [openFile, showToast, state.projectRoot, state.tabs.length]);

  return (
    <div className="app">
      <div className="app-drag-region" />
      <div className="app-body">
        <Sidebar
          projectRoot={state.projectRoot}
          mode={state.sidebarMode}
          onSetMode={(mode) => dispatch({ type: 'SET_SIDEBAR_MODE', mode })}
          onOpenFile={openFile}
          activeEditor={activeEditor}
        />
        <div className="main-area">
          <Toolbar editor={activeEditor} />
          <TabBar
            tabs={state.tabs}
            activeIndex={state.activeTabIndex}
            onSelect={(i) => dispatch({ type: 'SET_ACTIVE_TAB', index: i })}
            onClose={handleCloseTab}
          />
          <div className="editor-area">
            {activeTab?.conflict && (
              <ConflictBanner onReload={reloadActiveTab} onSaveAs={saveActiveTabAs} />
            )}
            {state.findBarOpen && activeEditor && (
              <FindBar
                editor={activeEditor}
                onClose={() => dispatch({ type: 'TOGGLE_FIND_BAR' })}
              />
            )}
            {state.tabs.map((tab, i) => (
              <div
                key={tab.id}
                className="editor-tab-pane"
                style={{ display: i === state.activeTabIndex ? 'flex' : 'none' }}
              >
                <Editor
                  tab={tab}
                  onReady={(editor) => registerEditor(tab.id, editor)}
                  onDestroy={() => unregisterEditor(tab.id)}
                  onDirtyChange={(dirty) =>
                    dispatch({ type: 'MARK_DIRTY', tabId: tab.id, dirty })
                  }
                />
              </div>
            ))}
            {state.tabs.length === 0 && (
              <div className="empty-state">
                <p>Open a file or drag a folder to get started</p>
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <div className="toast">{toast}</div>
      )}
    </div>
  );
}
