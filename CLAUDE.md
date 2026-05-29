# MDE -- Markdown Editor

## What this is

A WYSIWYG Markdown editor built with Electron + React + TipTap. See `plan.md` for full design.

## Architecture

**Main process** (`src/index.ts`): Window management, file I/O, IPC handlers, file watching, menu bar, drag-drop at the OS level, DOCX/PDF import conversion. No rendering.

- **Preload** (`src/preload.ts`): Exposes `window.mde` API via contextBridge. All file system access goes through this bridge.
- **Renderer** (`src/renderer.tsx`): React entry point. Imports Bootstrap Icons CSS and app styles.
- **Components** (`src/components/`): App, Sidebar, TabBar, Toolbar, Editor, FindBar, LinkBar, QuickOpen, ConflictBanner, TableMenu.
- **Types** (`src/types.ts`): Shared TypeScript types + `window.mde` declaration.
- **Markdown utils** (`src/utils/markdown.ts`): TipTap <-> Markdown serialization via tiptap-markdown.

## Key decisions

- `tiptap-markdown` handles MD parse/serialize. The TipTap document model is the source of truth while editing.
- TipTap (ProseMirror) for the editor, not raw contenteditable.
- Auto-save is opt-in (disabled by default). When enabled via Settings, saves after 1s of inactivity. Stored as `autosave` in `mde-state.json`. IPC: `get-autosave`, `set-autosave`, `autosave-changed`.
- File conflict detection: poll mtime, show red banner, disable Save (but not editing).
- State management: React context + useReducer, no external state lib.
- User preferences (theme, spellcheck, sidebar width, window bounds, last project root, fold state) stored in `mde-state.json` in Electron's userData dir via `loadState`/`saveState` helpers in index.ts.
- Initial file load uses a manual ProseMirror transaction with `addToHistory: false` so undo doesn't clear the buffer. Do not use `editor.commands.setContent()` for initial load -- TipTap's `beforeTransaction` event fires after history has already recorded the transaction.
- The `open-file` macOS event fires before `app.on('ready')` when launched via `mde .`. A `launchFileHandled` flag prevents the ready handler from creating a duplicate default window.
- Renderer webpack config does NOT use the `@vercel/webpack-asset-relocator-loader`. That loader breaks ESM imports from TipTap packages. It's only needed for native node modules in the main process.
- Code block copy button uses a TipTap NodeView (CodeBlockWithCopy extending CodeBlockLowlight) so ProseMirror's DOM reconciliation doesn't remove the button.
- Bootstrap Icons are self-hosted in `src/fonts/` (woff/woff2), imported via CSS in renderer.tsx.
- `confirm()` and `alert()` don't work in Electron's renderer. Use in-app toasts or inline confirmation UI instead.
- ProseMirror decorations (via Plugin with DecorationSet) are used for find-match highlighting and link-bar selection preservation. Always clean up decoration plugins on component unmount.
- File sidebar auto-refreshes via recursive `fs.watch` on the project root (debounced 2s). On macOS this uses FSEvents (kernel-level, zero CPU idle cost).
- PDF text extraction uses `pdfjs-dist/legacy/build/pdf.mjs` with the worker loaded into `globalThis.pdfjsWorker` (fake worker mode). Both `pdfjs-dist` and its worker are webpack externals -- they resolve from `node_modules` at runtime. Do NOT bundle them with webpack; the worker spawning mechanism breaks. Extraction uses position-based line grouping, multi-column layout detection (splits left/right columns when a >15% page-width gap is found), paragraph break detection (>1.5x median line height), and table detection (2+ aligned columns across 3+ consecutive lines).
- DOCX conversion preprocesses mammoth's HTML before turndown: strips `<p>` inside cells, promotes first row `<td>` to `<th>` with `<thead>`/`<tbody>` wrapping, so turndown-plugin-gfm's table rule can convert them. All conversion libraries (mammoth, turndown, turndown-plugin-gfm, pdfjs-dist) are webpack externals in `webpack.main.config.ts`.
- PDF text item joining uses gap-based spacing (>1px gap inserts space) rather than unconditional spaces, to handle PDFs with per-character text items (e.g. web-to-PDF renders).
- PDF heading detection: compares each line's font height to the page's most frequent (body) height. Lines >1.4x body height become headings; distinct sizes map to H1/H2/H3/H4 in descending order.
- PDF column-split detection is suppressed when >30% of lines span both sides of the gap (indicating a wide table, not a two-column layout).
- PDF table cell merging: continuation rows (col 0 empty) are merged into the previous logical row, handling multi-line cell content that spans multiple PDF text lines.
- PDF table run detection allows single-cluster continuation lines mid-run (cell text wrapping to a line with content in only one column).
- PDF conversion escapes lines matching `^\d+\.` to prevent Markdown OL interpretation of numbers like "994164972.".
- tiptap-markdown is configured with `html: false` so raw HTML tags in Markdown (e.g. `<ol>` in body text) are treated as literal text, not parsed as HTML elements. The text node serializer is overridden to skip tiptap-markdown's `escapeHTML` (which converts `<` `>` to `&lt;` `&gt;`), preserving prose like "Apples > oranges." verbatim on save. Standard Markdown character escaping (via prosemirror-markdown's `esc()`) is still applied.
- Sidebar folder expand/collapse state is lifted to the `Sidebar` component (not `DirectoryNode`) via a `Set<string>` of expanded paths, so it persists across explorer/outline view switches.
- Todo lists are unified with regular bullet list items via an extended `ListItem` with a `checked` attribute (`null` = bullet, `false` = unchecked task, `true` = checked task). All items live in a single `<ul>` -- no separate TaskList/TaskItem node types. Checkboxes are rendered via CSS `::before` pseudo-elements on `li[data-checked]`, with click handling via a ProseMirror plugin. Checked items show strikethrough. The `- [ ]` / `- [x]` input rule detects task syntax typed inside a list item. Markdown serialization prepends `[ ] ` / `[x] ` based on the `checked` attr. Enter in a task item creates a new unchecked task (not a bullet). Nesting mixed bullet/task items works naturally since they share one list type.
- Cmd+Enter cycles the current line (or all selected lines) between 3 states: bullet list (`checked: null`), unchecked task (`checked: false`), checked task (`checked: true`). Implemented as a custom TipTap extension (`CmdEnterCycle`) that toggles the `checked` attr via `setNodeMarkup`. Must never insert a line break.
- Tab/Shift+Tab: in lists, indent/outdent; elsewhere, insert a tab character. Always captured by the editor -- never escapes to browser focus behavior. Implemented as a custom TipTap extension (`TabHandler`).
- Cmd+Alt+Up/Down moves the block containing the cursor (paragraph, heading, or list item) above/below its sibling. For list items, operates within the list; for top-level blocks, swaps with the neighboring block. Implemented as the `MoveBlock` TipTap extension.
- Deleting a file via the sidebar also closes any tab open to that file, without adding it to the reopenable closed-tabs queue.
- Keyboard Shortcuts help page opens as a read-only tab. Content loaded from `docs/help/keyboard_shortcuts.md` via webpack `asset/source`. Read-only tabs hide the toolbar, TableMenu, and LinkPreview; the editor caret is transparent. **When adding or changing a keyboard shortcut, always update `docs/help/keyboard_shortcuts.md` and the shortcut summary in "What exists" below.**
- `deserializeInto` (used for file-reload on disk change) uses `createNodeFromContent` + manual transaction, not `setContent()`, to avoid the file appearing as raw HTML.
- File explorer context menu (rename, delete, copy path) and create file/folder use dedicated IPC handlers (`rename-file`, `trash-file`, `create-file`, `create-directory`). Delete moves to Trash via `shell.trashItem()`, never permanent delete.
- Sidebar drag-drop: files and folders can be dragged within the sidebar to move them into different folders (or to root). Dragging onto a file targets its parent folder. Drop targets (folder rows, root header) show a pulsating blue outline. Uses `renameFile` IPC (fs.rename) for the move. Prevents dropping into own descendants or current parent.
- Loose list handling: blank lines (`\n\n`) between list items at the same or parent indent level split them into separate lists on load. A `{LIST_SEPARATOR}` placeholder (plain ASCII) is inserted before parsing to trick markdown-it into splitting, then `cleanParsedListHtml()` replaces the placeholder `<p>` with an empty paragraph in the editor. On save, adjacent lists with an empty paragraph between them produce the `\n\n`. All lists are forced "tight" on load (`data-tight="true"`, `<p>` wrappers inside `<li>` removed) so tiptap-markdown never adds blank lines between items within the same list. The `JoinAdjacentLists` ProseMirror plugin auto-merges adjacent lists of the same type, so deleting the separator paragraph joins them.
- Horizontal rules show a blue outline (`var(--accent)`) when selected via `ProseMirror-selectednode` class.
- Enter at end of a parent list item (one that has a sublist) creates a new first child in the sublist rather than splitting the parent as a sibling. Only triggers when cursor depth is `liDepth + 1` (in the item's own paragraph). Enter on empty nested list items creates siblings (not bare `<p>` elements) -- the list-splitting behavior only applies at root level.
- Code folding: Cmd+. toggles collapse on list items with children. Fold state is stored in a ProseMirror plugin (`foldKey`) as a `Set<number>` of positions. Decorations add `folded` class to the `<li>` and a `fold-badge` widget (`<span>`) at the end of the paragraph. The fold caret is a CSS `::after` pseudo-element (SVG chevron) to the left of the bullet/checkbox. Clicking the caret (left padding area) or badge unfolds via `handleDOMEvents.mousedown`. Cmd+. only folds the item the cursor is directly in (paragraph at depth `liDepth + 1`); cursor in a childless nested item does nothing -- the keystroke is consumed (`return true`) to prevent propagation.
- Click-to-fold hover caret: the `foldKey` plugin also tracks a `hover` position (set via `SET_FOLD_HOVER` meta from a `mousemove` `handleDOMEvent`, cleared on `mouseleave`/toggle/docChange). When hovering an unfolded foldable item (innermost only, via `event.target.closest('li')`), a dim gray `.fold-caret` widget renders to the left of that single item -- no parents, no children. A 44px-left gutter-bridge keeps hover alive while the mouse travels toward the caret. The caret carries a `data-tooltip` "Fold sub-list (Cmd + .)" and its `mousedown` dispatches `TOGGLE_FOLD`. In `apply()`, the `TOGGLE_FOLD` check MUST precede `SET_FOLD_HOVER` (TOGGLE_FOLD also resets `hover: null`).
- Tooltips: toolbar buttons and the fold caret use a shared CSS `[data-tooltip]::after` bubble (0.45s hover delay, themed via `--tooltip-bg`/`--tooltip-text`). Toolbar buttons set `data-tooltip` + `aria-label` (not `title`) with platform-aware shortcut hints (e.g. "Bold selection (Cmd + B)"); `MOD` is `Cmd` on darwin else `Ctrl`. The fold-caret tooltip is positioned to the right of the caret via a `.fold-caret[data-tooltip]::after` override.
- `open-file` with no window: a closed-but-not-quit app (macOS dock) opening a file creates a window via `createWindow(null, filePath)`, passing the path as `pendingFile` in `WindowState`. The renderer PULLS it on mount via the `get-pending-file` IPC (which clears it), rather than the main process PUSHING `open-file` on `did-finish-load` -- the push raced the renderer registering its listener, causing intermittent empty-screen loads.
- Fold state persistence: stored in `mde-state.json` as `foldState: { [filePath]: number[] }` -- arrays of 1-based markdown line numbers. On fold/unfold, `foldPosToLineNumbers()` serializes the markdown and matches folded items' text to line numbers. On file load, `lineNumbersToFoldPositions()` matches persisted line numbers back to doc positions by text content. Both functions use `stripInlineMarkdown()` to strip bold/italic/code/link/escape formatting before comparing. File rename (`rename-file` IPC) migrates fold state keys. External file reloads (silent and conflict-banner) save/restore fold state around `deserializeInto`. Currently line-number-only; if folds are frequently lost from external edits, a djb2 hash of each line's text prefix can be added as a secondary matching fallback.

## Commands

```
npm start          # Run the app (electron-forge start)
npm test           # Build + run Playwright E2E tests (headless)
npx playwright test tests/app.spec.ts --grep "pattern"  # Run subset
rm -rf .webpack/ out/ && npm test  # Clean build (required after webpack config changes)
```

## Testing

Playwright in Electron mode. Tests live in `tests/`. Run with `npm test`. The `pretest` script in package.json runs `electron-forge package` to build the `.webpack/` bundle before tests execute. To skip the rebuild when iterating on tests without source changes, run `npx playwright test` directly.

**Tests MUST be headless.** No windows should pop up when tests run. The main process checks for `--test-headless` in `process.argv` and sets `show: false` on the BrowserWindow. The test helper passes this flag automatically via `electron.launch({ args: [mainPath, '--test-headless'] })`.

**When troubleshooting test failures, run one test or one grep pattern first**, not the full suite. The full suite takes \~20s; a single test takes <1s. Use `--grep "test name fragment"` to isolate.

**All features need E2E test coverage.** Conversion features (PDF, DOCX import) are especially important to test since they depend on external libraries and webpack bundling behavior that can break silently.

All verification goes through E2E tests -- do not start the app interactively to check behavior.

**Sidebar tab selectors** use `[title="File Explorer"]` and `[title="Document Outline"]` (not text content) since tabs show icons.

## Current status

68 E2E tests. The app has been manually tested and is in active use. Packaged app is named `MDE.app` (productName "MDE" in package.json, name "MDE" in forge.config.ts packagerConfig).

What exists:

- Electron shell with IPC bridge, menu bar (including Window menu with Hide/Minimize), drag-drop (with blue pulse overlay)
- TipTap WYSIWYG editor with Markdown load/save
- File explorer sidebar:
  - Resizable via drag handle (140--600px, width persisted to mde-state.json)
  - Root header with New File (`bi-file-earmark-plus`), New Folder (`bi-folder-plus`), Collapse All (`bi-arrows-collapse`) buttons
  - Selection state with teal highlight; Enter to rename selected item
  - Creates files/folders in selected folder or as sibling to selected file
  - Right-click context menu: Rename, Delete (confirmation dialog, moves to Trash), Copy Relative Path (shows info toast). Folders also show New File / New Folder. Dismissable with Escape.
  - Keyboard: Arrow Up/Down (navigate), Arrow Right/Left (expand/collapse folders), Enter (rename), Escape (deselect), Cmd+Backspace (delete with confirmation dialog)
  - Clicking outside sidebar deselects
  - Folder expand/collapse state persists across explorer/outline view switches
- Document outline sidebar (icon tabs with rounded bg, not text+underline)
- Tabbed editor with smart dirty tracking (undo back to original clears dirty), scroll position preserved across tab switches (saved via scroll event listeners, restored on tab activation)
- Toolbar with Bootstrap Icons (headings dropdown, bold, italic, strike, highlight, lists, todo list, blockquote, code, link, table, HR) -- wraps on narrow windows, undo/redo gray out when unavailable. Each button shows a styled tooltip on hover hinting its keyboard shortcut (e.g. "Bold selection (Cmd + B)").
- Link editing via floating LinkBar (top-right of editor, like FindBar) -- preserves text selection highlight via ProseMirror decorations while editing URL
- Link preview popup (top-right of editor area when cursor is in a link)
- Find/replace bar (inline below toolbar) with match highlighting (yellow border for all matches, yellow bg for active match), case-sensitive and whole-word filters, disabled nav when <=1 match, inline "Replace all" confirmation
- Code block copy button (NodeView-based, top-right corner, appears on hover)
- Table cell actions dropdown (three-dots trigger centered on top-right cell border, viewport-aware dropdown alignment, icons for insert/delete row/column)
- File conflict detection (silent reload / red banner)
- Quick Open command palette (Cmd+O) with fuzzy search, file indexing (10s TTL cache)
- DOCX/PDF import: converts to `.{ext}.md` on click (e.g. `report.pdf.md` -- preserves original extension), renames original to `.bak.{ext}`, backup files hidden from sidebar/quick-open. PDF extraction: position-based line grouping, multi-column layout detection, paragraph break detection, table detection. DOCX: mammoth + turndown with HTML table preprocessing for clean Markdown table output (zero HTML in output).
- PDF export (via Electron printToPDF)
- Dark mode support (light / dark / system default, stored in user state file)
- Settings dialog (Cmd+,) with theme selector, spellcheck toggle, auto-save toggle (1s debounce), terminal launcher installer
- Terminal launcher: `mde .` opens a folder from the terminal (installed via Settings)
- Toast notifications with semantic colors (danger, info variants -- separate text/border color variables for contrast in dark mode) and scale animations
- Window dimensions and position persisted and restored on reopen (debounced 500ms save on resize/move)
- Custom app icon (icon.icns, generated from icon.png)
- Rainbow wave color animation on project title in the title bar (12s cycle, 0.6s stagger per letter)
- Keyboard shortcuts: Cmd+S (save), Cmd+Shift+S (save as), Cmd+K (link), Cmd+Shift+E (code block), Cmd+F (find), Cmd+O (quick open), Cmd+Shift+O (open folder), Cmd+W (close tab), Cmd+Shift+T (reopen tab), Cmd+H (hide), Cmd+, (settings), Cmd+Alt+Left/Right (prev/next tab), Cmd+Enter (toggle todo checkbox), Cmd+Alt+Up/Down (move block/list item up/down), Cmd+. (toggle fold on list item with children)
- Keyboard Shortcuts help page: opens as a read-only tab from Help menu or empty-state link. Uses `initialContent` and `readOnly` tab properties.
- Help menu with Keyboard Shortcuts item (sends `show-keyboard-shortcuts` IPC)
- Code folding: Cmd+. on a list item with children toggles fold. When folded, children are hidden, a blue "..." badge appears after the text, and a blue chevron caret appears to the left of the bullet/checkbox. Fold state persists across file close/reopen and external file changes. Clicking the caret or badge unfolds. Hovering an unfolded foldable item shows a dim gray caret (with a "Fold sub-list (Cmd + .)" tooltip) that folds just that item on click.
- Sidebar defaults to the outline tab when a file is opened with no project folder set (the explorer would be empty, so the outline is more useful).

**Not yet done / known gaps:**

- DOCX export: menu item exists but handler is not wired in the renderer
- Image rendering (displaying existing `![](path)` references) is untested
- Toolbar hide/show setting not yet implemented

## CSS conventions

Utility classes are limited -- only `text-muted`, `fw-bold`, `fs-sm`, and a few others are defined. Do NOT assume Bootstrap utility classes like `d-flex`, `mt-3`, `gap-2` exist -- they are not included. Use inline styles or define component-specific classes when layout needs arise.

CSS variables for theming (defined in `:root`, `[data-theme="dark"]`, and `@media (prefers-color-scheme: dark)` blocks in `src/index.css`):

- Layout: `--bg`, `--bg-secondary`, `--bg-tertiary`, `--border`
- Text: `--text`, `--text-muted`
- Accent: `--accent`, `--accent-light`
- Danger: `--danger`, `--danger-bg`, `--danger-border`, `--danger-text`
- Info: `--info-text`
- Code: `--code-bg`, `--code-text`
- Highlight: `--highlight-bg`

When adding component styles:

- Use CSS variables for theme compatibility. Always set `color` and `background` on inputs and buttons so they work in dark mode.
- Component-specific classes are fine for anything with multi-property styling. Don't over-abstract.
- Keep utility definitions in `src/index.css` if adding new ones.
