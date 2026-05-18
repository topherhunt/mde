import { contextBridge, ipcRenderer } from 'electron';

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileStats {
  mtimeMs: number;
  size: number;
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
};

contextBridge.exposeInMainWorld('mde', api);
