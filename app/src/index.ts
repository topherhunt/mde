import { app, BrowserWindow, ipcMain, dialog, Menu } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

interface WindowState {
  projectRoot: string | null;
}

const windowStates = new Map<BrowserWindow, WindowState>();

const isTest = process.argv.includes('--test-headless');

function createWindow(projectRoot: string | null = null): BrowserWindow {
  const win = new BrowserWindow({
    height: 800,
    width: 1200,
    minWidth: 600,
    minHeight: 400,
    show: !isTest,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  windowStates.set(win, { projectRoot });

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  if (process.env.NODE_ENV === 'development') {
    win.webContents.openDevTools();
  }

  win.on('closed', () => {
    windowStates.delete(win);
  });

  win.webContents.on('did-finish-load', () => {
    if (projectRoot) {
      win.webContents.send('open-project', projectRoot);
    }
  });

  return win;
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open File...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const win = BrowserWindow.getFocusedWindow();
            if (!win) return;
            const result = await dialog.showOpenDialog(win, {
              properties: ['openFile'],
              filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              win.webContents.send('open-file', result.filePaths[0]);
            }
          },
        },
        {
          label: 'Open Folder...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const result = await dialog.showOpenDialog({
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              createWindow(result.filePaths[0]);
            }
          },
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('save-file');
          },
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('save-file-as');
          },
        },
        { type: 'separator' },
        {
          label: 'Export as PDF...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('export-pdf');
          },
        },
        {
          label: 'Export as DOCX...',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('export-docx');
          },
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Find',
          accelerator: 'CmdOrCtrl+F',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('toggle-find');
          },
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- IPC Handlers ---

ipcMain.handle('read-file', async (_event, filePath: string) => {
  return fs.promises.readFile(filePath, 'utf-8');
});

ipcMain.handle('write-file', async (_event, filePath: string, content: string) => {
  await fs.promises.writeFile(filePath, content, 'utf-8');
  const stats = await fs.promises.stat(filePath);
  return stats.mtimeMs;
});

ipcMain.handle('get-file-stats', async (_event, filePath: string) => {
  try {
    const stats = await fs.promises.stat(filePath);
    return { mtimeMs: stats.mtimeMs, size: stats.size };
  } catch {
    return null;
  }
});

ipcMain.handle('list-directory', async (_event, dirPath: string) => {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const result: Array<{ name: string; path: string; isDirectory: boolean }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      result.push({ name: entry.name, path: fullPath, isDirectory: true });
    } else if (/\.(md|markdown)$/i.test(entry.name)) {
      result.push({ name: entry.name, path: fullPath, isDirectory: false });
    }
  }

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
});

ipcMain.handle('show-save-dialog', async (_event, defaultPath?: string) => {
  const win = BrowserWindow.getFocusedWindow();
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    defaultPath,
    filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
  });
  return result.canceled ? null : result.filePath;
});

ipcMain.handle('export-pdf', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, {
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  const pdfData = await win.webContents.printToPDF({});
  await fs.promises.writeFile(result.filePath, pdfData);
  return result.filePath;
});

ipcMain.handle('get-project-root', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return null;
  return windowStates.get(win)?.projectRoot ?? null;
});

// --- File watching ---

const watchers = new Map<string, fs.FSWatcher>();

ipcMain.on('watch-file', (event, filePath: string) => {
  if (watchers.has(filePath)) return;
  try {
    const watcher = fs.watch(filePath, () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        win.webContents.send('file-changed', filePath);
      }
    });
    watchers.set(filePath, watcher);
  } catch {
    // File may not exist yet
  }
});

ipcMain.on('unwatch-file', (_event, filePath: string) => {
  const watcher = watchers.get(filePath);
  if (watcher) {
    watcher.close();
    watchers.delete(filePath);
  }
});

// --- Drag and drop at app level ---

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    createWindow(filePath);
  } else {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('open-file', filePath);
    } else {
      app.whenReady().then(() => {
        const newWin = createWindow();
        newWin.webContents.on('did-finish-load', () => {
          newWin.webContents.send('open-file', filePath);
        });
      });
    }
  }
});

// --- App lifecycle ---

app.on('ready', () => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
