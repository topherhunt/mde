# MDE -- Markdown Editor

## What this is

A WYSIWYG Markdown editor built with Electron + React + TipTap. See `plan.md` for full design.

## Architecture

- **Main process** (`src/index.ts`): Window management, file I/O, IPC handlers, file watching, menu bar, drag-drop at the OS level. No rendering.
- **Preload** (`src/preload.ts`): Exposes `window.mde` API via contextBridge. All file system access goes through this bridge.
- **Renderer** (`src/renderer.tsx`): React entry point.
- **Components** (`src/components/`): App, Sidebar, TabBar, Toolbar, Editor, FindBar, ConflictBanner.
- **Types** (`src/types.ts`): Shared TypeScript types + `window.mde` declaration.
- **Markdown utils** (`src/utils/markdown.ts`): TipTap <-> Markdown serialization via tiptap-markdown.

## Key decisions

- TipTap (ProseMirror) for the editor, not raw contenteditable.
- `tiptap-markdown` handles MD parse/serialize. The TipTap document model is the source of truth while editing.
- No auto-save. Explicit Cmd+S only.
- File conflict detection: poll mtime, show red banner, disable Save (but not editing).
- State management: React context + useReducer, no external state lib.
- User preferences (theme, last project root) stored in `mde-state.json` in Electron's userData dir via `loadState`/`saveState` helpers in index.ts.
- Initial file load uses a manual ProseMirror transaction with `addToHistory: false` so undo doesn't clear the buffer. Do not use `editor.commands.setContent()` for initial load -- TipTap's `beforeTransaction` event fires after history has already recorded the transaction.
- The `open-file` macOS event fires before `app.on('ready')` when launched via `mde .`. A `launchFileHandled` flag prevents the ready handler from creating a duplicate default window.
- Renderer webpack config does NOT use the `@vercel/webpack-asset-relocator-loader`. That loader breaks ESM imports from TipTap packages. It's only needed for native node modules in the main process.

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
first**, not the full suite. The full suite takes ~16s; a single test
takes <1s. Use `--grep "test name fragment"` to isolate.

All verification goes through E2E tests -- do not start the app
interactively to check behavior.

## Current status

34 E2E tests. The app has been manually tested and is in active use.
Packaged app is named `MDE.app` (productName "MDE" in package.json,
name "MDE" in forge.config.ts packagerConfig).

What exists:

- Electron shell with IPC bridge, menu bar, drag-drop (with blue pulse overlay)
- TipTap WYSIWYG editor with Markdown load/save
- File explorer sidebar (root shown as bold header, not collapsible) + document outline sidebar
- Tabbed editor with smart dirty tracking (undo back to original clears dirty)
- Toolbar (headings, bold, italic, strike, highlight, lists, blockquote, code, link, table, HR) -- wraps on narrow windows, undo/redo buttons gray out when unavailable
- Link preview popup (top-right of editor area when cursor is in a link)
- Find/replace floating bar
- File conflict detection (silent reload / red banner)
- PDF export (via Electron printToPDF)
- Dark mode support (light / dark / system default, stored in user state file)
- Settings dialog (Cmd+,) with theme selector and terminal launcher installer
- Terminal launcher: `mde .` opens a folder from the terminal (installed via Settings)
- Custom app icon (icon.icns, generated from icon.png)

**Not yet done / known gaps:**

- DOCX export: menu item exists but handler is not wired in the renderer
- Image rendering (displaying existing `![](path)` references) is untested

## CSS conventions

Prefer utility classes over single-purpose component classes. Follow
Bootstrap 5 naming conventions:

- Use utilities for spacing (`mt-3`, `px-2`), display (`d-flex`,
  `d-none`), text (`text-muted`, `fw-bold`, `fs-sm`), colors
  (`bg-danger`, `text-white`), borders (`border`, `rounded`), etc.
- Compose utilities on elements rather than writing a new class for
  every component.
- Only create a component-specific class when it has multi-property +
  state behavior that can't be composed from utilities (e.g. a
  `.toolbar-btn` with hover/active transitions).
- When a pattern recurs (e.g. muted labels, card containers), extract a
  reusable utility rather than N page-specific classes.
- Keep the utility definitions in a shared file so they're available
  everywhere.
