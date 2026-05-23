import { contextBridge, ipcRenderer, webUtils } from 'electron';

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

const api = {
  readFile: (filePath: string): Promise<string> =>
    ipcRenderer.invoke('read-file', filePath),

  writeFile: (filePath: string, content: string): Promise<number> =>
    ipcRenderer.invoke('write-file', filePath, content),

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

  installTerminalLauncher: (): Promise<{ success: boolean; error?: string }> =>
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

  convertImport: (filePath: string): Promise<{ mdPath: string } | { error: string }> =>
    ipcRenderer.invoke('convert-import', filePath),

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

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('mde', api);
