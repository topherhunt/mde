import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { VcChangedFile } from './types';

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

const api = {
  platform: process.platform,

  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-file', filePath),

  hashFile: (filePath: string): Promise<string | null> =>
    ipcRenderer.invoke('hash-file', filePath),

  // The ONLY way to write a document to disk. Refuses to overwrite a file whose on-disk
  // hash no longer matches expectedHash (data-safety guard). Do not add a raw writeFile.
  writeFileIfUnchanged: (
    filePath: string,
    content: string,
    expectedHash: string | null
  ): Promise<GuardedWriteResult> =>
    ipcRenderer.invoke('write-file-if-unchanged', filePath, content, expectedHash),

  getFileStats: (filePath: string): Promise<FileStats | null> =>
    ipcRenderer.invoke('get-file-stats', filePath),

  listDirectory: (dirPath: string): Promise<FileEntry[]> =>
    ipcRenderer.invoke('list-directory', dirPath),

  showSaveDialog: (defaultPath?: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultPath),

  exportPDF: (): Promise<string | null> =>
    ipcRenderer.invoke('export-pdf'),

  getProjectRoot: (): Promise<string | null> =>
    ipcRenderer.invoke('get-project-root'),

  getPendingFile: (): Promise<string | null> =>
    ipcRenderer.invoke('get-pending-file'),

  watchFile: (filePath: string): void =>
    ipcRenderer.send('watch-file', filePath),

  unwatchFile: (filePath: string): void =>
    ipcRenderer.send('unwatch-file', filePath),

  onOpenFile: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('open-file', handler);
    return () => ipcRenderer.removeListener('open-file', handler);
  },

  onOpenProject: (callback: (projectRoot: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectRoot: string) => callback(projectRoot);
    ipcRenderer.on('open-project', handler);
    return () => ipcRenderer.removeListener('open-project', handler);
  },

  onSaveFile: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('save-file', handler);
    return () => ipcRenderer.removeListener('save-file', handler);
  },

  onSaveFileAs: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('save-file-as', handler);
    return () => ipcRenderer.removeListener('save-file-as', handler);
  },

  onToggleFind: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-find', handler);
    return () => ipcRenderer.removeListener('toggle-find', handler);
  },

  onFileChanged: (callback: (filePath: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, filePath: string) => callback(filePath);
    ipcRenderer.on('file-changed', handler);
    return () => ipcRenderer.removeListener('file-changed', handler);
  },

  onExportPDF: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('export-pdf', handler);
    return () => ipcRenderer.removeListener('export-pdf', handler);
  },

  onExportDOCX: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('export-docx', handler);
    return () => ipcRenderer.removeListener('export-docx', handler);
  },

  onCloseTab: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('close-tab', handler);
    return () => ipcRenderer.removeListener('close-tab', handler);
  },

  onReopenClosedTab: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('reopen-closed-tab', handler);
    return () => ipcRenderer.removeListener('reopen-closed-tab', handler);
  },

  onPrevTab: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('prev-tab', handler);
    return () => ipcRenderer.removeListener('prev-tab', handler);
  },

  onNextTab: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('next-tab', handler);
    return () => ipcRenderer.removeListener('next-tab', handler);
  },

  closeWindow: (): void => ipcRenderer.send('close-window'),

  saveLastProjectRoot: (root: string): void =>
    ipcRenderer.send('save-last-project-root', root),

  openFolderInNewWindow: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke('open-folder-in-new-window', folderPath),

  openExternal: (url: string): void => ipcRenderer.send('open-external', url),

  getTheme: (): Promise<string> => ipcRenderer.invoke('get-theme'),
  setTheme: (theme: string): Promise<void> => ipcRenderer.invoke('set-theme', theme),
  onThemeChanged: (callback: (theme: string) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, theme: string) => callback(theme);
    ipcRenderer.on('theme-changed', handler);
    return () => ipcRenderer.removeListener('theme-changed', handler);
  },

  checkTerminalLauncher: (): Promise<boolean> =>
    ipcRenderer.invoke('check-terminal-launcher'),

  installTerminalLauncher: (): Promise<{ success: boolean; error?: string; note?: string }> =>
    ipcRenderer.invoke('install-terminal-launcher'),

  onOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },

  onToggleCodeBlock: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('toggle-code-block', handler);
    return () => ipcRenderer.removeListener('toggle-code-block', handler);
  },

  onInsertLink: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('insert-link', handler);
    return () => ipcRenderer.removeListener('insert-link', handler);
  },

  getSpellcheck: (): Promise<boolean> => ipcRenderer.invoke('get-spellcheck'),
  setSpellcheck: (enabled: boolean): Promise<void> => ipcRenderer.invoke('set-spellcheck', enabled),
  onSpellcheckChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('spellcheck-changed', handler);
    return () => ipcRenderer.removeListener('spellcheck-changed', handler);
  },

  getAutosave: (): Promise<boolean> => ipcRenderer.invoke('get-autosave'),
  setAutosave: (enabled: boolean): Promise<void> => ipcRenderer.invoke('set-autosave', enabled),
  onAutosaveChanged: (callback: (enabled: boolean) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, enabled: boolean) => callback(enabled);
    ipcRenderer.on('autosave-changed', handler);
    return () => ipcRenderer.removeListener('autosave-changed', handler);
  },

  convertImport: (filePath: string, opts?: { newCopy?: boolean }): Promise<{ mdPath: string } | { error: string }> =>
    ipcRenderer.invoke('convert-import', filePath, opts),

  getImportTarget: (filePath: string): Promise<{ mdPath: string; exists: boolean }> =>
    ipcRenderer.invoke('get-import-target', filePath),

  listProjectFiles: (root: string): Promise<string[]> =>
    ipcRenderer.invoke('list-project-files', root),

  watchProject: (root: string): void => ipcRenderer.send('watch-project', root),
  unwatchProject: (root: string): void => ipcRenderer.send('unwatch-project', root),
  onProjectFilesChanged: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('project-files-changed', handler);
    return () => ipcRenderer.removeListener('project-files-changed', handler);
  },

  onQuickOpen: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('quick-open', handler);
    return () => ipcRenderer.removeListener('quick-open', handler);
  },

  onShowKeyboardShortcuts: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('show-keyboard-shortcuts', handler);
    return () => ipcRenderer.removeListener('show-keyboard-shortcuts', handler);
  },

  onShowWordCount: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('show-word-count', handler);
    return () => ipcRenderer.removeListener('show-word-count', handler);
  },

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  renameFile: (oldPath: string, newPath: string): Promise<void> =>
    ipcRenderer.invoke('rename-file', oldPath, newPath),

  trashFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('trash-file', filePath),

  revealInFinder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('reveal-in-finder', filePath),

  createFile: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('create-file', filePath),

  createDirectory: (dirPath: string): Promise<void> =>
    ipcRenderer.invoke('create-directory', dirPath),

  getSidebarWidth: (): Promise<number | null> =>
    ipcRenderer.invoke('get-sidebar-width'),

  setSidebarWidth: (width: number): Promise<void> =>
    ipcRenderer.invoke('set-sidebar-width', width),

  getFoldState: (filePath: string): Promise<number[]> =>
    ipcRenderer.invoke('get-fold-state', filePath),

  setFoldState: (filePath: string, lineNumbers: number[]): Promise<void> =>
    ipcRenderer.invoke('set-fold-state', filePath, lineNumbers),

  // --- Version history (checkpoints). See CHECKPOINTS.md. ---

  vcGetState: (root: string) => ipcRenderer.invoke('vc-get-state', root),
  vcGetStatus: (root: string) => ipcRenderer.invoke('vc-get-status', root),
  vcPreflight: (root: string) => ipcRenderer.invoke('vc-preflight', root),
  vcInit: (root: string) => ipcRenderer.invoke('vc-init', root),
  vcAdopt: (root: string) => ipcRenderer.invoke('vc-adopt', root),
  vcCheckpoint: (root: string, message?: string) =>
    ipcRenderer.invoke('vc-checkpoint', root, message),
  vcHistory: (root: string, opts?: { limit?: number; before?: string }) =>
    ipcRenderer.invoke('vc-history', root, opts),
  vcFileHistory: (root: string, filePath: string, opts?: { limit?: number; before?: string }) =>
    ipcRenderer.invoke('vc-file-history', root, filePath, opts),
  vcCheckpointFiles: (root: string, sha: string, opts?: { counts?: boolean }) =>
    ipcRenderer.invoke('vc-checkpoint-files', root, sha, opts),
  vcCheckpointStats: (root: string, shas: string[]) =>
    ipcRenderer.invoke('vc-checkpoint-stats', root, shas),
  vcStatusCounts: (root: string, paths: string[]) =>
    ipcRenderer.invoke('vc-status-counts', root, paths),
  vcSetAuto: (root: string, auto: boolean) =>
    ipcRenderer.invoke('vc-set-auto', root, auto),
  vcSetTitle: (root: string, sha: string, title: string) =>
    ipcRenderer.invoke('vc-set-title', root, sha, title),
  vcDiff: (root: string, filePath: string, sha?: string) =>
    ipcRenderer.invoke('vc-diff', root, filePath, sha),
  vcRestoreFile: (root: string, sha: string, filePath: string) =>
    ipcRenderer.invoke('vc-restore-file', root, sha, filePath),
  vcRestoreAll: (root: string, sha: string) =>
    ipcRenderer.invoke('vc-restore-all', root, sha),

  onVcStatus: (callback: (payload: { root: string; files: VcChangedFile[] }) => void) => {
    const handler = (_e: unknown, payload: { root: string; files: VcChangedFile[] }) =>
      callback(payload);
    ipcRenderer.on('vc-status', handler);
    return () => ipcRenderer.removeListener('vc-status', handler);
  },

  onVcCheckpoint: (
    callback: (payload: { root: string; sha: string; subject: string }) => void
  ) => {
    const handler = (_e: unknown, payload: { root: string; sha: string; subject: string }) =>
      callback(payload);
    ipcRenderer.on('vc-checkpoint', handler);
    return () => ipcRenderer.removeListener('vc-checkpoint', handler);
  },
};

contextBridge.exposeInMainWorld('mde', api);
