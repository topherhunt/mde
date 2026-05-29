import { app, BrowserWindow, ipcMain, dialog, Menu, shell, nativeTheme } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

// On Windows, Squirrel runs the app with special args during install/update/uninstall.
// We handle these to create/remove Start Menu shortcuts and register the .md "Open with"
// file association, then quit. Returns true if such an event was handled.
function handleSquirrelEvent(): boolean {
  if (process.platform !== 'win32' || process.argv.length < 2) return false;

  const squirrelEvent = process.argv[1];
  const appFolder = path.resolve(process.execPath, '..');
  const rootFolder = path.resolve(appFolder, '..');
  const updateExe = path.resolve(path.join(rootFolder, 'Update.exe'));
  const exeName = path.basename(process.execPath);
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execSync, spawnSync } = require('child_process');

  const runUpdate = (args: string[]) => {
    try { spawnSync(updateExe, args, { detached: true }); } catch {}
  };

  // ProgId-based association: adds MDE to the "Open with" list for .md/.markdown
  // without hijacking the user's existing default handler.
  const progId = 'MDE.Markdown';
  const reg = (cmd: string) => { try { execSync(cmd); } catch {} };
  const registerAssoc = () => {
    const open = `"${process.execPath}" "%1"`;
    reg(`reg add "HKCU\\Software\\Classes\\${progId}" /ve /d "Markdown Document" /f`);
    reg(`reg add "HKCU\\Software\\Classes\\${progId}\\DefaultIcon" /ve /d "${process.execPath},0" /f`);
    reg(`reg add "HKCU\\Software\\Classes\\${progId}\\shell\\open\\command" /ve /d "${open}" /f`);
    reg(`reg add "HKCU\\Software\\Classes\\.md\\OpenWithProgids" /v "${progId}" /t REG_NONE /f`);
    reg(`reg add "HKCU\\Software\\Classes\\.markdown\\OpenWithProgids" /v "${progId}" /t REG_NONE /f`);
  };
  const unregisterAssoc = () => {
    reg(`reg delete "HKCU\\Software\\Classes\\${progId}" /f`);
    reg(`reg delete "HKCU\\Software\\Classes\\.md\\OpenWithProgids" /v "${progId}" /f`);
    reg(`reg delete "HKCU\\Software\\Classes\\.markdown\\OpenWithProgids" /v "${progId}" /f`);
  };

  switch (squirrelEvent) {
    case '--squirrel-install':
    case '--squirrel-updated':
      runUpdate([`--createShortcut=${exeName}`]);
      registerAssoc();
      app.quit();
      return true;
    case '--squirrel-uninstall':
      runUpdate([`--removeShortcut=${exeName}`]);
      unregisterAssoc();
      app.quit();
      return true;
    case '--squirrel-obsolete':
      app.quit();
      return true;
  }
  return false;
}

if (handleSquirrelEvent()) {
  // A Squirrel lifecycle event was handled; the app is quitting.
} else if (require('electron-squirrel-startup')) {
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

// Whether the UI is effectively dark, honoring the explicit theme override or the OS setting.
function effectiveDark(): boolean {
  const theme = loadState().theme || 'system';
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  return nativeTheme.shouldUseDarkColors;
}

// Colors for the native window-control overlay on Windows. Matches --bg-secondary / --text.
function titleBarOverlayColors() {
  return effectiveDark()
    ? { color: '#252526', symbolColor: '#ffffff', height: 38 }
    : { color: '#f5f5f5', symbolColor: '#1a1a1a', height: 38 };
}

// On Windows/Linux there's no `open-file` event; a second launch (double-click a file,
// `mde .`) starts a new process. Route its path into the running instance instead.
if (process.platform !== 'darwin' && !isTest) {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
  } else {
    app.on('second-instance', (_event, argv, workingDir) => {
      const target = findCliPath(argv, workingDir);
      if (target) {
        openResolvedPath(target);
      } else {
        const win = BrowserWindow.getAllWindows()[0];
        if (win) {
          if (win.isMinimized()) win.restore();
          win.focus();
        }
      }
    });
  }
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
    // macOS keeps the inset traffic lights; other platforms hide the frame and let the OS
    // draw min/max/close as an overlay sized to match the custom 38px drag region.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 12 } }
      : { titleBarStyle: 'hidden' as const, titleBarOverlay: titleBarOverlayColors() }),
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

let aboutWindow: BrowserWindow | null = null;

function showAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus();
    return;
  }
  aboutWindow = new BrowserWindow({
    width: 320,
    height: 240,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'About MDE',
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  const version = app.getVersion();
  const html = `<!DOCTYPE html>
<html><head><style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; text-align: center;
    padding: 30px 20px; margin: 0; background: #f5f5f7; color: #333; user-select: none; }
  h1 { font-size: 22px; margin: 0 0 4px; font-weight: 600; }
  .version { font-size: 13px; color: #888; margin-bottom: 16px; }
  .credit { font-size: 14px; margin-bottom: 8px; }
  a { color: #0066cc; text-decoration: none; font-size: 13px; }
  a:hover { text-decoration: underline; }
  @media (prefers-color-scheme: dark) {
    body { background: #2a2a2c; color: #e0e0e0; }
    .version { color: #999; }
    a { color: #4da3ff; }
  }
</style></head><body>
  <h1>MDE</h1>
  <div class="version">Version ${version}</div>
  <div class="credit">Made with \u{1F499} by Topher Hunt</div>
  <a href="https://github.com/topherhunt/mde">github.com/topherhunt/mde</a>
</body></html>`;
  aboutWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  aboutWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  aboutWindow.webContents.on('will-navigate', (e, url) => {
    e.preventDefault();
    shell.openExternal(url);
  });
  aboutWindow.once('ready-to-show', () => aboutWindow!.show());
  aboutWindow.on('closed', () => { aboutWindow = null; });
}

function buildMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'About MDE',
          click: () => showAboutWindow(),
        },
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
    {
      label: 'Help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            if (win) win.webContents.send('show-keyboard-shortcuts');
          },
        },
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

ipcMain.handle('rename-file', async (_event, oldPath: string, newPath: string) => {
  await fs.promises.rename(oldPath, newPath);
  // Migrate fold state to the new path
  const foldState = { ...(loadState().foldState || {}) };
  if (foldState[oldPath]) {
    foldState[newPath] = foldState[oldPath];
    delete foldState[oldPath];
    saveState({ foldState });
  }
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
      // Preprocess table HTML for turndown-plugin-gfm compatibility:
      // mammoth produces all <td> (no <th>), and wraps cell content in <p> tags.
      // The gfm tables plugin only converts tables with <th> header rows.
      let html = result.value;
      html = html.replace(/<table[^>]*>([\s\S]*?)<\/table>/g, (_match: string, inner: string) => {
        // Strip <p> tags inside cells
        let cleaned = inner.replace(/<td([^>]*)><p>([\s\S]*?)<\/p><\/td>/g, '<td$1>$2</td>');
        // Also handle multiple <p> in one cell
        cleaned = cleaned.replace(/<p>([\s\S]*?)<\/p>/g, '$1');
        // Find first <tr>...</tr> and convert its <td> to <th>
        const rows = cleaned.match(/<tr[\s\S]*?<\/tr>/g);
        if (rows && rows.length > 0) {
          const headerRow = rows[0].replace(/<td([^>]*)>/g, '<th$1>').replace(/<\/td>/g, '</th>');
          const bodyRows = rows.slice(1).join('');
          return '<table><thead>' + headerRow + '</thead><tbody>' + bodyRows + '</tbody></table>';
        }
        return '<table>' + cleaned + '</table>';
      });
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      const { tables, strikethrough } = require('turndown-plugin-gfm');
      td.use([tables, strikethrough]);
      markdown = td.turndown(html);
    } else if (ext === '.pdf') {
      (globalThis as any).pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.mjs');
      const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.mjs');
      const buffer = await fs.promises.readFile(filePath);
      const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false, isEvalSupported: false, useSystemFonts: true }).promise;

      const pages: string[] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const items: { str: string; x: number; y: number; width: number; height: number; fontName: string }[] = [];
        for (const item of content.items as any[]) {
          if (!item.str || item.str.trim() === '') continue;
          items.push({ str: item.str, x: item.transform[4], y: item.transform[5], width: item.width, height: item.height, fontName: item.fontName || '' });
        }
        if (items.length === 0) continue;

        type PdfItem = { str: string; x: number; y: number; width: number; height: number; fontName: string };

        const processItems = (itemsToProcess: PdfItem[]): string => {
          // Group items into lines by Y position (tolerance ~2px)
          const lines: { y: number; height: number; maxHeight: number; items: PdfItem[] }[] = [];
          for (const item of itemsToProcess) {
            const existing = lines.find(l => Math.abs(l.y - item.y) <= 2);
            if (existing) {
              existing.items.push(item);
              if (item.height > existing.maxHeight) existing.maxHeight = item.height;
            } else {
              lines.push({ y: item.y, height: item.height, maxHeight: item.height, items: [item] });
            }
          }

          // Sort lines top-to-bottom (PDF Y decreases going down)
          lines.sort((a, b) => b.y - a.y);
          // Sort items within each line left-to-right
          for (const line of lines) {
            line.items.sort((a, b) => a.x - b.x);
          }

          // Compute body text height as the most frequent (mode) line height
          const heightCounts = new Map<number, number>();
          for (const line of lines) {
            if (line.height > 0) {
              const rounded = Math.round(line.height);
              heightCounts.set(rounded, (heightCounts.get(rounded) || 0) + 1);
            }
          }
          let bodyHeight = 12;
          let maxCount = 0;
          for (const [h, count] of heightCounts) {
            if (count > maxCount) { maxCount = count; bodyHeight = h; }
          }

          // Collect distinct font sizes larger than body text for heading detection
          const headingSizes = [...new Set(lines.map(l => l.maxHeight).filter(h => h > bodyHeight * 1.4))];
          headingSizes.sort((a, b) => b - a);
          const getHeadingLevel = (h: number): number => {
            if (headingSizes.length === 0) return 0;
            const idx = headingSizes.findIndex(s => Math.abs(s - h) < 1);
            if (idx < 0) return 0;
            return Math.min(idx + 1, 4);
          };

          // Try to detect table regions: 3+ consecutive lines with 2+ aligned columns
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

          // Find runs of lines that share 2+ column positions.
          // Single-cluster lines are allowed mid-run (cell text wrapping to a
          // continuation line that only has content in one column).
          const isTableLine: boolean[] = new Array(lines.length).fill(false);
          let runStart = 0;
          while (runStart < lines.length) {
            if (lineXClusters[runStart].length < 2) { runStart++; continue; }
            let runEnd = runStart + 1;
            while (runEnd < lines.length) {
              const refCols = lineXClusters[runStart];
              const curCols = lineXClusters[runEnd];
              if (curCols.length >= 2) {
                let matched = 0;
                for (const rc of refCols) {
                  if (curCols.some(cc => Math.abs(cc - rc) <= 10)) matched++;
                }
                if (matched < 2) break;
              } else if (curCols.length === 1) {
                // Allow single-cluster continuation if it aligns with a ref column
                if (!refCols.some(rc => Math.abs(rc - curCols[0]) <= 10)) break;
              } else {
                break;
              }
              runEnd++;
            }
            if (runEnd - runStart >= 3) {
              for (let j = runStart; j < runEnd; j++) isTableLine[j] = true;
            }
            runStart = runEnd;
          }

          // Build output
          const outputParts: string[] = [];
          let tableBuffer: { cols: number[]; rows: string[][] } | null = null;

          const flushTable = () => {
            if (!tableBuffer || tableBuffer.rows.length === 0) return;
            const { cols, rows } = tableBuffer;
            // PDF tables have no cell boundaries -- each PDF line becomes a row.
            // When cell text wraps, continuation lines have content only in some
            // columns (col 0 empty). Merge these into the previous logical row
            // so "Navigating long reports and\nmanuals." becomes one cell, not two rows.
            const merged: string[][] = [];
            for (const row of rows) {
              if (merged.length > 0 && !row[0].trim()) {
                const prev = merged[merged.length - 1];
                for (let ci = 0; ci < cols.length; ci++) {
                  if (row[ci].trim()) {
                    prev[ci] = prev[ci] ? prev[ci] + ' ' + row[ci] : row[ci];
                  }
                }
              } else {
                merged.push([...row]);
              }
            }
            const widths = cols.map((_, ci) => Math.max(3, ...merged.map(r => (r[ci] || '').length)));
            const formatRow = (r: string[]) => '| ' + cols.map((_, ci) => (r[ci] || '').padEnd(widths[ci])).join(' | ') + ' |';
            outputParts.push(formatRow(merged[0]));
            outputParts.push('| ' + cols.map((_, ci) => '-'.repeat(widths[ci])).join(' | ') + ' |');
            for (let ri = 1; ri < merged.length; ri++) {
              outputParts.push(formatRow(merged[ri]));
            }
            tableBuffer = null;
          };

          for (let li = 0; li < lines.length; li++) {
            const line = lines[li];
            let lineText = '';
            for (let ii = 0; ii < line.items.length; ii++) {
              const item = line.items[ii];
              if (ii > 0) {
                const prev = line.items[ii - 1];
                const gap = item.x - (prev.x + prev.width);
                lineText += gap > 1 ? ' ' : '';
              }
              lineText += item.str;
            }

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
                if (gap > bodyHeight * 1.5) {
                  outputParts.push('');
                }
              }
              // Escape lines that would be parsed as ordered lists (e.g. "994164972.")
              const escaped = lineText.replace(/^(\d+)\./,  '$1\\.');
              const headingLevel = getHeadingLevel(line.maxHeight);
              if (headingLevel > 0) {
                outputParts.push('#'.repeat(headingLevel) + ' ' + escaped);
              } else {
                outputParts.push(escaped);
              }
            }
          }
          flushTable();
          return outputParts.join('\n');
        };

        // Detect multi-column layout
        const xPositions = items.map(it => it.x).sort((a, b) => a - b);
        const minX = xPositions[0];
        const maxX = xPositions[xPositions.length - 1];
        const pageWidth = maxX - minX;

        // Group items by approximate X position to find column starts
        const xBuckets: number[] = [];
        for (const x of xPositions) {
          if (!xBuckets.some(b => Math.abs(b - x) < 20)) xBuckets.push(x);
        }
        xBuckets.sort((a, b) => a - b);

        // Check for a significant gap that divides content into columns
        let columnSplit: number | null = null;
        if (xBuckets.length >= 4 && pageWidth > 200) {
          // Find the largest gap in the middle 60% of the page
          const midStart = minX + pageWidth * 0.2;
          const midEnd = minX + pageWidth * 0.8;
          let maxGap = 0;
          let gapX = 0;
          for (let i = 1; i < xBuckets.length; i++) {
            const mid = (xBuckets[i] + xBuckets[i - 1]) / 2;
            if (mid > midStart && mid < midEnd) {
              const gap = xBuckets[i] - xBuckets[i - 1];
              if (gap > maxGap) { maxGap = gap; gapX = mid; }
            }
          }
          // If the gap is significant (> 15% of page width), might be two columns
          // But first check it's not a wide table: if many lines span both sides, skip
          if (maxGap > pageWidth * 0.15) {
            const linesByY: Map<number, typeof items> = new Map();
            for (const item of items) {
              const yKey = Math.round(item.y);
              const bucket = linesByY.get(yKey) || [];
              bucket.push(item);
              linesByY.set(yKey, bucket);
            }
            let spanning = 0;
            let total = 0;
            for (const lineItems of linesByY.values()) {
              total++;
              const hasLeft = lineItems.some(it => it.x < gapX);
              const hasRight = lineItems.some(it => it.x >= gapX);
              if (hasLeft && hasRight) spanning++;
            }
            if (spanning / total < 0.3) {
              columnSplit = gapX;
            }
          }
        }

        if (columnSplit !== null) {
          const leftItems = items.filter(it => it.x < columnSplit);
          const rightItems = items.filter(it => it.x >= columnSplit);
          const leftText = processItems(leftItems);
          const rightText = processItems(rightItems);
          pages.push(leftText + '\n\n' + rightText);
        } else {
          pages.push(processItems(items));
        }
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
      if (process.platform === 'win32') {
        try { win.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
      }
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

ipcMain.handle('get-autosave', () => {
  return loadState().autosave === true;
});

ipcMain.handle('set-autosave', (_event, enabled: boolean) => {
  saveState({ autosave: enabled });
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('autosave-changed', enabled);
    }
  }
});

// Fold state persistence: stores folded list item line numbers per file.
// Currently uses markdown line numbers only. If folds are frequently lost
// due to external edits shifting line numbers, we can add a djb2 hash of
// each folded line's text prefix as a secondary matching criterion.
ipcMain.handle('get-fold-state', (_event, filePath: string) => {
  const foldState = loadState().foldState || {};
  return foldState[filePath] || [];
});

ipcMain.handle('set-fold-state', (_event, filePath: string, lineNumbers: number[]) => {
  const foldState = { ...(loadState().foldState || {}) };
  if (lineNumbers.length === 0) {
    delete foldState[filePath];
  } else {
    foldState[filePath] = lineNumbers;
  }
  saveState({ foldState });
});

ipcMain.handle('get-sidebar-width', () => {
  return loadState().sidebarWidth || null;
});

ipcMain.handle('set-sidebar-width', (_event, width: number) => {
  saveState({ sidebarWidth: width });
});

// On Windows the launcher is an mde.cmd in a per-user bin dir added to the user PATH.
function winLauncherPath(): string {
  const base = process.env.LOCALAPPDATA || app.getPath('appData');
  return path.join(base, 'MDE', 'bin', 'mde.cmd');
}

ipcMain.handle('check-terminal-launcher', () => {
  if (process.platform === 'win32') return fs.existsSync(winLauncherPath());
  return fs.existsSync('/usr/local/bin/mde');
});

ipcMain.handle('install-terminal-launcher', async () => {
  if (process.platform === 'win32') {
    const dest = winLauncherPath();
    const binDir = path.dirname(dest);
    const exe = process.execPath;
    // With no arg, open the current directory; otherwise open the resolved path of the arg.
    const script = `@echo off\r\nif "%~1"=="" ( start "" "${exe}" "%CD%" ) else ( start "" "${exe}" "%~f1" )\r\n`;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { execSync } = require('child_process');
    try {
      fs.mkdirSync(binDir, { recursive: true });
      fs.writeFileSync(dest, script);
      // Append binDir to the user PATH (read existing first to avoid setx truncation/duplication).
      let userPath = '';
      try {
        const out = execSync('reg query "HKCU\\Environment" /v Path', { encoding: 'utf-8' });
        const m = out.match(/Path\s+REG(?:_EXPAND)?_SZ\s+(.*)/i);
        if (m) userPath = m[1].trim();
      } catch {}
      const onPath = userPath.split(';').some(p => p.trim().toLowerCase() === binDir.toLowerCase());
      if (!onPath) {
        const newPath = userPath ? `${userPath};${binDir}` : binDir;
        execSync(`reg add "HKCU\\Environment" /v Path /t REG_EXPAND_SZ /d "${newPath}" /f`);
      }
      return { success: true, note: 'Open a new terminal window for the `mde` command to take effect.' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

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

// Find a file/folder path argument among process args (CLI launch or `second-instance`),
// resolving it against the launching shell's working directory. Returns null if none exists.
function findCliPath(argv: string[], cwd?: string): string | null {
  const arg = argv.find((a, i) =>
    i > 0 && !a.startsWith('-') &&
    !a.includes('electron') && !a.includes('.webpack') && !a.endsWith('.js')
  );
  if (!arg) return null;
  try {
    const resolved = path.isAbsolute(arg) ? arg : path.resolve(cwd || process.cwd(), arg);
    fs.statSync(resolved);
    return resolved;
  } catch {
    return null;
  }
}

// Open an already-resolved path: a directory as a project window, a file in a window.
function openResolvedPath(target: string): void {
  let stat: fs.Stats;
  try { stat = fs.statSync(target); } catch { return; }
  if (stat.isDirectory()) {
    const existing = BrowserWindow.getAllWindows().find(w => windowStates.get(w)?.projectRoot === target);
    if (existing) existing.focus();
    else createWindow(target);
  } else {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) {
      win.focus();
      win.webContents.send('open-file', target);
    } else {
      const newWin = createWindow();
      newWin.webContents.once('did-finish-load', () => newWin.webContents.send('open-file', target));
    }
  }
}

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
  // Keep the Windows window-control overlay colors in sync when the OS theme changes
  // (only matters when the app is following the system theme).
  if (process.platform === 'win32') {
    nativeTheme.on('updated', () => {
      if ((loadState().theme || 'system') !== 'system') return;
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          try { win.setTitleBarOverlay(titleBarOverlayColors()); } catch {}
        }
      }
    });
  }
  if (launchFileHandled) return;
  // A directory arg opens as a project; a file arg opens in a fresh window.
  const target = findCliPath(process.argv);
  if (target) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      createWindow(target);
      return;
    }
    const win = createWindow();
    win.webContents.once('did-finish-load', () => win.webContents.send('open-file', target));
    return;
  }
  createWindow(loadLastProjectRoot());
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
