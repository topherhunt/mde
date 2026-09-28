import React, { useReducer, useEffect, useCallback, useRef, useState, useMemo } from 'react';
import { Tab, SidebarMode, HistoryTarget } from '../types';
import Sidebar from './Sidebar';
import TabBar from './TabBar';
import Toolbar from './Toolbar';
import Editor, { getFoldedPositions, applyFoldPositions, foldPosToLineNumbers, lineNumbersToFoldPositions } from './Editor';
import ConflictBanner from './ConflictBanner';
import FindBar from './FindBar';
import LinkBar from './LinkBar';
import QuickOpen from './QuickOpen';
import { useVersionControl, VersionControl, CheckpointSettings } from './VersionPanel';
import HistoryView, { HistoryNavRequest } from './HistoryView';
import { DeleteConfirmDialog } from './FileContextMenu';
import ImageWarningDialog from './ImageWarningDialog';
import { Editor as TipTapEditor } from '@tiptap/react';
import { FileEntry } from '../types';
import { basename, dirname, joinPath, resolvePath } from '../utils/paths';
import KEYBOARD_SHORTCUTS_CONTENT from '../../docs/help/keyboard_shortcuts.md';

interface AppState {
  tabs: Tab[];
  activeTabIndex: number;
  sidebarMode: SidebarMode;
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
  | { type: 'UPDATE_TAB_PATH'; tabId: string; filePath: string; fileName: string; mtime: number | null; hash: string | null }
  | { type: 'UPDATE_TAB_MTIME'; tabId: string; mtime: number | null; hash: string | null }
  | { type: 'SET_SIDEBAR_MODE'; mode: SidebarMode }
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
      // Removing a tab to the left shifts the active one down a slot.
      if (action.index < activeTabIndex) activeTabIndex--;
      if (activeTabIndex >= tabs.length) activeTabIndex = tabs.length - 1;
      if (activeTabIndex < 0) activeTabIndex = 0;
      return { ...state, tabs, activeTabIndex };
    }

    case 'SET_ACTIVE_TAB':
      return { ...state, activeTabIndex: action.index };

    case 'MARK_DIRTY': {
      // Fired from the editor's onUpdate, i.e. on EVERY document change. Return the
      // existing state untouched when nothing actually changes, so a keystroke in an
      // already-dirty buffer doesn't re-render the whole app (and, with it, every
      // Editor) for no reason.
      const target = state.tabs.find(t => t.id === action.tabId);
      if (!target) return state;
      const tentative = action.dirty ? false : target.tentative;
      if (target.dirty === action.dirty && target.tentative === tentative) return state;
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId
            ? { ...t, dirty: action.dirty, tentative }
            : t
        ),
      };
    }

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
            ? { ...t, filePath: action.filePath, fileName: action.fileName, diskMtime: action.mtime, diskHash: action.hash }
            : t
        ),
      };

    case 'UPDATE_TAB_MTIME':
      return {
        ...state,
        tabs: state.tabs.map(t =>
          t.id === action.tabId ? { ...t, diskMtime: action.mtime, diskHash: action.hash } : t
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

const CHECKPOINT_HISTORY_TAB_ID = 'checkpoint-history';

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
  const suppressEditorFocusRef = useRef(false);
  const findBarOpenRef = useRef(false);
  const [activeEditor, setActiveEditor] = useState<TipTapEditor | null>(null);
  const [theme, setTheme] = useState<string>('system');
  const [toast, setToast] = useState<{ msg: string; variant?: string; hiding?: boolean } | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const dragCountRef = useRef(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [wordCountOpen, setWordCountOpen] = useState(false);
  const [quickOpenVisible, setQuickOpenVisible] = useState(false);
  const [linkTrigger, setLinkTrigger] = useState(0);
  const [spellcheck, setSpellcheck] = useState(true);
  const [autosave, setAutosave] = useState(false);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [importConfirm, setImportConfirm] = useState<string | null>(null);
  const [importExisting, setImportExisting] = useState<{ filePath: string; mdPath: string } | null>(null);
  const [linkCreateTarget, setLinkCreateTarget] = useState<string | null>(null);
  const [linkBarVisible, setLinkBarVisible] = useState(false);
  const initialSidebarModeSetRef = useRef(false);
  const [tabRenameTarget, setTabRenameTarget] = useState<FileEntry | null>(null);
  const [tabDeleteTarget, setTabDeleteTarget] = useState<FileEntry | null>(null);
  const [appError, setAppError] = useState<string | null>(null);
  const [findFocusTrigger, setFindFocusTrigger] = useState(0);
  // Blue "detected changes" banner shown after a silent auto-reload. `hiding` drives fade-out.
  const [reloadNotice, setReloadNotice] = useState<{ fileName: string; hiding?: boolean } | null>(null);
  // A file just loaded that contains images the editor cannot hold, so saving it would strip
  // them. One at a time, last one wins: opening two such files at once is rare, and the warning
  // is per-file identical in substance -- a queue would be machinery for no gain.
  const [imageWarning, setImageWarning] =
    useState<{ fileName: string; refs: string[] } | null>(null);
  const reloadTimersRef = useRef<{ hide?: ReturnType<typeof setTimeout>; remove?: ReturnType<typeof setTimeout> }>({});
  const showReloadNotice = useCallback((fileName: string) => {
    const timers = reloadTimersRef.current;
    if (timers.hide) clearTimeout(timers.hide);
    if (timers.remove) clearTimeout(timers.remove);
    setReloadNotice({ fileName });
    timers.hide = setTimeout(() => {
      setReloadNotice(prev => (prev ? { ...prev, hiding: true } : null));
      timers.remove = setTimeout(() => setReloadNotice(null), 300); // matches fade-out duration
    }, 5000);
  }, []);

  const showToast = useCallback((msg: string, variant?: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ msg, variant });
    toastTimerRef.current = setTimeout(() => {
      setToast(prev => prev ? { ...prev, hiding: true } : null);
      setTimeout(() => setToast(null), 200);
    }, 4000);
  }, []);

  const activeTab = state.tabs[state.activeTabIndex] || null;

  // Lives here rather than inside the panel so the sidebar tab badge stays live whether or
  // not the Checkpoints tab is the one on screen.
  const vc = useVersionControl(state.projectRoot);

  // Where the checkpoint history tab should point. Owned here because every entry point into
  // that tab is outside it: the sidebar's Browse button, a checkpoint row, a right-click.
  const [historyNav, setHistoryNav] = useState<HistoryNavRequest | null>(null);

  // The hash we last read from / wrote to each path, recorded SYNCHRONOUSLY. `tab.diskHash`
  // holds the same value, but it only becomes visible once React commits the dispatch --
  // and a callback created before that commit (a queued autosave, an in-flight
  // `file-changed` event) would otherwise quote a pre-save hash and get its own write
  // refused as a "conflict" with a file only we ever touched.
  const diskHashRef = useRef(new Map<string, string | null>());
  const recordDiskHash = useCallback((filePath: string, hash: string | null) => {
    diskHashRef.current.set(filePath, hash);
  }, []);
  const knownDiskHash = useCallback((filePath: string, fallback: string | null) => (
    diskHashRef.current.has(filePath) ? diskHashRef.current.get(filePath)! : fallback
  ), []);

  // Latest tab list, readable from callbacks that were created in an earlier render.
  const tabsRef = useRef(state.tabs);
  tabsRef.current = state.tabs;
  // An Editor calls the onDestroy it captured at mount, when ITS tab was active. Checking
  // that stale activeTab let closing a background tab null out the active tab's editor.
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTab?.id ?? null;
  // Only one write per buffer may be in flight; a second would quote the first's
  // pre-write hash.
  const savingRef = useRef(false);
  // Lets saveActiveTab re-arm autosave without depending on triggerAutosave (which is
  // defined below it, in terms of it).
  const triggerAutosaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    const editor = activeTab ? editorsRef.current.get(activeTab.id) || null : null;
    setActiveEditor(editor);
    if (editor && !suppressEditorFocusRef.current) {
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
    suppressEditorFocusRef.current = false;
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

    const [stats, diskHash] = await Promise.all([
      window.mde.getFileStats(filePath),
      window.mde.hashFile(filePath),
    ]);
    const tab: Tab = {
      id: nextTabId(),
      filePath,
      fileName: fileNameFromPath(filePath),
      dirty: false,
      diskMtime: stats?.mtimeMs ?? null,
      diskHash,
      conflict: false,
      tentative,
    };
    recordDiskHash(filePath, diskHash);
    dispatch({ type: 'OPEN_TAB', tab });
    window.mde.watchFile(filePath);
  }, [state.tabs]);

  // Cmd/Ctrl+click on a link in the editor. External URLs open in the browser;
  // relative paths resolve against the source file's folder (or the project root
  // for unsaved buffers) and open in a tab. A missing target prompts to create it.
  const handleLinkClick = useCallback(async (href: string, sourceFilePath: string | null) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      window.mde.openExternal(href);
      return;
    }
    // Drop any in-page anchor / query so "doc.md#section" resolves to the file.
    const filePart = href.replace(/[#?].*$/, '');
    if (!filePart) return; // pure anchor like "#section" -- nothing to open
    // Relative links resolve against the source file's folder (CommonMark / GitHub /
    // VS Code semantics), regardless of any ./ or ../ prefix. For an unsaved buffer
    // with no folder, fall back to the project root.
    const baseDir = sourceFilePath ? dirname(sourceFilePath) : state.projectRoot;
    if (!baseDir) {
      showToast('Save this file before following relative links.', 'danger');
      return;
    }
    const resolved = resolvePath(baseDir, filePart);
    const stats = await window.mde.getFileStats(resolved);
    if (stats?.isDirectory) {
      showToast('That link points to a folder, not a file.', 'danger');
    } else if (stats) {
      openFile(resolved);
    } else {
      setLinkCreateTarget(resolved);
    }
  }, [openFile, showToast, state.projectRoot]);

  const confirmCreateLink = useCallback(async () => {
    if (!linkCreateTarget) return;
    const target = linkCreateTarget;
    setLinkCreateTarget(null);
    try {
      await window.mde.createDirectory(dirname(target));
      await window.mde.createFile(target);
      openFile(target);
    } catch {
      showToast('Could not create the file.', 'danger');
    }
  }, [linkCreateTarget, openFile, showToast]);

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
      diskHash: null,
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

  // Checkpoint history opens as an ordinary read-only tab. Deliberately not an app-wide mode:
  // open documents keep their buffers, their dirty flags, and their watchers while you browse.
  //
  // Every entry point routes through here with a target, so the tab is always pointed at what
  // was clicked -- including when it is ALREADY open on a diff three levels down. The nonce is
  // what makes that work: the same target twice must still navigate, and an unchanged prop
  // fires no effect in the view.
  const openCheckpointHistory = useCallback((target: HistoryTarget) => {
    setHistoryNav(prev => ({ target, nonce: (prev?.nonce ?? 0) + 1 }));
    const existing = state.tabs.find(t => t.id === CHECKPOINT_HISTORY_TAB_ID);
    if (existing) {
      dispatch({ type: 'SET_ACTIVE_TAB', index: state.tabs.indexOf(existing) });
      return;
    }
    dispatch({
      type: 'OPEN_TAB',
      tab: {
        id: CHECKPOINT_HISTORY_TAB_ID,
        filePath: null,
        fileName: 'Checkpoint History',
        dirty: false,
        diskMtime: null,
        diskHash: null,
        conflict: false,
        tentative: false,
        readOnly: true,
        view: 'history',
      },
    });
  }, [state.tabs]);

  // Right-click -> "View change history", from the file explorer or a tab. Both hand back a
  // repo-relative path (the context menu computes it), which is what checkpoints are keyed by.
  // Undefined -- not a no-op -- when there are no checkpoints, so the menu hides the item.
  const viewFileHistory = vc.state.attach === 'none'
    ? undefined
    : (relativePath: string) => openCheckpointHistory({ kind: 'file', path: relativePath });

  // Clicking a .docx/.pdf: if it has already been converted, the useful offer is to
  // open that Markdown -- not to convert again. Only a source with no Markdown beside
  // it gets the conversion prompt. The source file itself is never renamed or hidden.
  const handleImportFile = useCallback(async (filePath: string) => {
    const { mdPath, exists } = await window.mde.getImportTarget(filePath);
    if (exists) {
      setImportExisting({ filePath, mdPath });
    } else {
      setImportConfirm(filePath);
    }
  }, []);

  const runConvert = useCallback(async (filePath: string, opts?: { newCopy?: boolean }) => {
    const result = await window.mde.convertImport(filePath, opts);
    if ('error' in result) {
      showToast(result.error, 'danger');
    } else {
      showToast(`Converted to ${basename(result.mdPath)}.`);
      openFile(result.mdPath);
    }
  }, [openFile, showToast]);

  const confirmImport = useCallback(async () => {
    if (!importConfirm) return;
    const filePath = importConfirm;
    setImportConfirm(null);
    await runConvert(filePath);
  }, [importConfirm, runConvert]);

  const reconvertImport = useCallback(async () => {
    if (!importExisting) return;
    const { filePath } = importExisting;
    setImportExisting(null);
    await runConvert(filePath, { newCopy: true });
  }, [importExisting, runConvert]);

  const saveActiveTab = useCallback(async () => {
    if (!activeTab || activeTab.view === 'history') return;
    // Never return silently: a buffer that cannot save must say so. The throw reaches the
    // red error banner via the unhandledrejection listener.
    if (!activeEditor) throw new Error(`Save failed: "${activeTab.fileName}" has no connected editor. Copy your text somewhere safe, then close and reopen the file.`);
    if (activeTab.conflict) return;
    if (savingRef.current) return;

    // A queued autosave would fire mid-write with this save's pre-write hash.
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }

    let filePath = activeTab.filePath;
    if (!filePath) {
      filePath = await window.mde.showSaveDialog();
      if (!filePath) return;
    }

    const { Markdown } = await import('../utils/markdown');
    const markdown = Markdown.serialize(activeEditor);
    // What we are about to put on disk. Anything typed after this point is NOT in it.
    const docAtWrite = activeEditor.state.doc;

    // DATA-SAFETY GUARD (do not bypass): overwrite only if the file still hashes to what we
    // last synced; else writeFileIfUnchanged refuses and we show the conflict banner. null = new path.
    const isSamePath = activeTab.filePath === filePath;
    const expectedHash = isSamePath ? knownDiskHash(filePath, activeTab.diskHash) : null;

    if (activeTab.filePath) {
      window.mde.unwatchFile(activeTab.filePath);
    }
    savingRef.current = true;
    let result;
    try {
      result = await window.mde.writeFileIfUnchanged(filePath, markdown, expectedHash);
    } finally {
      savingRef.current = false;
    }

    if (result.conflict) {
      // Re-watch the file we refused to overwrite so we keep tracking it.
      window.mde.watchFile(filePath);
      // Deliberately do NOT adopt the on-disk hash here: it belongs to a version the user
      // has not seen, and treating it as our baseline would let the next save clobber it.
      dispatch({ type: 'MARK_CONFLICT', tabId: activeTab.id, conflict: true });
      return;
    }

    recordDiskHash(filePath, result.hash);
    if (!isSamePath) {
      dispatch({
        type: 'UPDATE_TAB_PATH',
        tabId: activeTab.id,
        filePath,
        fileName: fileNameFromPath(filePath),
        mtime: result.mtimeMs,
        hash: result.hash,
      });
    } else {
      dispatch({ type: 'UPDATE_TAB_MTIME', tabId: activeTab.id, mtime: result.mtimeMs, hash: result.hash });
    }
    // Edits made while the write was in flight are not in the file -- keeping the tab
    // clean would silently drop them (the editor re-baselines its clean snapshot on the
    // dirty->clean edge). Leave it dirty and re-arm autosave for the remainder.
    if (activeEditor.state.doc === docAtWrite) {
      dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    } else {
      triggerAutosaveRef.current();
    }
    window.mde.watchFile(filePath);
  }, [activeTab, activeEditor, knownDiskHash, recordDiskHash]);

  const triggerAutosave = useCallback(() => {
    if (!autosave) return;
    const tabId = activeTab?.id;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null;
      // Cmd+S during the debounce already flushed this buffer; saving again would quote
      // the hash from before that save and be refused as a conflict with our own write.
      const tab = tabsRef.current.find(t => t.id === tabId);
      if (!tab || !tab.dirty || tab.conflict) return;
      saveActiveTab();
    }, 1000);
  }, [autosave, saveActiveTab, activeTab?.id]);
  triggerAutosaveRef.current = triggerAutosave;

  const saveActiveTabAs = useCallback(async () => {
    if (!activeTab || !activeEditor) return;

    const filePath = await window.mde.showSaveDialog(activeTab.filePath || undefined);
    if (!filePath) return;

    const { Markdown } = await import('../utils/markdown');
    const markdown = Markdown.serialize(activeEditor);
    // Save As writes to a user-chosen path (possibly overwriting a different file on
    // purpose), so we force the write and adopt the new file's hash as our baseline.
    const result = await window.mde.writeFileIfUnchanged(filePath, markdown, null);
    recordDiskHash(filePath, result.hash);

    dispatch({
      type: 'UPDATE_TAB_PATH',
      tabId: activeTab.id,
      filePath,
      fileName: fileNameFromPath(filePath),
      mtime: result.mtimeMs,
      hash: result.hash,
    });
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    dispatch({ type: 'MARK_CONFLICT', tabId: activeTab.id, conflict: false });
    window.mde.watchFile(filePath);
  }, [activeTab, activeEditor]);

  const reloadActiveTab = useCallback(async () => {
    if (!activeTab || !activeEditor || !activeTab.filePath) return;

    // Save fold state before reload (line numbers, not positions)
    const savedFoldLines = foldPosToLineNumbers(activeEditor, getFoldedPositions(activeEditor));

    const content = await window.mde.readFile(activeTab.filePath);
    const [stats, diskHash] = await Promise.all([
      window.mde.getFileStats(activeTab.filePath),
      window.mde.hashFile(activeTab.filePath),
    ]);
    const { Markdown } = await import('../utils/markdown');
    Markdown.deserializeInto(activeEditor, content);

    // Restore fold state after reload
    if (savedFoldLines.length) {
      applyFoldPositions(activeEditor, lineNumbersToFoldPositions(activeEditor.state.doc, content, savedFoldLines));
    }

    recordDiskHash(activeTab.filePath, diskHash);
    dispatch({ type: 'UPDATE_TAB_MTIME', tabId: activeTab.id, mtime: stats?.mtimeMs ?? null, hash: diskHash });
    dispatch({ type: 'MARK_DIRTY', tabId: activeTab.id, dirty: false });
    dispatch({ type: 'MARK_CONFLICT', tabId: activeTab.id, conflict: false });
  }, [activeTab, activeEditor]);

  const scrollListenersRef = useRef<Map<string, () => void>>(new Map());

  const registerEditor = useCallback((tabId: string, editor: TipTapEditor) => {
    editorsRef.current.set(tabId, editor);
    if (tabId === activeTabIdRef.current) {
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
  }, []);

  const unregisterEditor = useCallback((tabId: string) => {
    editorsRef.current.delete(tabId);
    scrollPositionsRef.current.delete(tabId);
    const cleanup = scrollListenersRef.current.get(tabId);
    if (cleanup) { cleanup(); scrollListenersRef.current.delete(tabId); }
    if (tabId === activeTabIdRef.current) {
      setActiveEditor(null);
    }
  }, []);

  const handleDeleteFile = useCallback((filePath: string) => {
    const tabIndex = state.tabs.findIndex(t => t.filePath === filePath);
    if (tabIndex < 0) return;
    const tab = state.tabs[tabIndex];
    if (tab.filePath) window.mde.unwatchFile(tab.filePath);
    unregisterEditor(tab.id);
    dispatch({ type: 'CLOSE_TAB', index: tabIndex });
  }, [state.tabs, unregisterEditor]);

  const handleFileRenamedInSidebar = useCallback(async (oldPath: string, newPath: string) => {
    const tab = state.tabs.find(t => t.filePath === oldPath);
    if (!tab) return;
    window.mde.unwatchFile(oldPath);
    const [stats, hash] = await Promise.all([
      window.mde.getFileStats(newPath),
      window.mde.hashFile(newPath),
    ]);
    recordDiskHash(newPath, hash);
    dispatch({
      type: 'UPDATE_TAB_PATH',
      tabId: tab.id,
      filePath: newPath,
      fileName: fileNameFromPath(newPath),
      mtime: stats?.mtimeMs ?? null,
      hash,
    });
    window.mde.watchFile(newPath);
  }, [state.tabs, recordDiskHash]);

  const confirmTabRename = useCallback(async (newName: string) => {
    const target = tabRenameTarget;
    setTabRenameTarget(null);
    if (!target || !newName || newName === target.name) return;
    const newPath = joinPath(dirname(target.path), newName);
    const tab = state.tabs.find(t => t.filePath === target.path);
    if (tab && tab.filePath) window.mde.unwatchFile(tab.filePath);
    await window.mde.renameFile(target.path, newPath);
    if (tab) {
      const [stats, hash] = await Promise.all([
        window.mde.getFileStats(newPath),
        window.mde.hashFile(newPath),
      ]);
      recordDiskHash(newPath, hash);
      dispatch({
        type: 'UPDATE_TAB_PATH',
        tabId: tab.id,
        filePath: newPath,
        fileName: fileNameFromPath(newPath),
        mtime: stats?.mtimeMs ?? null,
        hash,
      });
      window.mde.watchFile(newPath);
    }
    setSidebarRefreshKey(n => n + 1);
  }, [tabRenameTarget, state.tabs]);

  const confirmTabDelete = useCallback(async () => {
    const target = tabDeleteTarget;
    setTabDeleteTarget(null);
    if (!target) return;
    await window.mde.trashFile(target.path);
    handleDeleteFile(target.path);
    setSidebarRefreshKey(n => n + 1);
  }, [tabDeleteTarget, handleDeleteFile]);

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
      window.mde.onToggleFind(() => {
        if (findBarOpenRef.current) {
          setFindFocusTrigger(n => n + 1);
        } else {
          dispatch({ type: 'TOGGLE_FIND_BAR' });
        }
      }),
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
      window.mde.onShowWordCount(() => setWordCountOpen(true)),
      window.mde.onInsertLink(() => {
        const ed = editorsRef.current.get(state.tabs[state.activeTabIndex]?.id);
        if (ed && (ed.isActive('link') || !ed.state.selection.empty)) {
          setLinkBarVisible(true);
        } else {
          showToast('Select some text first.', 'danger');
        }
      }),
      window.mde.onFileChanged(async (filePath) => {
        // Read the tab from the ref, not this closure: the event can arrive before React
        // has committed the dispatch from our own save, and a stale `dirty`/`diskHash`
        // pair is exactly what raises a phantom conflict.
        const tab = tabsRef.current.find(t => t.filePath === filePath);
        if (!tab) return;

        // Detect real changes by content hash, not mtime -- so spurious watcher fires
        // and our own saves become no-ops (hash matches).
        const [stats, diskHash] = await Promise.all([
          window.mde.getFileStats(filePath),
          window.mde.hashFile(filePath),
        ]);
        if (!stats || diskHash === null) return;
        if (diskHash === knownDiskHash(filePath, tab.diskHash)) return; // nothing actually changed on disk
        const current = tabsRef.current.find(t => t.id === tab.id);
        if (!current) return;

        if (current.dirty) {
          dispatch({ type: 'MARK_CONFLICT', tabId: tab.id, conflict: true });
        } else {
          const editor = editorsRef.current.get(tab.id);
          if (editor) {
            // Save fold state before silent reload
            const savedFoldLines = foldPosToLineNumbers(editor, getFoldedPositions(editor));

            const content = await window.mde.readFile(filePath);
            const { Markdown } = await import('../utils/markdown');
            Markdown.deserializeInto(editor, content);

            // Restore fold state after silent reload
            if (savedFoldLines.length) {
              applyFoldPositions(editor, lineNumbersToFoldPositions(editor.state.doc, content, savedFoldLines));
            }
          }
          recordDiskHash(filePath, diskHash);
          dispatch({ type: 'UPDATE_TAB_MTIME', tabId: tab.id, mtime: stats.mtimeMs, hash: diskHash });
          // Positive proof to the user that live detection is working: a thin blue banner
          // naming the reloaded file, shown for 5s.
          showReloadNotice(tab.fileName);
        }
      }),
    ];

    return () => cleanups.forEach(fn => fn());
  }, [openFile, saveActiveTab, saveActiveTabAs, handleCloseTab, openKeyboardShortcuts, state.tabs, state.activeTabIndex]);

  useEffect(() => {
    window.mde.getProjectRoot().then(root => {
      if (root) dispatch({ type: 'SET_PROJECT_ROOT', root });
    });
    // A file queued at window creation (launched/dock-opened) is pulled here
    // rather than pushed, so it loads even if it arrived before this listener.
    window.mde.getPendingFile().then(filePath => {
      if (filePath) openFile(filePath);
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

  useEffect(() => { findBarOpenRef.current = state.findBarOpen; }, [state.findBarOpen]);

  function applyTheme(t: string) {
    setTheme(t);
    if (t === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', t);
    }
  }

  // When the first file opens with no project folder set, the file explorer has
  // nothing to show, so default to the outline tab. Runs once; later user toggles stick.
  useEffect(() => {
    if (initialSidebarModeSetRef.current) return;
    if (state.tabs.length === 0) return;
    initialSidebarModeSetRef.current = true;
    if (!state.projectRoot) {
      dispatch({ type: 'SET_SIDEBAR_MODE', mode: 'outline' });
    }
  }, [state.tabs.length, state.projectRoot]);

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

  // Surface otherwise-silent failures (e.g. an IPC call rejecting because a
  // watched directory was moved on disk) as a visible red banner, since they
  // can leave the app in a broken state where saving stops working.
  useEffect(() => {
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const msg = (reason && (reason.message || String(reason))) || 'Unknown error';
      setAppError(msg);
    };
    const onError = (e: ErrorEvent) => {
      // ResizeObserver loop warnings are benign browser noise, not real errors.
      if (e.message && e.message.includes('ResizeObserver')) return;
      setAppError(e.message || 'Unknown error');
    };
    window.addEventListener('unhandledrejection', onRejection);
    window.addEventListener('error', onError);
    return () => {
      window.removeEventListener('unhandledrejection', onRejection);
      window.removeEventListener('error', onError);
    };
  }, []);

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
          vc={vc}
          onOpenFile={(filePath, tentative) => {
            suppressEditorFocusRef.current = true;
            openFile(filePath, tentative);
          }}
          onImportFile={handleImportFile}
          activeEditor={activeEditor}
          activeFilePath={activeTab?.filePath || null}
          refreshKey={sidebarRefreshKey}
          onToast={showToast}
          onDeleteFile={handleDeleteFile}
          onFileRenamed={handleFileRenamedInSidebar}
          onOpenHistory={openCheckpointHistory}
          onOpenSettings={() => setSettingsOpen(true)}
          onViewFileHistory={viewFileHistory}
        />
        <div className="main-area">
          <TabBar
            tabs={state.tabs}
            activeIndex={state.activeTabIndex}
            onSelect={(i) => dispatch({ type: 'SET_ACTIVE_TAB', index: i })}
            onClose={handleCloseTab}
            onReorder={(from, to) => dispatch({ type: 'REORDER_TABS', fromIndex: from, toIndex: to })}
            onPinTab={(tabId) => dispatch({ type: 'PIN_TAB', tabId })}
            projectRoot={state.projectRoot}
            onToast={showToast}
            onRenameFile={setTabRenameTarget}
            onRequestDeleteFile={setTabDeleteTarget}
            onViewFileHistory={viewFileHistory}
          />
          {!activeTab?.readOnly && (
            <Toolbar editor={activeEditor} linkTrigger={linkTrigger} onToast={showToast} onLinkEdit={() => setLinkBarVisible(true)} />
          )}
          {state.findBarOpen && activeEditor && (
            <FindBar
              editor={activeEditor}
              onClose={() => dispatch({ type: 'TOGGLE_FIND_BAR' })}
              focusTrigger={findFocusTrigger}
              projectRoot={state.projectRoot}
              tabs={state.tabs}
              onOpenFile={openFile}
              onToast={showToast}
            />
          )}
          <div className="editor-area">
            {reloadNotice && (
              <div className={`reload-notice${reloadNotice.hiding ? ' reload-notice-out' : ''}`}>
                <i className="bi bi-arrow-clockwise" />
                <span>Detected changes to <strong>{reloadNotice.fileName}</strong> -- reloaded from disk</span>
              </div>
            )}
            {appError && (
              <div className="error-banner">
                <span className="error-banner-text">
                  <i className="bi bi-exclamation-triangle-fill" /> An error occurred -- you may need to quit and restart.
                  Please report this: {appError}
                </span>
                <button className="conflict-btn conflict-btn-saveas" onClick={() => setAppError(null)}>
                  Dismiss
                </button>
              </div>
            )}
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
                {tab.view === 'history' ? (
                  <HistoryView
                    projectRoot={state.projectRoot}
                    vc={vc}
                    onToast={showToast}
                    navRequest={historyNav}
                  />
                ) : (
                  <Editor
                    tab={tab}
                    onReady={(editor) => registerEditor(tab.id, editor)}
                    onDestroy={() => unregisterEditor(tab.id)}
                    onDirtyChange={(dirty) => {
                      dispatch({ type: 'MARK_DIRTY', tabId: tab.id, dirty });
                      if (dirty) triggerAutosave();
                    }}
                    onLinkClick={(href) => handleLinkClick(href, tab.filePath)}
                    onImagesFound={(refs) => setImageWarning({ fileName: tab.fileName, refs })}
                  />
                )}
              </div>
            ))}
            {state.tabs.length === 0 && (
              <div className="empty-state">
                <p>Open a file or drag a folder to get started</p>
                <p className="small">or press <kbd>Cmd + O</kbd> to quick-search</p>
                <p className="small">
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
      {importExisting && (
        <ImportExistsDialog
          filePath={importExisting.filePath}
          mdPath={importExisting.mdPath}
          onOpen={() => { const p = importExisting.mdPath; setImportExisting(null); openFile(p); }}
          onReconvert={reconvertImport}
          onCancel={() => setImportExisting(null)}
        />
      )}
      {linkCreateTarget && (
        <CreateFileDialog
          filePath={linkCreateTarget}
          onConfirm={confirmCreateLink}
          onCancel={() => setLinkCreateTarget(null)}
        />
      )}
      {tabRenameTarget && (
        <RenameDialog
          target={tabRenameTarget}
          onConfirm={confirmTabRename}
          onCancel={() => setTabRenameTarget(null)}
        />
      )}
      {tabDeleteTarget && (
        <DeleteConfirmDialog
          target={tabDeleteTarget}
          onConfirm={confirmTabDelete}
          onCancel={() => setTabDeleteTarget(null)}
        />
      )}
      {imageWarning && (
        <ImageWarningDialog
          fileName={imageWarning.fileName}
          refs={imageWarning.refs}
          onDismiss={() => setImageWarning(null)}
        />
      )}
      {settingsOpen && (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          theme={theme}
          spellcheck={spellcheck}
          autosave={autosave}
          projectRoot={state.projectRoot}
          vc={vc}
          onToast={showToast}
        />
      )}
      {wordCountOpen && <WordCountDialog editor={activeEditor} onClose={() => setWordCountOpen(false)} />}
      {toast && (
        <div className={`toast ${toast.variant ? `toast-${toast.variant}` : ''} ${toast.hiding ? 'toast-out' : ''}`}>{toast.msg}</div>
      )}
    </div>
  );
}

interface SettingsDialogProps {
  onClose: () => void;
  theme: string;
  spellcheck: boolean;
  autosave: boolean;
  // Checkpoints are a per-FOLDER setting living in an otherwise app-global dialog, which is why
  // these three have to be threaded down here at all. `CheckpointSettings` names the folder so
  // the mismatch is visible rather than misleading.
  projectRoot: string | null;
  vc: VersionControl;
  onToast: (msg: string, variant?: string) => void;
}

function SettingsDialog({ onClose, theme, spellcheck, autosave, projectRoot, vc, onToast }: SettingsDialogProps) {
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
    <div className="modal-backdrop qa-settings" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">Settings</span>
          <button className="toolbar-btn qa-settings-close" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          <div className="settings-row">
            <div>
              <div className="fw-bold">Theme</div>
              <div className="small text-muted">Choose light, dark, or match your system.</div>
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
              <div className="small text-muted">Show spelling errors with a red underline.</div>
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
              <div className="small text-muted">Automatically save files after 1 second of inactivity.</div>
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
              <div className="small text-muted">
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
          <div className="settings-separator" />
          <CheckpointSettings projectRoot={projectRoot} vc={vc} onToast={onToast} />
        </div>
      </div>
    </div>
  );
}

const WORDS_PER_PAGE = 300;

// Plain text of a doc range, with block boundaries as newlines so words in
// adjacent blocks don't run together into one "word".
function countsFor(doc: any, from: number, to: number) {
  const text = doc.textBetween(from, to, '\n', ' ');
  const words = text.split(/\s+/).filter(Boolean).length;
  return { words, chars: text.length, pages: words / WORDS_PER_PAGE };
}

function WordCountDialog({ editor, onClose }: { editor: TipTapEditor | null; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Snapshot once on open -- the dialog steals focus, so the numbers must not
  // move underneath the user while it's up. With no selection there is nothing to
  // compare against, so each row shows the document figure alone (no "0 / " prefix).
  const stats = useMemo(() => {
    if (!editor) return null;
    const { doc, selection } = editor.state;
    return {
      hasSelection: !selection.empty,
      selection: countsFor(doc, selection.from, selection.to),
      document: countsFor(doc, 0, doc.content.size),
    };
  }, [editor]);

  const rows: [string, string][] = stats
    ? ([
        ['Word count', stats.selection.words.toLocaleString(), stats.document.words.toLocaleString()],
        ['Character count', stats.selection.chars.toLocaleString(), stats.document.chars.toLocaleString()],
        ['Est. page count', stats.selection.pages.toFixed(1), stats.document.pages.toFixed(1)],
      ] as [string, string, string][]).map(([label, sel, doc]) => [
        label,
        stats.hasSelection ? `${sel} / ${doc}` : doc,
      ])
    : [];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog qa-word-count" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">Word Count</span>
          <button className="toolbar-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {!stats ? (
            <div className="text-muted">No document is open.</div>
          ) : (
            <>
              <div className="small text-muted" style={{ marginBottom: '0.75rem' }}>
                {stats.hasSelection ? 'Selection / whole document' : 'Whole document'}
              </div>
              <table className="word-count-table">
                <tbody>
                  {rows.map(([label, value]) => (
                    <tr key={label}>
                      <td>{label}:</td>
                      <td className="word-count-value">{value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="small text-muted" style={{ marginTop: '0.75rem' }}>
                Pages estimated at {WORDS_PER_PAGE} words per page.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RenameDialog({ target, onConfirm, onCancel }: { target: FileEntry; onConfirm: (newName: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    // Select the base name, leaving the extension unselected (like Finder).
    const dot = target.name.lastIndexOf('.');
    if (inputRef.current) inputRef.current.setSelectionRange(0, dot > 0 ? dot : target.name.length);
  }, []);

  const submit = () => onConfirm(name.trim());

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ justifyContent: 'center' }}>
          <span className="fw-bold">Rename {target.isDirectory ? 'folder' : 'file'}</span>
        </div>
        <div className="modal-body">
          <input
            ref={inputRef}
            className="settings-select"
            style={{ width: '100%' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn" onClick={onCancel}>Cancel</button>
            <button className="settings-btn btn-primary" onClick={submit}>Rename</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CreateFileDialog({ filePath, onConfirm, onCancel }: { filePath: string; onConfirm: () => void; onCancel: () => void }) {
  const fileName = basename(filePath) || filePath;

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
          <span className="fw-bold">File doesn&rsquo;t exist</span>
        </div>
        <div className="modal-body">
          <p className="small text-muted">
            <code>{fileName}</code> doesn&rsquo;t exist yet. Create it and open it in a new tab?
          </p>
          <p className="small text-muted" style={{ wordBreak: 'break-all' }}>{filePath}</p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn" onClick={onCancel}>Cancel</button>
            <button className="settings-btn btn-primary" onClick={onConfirm}>Create &amp; Open</button>
          </div>
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

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-dialog qa-import-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ justifyContent: 'center' }}>
          <span className="fw-bold">Convert {ext} to Markdown</span>
        </div>
        <div className="modal-body">
          <p className="small text-muted">
            This will create <code>{fileName}.md</code> alongside it and open that for editing.
            <code>{fileName}</code> is left untouched. Some formatting may be simplified.
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

// Shown when a .docx/.pdf already has a converted Markdown beside it. Opening that
// Markdown is the primary action -- re-converting would either clobber edits or
// leave the user guessing which file is current. "Convert again" is available but
// de-emphasized (for a source that changed on disk since it was converted), and it
// always writes a NEW numbered file rather than overwriting.
function ImportExistsDialog({ filePath, mdPath, onOpen, onReconvert, onCancel }: {
  filePath: string;
  mdPath: string;
  onOpen: () => void;
  onReconvert: () => void;
  onCancel: () => void;
}) {
  const fileName = basename(filePath) || filePath;
  const mdName = basename(mdPath) || mdPath;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onOpen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen, onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal-dialog qa-import-exists" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ justifyContent: 'center' }}>
          <span className="fw-bold">Already converted</span>
        </div>
        <div className="modal-body">
          <p className="small text-muted">
            <code>{fileName}</code> has already been converted &mdash; <code>{mdName}</code> is
            sitting next to it. Open that instead?
          </p>
          <p className="small text-muted">
            Converting again won&rsquo;t overwrite it; it writes a new numbered copy.
          </p>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '1rem' }}>
            <button className="settings-btn" onClick={onCancel}>Cancel</button>
            <button className="settings-btn qa-reconvert" onClick={onReconvert}>Convert again</button>
            <button className="settings-btn btn-primary qa-open-existing" onClick={onOpen}>Open {mdName}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
