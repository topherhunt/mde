export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileStats {
  mtimeMs: number;
  size: number;
  isDirectory: boolean;
}

export interface GuardedWriteResult {
  ok: boolean;
  conflict: boolean;
  mtimeMs: number | null;
  hash: string;
}

export interface Tab {
  id: string;
  filePath: string | null;
  fileName: string;
  dirty: boolean;
  diskMtime: number | null;
  // Content hash of the file as we last read/wrote it on disk. The save path refuses to
  // write when the current on-disk hash no longer matches this, so a stale buffer can
  // never clobber a newer version. null for unsaved buffers or read-only tabs.
  diskHash: string | null;
  conflict: boolean;
  tentative: boolean;
  readOnly?: boolean;
  initialContent?: string;
  // A tab that renders something other than the editor. Deliberately a TAB rather than an
  // app-wide mode: the main area's contract is "show the active tab", and a mode that hid the
  // editor would have to either unmount live buffers (losing unsaved work and undo history) or
  // keep a hidden editor receiving keystrokes. Everything else -- Cmd+W, Cmd+S, the conflict
  // banner, drag-drop -- already has a correct answer for a read-only tab.
  view?: 'history';
}

export type SidebarMode = 'explorer' | 'outline' | 'versions';

// --- Version history (checkpoints). See CHECKPOINTS.md for the full design. ---

// Only 'managed' permits writes. Everything else is read-only browsing; see
// `resolveState` in src/git/repo.ts. The marker grants write mode and nothing else does.
export type VcAttachState = 'none' | 'managed' | 'foreign' | 'steppedBack';

export interface VcState {
  attach: VcAttachState;
  // Human-readable explanation for the non-writable states, shown verbatim in the panel.
  reason?: string;
  branch?: string | null;
  hasRemote?: boolean;
  // Only populated for 'foreign'. More than one branch means adopting would immediately
  // step back to read-only, so the panel hides the adopt button rather than offering a
  // button that visibly does nothing.
  branchCount?: number;
}

export type VcChangeKind = 'added' | 'modified' | 'deleted';

export interface VcChangedFile {
  path: string; // repo-relative
  kind: VcChangeKind;
  // Line counts, only populated when explicitly requested (they cost a blob read + diff).
  added?: number;
  removed?: number;
}

/** One checkpoint at a glance: how many files it touched and how far the lines moved. */
export interface VcCheckpointStat {
  files: number;
  // Absent, never zero, when nothing in the checkpoint could be measured (all binary, or past
  // the file cap). A zero would read as "nothing really changed" instead of "nobody counted".
  added?: number;
  removed?: number;
}

export interface VcStatus {
  files: VcChangedFile[];
  count: number;
}

export interface VcCheckpoint {
  sha: string;
  // The checkpoint immediately before this one. Absent only on the very first checkpoint in a
  // folder. This is what "restore the way it was BEFORE this change" restores to, so it is
  // carried on every checkpoint rather than fetched when a restore dialog opens.
  parent?: string;
  // What to display. The user's edited title when there is one, else the generated subject.
  subject: string;
  // The auto-generated subject, always. Kept so "use the automatic title again" can restore it
  // without re-deriving it, and so the pencil never hides what MDE originally recorded.
  generatedSubject: string;
  titleEdited?: boolean;
  timestamp: number; // ms since epoch
  kind: 'auto' | 'manual' | 'restore';
  // Present when kind === 'restore': the checkpoint whose content was restored.
  restoreOf?: string;
  // Present when the commit was not made by MDE (only possible in an adopted repo).
  foreign?: boolean;
}

export interface VcLargeFile {
  path: string;
  bytes: number;
}

export interface VcPreflight {
  // Non-null blocks init outright: nesting a repo inside a repo is unrecoverable for this user.
  parentRepo: string | null;
  childRepos: string[];
  totalBytes: number;
  fileCount: number;
  largeFiles: VcLargeFile[];
  // e.g. 'iCloud Drive'. Warn but never block: reading every file on a
  // storage-optimized sync folder can pull content back down from the cloud.
  cloudSync: string | null;
  // True when the walk hit its cap, so the totals above are lower bounds.
  truncated: boolean;
}

/**
 * Where to point the checkpoint history tab when something opens it.
 *
 * The tab is the ONLY thing that renders a checkpoint drill-down; the sidebar routes here
 * instead of keeping a second, shallower copy of the same screens. `all` also means "zoom back
 * out", which is what the Browse button must do when the tab is already open on a file diff.
 */
export type HistoryTarget =
  | { kind: 'all' }
  | { kind: 'checkpoint'; checkpoint: VcCheckpoint }
  // Repo-relative path. Only the LIST is filtered -- drilling into a checkpoint from here still
  // shows everything that checkpoint touched, because "what else moved at the same time" is the
  // next question and hiding it would make the checkpoint look smaller than it was.
  | { kind: 'file'; path: string };

export interface VcDiff {
  path: string;
  before: string | null; // null when the file did not exist at that point
  after: string | null; // null when the file was deleted
  binary: boolean;
}

export interface VcRestoreResult {
  ok: boolean;
  newSha: string | null;
  filesWritten: number;
  filesDeleted: number;
  // The checkpoint capturing the pre-restore state, if anything needed capturing.
  safetySha: string | null;
  error?: string;
}

export interface VcCheckpointResult {
  ok: boolean;
  // null when there was nothing to commit -- not an error, just a no-op.
  sha: string | null;
  subject?: string;
  filesChanged?: number;
  error?: string;
}

export interface MdeAPI {
  platform: NodeJS.Platform;
  readFile: (filePath: string) => Promise<string>;
  hashFile: (filePath: string) => Promise<string | null>;
  // The ONLY document-write path. Refuses to overwrite a file changed on disk. No raw writeFile.
  writeFileIfUnchanged: (
    filePath: string,
    content: string,
    expectedHash: string | null
  ) => Promise<GuardedWriteResult>;
  getFileStats: (filePath: string) => Promise<FileStats | null>;
  listDirectory: (dirPath: string) => Promise<FileEntry[]>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  exportPDF: () => Promise<string | null>;
  getProjectRoot: () => Promise<string | null>;
  getPendingFile: () => Promise<string | null>;
  watchFile: (filePath: string) => void;
  unwatchFile: (filePath: string) => void;
  onOpenFile: (callback: (filePath: string) => void) => () => void;
  onOpenProject: (callback: (projectRoot: string) => void) => () => void;
  onSaveFile: (callback: () => void) => () => void;
  onSaveFileAs: (callback: () => void) => () => void;
  onToggleFind: (callback: () => void) => () => void;
  onFileChanged: (callback: (filePath: string) => void) => () => void;
  onExportPDF: (callback: () => void) => () => void;
  onExportDOCX: (callback: () => void) => () => void;
  onCloseTab: (callback: () => void) => () => void;
  onReopenClosedTab: (callback: () => void) => () => void;
  onPrevTab: (callback: () => void) => () => void;
  onNextTab: (callback: () => void) => () => void;
  closeWindow: () => void;
  saveLastProjectRoot: (root: string) => void;
  openFolderInNewWindow: (folderPath: string) => Promise<void>;
  openExternal: (url: string) => void;
  getTheme: () => Promise<string>;
  setTheme: (theme: string) => Promise<void>;
  onThemeChanged: (callback: (theme: string) => void) => () => void;
  checkTerminalLauncher: () => Promise<boolean>;
  installTerminalLauncher: () => Promise<{ success: boolean; error?: string; note?: string }>;
  onOpenSettings: (callback: () => void) => () => void;
  onToggleCodeBlock: (callback: () => void) => () => void;
  onInsertLink: (callback: () => void) => () => void;
  getSpellcheck: () => Promise<boolean>;
  setSpellcheck: (enabled: boolean) => Promise<void>;
  onSpellcheckChanged: (callback: (enabled: boolean) => void) => () => void;
  getAutosave: () => Promise<boolean>;
  setAutosave: (enabled: boolean) => Promise<void>;
  onAutosaveChanged: (callback: (enabled: boolean) => void) => () => void;
  convertImport: (filePath: string, opts?: { newCopy?: boolean }) => Promise<{ mdPath: string } | { error: string }>;
  getImportTarget: (filePath: string) => Promise<{ mdPath: string; exists: boolean }>;
  watchProject: (root: string) => void;
  unwatchProject: (root: string) => void;
  onProjectFilesChanged: (callback: () => void) => () => void;
  listProjectFiles: (root: string) => Promise<string[]>;
  onQuickOpen: (callback: () => void) => () => void;
  onShowKeyboardShortcuts: (callback: () => void) => () => void;
  onShowWordCount: (callback: () => void) => () => void;
  getPathForFile: (file: File) => string;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  trashFile: (filePath: string) => Promise<void>;
  revealInFinder: (filePath: string) => Promise<void>;
  createFile: (filePath: string) => Promise<void>;
  createDirectory: (dirPath: string) => Promise<void>;
  getSidebarWidth: () => Promise<number | null>;
  setSidebarWidth: (width: number) => Promise<void>;
  getFoldState: (filePath: string) => Promise<number[]>;
  setFoldState: (filePath: string, lineNumbers: number[]) => Promise<void>;

  // --- Version history. All calls are no-ops on a folder MDE does not manage, except
  // vcGetState/vcGetStatus/vcHistory/vcDiff, which are read-only and safe anywhere. ---
  vcGetState: (root: string) => Promise<VcState>;
  vcGetStatus: (root: string) => Promise<VcStatus>;
  vcPreflight: (root: string) => Promise<VcPreflight>;
  vcInit: (root: string) => Promise<{ ok: boolean; error?: string }>;
  vcAdopt: (root: string) => Promise<{ ok: boolean; error?: string }>;
  vcCheckpoint: (root: string, message?: string) => Promise<VcCheckpointResult>;
  vcHistory: (root: string, opts?: { limit?: number; before?: string }) => Promise<VcCheckpoint[]>;
  // Just the checkpoints that touched one file (repo-relative path), same shape as vcHistory.
  vcFileHistory: (
    root: string,
    filePath: string,
    opts?: { limit?: number; before?: string }
  ) => Promise<VcCheckpoint[]>;
  vcCheckpointFiles: (
    root: string,
    sha: string,
    opts?: { counts?: boolean }
  ) => Promise<VcChangedFile[]>;
  // Line totals for the history list's diff-stat bars, keyed by sha. Batched and fetched after
  // the list itself: it costs a diff per changed file, and the list must not wait on it.
  // A sha with nothing measurable is simply absent from the result.
  vcCheckpointStats: (root: string, shas: string[]) => Promise<Record<string, VcCheckpointStat>>;
  // Stores a display title in a sidecar inside .git. Deliberately NOT a commit rewrite --
  // see the header of src/git/titles.ts. Pass '' to go back to the generated title.
  vcSetTitle: (root: string, sha: string, title: string) => Promise<{ ok: boolean; error?: string }>;
  vcDiff: (root: string, filePath: string, sha?: string) => Promise<VcDiff>;
  vcRestoreFile: (root: string, sha: string, filePath: string) => Promise<VcRestoreResult>;
  vcRestoreAll: (root: string, sha: string) => Promise<VcRestoreResult>;
  onVcStatus: (callback: (payload: { root: string; files: VcChangedFile[] }) => void) => () => void;
  onVcCheckpoint: (
    callback: (payload: { root: string; sha: string; subject: string }) => void
  ) => () => void;
}

declare global {
  interface Window {
    mde: MdeAPI;
  }
}
