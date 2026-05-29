import React, { useReducer, useEffect, useCallback, useRef, useState } from 'react';
import { Tab } from '../types';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import Toolbar from './Toolbar';
import Editor, { foldKey, RESTORE_FOLDS, foldPosToLineNumbers, lineNumbersToFoldPositions } from './Editor';
import ConflictBanner from './ConflictBanner';
import FindBar from './FindBar';
import LinkBar from './LinkBar';
import QuickOpen from './QuickOpen';
import { Editor as TipTapEditor } from '@tiptap/react';
import { basename } from '../utils/paths';
import KEYBOARD_SHORTCUTS_CONTENT from '../../docs/help/keyboard_shortcuts.md';

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
  | { type: 'TOGGLE_FIND_BAR' }
  | { type: 'REORDER_TABS'; fromIndex: number; toIndex: number }
  | { type: 'PIN_TAB'; tabId: string };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_PROJECT_ROOT':
      return { ...state, projectRoot: action.root };

    case 'OPEN_TAB': {
      const existing = state.tabs.findIndex(t => t.filePath === action.tab.filePath);
      if (existing >= 0) {
        const tab = state.tabs[existing];
        if (tab.tentative && !action.tab.tentative) {
          return {
            ...state,
            tabs: state.tabs.map((t, i) => i === existing ? { ...t, tentative: false } : t),
            activeTabIndex: existing,
          };
        }
        return { ...state, activeTabIndex: existing };
      }
      if (action.tab.tentative) {
        const tentativeIndex = state.tabs.findIndex(t => t.tentative);
        if (tentativeIndex >= 0) {
          const tabs = state.tabs.map((t, i) => i === tentativeIndex ? action.tab : t);
          return { ...state, tabs, activeTabIndex: tentativeIndex };
        }
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
          t.id === action.tabId
            ? { ...t, dirty: action.dirty, tentative: action.dirty ? false : t.tentative }
            : t
        ),
      };

    case 'PIN_TAB':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId ? { ...t, tentative: false } : t
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

    case 'REORDER_TABS': {
      const tabs = [...state.tabs];
      const [moved] = tabs.splice(action.fromIndex, 1);
      tabs.splice(action.toIndex, 0, moved);
      const activeTab = state.tabs[state.activeTabIndex];
      const newActiveIndex = tabs.indexOf(activeTab);
      return { ...state, tabs, activeTabIndex: newActiveIndex };
    }

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
  return basename(filePath) || 'Untitled';
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const editorsRef = useRef<Map<string, TipTapEditor>>(new Map());
  const closedTabsRef = useRef<string[]>([]);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const [activeEditor, setActiveEditor] = useState<TipTapEditor | null>(null);
  const [theme, setTheme] = useState<string>('system');
  const [toast, setToast] = useState<{ msg: string; variant?: string; hiding?: boolean } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const dragCountRef = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [linkTrigger, setLinkTrigger] = useState(0);
  const [spellcheck, setSpellcheck] = useState(true);
  const [autosave, setAutosave] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [importConfirm, setImportConfirm] = useState<string | null>(null);
  const [linkBarVisible, setLinkBarVisible] = useState(false);

  const showToast = useCallback((msg: string, variant?: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, variant });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => prev ? { ...prev, hiding: true } : null);
      setTimeout(() => setToast(null), 200);
    }, 4000);
  }, []);

  const activeTab = state.tabs[state.activeTabIndex] || null;

  useEffect(() => {
    const editor = activeTab ? editorsRef.current.get(activeTab.id) || null : null;
    setActiveEditor(editor);
    if (editor) {
      editor.commands.focus();
      const tabId = activeTab?.id;
      requestAnimationFrame(() => {
        if (!tabId) return;
        const saved = scrollPositionsRef.current.get(tabId);
        if (saved !== undefined) {
          const el = editor.view.dom.closest('.editor-content');
          if (el) el.scrollTop = saved;
        }
      });
    }
  }, [activeTab?.id]);

  const openFile = useCallback(async (filePath: string, tentative = false) => {
    const existing = state.tabs.find(t => t.filePath === filePath);
    if (existing) {
      if (!tentative && existing.tentative) {
        dispatch({ type: 'PIN_TAB', tabId: existing.id });
      }
      const idx = state.tabs.indexOf(existing);
      dispatch({ type: 'SET_ACTIVE_TAB', index: idx });
      return;
    }

    if (tentative) {
      const oldTentative = state.tabs.find(t => t.tentative);
      if (oldTentative && oldTentative.filePath) {
        window.mde.unwatchFile(oldTentative.filePath);
        editorsRef.current.delete(oldTentative.id);
      }
    }

    const stats = await window.mde.getFileStats(filePath);
    const tab: Tab = {
      id: nextTabId(),
      filePath,
      fileName: fileNameFromPath(filePath),
      dirty: false,
      diskMtime: stats?.mtimeMs ?? null,
      conflict: false,
      tentative,
    };
    dispatch({ type: 'OPEN_TAB', tab });
    window.mde.watchFile(filePath);
  }, [state.tabs]);

  const openKeyboardShortcuts = useCallback(() => {
    const existing = state.tabs.find(t => t.id === 'keyboard-shortcuts');
    if (existing) {
      const idx = state.tabs.indexOf(existing);
      dispatch({ type: 'SET_ACTIVE_TAB', index: idx });
      return;
    }
    const tab: Tab = {
      id: 'keyboard-shortcuts',
      filePath: null,
      fileName: 'Keyboard Shortcuts',
      dirty: false,
      diskMtime: null,
      conflict: false,
      tentative: false,
      readOnly: true,
      // The shortcuts doc is written with macOS key names; map Cmd -> Ctrl for Windows/Linux.
      initialContent: window.mde.platform === 'darwin'
        ? KEYBOARD_SHORTCUTS_CONTENT
        : KEYBOARD_SHORTCUTS_CONTENT.replace(/\bCmd\b/g, 'Ctrl'),
    };
    dispatch({ type: 'OPEN_TAB', tab });
  }, [state.tabs]);

  const handleImportFile = useCallback((filePath: string) => {
    setImportConfirm(filePath);
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importConfirm) return;
    setImportConfirm(null);
    const result = await window.mde.convertImport(importConfirm);
    if ('error' in result) {
      showToast(result.error, 'danger');
    } else {
      showToast('Converted to Markdown. Original saved as backup.');
      openFile(result.mdPath);
    }
  }, [importConfirm, openFile, showToast]);

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

    if (activeTab.filePath) {
      window.mde.unwatchFile(activeTab.filePath);
    }
    const mtime = await window.mde.writeFile(filePath, markdown);

    if (activeTab.filePath !== filePath) {
      dispatch({
        type: 'UPDATE_TAB_PATH',
        tabId: activeTab.id,
        filePath,
        fileName: fileNameFromPath(filePath),
        mtime,
      });
    } else {
      dispatch({ type: 'UPDATE_TAB_MTIME', tabId: activeTab.id, mtime });
    }
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    window.mde.watchFile(filePath);
  }, [activeTab, activeEditor]);

  const triggerAutosave = useCallback(() => {
    if (!autosave) return;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      saveActiveTab();
    }, 1000);
  }, [autosave, saveActiveTab]);

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

    // Save fold state before reload (line numbers, not positions)
    const { collapsed } = foldKey.getState(activeEditor.state);
    const savedFoldLines = foldPosToLineNumbers(activeEditor, collapsed);

    const content = await window.mde.readFile(activeTab.filePath);
    const stats = await window.mde.getFileStats(activeTab.filePath);
    const { Markdown } = await import('../utils/markdown');
    Markdown.deserializeInto(activeEditor, content);

    // Restore fold state after reload
    if (savedFoldLines.length) {
      const positions = lineNumbersToFoldPositions(activeEditor.state.doc, content, savedFoldLines);
      if (positions.length) {
        const tr = activeEditor.state.tr;
        tr.setMeta(RESTORE_FOLDS, positions);
        tr.setMeta('addToHistory', false);
        activeEditor.view.dispatch(tr);
      }
    }

    dispatch({ type: 'UPDATE_TAB_MTIME', tabId: activeTab.id, mtime: stats?.mtimeMs ?? null });
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    dispatch({ type: 'MARK_CONFLICT', tabId: activeTab.id, conflict: false });
  }, [activeTab, activeEditor]);

  const scrollListenersRef = useRef<Map<string, () => void>>(new Map());

  const registerEditor = useCallback((tabId: string, editor: TipTapEditor) => {
    editorsRef.current.set(tabId, editor);
    if (activeTab && tabId === activeTab.id) {
      setActiveEditor(editor);
    }
    requestAnimationFrame(() => {
      const el = editor.view.dom.closest('.editor-content');
      if (el) {
        // Fires on every scroll pixel, but only writes to a Map ref -- no state
        // update, no re-render, just a number assignment. Safe without debounce.
        const handler = () => { scrollPositionsRef.current.set(tabId, el.scrollTop); };
        el.addEventListener('scroll', handler);
        scrollListenersRef.current.set(tabId, () => el.removeEventListener('scroll', handler));
      }
    });
  }, [activeTab]);

  const unregisterEditor = useCallback((tabId: string) => {
    editorsRef.current.delete(tabId);
    scrollPositionsRef.current.delete(tabId);
    const cleanup = scrollListenersRef.current.get(tabId);
    if (cleanup) { cleanup(); scrollListenersRef.current.delete(tabId); }
    if (activeTab && tabId === activeTab.id) {
      setActiveEditor(null);
    }
  }, [activeTab]);

  const handleDeleteFile = useCallback((filePath: string) => {
    const tabIndex = state.tabs.findIndex(t => t.filePath === filePath);
    if (tabIndex < 0) return;
    const tab = state.tabs[tabIndex];
    if (tab.filePath) window.mde.unwatchFile(tab.filePath);
    unregisterEditor(tab.id);
    dispatch({ type: 'CLOSE_TAB', index: tabIndex });
  }, [state.tabs, unregisterEditor]);

  const handleCloseTab = useCallback((index: number) => {
    const tab = state.tabs[index];
    if (!tab) return;
    if (tab.dirty || tab.conflict) {
      const msg = tab.conflict
        ? `"${tab.fileName}" has a conflict with the version on disk. Close anyway and lose your changes?`
        : `"${tab.fileName}" has unsaved changes. Close anyway and lose them?`;
      if (!window.confirm(msg)) return;
    }
    if (tab.filePath) {
      closedTabsRef.current.push(tab.filePath);
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
      window.mde.onReopenClosedTab(() => {
        const filePath = closedTabsRef.current.pop();
        if (filePath) openFile(filePath);
      }),
      window.mde.onPrevTab(() => {
        if (state.tabs.length > 1) {
          const prev = (state.activeTabIndex - 1 + state.tabs.length) % state.tabs.length;
          dispatch({ type: 'SET_ACTIVE_TAB', index: prev });
        }
      }),
      window.mde.onNextTab(() => {
        if (state.tabs.length > 1) {
          const next = (state.activeTabIndex + 1) % state.tabs.length;
          dispatch({ type: 'SET_ACTIVE_TAB', index: next });
        }
      }),
      window.mde.onSaveFile(saveActiveTab),
      window.mde.onSaveFileAs(saveActiveTabAs),
      window.mde.onToggleFind(() => dispatch({ type: 'TOGGLE_FIND_BAR' })),
      window.mde.onExportPDF(async () => {
        await window.mde.exportPDF();
      }),
      window.mde.onOpenSettings(() => setSettingsOpen(true)),
      window.mde.onQuickOpen(() => setQuickOpenVisible(true)),
      window.mde.onToggleCodeBlock(() => {
        const ed = editorsRef.current.get(state.tabs[state.activeTabIndex]?.id);
        if (ed) ed.chain().focus().toggleCodeBlock().run();
      }),
      window.mde.onShowKeyboardShortcuts(openKeyboardShortcuts),
      window.mde.onInsertLink(() => {
        const ed = editorsRef.current.get(state.tabs[state.activeTabIndex]?.id);
        if (ed && (ed.isActive('link') || !ed.state.selection.empty)) {
          setLinkBarVisible(true);
        } else {
          showToast('Select some text first.', 'danger');
        }
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
              // Save fold state before silent reload
              const { collapsed } = foldKey.getState(editor.state);
              const savedFoldLines = foldPosToLineNumbers(editor, collapsed);

              const content = await window.mde.readFile(filePath);
              const { Markdown } = await import('../utils/markdown');
              Markdown.deserializeInto(editor, content);

              // Restore fold state after silent reload
              if (savedFoldLines.length) {
                const positions = lineNumbersToFoldPositions(editor.state.doc, content, savedFoldLines);
                if (positions.length) {
                  const tr = editor.state.tr;
                  tr.setMeta(RESTORE_FOLDS, positions);
                  tr.setMeta('addToHistory', false);
                  editor.view.dispatch(tr);
                }
              }
            }
            dispatch({ type: 'UPDATE_TAB_MTIME', tabId: tab.id, mtime: stats.mtimeMs });
          }
        }
      }),
    ];

    return () => cleanups.forEach(fn => fn());
  }, [openFile, saveActiveTab, saveActiveTabAs, handleCloseTab, openKeyboardShortcuts, state.tabs, state.activeTabIndex]);

  useEffect(() => {
    window.mde.getProjectRoot().then(root => {
      if (root) dispatch({ type: 'SET_PROJECT_ROOT', root });
    });
    window.mde.getTheme().then(applyTheme);
    window.mde.getSpellcheck().then(setSpellcheck);
    window.mde.getAutosave().then(setAutosave);
    const cleanupTheme = window.mde.onThemeChanged(applyTheme);
    const cleanupSpell = window.mde.onSpellcheckChanged(setSpellcheck);
    const cleanupAutosave = window.mde.onAutosaveChanged(setAutosave);
    const cleanupProjectFiles = window.mde.onProjectFilesChanged(() => setSidebarRefreshKey(n => n + 1));
    return () => { cleanupTheme(); cleanupSpell(); cleanupAutosave(); cleanupProjectFiles(); };
  }, []);

  function applyTheme(t: string) {
    setTheme(t);
    if (t === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', t);
    }
  }

  useEffect(() => {
    if (state.projectRoot) {
      window.mde.saveLastProjectRoot(state.projectRoot);
      window.mde.watchProject(state.projectRoot);
    }
    return () => {
      if (state.projectRoot) window.mde.unwatchProject(state.projectRoot);
    };
  }, [state.projectRoot]);

  useEffect(() => {
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCountRef.current++;
      if (dragCountRef.current === 1) setDraggingOver(true);
    };
    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      if (!e.dataTransfer?.types.includes('Files')) return;
      dragCountRef.current--;
      if (dragCountRef.current === 0) setDraggingOver(false);
    };
    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCountRef.current = 0;
      setDraggingOver(false);
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
        if (/\.(md|markdown|txt)$/i.test(filePath)) {
          openFile(filePath);
        } else if (/\.(docx|pdf)$/i.test(filePath)) {
          handleImportFile(filePath);
        } else {
          const ext = basename(filePath) || filePath;
          showToast(`Unsupported file type: ${ext}`, 'danger');
        }
      }
    };
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragenter', handleDragEnter);
    document.addEventListener('dragleave', handleDragLeave);
    document.addEventListener('drop', handleDrop);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragenter', handleDragEnter);
      document.removeEventListener('dragleave', handleDragLeave);
      document.removeEventListener('drop', handleDrop);
    };
  }, [openFile, showToast, state.projectRoot, state.tabs.length]);

  return (
    <div className="app">
      <div className="app-drag-region">
        {state.projectRoot && (
          <span className="app-title">
            {(basename(state.projectRoot) || '').split('').map((ch, i) => (
              <span key={i} className="app-title-letter" style={{ animationDelay: `${i * 6}s` }}>
                {ch}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="app-body">
        <Sidebar
          projectRoot={state.projectRoot}
          mode={state.sidebarMode}
          onSetMode={(mode) => dispatch({ type: 'SET_SIDEBAR_MODE', mode })}
          onOpenFile={openFile}
          onImportFile={handleImportFile}
          activeEditor={activeEditor}
          activeFilePath={activeTab?.filePath || null}
          refreshKey={sidebarRefreshKey}
          onToast={showToast}
          onDeleteFile={handleDeleteFile}
        />
        <div className="main-area">
          <TabBar
            tabs={state.tabs}
            activeIndex={state.activeTabIndex}
            onSelect={(i) => dispatch({ type: 'SET_ACTIVE_TAB', index: i })}
            onClose={handleCloseTab}
            onReorder={(from, to) => dispatch({ type: 'REORDER_TABS', fromIndex: from, toIndex: to })}
            onPinTab={(tabId) => dispatch({ type: 'PIN_TAB', tabId })}
          />
          {!activeTab?.readOnly && (
            <Toolbar editor={activeEditor} linkTrigger={linkTrigger} onToast={showToast} onLinkEdit={() => setLinkBarVisible(true)} />
          )}
          {state.findBarOpen && activeEditor && (
            <FindBar
              editor={activeEditor}
              onClose={() => dispatch({ type: 'TOGGLE_FIND_BAR' })}
            />
          )}
          <div className="editor-area">
            {activeTab?.conflict && (
              <ConflictBanner onReload={reloadActiveTab} onSaveAs={saveActiveTabAs} />
            )}
            {linkBarVisible && activeEditor && (
              <LinkBar
                editor={activeEditor}
                onClose={() => setLinkBarVisible(false)}
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
                  onDirtyChange={(dirty) => {
                    dispatch({ type: 'MARK_DIRTY', tabId: tab.id, dirty });
                    if (dirty) triggerAutosave();
                  }}
                />
              </div>
            ))}
            {state.tabs.length === 0 && (
              <div className="empty-state">
                <p>Open a file or drag a folder to get started</p>
                <p className="fs-sm">or press <kbd>Cmd + O</kbd> to quick-search</p>
                <p className="fs-sm">
                  <a className="empty-state-link" onClick={openKeyboardShortcuts}>Keyboard Shortcuts</a>
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {draggingOver && <div className="drop-overlay">Drop to open</div>}
      {quickOpenVisible && state.projectRoot && (
        <QuickOpen
          projectRoot={state.projectRoot}
          onSelect={(filePath) => { setQuickOpenVisible(false); openFile(filePath); }}
          onClose={() => setQuickOpenVisible(false)}
        />
      )}
      {importConfirm && (
        <ImportConfirmDialog
          filePath={importConfirm}
          onConfirm={confirmImport}
          onCancel={() => setImportConfirm(null)}
        />
      )}
      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} theme={theme} spellcheck={spellcheck} autosave={autosave} />}
      {toast && (
        <div className={`toast ${toast.variant ? `toast-${toast.variant}` : ''} ${toast.hiding ? 'toast-out' : ''}`}>{toast.msg}</div>
      )}
    </div>
  );
}

function SettingsDialog({ onClose, theme, spellcheck, autosave }: { onClose: () => void; theme: string; spellcheck: boolean; autosave: boolean }) {
  const [status, setStatus] = useState<'checking' | 'idle' | 'installed' | 'installing' | 'done' | 'error'>('checking');
  const [errorMsg, setErrorMsg] = useState('');
  const [installNote, setInstallNote] = useState('');

  useEffect(() => {
    window.mde.checkTerminalLauncher().then(exists => {
      setStatus(exists ? 'installed' : 'idle');
    });
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const install = async () => {
    setStatus('installing');
    const result = await window.mde.installTerminalLauncher();
    if (result.success) {
      setStatus('done');
      if (result.note) setInstallNote(result.note);
    } else {
      setStatus('error');
      setErrorMsg(result.error || 'Unknown error');
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">Settings</span>
          <button className="toolbar-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="settings-row">
            <div>
              <div className="fw-bold">Theme</div>
              <div className="text-muted fs-sm">Choose light, dark, or match your system.</div>
            </div>
            <select
              className="settings-select"
              value={theme}
              onChange={(e) => window.mde.setTheme(e.target.value)}
            >
              <option value="system">System default</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="settings-separator" />
          <div className="settings-row">
            <div>
              <div className="fw-bold">Spell check</div>
              <div className="text-muted fs-sm">Show spelling errors with a red underline.</div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={spellcheck}
                onChange={(e) => window.mde.setSpellcheck(e.target.checked)}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>
          <div className="settings-separator" />
          <div className="settings-row">
            <div>
              <div className="fw-bold">Auto-save</div>
              <div className="text-muted fs-sm">Automatically save files after 1 second of inactivity.</div>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={autosave}
                onChange={(e) => window.mde.setAutosave(e.target.checked)}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>
          <div className="settings-separator" />
          <div className="settings-row">
            <div>
              <div className="fw-bold">Terminal launcher</div>
              <div className="text-muted fs-sm">
                Install the <code>mde</code> command so you can open folders from your terminal.
              </div>
            </div>
            <button
              className="settings-btn"
              onClick={install}
              disabled={status === 'checking' || status === 'installing' || status === 'done'}
            >
              {status === 'checking' && '...'}
              {status === 'idle' && 'Install terminal launcher'}
              {status === 'installed' && 'Reinstall terminal launcher'}
              {status === 'installing' && 'Installing...'}
              {status === 'done' && 'Installed'}
              {status === 'error' && 'Retry'}
            </button>
          </div>
          {(status === 'installed' || status === 'done') && (
            <div className="settings-success">
              {status === 'done' ? 'Installed.' : 'Already installed.'} Run <code>mde .</code> from any directory to open it.
              {installNote && <> {installNote}</>}
            </div>
          )}
          {status === 'error' && (
            <div className="settings-error">{errorMsg}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function ImportConfirmDialog({ filePath, onConfirm, onCancel }: { filePath: string; onConfirm: () => void; onCancel: () => void }) {
  const fileName = basename(filePath) || filePath;
  const ext = fileName.split('.').pop()?.toUpperCase() || '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onConfirm, onCancel]);

  const backupName = fileName.replace(/(\.[^.]+)$/, '.bak$1');

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ justifyContent: 'center' }}>
          <span className="fw-bold">Convert {ext} to Markdown</span>
        </div>
        <div className="modal-body">
          <p className="text-muted fs-sm">
            This will convert <code>{fileName}</code> to Markdown for editing.
            The original will be kept as a backup (<code>{backupName}</code>).
            Some formatting may be simplified.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn" onClick={onCancel}>Cancel</button>
            <button className="settings-btn btn-primary" onClick={onConfirm}>Convert &amp; Open</button>
          </div>
        </div>
      </div>
    </div>
  );
}
