# MDE -- Markdown Editor

## What this is

A WYSIWYG Markdown editor built with Electron + React + TipTap. See `plan.md` for full design.

## Architecture

- **Main process** (`src/index.ts`): Window management, file I/O, IPC handlers, file watching, menu bar, drag-drop at the OS level, DOCX/PDF import conversion. No rendering.
- **Preload** (`src/preload.ts`): Exposes `window.mde` API via contextBridge. All file system access goes through this bridge.
- **Renderer** (`src/renderer.tsx`): React entry point. Imports Bootstrap Icons CSS and app styles.
- **Components** (`src/components/`): App, Sidebar, TabBar, Toolbar, Editor, FindBar, LinkBar, QuickOpen, ConflictBanner, TableMenu.
- **Types** (`src/types.ts`): Shared TypeScript types + `window.mde` declaration.
- **Markdown utils** (`src/utils/markdown.ts`): TipTap <-> Markdown serialization via tiptap-markdown.

## Key decisions

- TipTap (ProseMirror) for the editor, not raw contenteditable.
- `tiptap-markdown` handles MD parse/serialize. The TipTap document model is the source of truth while editing.
- No auto-save. Explicit Cmd+S only.
- File conflict detection: poll mtime, show red banner, disable Save (but not editing).
- State management: React context + useReducer, no external state lib.
- User preferences (theme, spellcheck, last project root) stored in `mde-state.json` in Electron's userData dir via `loadState`/`saveState` helpers in index.ts.
- Initial file load uses a manual ProseMirror transaction with `addToHistory: false` so undo doesn't clear the buffer. Do not use `editor.commands.setContent()` for initial load -- TipTap's `beforeTransaction` event fires after history has already recorded the transaction.
- The `open-file` macOS event fires before `app.on('ready')` when launched via `mde .`. A `launchFileHandled` flag prevents the ready handler from creating a duplicate default window.
- Renderer webpack config does NOT use the `@vercel/webpack-asset-relocator-loader`. That loader breaks ESM imports from TipTap packages. It's only needed for native node modules in the main process.
- Code block copy button uses a TipTap NodeView (CodeBlockWithCopy extending CodeBlockLowlight) so ProseMirror's DOM reconciliation doesn't remove the button.
- Bootstrap Icons are self-hosted in `src/fonts/` (woff/woff2), imported via CSS in renderer.tsx.
- `confirm()` and `alert()` don't work in Electron's renderer. Use in-app toasts or inline confirmation UI instead.
- ProseMirror decorations (via Plugin with DecorationSet) are used for find-match highlighting and link-bar selection preservation. Always clean up decoration plugins on component unmount.
- File sidebar auto-refreshes via recursive `fs.watch` on the project root (debounced 2s). On macOS this uses FSEvents (kernel-level, zero CPU idle cost).
- PDF text extraction uses `pdfjs-dist/legacy/build/pdf.mjs` with the worker loaded into `globalThis.pdfjsWorker` (fake worker mode). Both `pdfjs-dist` and its worker are webpack externals -- they resolve from `node_modules` at runtime. Do NOT bundle them with webpack; the worker spawning mechanism breaks.
- DOCX/PDF import conversion (mammoth, turndown, pdfjs-dist) are all webpack externals in `webpack.main.config.ts`. Any new heavy Node library used only in the main process should be added there too.
- File explorer context menu (rename, delete, copy path) and create file/folder use dedicated IPC handlers (`rename-file`, `trash-file`, `create-file`, `create-directory`). Delete moves to Trash via `shell.trashItem()`, never permanent delete.

## Commands

```
npm start          # Run the app (electron-forge start)
npm test           # Build + run Playwright E2E tests (headless)
npx playwright test tests/app.spec.ts --grep "pattern"  # Run subset
rm -rf .webpack/ out/ && npm test  # Clean build (required after webpack config changes)
```

## Testing

Playwright in Electron mode. Tests live in `tests/`. Run with `npm test`.
The `pretest` script in package.json runs `electron-forge package` to
build the `.webpack/` bundle before tests execute. To skip the rebuild
when iterating on tests without source changes, run
`npx playwright test` directly.

**Tests MUST be headless.** No windows should pop up when tests run. The
main process checks for `--test-headless` in `process.argv` and sets
`show: false` on the BrowserWindow. The test helper passes this flag
automatically via `electron.launch({ args: [mainPath, '--test-headless'] })`.

**When troubleshooting test failures, run one test or one grep pattern
first**, not the full suite. The full suite takes ~20s; a single test
takes <1s. Use `--grep "test name fragment"` to isolate.

**All features need E2E test coverage.** Conversion features (PDF, DOCX
import) are especially important to test since they depend on external
libraries and webpack bundling behavior that can break silently.

All verification goes through E2E tests -- do not start the app
interactively to check behavior.

**Sidebar tab selectors** use `[title="File Explorer"]` and
`[title="Document Outline"]` (not text content) since tabs show icons.

## Current status

36 E2E tests. The app has been manually tested and is in active use.
Packaged app is named `MDE.app` (productName "MDE" in package.json,
name "MDE" in forge.config.ts packagerConfig).

What exists:

- Electron shell with IPC bridge, menu bar (including Window menu with Hide/Minimize), drag-drop (with blue pulse overlay)
- TipTap WYSIWYG editor with Markdown load/save
- File explorer sidebar (resizable via drag handle, width persisted; root header with new-file/new-folder buttons; selection state with teal highlight -- Enter to rename; creates files/folders in selected folder or as sibling to selected file; right-click context menu with Rename/Delete/Copy Relative Path) + document outline sidebar (icon tabs with rounded bg, not text+underline)
- Tabbed editor with smart dirty tracking (undo back to original clears dirty)
- Toolbar with Bootstrap Icons (headings dropdown, bold, italic, strike, highlight, lists, blockquote, code, link, table, HR) -- wraps on narrow windows, undo/redo gray out when unavailable
- Link editing via floating LinkBar (top-right of editor, like FindBar) -- preserves text selection highlight via ProseMirror decorations while editing URL
- Link preview popup (top-right of editor area when cursor is in a link)
- Find/replace floating bar with match highlighting (yellow border for all matches, yellow bg for active match), disabled nav when <=1 match, inline "Replace all" confirmation
- Code block copy button (NodeView-based, top-right corner, appears on hover)
- Table cell actions dropdown (three-dots trigger centered on top-right cell border, viewport-aware dropdown alignment, icons for insert/delete row/column)
- File conflict detection (silent reload / red banner)
- Quick Open command palette (Cmd+O) with fuzzy search, file indexing (10s TTL cache)
- DOCX/PDF import: converts to .{ext}.md on click (preserves original extension), renames original to .bak.{ext}, backup files hidden from sidebar/quick-open. PDF extraction uses position-based line grouping and table detection. DOCX uses mammoth + turndown with GFM tables plugin.
- PDF export (via Electron printToPDF)
- Dark mode support (light / dark / system default, stored in user state file)
- Settings dialog (Cmd+,) with theme selector, spellcheck toggle, terminal launcher installer
- Terminal launcher: `mde .` opens a folder from the terminal (installed via Settings)
- Toast notifications with semantic colors (danger, info variants) and scale animations
- Window dimensions persisted and restored on reopen (sidebar width + window bounds, stored in mde-state.json)
- Custom app icon (icon.icns, generated from icon.png)
- Keyboard shortcuts: Cmd+K (link), Cmd+Shift+E (code block), Cmd+F (find), Cmd+O (quick open), Cmd+H (hide), Cmd+, (settings)

**Not yet done / known gaps:**

- DOCX export: menu item exists but handler is not wired in the renderer
- Image rendering (displaying existing `![](path)` references) is untested
- Toolbar hide/show setting not yet implemented

## CSS conventions

Utility classes are limited -- only `text-muted`, `fw-bold`, `fs-sm`,
and a few others are defined. Do NOT assume Bootstrap utility classes
like `d-flex`, `mt-3`, `gap-2` exist -- they are not included. Use
inline styles or define component-specific classes when layout needs
arise.

When adding component styles:
- Use CSS variables (`var(--bg)`, `var(--text)`, `var(--border)`, etc.)
  for theme compatibility. Always set `color` and `background` on inputs
  and buttons so they work in dark mode.
- Component-specific classes are fine for anything with multi-property
  styling. Don't over-abstract.
- Keep utility definitions in `src/index.css` if adding new ones.
