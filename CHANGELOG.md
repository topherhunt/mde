# Changelog

## v0.6.0

### Checkpoints -- version history for a folder, without Git

The headline feature of this release. If you work alongside an AI agent (or just want an undo that outlives the editor), MDE can now snapshot your project folder on its own and show you, in plain prose, what changed and when. It's built on Git under the hood, but you never see or touch Git: no staging, no branches, no remotes, no merge conflicts.

- **Opt-in, per folder**: Nothing is ever tracked until you turn it on. An untracked folder shows a dimmed clock tab in the sidebar and an explainer. Turning it on runs a preflight check, sets up history, ignores the usual OS and editor junk, and takes a first checkpoint so the history is never empty.
- **Snapshots take themselves**: Roughly every ten to thirty minutes, whenever there are actual changes and things have gone quiet, MDE checkpoints the folder. Protection doesn't depend on you remembering to ask for it, and there's no separate behavior for an agent's writes vs. your own typing.
- **See what changed, as prose**: The diff highlights the added and removed *words* inside a changed sentence, keeping the rest inline as context. A `+`/`-` line diff lights up whole paragraphs, which for prose tells you nothing.
- **Browse the whole history in a tab**: "Browse all checkpoints" opens a full-page read-only tab with a breadcrumb: every checkpoint (50 at a time), the files each one touched with `+n -n` line counts, and the full-width diff. Your open documents keep their unsaved edits and undo history while you browse. The sidebar panel stays the quick glance.
- **Checkpoint titles that say something**: A checkpoint is named after the files it moved ("Updated ch1.md, ch2.md and 4 more") rather than "6 files changed", so you can recognize the moment you're looking for while scanning. A pencil on any checkpoint lets you write your own description instead, or reset back to the automatic one.
- **Restore one file, in either direction**: The Restore button opens a dialog offering both readings by name -- **Undo this change** (the file as it was before that checkpoint) and **Use this version** (as it came out of it) -- tinted with the same red and green as the diff you're looking at. It also tells you how many later checkpoints touching that file go with the choice, and says up front when a direction means the file goes away entirely.
- **Restore the whole folder**: One action, with the dialog stating in words which side of the checkpoint you land on (the end of it, its changes included) and pointing at the row below for the other direction. Files that already match are left completely alone, so "nothing needed restoring" is a real answer rather than a silent no-op.
- **Restoring never loses anything**: History is append-only. A restore takes a safety checkpoint of the current state first and then writes the old content as a *new* checkpoint on top, so the version you just replaced stays reachable and you can go forward again.
- **One document's history**: Right-click a file in the explorer or its tab and choose **View Change History** to see just the checkpoints that touched it. Works on files that have since been deleted.
- **Folders MDE didn't set up are read-only**: An existing Git repo opens in a look-but-don't-touch mode with a deliberate adopt button, and a folder that has since grown a remote or a second branch isn't adoptable at all. MDE never writes to a repository it doesn't own.

### Development

- E2E coverage expanded from 150 to 205 tests, all of the new ones in `tests/version-control.spec.ts`: the opt-in flow, every guardrail, automatic detection (including a same-second rewrite and deletions), the word-level diff, all restore paths including the dirty-buffer conflict, the three-level history drill-down, and checkpoint renaming.
- `CHECKPOINTS.md` is gone; its as-built content now lives in the Checkpoints section of `docs/architecture-notes.md`, with the short-form rules in `CLAUDE.md`.
- New runtime dependency: `isomorphic-git`, running entirely in the main process. The renderer never sees a repository object.

### Known issues

- **Opening and saving a file deletes any images in it.** The editor has no image node, so an `![alt](path)` reference is dropped when the document loads and is simply absent when it's written back -- silently, for both local and remote images. This is not new in v0.6.0, but it was only confirmed while preparing this release. Avoid editing files containing images until it's fixed; if you already have, the file's checkpoint history is the way back.
- **Export as DOCX** appears in the menu but isn't wired up. **Export as PDF** works, but it captures the visible page rather than rendering the whole document.

---

## v0.5.0

### Installation

- **macOS no longer reports MDE as "damaged"**: Every previous macOS build shipped with a code signature that no longer matched the app bundle, so downloading MDE produced "MDE is damaged and can't be opened. You should move it to the Trash." -- with no **Open Anyway** button, because macOS reports a mismatched signature as *tampering* rather than as an unknown developer. Installing required a Terminal command (`xattr -d com.apple.quarantine`). The packaged app is now re-signed and verified at build time, so installing is the normal three-click **System Settings > Privacy & Security > Open Anyway** flow. MDE still isn't notarized, so that one-time approval is still required.
- **No more keychain password prompt on macOS**: MDE asked for your login keychain password ("MDE wants to use your confidential information stored in MDE Safe Storage") on launch, and would have asked again after *every* update -- macOS ties that permission to an exact build, and each release is a different build. MDE never used the encrypted storage for anything, so it's disabled. If you already granted it, the leftover `MDE Safe Storage` entry can be deleted from Keychain Access.

### Editor

- **Folding never hides your cursor**: Any edit that would move the cursor into folded content now releases that fold automatically, instead of the line you're typing on silently vanishing. Tab-indenting the item below a folded item is the common case.
- **Enter at the end of a folded item**: Creates a sibling below the whole folded subtree rather than a hidden first child. A folded item reads as childless, so the new line used to look like it went nowhere. Unfold first to get the old first-child behavior.
- **Folds survive editing**: Fold state now travels with the list item or heading itself, so reordering (Cmd+Alt+Up/Down) or splitting an item no longer unfolds the real item and stamps a phantom `...` badge on an unrelated one.
- **Fold headings**: Cmd+. now folds a heading as well as a list item, hiding every block down to the next heading of the same or larger rank. The hover caret works on headings too.
- **Folding no longer marks a file dirty** -- or, worse, silently marks a file with unsaved edits as clean.
- **Task lists -- Enter carries checked-ness**: Splitting a checked task mid-item leaves both halves checked, so continuing a completed thought no longer silently un-completes it. Splitting at the start or end always leaves the empty half unchecked.
- **Task lists -- checkbox click**: Only a click actually inside the checkbox toggles it. Previously the entire first line of text (and every wrapped line below) was a toggle target, so clicking to place the cursor flipped the task instead.
- **Backspace on an empty list item** deletes just that item and moves the cursor to the end of the item above, instead of outdenting it and splitting the list in two.
- **Copying inside a list item** yields just the text -- no `- ` bullet or `[ ] ` checkbox, and no doubled markers from a nested item.
- **A lone `~` is no longer escaped on save**: Prose like "approx ~5" reached disk as `approx \~5`. Only a doubled `~~` opens a strikethrough, so a single tilde needs no escape.
- **Roomier paragraph spacing**: Paragraph top margin doubled, with the gap under headings deliberately unchanged.

### Reliability

- **No more phantom conflict banner**: The red "modified on disk" banner fired on files nothing but MDE had ever touched -- MDE was racing itself. A save whose on-disk bytes are identical to what we're writing is now treated as success, the expected hash is read synchronously rather than from a stale timer closure, and a save takes an in-flight lock that cancels any pending autosave. Edits typed *while* a save is in flight stay dirty instead of being falsely marked clean.
- **`{LIST_SEPARATOR}` can no longer reach your files**: A bulleted list inside a ``` fence had an internal placeholder injected into it, which was then written straight back into your code sample on save. List syntax inside a fence is content, and is now left alone; the single load path also hard-fails loudly on any placeholder that leaks through.
- **Import never touches the source file**: Converting `report.docx` no longer renames it to `report.bak.docx` and hides it from the sidebar. The source stays put, conversion writes `report.docx.md` beside it, and clicking an already-converted source offers to open that Markdown. "Convert again" always writes a new numbered copy (`report.docx.2.md`), so no code path can overwrite a converted file that may hold hand edits.
- **DOCX/PDF import works in the shipped app**: Import previously failed with "Cannot find module" for every real user while working perfectly in dev, because the packaged app shipped an empty `node_modules`. The conversion libraries and their dependency trees are now copied into the build.
- **Fixed the daily crash**: The "Maximum update depth exceeded" (React error #185) crash that hit roughly once a day under heavy use is gone -- the editor's options are no longer rebuilt on every render, which had let ProseMirror read back its own DOM selection as a new transaction and loop.
- **Select-all + copy keeps everything**: Copying a whole document containing a table used to put *only* the table on the clipboard, dropping every heading, paragraph, and list.

### Interface

- **Tools > Word Count**: Word count, character count, and estimated page count (300 words/page), shown as `selection / whole document` -- or just the document figure when nothing is selected.
- **Sticky sidebar project header**: The folder name and New File / New Folder / Collapse All buttons stay pinned at the top of a long file tree, with no transparent gap for rows to scroll through.
- **CSS utilities actually exist**: `.small`, `.fw-bold` and `.text-muted` were used ~34 times across the app while defined nowhere, so all of them silently rendered as plain body text.

### Development

- E2E coverage expanded from 108 to 150 tests, including a packaged-artifact spec that inspects the built `app.asar` and verifies the macOS code signature -- two classes of breakage the normal suite structurally cannot catch, since it runs against the dev tree.
- `docs/architecture-notes.md` now holds the reasoning behind each project rule; `CLAUDE.md` keeps the rules themselves plus an explicit "Invariants" section.

---

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
