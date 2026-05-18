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

export interface Tab {
  id: string;
  filePath: string | null;
  fileName: string;
  dirty: boolean;
  diskMtime: number | null;
  conflict: boolean;
}

export interface MdeAPI {
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<number>;
  getFileStats: (filePath: string) => Promise<FileStats | null>;
  listDirectory: (dirPath: string) => Promise<FileEntry[]>;
  showSaveDialog: (defaultPath?: string) => Promise<string | null>;
  exportPDF: () => Promise<string | null>;
  getProjectRoot: () => Promise<string | null>;
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
  openFolderInNewWindow: (folderPath: string) => Promise<void>;
  getPathForFile: (file: File) => string;
}

declare global {
  interface Window {
    mde: MdeAPI;
  }
}
