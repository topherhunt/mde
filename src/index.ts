import { app, BrowserWindow, ipcMain, dialog, Menu, shell } from 'electron';
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

const stateFilePath = path.join(app.getPath('userData'), 'mde-state.json');

function loadState(): Record<string, any> {
  try {
    return JSON.parse(fs.readFileSync(stateFilePath, 'utf-8'));
  } catch {}
  return {};
}

function saveState(partial: Record<string, any>): void {
  try {
    const current = loadState();
    fs.writeFileSync(stateFilePath, JSON.stringify({ ...current, ...partial }), 'utf-8');
  } catch {}
}

function loadLastProjectRoot(): string | null {
  if (isTest) return null;
  const data = loadState();
  if (data.lastProjectRoot && fs.existsSync(data.lastProjectRoot)) {
    return data.lastProjectRoot;
  }
  return null;
}

function saveLastProjectRoot(root: string): void {
  saveState({ lastProjectRoot: root });
}

function createWindow(projectRoot: string | null = null): BrowserWindow {
  const focused = BrowserWindow.getFocusedWindow();
  const [x, y] = focused ? focused.getPosition().map((v, i) => v + 30) : [undefined, undefined];

  const win = new BrowserWindow({
    height: 800,
    width: 800,
    x,
    y,
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
  if (projectRoot) saveLastProjectRoot(projectRoot);

  const spellcheckEnabled = loadState().spellcheck !== false;
  win.webContents.session.setSpellCheckerEnabled(spellcheckEnabled);

  win.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  win.on('closed', () => {
    windowStates.delete(win);
  });

  win.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });

  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  win.webContents.on('did-finish-load', () => {
    if (projectRoot) {
      win.webContents.send('open-project', projectRoot);
      win.setTitle(path.basename(projectRoot));
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
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('open-settings');
          },
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Quick Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('quick-open');
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
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('close-tab');
          },
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('reopen-closed-tab');
          },
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Alt+Left',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('prev-tab');
          },
        },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Alt+Right',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('next-tab');
          },
        },
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
        { type: 'separator' },
        {
          label: 'Toggle Code Block',
          accelerator: 'CmdOrCtrl+Shift+E',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('toggle-code-block');
          },
        },
        {
          label: 'Insert Link',
          accelerator: 'CmdOrCtrl+K',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('insert-link');
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
    return { mtimeMs: stats.mtimeMs, size: stats.size, isDirectory: stats.isDirectory() };
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
    result.push({ name: entry.name, path: fullPath, isDirectory: entry.isDirectory() });
  }

  result.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
});

const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.webpack', '__pycache__', '.venv', 'dist', 'out', '.DS_Store', 'vendor', 'build']);
const FILE_INDEX_TTL = 10_000;
const FILE_INDEX_CAP = 50_000;

const fileIndexCache = new Map<string, { files: string[]; time: number }>();

async function walkProjectFiles(root: string): Promise<string[]> {
  const cached = fileIndexCache.get(root);
  if (cached && Date.now() - cached.time < FILE_INDEX_TTL) return cached.files;

  const files: string[] = [];
  const queue: string[] = [root];
  while (queue.length > 0 && files.length < FILE_INDEX_CAP) {
    const dir = queue.shift()!;
    let entries: fs.Dirent[];
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        queue.push(full);
      } else {
        files.push(path.relative(root, full));
      }
    }
  }
  files.sort();
  fileIndexCache.set(root, { files, time: Date.now() });
  return files;
}

ipcMain.handle('list-project-files', async (_event, root: string) => {
  return walkProjectFiles(root);
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

ipcMain.on('watch-file', (_event, filePath: string) => {
  if (watchers.has(filePath)) return;
  try {
    const watcher = fs.watch(filePath, () => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send('file-changed', filePath);
        }
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

ipcMain.on('save-last-project-root', (_event, root: string) => {
  saveLastProjectRoot(root);
});

const projectWatchers = new Map<string, fs.FSWatcher>();
const projectWatchTimers = new Map<string, ReturnType<typeof setTimeout>>();

ipcMain.on('watch-project', (_event, root: string) => {
  if (projectWatchers.has(root)) return;
  try {
    const watcher = fs.watch(root, { recursive: true }, () => {
      const existing = projectWatchTimers.get(root);
      if (existing) clearTimeout(existing);
      projectWatchTimers.set(root, setTimeout(() => {
        projectWatchTimers.delete(root);
        fileIndexCache.delete(root);
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) {
            win.webContents.send('project-files-changed');
          }
        }
      }, 2000));
    });
    projectWatchers.set(root, watcher);
  } catch {}
});

ipcMain.on('unwatch-project', (_event, root: string) => {
  const watcher = projectWatchers.get(root);
  if (watcher) { watcher.close(); projectWatchers.delete(root); }
  const timer = projectWatchTimers.get(root);
  if (timer) { clearTimeout(timer); projectWatchTimers.delete(root); }
});

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.handle('open-folder-in-new-window', (_event, folderPath: string) => {
  createWindow(folderPath);
});

ipcMain.on('open-external', (_event, url: string) => {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
});

ipcMain.handle('get-theme', () => {
  return loadState().theme || 'system';
});

ipcMain.handle('set-theme', (_event, theme: string) => {
  saveState({ theme });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('theme-changed', theme);
    }
  }
});

ipcMain.handle('get-spellcheck', () => {
  const state = loadState();
  return state.spellcheck !== false;
});

ipcMain.handle('set-spellcheck', (_event, enabled: boolean) => {
  saveState({ spellcheck: enabled });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.session.setSpellCheckerEnabled(enabled);
      win.webContents.send('spellcheck-changed', enabled);
    }
  }
});

ipcMain.handle('check-terminal-launcher', () => {
  return fs.existsSync('/usr/local/bin/mde');
});

ipcMain.handle('install-terminal-launcher', async () => {
  const dest = '/usr/local/bin/mde';
  const appBundle = app.getPath('exe').replace(/\/Contents\/MacOS\/.*$/, '');
  const script = `#!/bin/bash\nopen -a "${appBundle}" "$(cd "\${1:-.}" && pwd)"\n`;
  const tmp = path.join(app.getPath('temp'), 'mde-launcher');
  try {
    fs.writeFileSync(tmp, script, { mode: 0o755 });
    try {
      fs.copyFileSync(tmp, dest);
      fs.chmodSync(dest, 0o755);
    } catch {
      const { execSync } = require('child_process');
      execSync(`osascript -e 'do shell script "cp ${tmp} ${dest} && chmod +x ${dest}" with administrator privileges'`);
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
});

// --- Drag and drop at app level ---

let launchFileHandled = false;

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  let stat: fs.Stats;
  try { stat = fs.statSync(filePath); } catch { return; }

  if (stat.isDirectory()) {
    const existing = BrowserWindow.getAllWindows().find(w => {
      const ws = windowStates.get(w);
      return ws && ws.projectRoot === filePath;
    });
    if (existing) {
      existing.focus();
    } else {
      if (app.isReady()) {
        createWindow(filePath);
      } else {
        launchFileHandled = true;
        app.whenReady().then(() => createWindow(filePath));
      }
    }
  } else {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.webContents.send('open-file', filePath);
    } else {
      launchFileHandled = true;
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
  if (launchFileHandled) return;
  const cliPath = process.argv.find((arg, i) =>
    i > 0 && !arg.startsWith('-') && !arg.includes('electron') && !arg.includes('.webpack')
  );
  let projectRoot: string | null = null;
  if (cliPath) {
    try {
      const resolved = path.resolve(cliPath);
      if (fs.statSync(resolved).isDirectory()) projectRoot = resolved;
    } catch {}
  }
  createWindow(projectRoot || loadLastProjectRoot());
});

let isQuitting = false;

app.on('before-quit', (event) => {
  if (isQuitting || isTest) return;
  event.preventDefault();

  (async () => {
    let hasDirty = false;
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      try {
        hasDirty = await win.webContents.executeJavaScript(
          'document.querySelector(".tab-dirty-dot") !== null'
        );
        if (hasDirty) {
          const { response } = await dialog.showMessageBox(win, {
            type: 'warning',
            buttons: ['Quit', 'Cancel'],
            defaultId: 1,
            message: 'You have unsaved changes. Quit anyway and lose them?',
          });
          if (response !== 0) return;
          break;
        }
      } catch {}
    }
    isQuitting = true;
    app.quit();
  })();
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
