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
  const savedBounds = isTest ? null : loadState().windowBounds;
  const [x, y] = focused
    ? focused.getPosition().map((v) => v + 30)
    : [savedBounds?.x, savedBounds?.y];

  const win = new BrowserWindow({
    height: savedBounds?.height || 800,
    width: savedBounds?.width || 800,
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

  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const saveBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized()) {
        saveState({ windowBounds: win.getBounds() });
      }
    }, 500);
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

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
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
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
    {
      role: 'windowMenu',
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

ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string) => {
  await fs.promises.rename(oldPath, newPath);
});

ipcMain.handle('trash-file', async (_event, filePath: string) => {
  await shell.trashItem(filePath);
});

ipcMain.handle('create-file', async (_event, filePath: string) => {
  await fs.promises.writeFile(filePath, '', 'utf-8');
});

ipcMain.handle('create-directory', async (_event, dirPath: string) => {
  await fs.promises.mkdir(dirPath, { recursive: true });
});

ipcMain.handle('list-directory', async (_event, dirPath: string) => {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const result: Array<{ name: string; path: string; isDirectory: boolean }> = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (isBackupFile(entry.name)) continue;
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
      if (isBackupFile(entry.name)) continue;
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

const IMPORTABLE_EXTENSIONS = ['.docx', '.pdf'];
const BACKUP_INFIX = '.bak';

function isBackupFile(name: string): boolean {
  return IMPORTABLE_EXTENSIONS.some(ext => name.endsWith(`${BACKUP_INFIX}${ext}`));
}

function isImportable(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORTABLE_EXTENSIONS.some(ext => lower.endsWith(ext)) && !isBackupFile(lower);
}

ipcMain.handle('convert-import', async (_event, filePath: string): Promise<{ mdPath: string } | { error: string }> => {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  const dir = path.dirname(filePath);
  const mdPath = path.join(dir, `${baseName}${ext}.md`);
  const backupPath = path.join(dir, `${baseName}${BACKUP_INFIX}${ext}`);

  try {
    const existingMd = await fs.promises.access(mdPath).then(() => true).catch(() => false);
    if (existingMd) {
      return { error: `${baseName}${ext}.md already exists. Delete or rename it first.` };
    }

    let markdown = '';

    if (ext === '.docx') {
      const mammoth = require('mammoth');
      const TurndownService = require('turndown');
      const result = await mammoth.convertToHtml({ path: filePath });
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      const { tables, strikethrough } = require('turndown-plugin-gfm');
      td.use([tables, strikethrough]);
      markdown = td.turndown(result.value);
    } else if (ext === '.pdf') {
      (globalThis as any).pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
      const buffer = await fs.promises.readFile(filePath);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;

      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const items: { str: string; x: number; y: number; width: number; height: number }[] = [];
        for (const item of content.items as any[]) {
          if (!item.str || item.str.trim() === '') continue;
          items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height });
        }
        if (items.length === 0) continue;

        // Group items into lines by Y position (tolerance ~2px)
        const lines: { y: number; height: number; items: typeof items }[] = [];
        for (const item of items) {
          const existing = lines.find(l => Math.abs(l.y - item.y) <= 2);
          if (existing) {
            existing.items.push(item);
          } else {
            lines.push({ y: item.y, height: item.height, items: [item] });
          }
        }

        // Sort lines top-to-bottom (PDF Y decreases going down)
        lines.sort((a, b) => b.y - a.y);
        // Sort items within each line left-to-right
        for (const line of lines) {
          line.items.sort((a, b) => a.x - b.x);
        }

        // Compute median line height for paragraph detection
        const heights = lines.map(l => l.height).filter(h => h > 0);
        heights.sort((a, b) => a - b);
        const medianHeight = heights.length > 0 ? heights[Math.floor(heights.length / 2)] : 12;

        // Try to detect table regions: 3+ consecutive lines with 3+ aligned columns
        const lineXClusters: number[][] = lines.map(line => {
          const xs = line.items.map(it => it.x);
          // Cluster X positions within ~10px
          const clusters: number[] = [];
          for (const x of xs) {
            if (!clusters.some(c => Math.abs(c - x) <= 10)) {
              clusters.push(x);
            }
          }
          clusters.sort((a, b) => a - b);
          return clusters;
        });

        // Find runs of lines that share 3+ column positions
        const isTableLine: boolean[] = new Array(lines.length).fill(false);
        let runStart = 0;
        while (runStart < lines.length) {
          if (lineXClusters[runStart].length < 3) { runStart++; continue; }
          let runEnd = runStart + 1;
          while (runEnd < lines.length && lineXClusters[runEnd].length >= 3) {
            // Check if columns align with the first line's columns
            const refCols = lineXClusters[runStart];
            const curCols = lineXClusters[runEnd];
            let matched = 0;
            for (const rc of refCols) {
              if (curCols.some(cc => Math.abs(cc - rc) <= 10)) matched++;
            }
            if (matched < 3) break;
            runEnd++;
          }
          if (runEnd - runStart >= 3) {
            for (let j = runStart; j < runEnd; j++) isTableLine[j] = true;
          }
          runStart = runEnd;
        }

        // Build output
        const outputParts: string[] = [];
        let tableBuffer: { cols: number[]; rows: string[][] }  | null = null;

        const flushTable = () => {
          if (!tableBuffer || tableBuffer.rows.length === 0) return;
          const { cols, rows } = tableBuffer;
          // Determine max width per column
          const widths = cols.map((_, ci) => Math.max(3, ...rows.map(r => (r[ci] || '').length)));
          const formatRow = (r: string[]) => '| ' + cols.map((_, ci) => (r[ci] || '').padEnd(widths[ci])).join(' | ') + ' |';
          outputParts.push(formatRow(rows[0]));
          outputParts.push('| ' + cols.map((_, ci) => '-'.repeat(widths[ci])).join(' | ') + ' |');
          for (let ri = 1; ri < rows.length; ri++) {
            outputParts.push(formatRow(rows[ri]));
          }
          tableBuffer = null;
        };

        for (let li = 0; li < lines.length; li++) {
          const line = lines[li];
          const lineText = line.items.map(it => it.str).join(' ');

          if (isTableLine[li]) {
            // Start or continue table
            if (!tableBuffer) {
              // Determine column positions from reference line cluster
              const cols = lineXClusters[li].slice();
              tableBuffer = { cols, rows: [] };
            }
            // Place items into columns
            const row: string[] = new Array(tableBuffer.cols.length).fill('');
            for (const item of line.items) {
              let bestCol = 0;
              let bestDist = Infinity;
              for (let ci = 0; ci < tableBuffer.cols.length; ci++) {
                const dist = Math.abs(item.x - tableBuffer.cols[ci]);
                if (dist < bestDist) { bestDist = dist; bestCol = ci; }
              }
              row[bestCol] = row[bestCol] ? row[bestCol] + ' ' + item.str : item.str;
            }
            tableBuffer.rows.push(row);
          } else {
            flushTable();
            // Determine gap from previous line
            if (li > 0 && !isTableLine[li - 1]) {
              const gap = lines[li - 1].y - line.y;
              if (gap > medianHeight * 1.5) {
                outputParts.push('');
              }
            }
            outputParts.push(lineText);
          }
        }
        flushTable();
        pages.push(outputParts.join('\n'));
      }
      markdown = pages.join('\n\n');
      doc.destroy();
    } else {
      return { error: `Unsupported file type: ${ext}` };
    }

    await fs.promises.rename(filePath, backupPath);
    await fs.promises.writeFile(mdPath, markdown, 'utf-8');
    return { mdPath };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Conversion failed: ${msg}` };
  }
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

ipcMain.handle('get-sidebar-width', () => {
  return loadState().sidebarWidth || null;
});

ipcMain.handle('set-sidebar-width', (_event, width: number) => {
  saveState({ sidebarWidth: width });
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
