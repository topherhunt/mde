# Changelog

## v0.4.0

### Editor

- **Wrap a selection in inline code**: With text selected on a single line, pressing `` ` `` wraps it in inline code (like `this`) instead of replacing it with a literal backtick. A backtick with no selection still types normally.
- **Copy from a code fence pastes as plain text**: Copying or cutting content from inside a code block now puts raw text on the clipboard, so it pastes anywhere -- prose or another fence -- without being re-wrapped in ``` gates.
- **Obsidian / nested list paste**: Pasting a bullet or task list from Obsidian (including an indented sub-tree, or mixed bullets and tasks) now produces a clean nested list instead of a code block or stray empty bullets. A list pasted inside an existing list merges into it.
- **No leading code fence**: A document can never start with a code block -- an empty paragraph is always kept above it so you have somewhere to place the cursor before the fence (mirroring the existing trailing block).
- **Plain code fences**: Code blocks now render as uniform, unhighlighted text. The language tag is still stored and round-tripped through Markdown; it just no longer drives token colors.

### Reliability

- **Bulletproof conflict detection**: Saving is now guarded by a content-hash check performed in the main process -- it re-reads and re-hashes the file and refuses to overwrite a version that changed on disk, so a stale buffer can never clobber newer content. mtime polling is gone.
- **Survives atomic saves**: File watching now watches the containing directory instead of the file inode, so an external atomic save (write-temp-then-rename, as most editors and CLI tools do) no longer silently kills the watcher.
- **Reload proof banner**: When a clean buffer is silently reloaded after an external change, a thin blue banner naming the file briefly overlays the top of the editor -- positive proof the live detection is working.
- **Single write path**: Every document write -- including cross-file Find & Replace -- now routes through the one hash-guarded save; the unguarded writer was removed entirely.

### Interface

- **About window build info**: The About window now shows both the release version and the 7-character git commit the build was made from.

### Development

- Inject the git commit at build time via a webpack `DefinePlugin` (`process.env.GIT_COMMIT`), with an `unknown` fallback for non-git builds.
- Dropped the `lowlight` syntax-highlighting wiring and its `.hljs-*` CSS in favor of the plain code-block extension.
- E2E coverage expanded to 108 tests (conflict detection, the four editor fixes, and Obsidian list paste).

---

## v0.3.0

### Editor

- **Follow links (Cmd/Ctrl+click)**: Cmd/Ctrl+click a Markdown link to follow it -- relative file links open in a new tab (resolved against the current file's folder, per CommonMark / GitHub / VS Code semantics), a missing target prompts to create the file, and external URLs open in the system browser. Plain click still positions the cursor for editing.
- **Two-stage Cmd+Left/Right (macOS)**: Cmd+Left/Right moves first to the start/end of the wrapped visual line, then -- on a second press -- to the start/end of the whole paragraph or list item. Shift extends at each stage. Non-Mac platforms keep native Ctrl+Arrow word motion.
- **Paste as plain text**: Cmd+Shift+V inserts clipboard text verbatim (newlines as hard breaks, no Markdown parsing).
- **No auto-linking**: Typing or pasting a bare path like `docs/foo.md` now stays literal text -- only real Markdown `[text](url)` links become links.
- **Fix: relative links no longer stripped on save**: Real Markdown links to relative local files (e.g. `[canon](docs/foo/00-canon.md)`) now survive a load/save round-trip instead of collapsing to plain text.
- **Obsidian/GitHub task-list paste**: Pasting HTML with GitHub-style task lists now correctly converts to checked/unchecked list items.
- **Enter outdents empty final child**: Enter on an empty final item of a sublist outdents to the parent level instead of nesting deeper.
- **Link bar remove button**: A trash button in the LinkBar removes an existing link; LinkPreview shifts left when it would overflow the editor's right edge.
- **Move-block keeps a plain cursor**: Cmd+Alt+Up/Down with no selection leaves a collapsed cursor in the moved block instead of selecting it.

### Find & Replace

- **Cross-file Find & Replace**: A toggle in the Find bar switches between current-file and all-project-files search. All-files mode scans every Markdown file in the project, shows a scrollable result list with per-file match counts, and replace shows a confirmation ("Replace N in M files?"), skipping any tab with unsaved changes.
- **Cmd+F focus**: Pressing Cmd+F while the Find bar is already open focuses and selects the search input instead of toggling the bar closed.

### Interface

- **Tab context menu**: Right-clicking a tab opens a Rename / Delete / Copy Relative Path menu (the same actions as the file explorer), with the open tab's path and watcher kept in sync.
- **Reveal in Finder**: File context menu gains a platform-aware "Reveal in Finder" / "Show in Explorer" / "Show in Folder" item. The copy-path item degrades to "Copy File Name" when no project folder is set.
- **Sidebar rename syncs open tab**: Renaming a file in the sidebar updates any open tab's name, path, mtime, and file watcher -- no more phantom conflict banners or broken saves.
- **Global error banner**: Otherwise-silent unhandled errors (e.g. an IPC call failing because a watched directory moved) surface as a dismissable red banner.
- **Fix: restore minimized windows**: Re-opening an already-open file or folder whose window is minimized now un-minimizes it instead of leaving it in the Dock.

### Development

- **Dependencies**: Replaced `pdf-parse` with a direct `pdfjs-dist` (^4.10.38) dependency (drops the transitive native canvas binaries); bumped Electron 42.1.0 -> 42.4.1.
- **Reproducible toolchain**: Added `.tool-versions` pinning Node 22.14.0.
- Renamed the `make` npm script to `release`; named the Windows installer `MDE-<version> Windows Setup.exe` to distinguish it from the macOS artifacts.

---

## v0.2.1

### Windows support

- **Windows build**: Installer, `.md` file association, `mde` CLI launcher, and native title bar, released alongside the macOS build.

### Editor

- **Table cell copy**: Copying a single cell yields just its text; copying multiple cells yields tab-separated rows (pastes as plain text in editors, as a real table into Word).
- **Click-to-fold caret**: Hovering an unfolded foldable list item shows a dim gray caret (with a "Fold sub-list" tooltip) that folds the item on click.
- **Scroll-synced outline**: The document outline highlights the heading currently scrolled to the top of the viewport.

### Interface

- **Toolbar tooltips**: Toolbar buttons show a styled tooltip hinting their keyboard shortcut on hover.
- **Outline default**: Sidebar defaults to the outline tab when a file is opened with no project folder set.
- **Fix dock-open empty screen**: Opening a file from the dock with no window open no longer intermittently loads a blank screen.

### Development

- **Windows CI**: Manually-triggered Windows Playwright workflow to catch Windows-specific breakage; documented the release process.
- CI runs on Node 22; GitHub Actions bumped to v5 (Node 24 runtime).
- Fixed a save-test race and `npm ci` errors.

---

## v0.2.0

### Editor

- **Code folding**: Cmd+. toggles fold on list items with children. Folded items hide sublists and show a blue "..." badge and chevron caret. Fold state persists across file close/reopen and external file changes.
- **Unified todo/bullet lists**: Replaced separate TaskList/TaskItem node types with a single ListItem that has a `checked` attribute. Bullets and tasks can be freely mixed and nested in the same list.
- **Cmd+Enter cycling**: Cycles lines between bullet, unchecked task, and checked task. Works on partial selections.
- **Tab/Shift+Tab**: Indent/outdent in lists, insert tab character elsewhere. Never escapes to browser focus.
- **Move block**: Cmd+Alt+Up/Down moves paragraphs, headings, or list items above/below siblings. Supports cross-parent reparenting.
- **Scroll persistence**: Scroll position preserved across tab switches.
- **Loose list handling**: Blank lines between list items split into separate lists on load, reproduced on save.
- **Enter behavior fixes**: Enter at end of a parent list item creates a new child in the sublist. Enter on empty nested items creates siblings.
- **Fix < and > escaping**: Override tiptap-markdown's text serializer so prose like "Apples > oranges." is preserved verbatim on save.
- **Smart clipboard**: Strips list marker when copying a single list item; keeps markers for multi-item copies.

### Features

- **Auto-save**: Opt-in setting (Settings dialog). Saves after 1s of inactivity.
- **Todo lists**: Toolbar button, Cmd+Enter toggle, strikethrough for checked items. Round-trips as `- [ ]` / `- [x]`.
- **Keyboard Shortcuts help page**: Read-only tab from Help menu or empty-state link.
- **Find bar improvements**: Whole-word filter, moved from floating overlay to inline bar below toolbar.
- **Delete confirmation dialog**: Modal dialog replaces inline two-step confirmation for file/folder delete.

### Sidebar

- **Keyboard navigation**: Arrow keys to move selection, Right/Left to expand/collapse folders, Enter to rename, Escape to deselect, Cmd+Backspace to delete.
- **Drag-drop**: Move files and folders within the sidebar. Drop targets show pulsating blue outline.
- **Collapse All button** in root header.
- **Folder context menu**: New File and New Folder options on right-click.
- **Delete closes tab**: Deleting a file also closes any tab open to that file.
- Folder expand/collapse state persists across explorer/outline view switches.

### PDF/DOCX import

- Multi-column layout detection (splits left/right columns on >15% page-width gap).
- Heading detection from font size relative to body text.
- Table cell merging for continuation rows.
- Column-split detection suppressed for wide tables.
- Escape lines matching `^\d+\.` to prevent Markdown OL interpretation.
- Gap-based spacing for text item joining.
- DOCX table preprocessing produces clean Markdown tables with zero HTML.

### Other

- **About window**: Custom About MDE window with version, credits, and GitHub link.
- **DMG maker**: @electron-forge/maker-dmg for macOS distribution.
- **Rainbow title**: Color wave animation on project title in the title bar.
- CSS: horizontal rule selection highlight, paragraph/heading margin adjustments, dark mode toast legibility fixes.
- 30+ new E2E tests (total: 68).

---

## v0.1.0

Initial release.

- Electron shell with IPC bridge, menu bar, and OS-level drag-drop (blue pulse overlay).
- TipTap WYSIWYG editor with Markdown load/save.
- File explorer sidebar with resizable width, right-click context menu (Rename, Delete, Copy Path), and auto-refresh via `fs.watch`.
- Document outline sidebar.
- Tabbed editor with smart dirty tracking and reopen closed tabs (Cmd+Shift+T).
- Tab drag-and-drop reordering, tentative tab previews.
- Toolbar with Bootstrap Icons (headings, bold, italic, strike, highlight, lists, blockquote, code, link, table, HR).
- Link editing via floating LinkBar with selection preservation.
- Link preview popup.
- Find/replace bar with match highlighting, case-sensitive filter.
- Code block copy button (NodeView-based).
- Table cell actions dropdown.
- File conflict detection (silent reload / red banner).
- Quick Open command palette (Cmd+O) with fuzzy search.
- DOCX/PDF import (converts to `.{ext}.md`, renames original to `.bak.{ext}`).
- PDF export (via Electron printToPDF).
- Dark mode support (light / dark / system default).
- Settings dialog (Cmd+,) with theme selector and spellcheck toggle.
- Terminal launcher (`mde .`).
- Toast notifications with semantic colors.
- Window dimensions and position persisted.
- Custom app icon.
- MIT License.
