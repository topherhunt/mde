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
  tentative: boolean;
  readOnly?: boolean;
  initialContent?: string;
}

export interface MdeAPI {
  platform: NodeJS.Platform;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<number>;
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
  convertImport: (filePath: string) => Promise<{ mdPath: string } | { error: string }>;
  watchProject: (root: string) => void;
  unwatchProject: (root: string) => void;
  onProjectFilesChanged: (callback: () => void) => () => void;
  listProjectFiles: (root: string) => Promise<string[]>;
  onQuickOpen: (callback: () => void) => () => void;
  onShowKeyboardShortcuts: (callback: () => void) => () => void;
  getPathForFile: (file: File) => string;
  renameFile: (oldPath: string, newPath: string) => Promise<void>;
  trashFile: (filePath: string) => Promise<void>;
  createFile: (filePath: string) => Promise<void>;
  createDirectory: (dirPath: string) => Promise<void>;
  getSidebarWidth: () => Promise<number | null>;
  setSidebarWidth: (width: number) => Promise<void>;
  getFoldState: (filePath: string) => Promise<number[]>;
  setFoldState: (filePath: string, lineNumbers: number[]) => Promise<void>;
}

declare global {
  interface Window {
    mde: MdeAPI;
  }
}
