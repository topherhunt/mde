# MDE -- Markdown Editor

## What this is

A WYSIWYG Markdown editor built with Electron + React + TipTap. See `plan.md` for full design.

**This file holds the rules.** `docs/architecture-notes.md` **holds the reasoning** -- why each rule exists, what broke when the obvious approach was tried, and the implementation detail behind it. Below, `-> notes: X` means "read section X of `docs/architecture-notes.md` before touching this". Read the relevant section before changing a subsystem; add new rationale there, not here.

## Architecture

**Main process** (`src/index.ts`): Window management, file I/O, IPC handlers, file watching, menu bar, drag-drop at the OS level, DOCX/PDF import conversion. No rendering.

- **Preload** (`src/preload.ts`): Exposes `window.mde` API via contextBridge. All file system access goes through this bridge.
- **Renderer** (`src/renderer.tsx`): React entry point. Imports Bootstrap Icons CSS and app styles.
- **Components** (`src/components/`): App, Sidebar, TabBar, Toolbar, Editor, FindBar, LinkBar, QuickOpen, ConflictBanner, TableMenu, VersionPanel, DiffView.
- **Types** (`src/types.ts`): Shared TypeScript types + `window.mde` declaration.
- **Markdown utils** (`src/utils/markdown.ts`): TipTap <-> Markdown serialization via tiptap-markdown.
- **Checkpoints** (`src/git/`): repo detection and the managed marker, status, checkpoint creation, the auto-checkpoint poller, history reads, restore, init guardrails, default gitignore. Runs entirely in the MAIN process via isomorphic-git -- the renderer never sees a repo object. -> notes: Checkpoints

State management is React context + useReducer, no external state lib. User preferences (theme, spellcheck, sidebar width, window bounds, last project root, fold state) live in `mde-state.json` in Electron's userData dir via `loadState` / `saveState` in index.ts.

## Invariants

Break these and something silently corrupts, clobbers, or infinite-loops.

- **SINGLE WRITE PATH.** `write-file-if-unchanged` is the ONLY IPC that writes a document to disk. Do NOT add a raw `write-file` handler or `writeFile` bridge method back -- it was deliberately removed so nothing can bypass the hash guard. -> notes: Saving and conflict detection
- **On a real conflict, never adopt the on-disk hash.** It belongs to a version the user has not seen; adopting it would let the next Cmd+S clobber it. -> notes: Saving and conflict detection
- **Read** `diskHash` **from** `diskHashRef`**, and** `state.tabs` **from** `tabsRef` -- never from `activeTab` inside a timer closure. A stale closure caused self-conflicts. -> notes: Saving and conflict detection
- **Watch the containing directory, not the file.** `fs.watch` on a single file follows the inode, so an atomic save (write temp + rename) silently kills the watcher. -> notes: File watching
- `extensions` **and** `editorProps` **passed to** `useEditor` **MUST be** `useMemo`**'d with** `[]` **deps** -- never inline literals, or you get an infinite transaction loop ending in React error #185. Anything those closures reference must be module-level or a ref. -> notes: Editor wiring
- **Never use** `editor.commands.setContent()` **for loading a document.** Use a manual ProseMirror transaction with `addToHistory: false` (initial load) or `createNodeFromContent` + manual transaction (`deserializeInto`, for reloads). -> notes: Editor wiring
- `{LIST_SEPARATOR}` **must never reach the document or disk.** Two guards in `utils/markdown.ts`; `markdownToHtml()` is the single markdown -> editor-HTML entry point and must stay that way. -> notes: Lists and tasks
- **Fold state lives on the node as a** `folded` **attribute, never as positions in plugin state.** Position sets do not survive edits. -> notes: Folding
- **Folding must never mark a buffer dirty or clean.** The clean snapshot is `docSignature(doc)` (drops `folded` keys), and `onTransaction`'s re-baseline skips `FOLD_CHANGE`. -> notes: Folding
- **Clipboard: never decide the TSV path on "contains a table anywhere."** A mixed slice must fall through to the markdown serializer, or every non-table block is silently dropped from the copy. -> notes: Clipboard
- **Keep** `webpack.main.config.ts`**'s** `externalPackages` **in sync with** `externals`**.** A main-process external not listed there throws `Cannot find module` in the packaged app while working fine in dev. -> notes: Packaging and webpack
- **Keep** `EnableCookieEncryption` **false while the app is ad-hoc signed.** It makes Chromium create a keychain item, and an ad-hoc designated requirement is pinned to one exact binary hash -- so every release would prompt the user for their login keychain password. MDE uses neither cookies nor `safeStorage`. Revisit only if we get a Developer ID cert. -> notes: Packaging and webpack
- **Never remove** `forge.config.ts`**'s** `postPackage` **ad-hoc re-sign hook.** Forge leaves the macOS bundle with a signature that no longer matches it, and a BROKEN signature means "damaged, move to Trash" with no Open Anyway button -- strictly worse than no signature. The hook's `codesign --verify` gate must stay too, or the breakage is invisible until a user hits it. -> notes: Packaging and webpack
- **Import never mutates the source file.** No renaming, moving, or hiding, and no code path overwrites an already-converted Markdown. -> notes: Import (DOCX / PDF)
- `confirm()` **and** `alert()` **don't work in Electron's renderer.** Use in-app toasts or inline confirmation UI.
- **Renderer webpack config must NOT use** `@vercel/webpack-asset-relocator-loader` -- it breaks ESM imports from TipTap packages. Main process only.
- **Do NOT bundle** `pdfjs-dist` **or its worker with webpack** -- the worker spawning mechanism breaks. They stay externals and resolve from `node_modules` at runtime.
- **When adding or changing a keyboard shortcut, update** `docs/help/keyboard_shortcuts.md` -- it is the single source of truth for the shortcut list and is loaded into the in-app help tab.
- **Checkpoint history is append-only.** No `reset --hard`, no amend, no rebase, no force, ever. Restore writes old content as a NEW checkpoint on top, after taking a safety checkpoint first. -> notes: Checkpoints
- `mde.managed = true` **in** `.git/config` **is the ONLY thing that grants write mode**, and live evidence (a remote, a second branch) overrides it. Never key managed-ness off a path in `mde-state.json`. Never create a repo without the user opting in. -> notes: Checkpoints
- **Never return** `null` **from an isomorphic-git** `walk` **map** -- `null` means PRUNE, and returning it for the `'.'` root silently prunes the whole walk so every checkpoint reports zero files. Use `undefined`. -> notes: Checkpoints
- **Keep** `refresh: false` **on** `statusMatrix` **and the** `deraceIndex` **call after commit.** isomorphic-git has no racy-clean rule, so a same-second same-size write is otherwise invisible FOREVER -- the changes list silently omits a file that really changed. Both halves are required; do not "simplify" either. -> notes: Checkpoints
- **Restore writes BYTES, never a decoded string.** `readBlobAt` returns a Buffer; `readFileAt` (string) is for the diff viewer only. Decoding a blob to a JS string and writing it back as `'utf8'` replaced every invalid-UTF-8 byte with U+FFFD and destroyed a user's PDF. Whole-tree restore also byte-compares via `writeIfDifferent` -- identical files are not rewritten. -> notes: Checkpoints
- **A checkpoint's user-edited title is a sidecar (**`.git/mde-titles.json`**), never a commit rewrite.** Rewriting changes that commit's sha and every descendant's, stranding the `MDE-Restore:` trailers that name them, and isomorphic-git has no rebase to do it with. -> notes: Checkpoints
- **The checkpoint index must stay COMPLETE between checkpoints** (never dirty, but never emptied) -- `git.commit` builds its tree from it. Do not delete `.git/index`. -> notes: Checkpoints

## Key decisions

Short form. Follow the `-> notes:` pointer before changing any of these.

### Editor and document model

- `tiptap-markdown` handles MD parse/serialize. The TipTap document model is the source of truth while editing. TipTap (ProseMirror) for the editor, not raw contenteditable.
- tiptap-markdown runs with `html: false`, so raw HTML tags are literal text. The text node serializer skips `escapeHTML` so prose like "Apples > oranges." survives verbatim. A lone `~` is deliberately un-escaped on save. -> notes: Markdown serialization
- `LeadingParagraph` guarantees a document never starts with a code fence. -> notes: Editor wiring
- Syntax highlighting is deliberately OFF. Plain `CodeBlock`, not `CodeBlockLowlight`. The copy button is a NodeView. -> notes: Editor wiring
- ProseMirror decorations power find-match highlighting and link-bar selection preservation. Always clean up decoration plugins on unmount.
- Paragraph spacing and HR selection styling: -> notes: UI details

### Files, saving, watching

- Auto-save is opt-in (off by default), 1s debounce, stored as `autosave` in `mde-state.json`. IPC: `get-autosave`, `set-autosave`, `autosave-changed`.
- Conflict detection is content-hash based with two layers: a hash-guarded write (safety backstop) and a `file-changed` handler that silently reloads a clean buffer or raises the red banner on a dirty one. mtime no longer drives the decision. -> notes: Saving and conflict detection
- A silent reload shows a thin blue `.reload-notice` overlay banner for 5s as positive proof live detection is working. -> notes: File watching
- The sidebar auto-refreshes via recursive `fs.watch` on the project root (debounced 2s).
- `open-file` on macOS fires before `app.on('ready')`; a `launchFileHandled` flag prevents a duplicate window. With no window open, the renderer PULLS the path via `get-pending-file` rather than the main process pushing it. -> notes: App launch and window lifecycle

### Lists, tasks, folding

- Todo items and bullets are ONE node type: an extended `ListItem` with a `checked` attribute (`null` bullet / `false` unchecked / `true` checked). Checkboxes are CSS `::before` pseudo-elements. -> notes: Lists and tasks
- Enter inside a task item: checked-ness follows the text; the half that ends up empty is the unchecked one. -> notes: Lists and tasks
- Enter at the end of a parent item creates a first child in its sublist -- EXCEPT when the item is folded, where it creates a sibling below the whole subtree. -> notes: Lists and tasks
- Checkbox click is hit-tested by hand against the `CHECKBOX_*` constants in Editor.tsx, which MUST stay in sync with the `li[data-checked]::before` rule in index.css. -> notes: Lists and tasks
- `ListItemBackspace` (needs `priority: 1000` to beat ListKit) deletes an empty item and moves the cursor up, instead of outdenting.
- Custom extensions: `CmdEnterCycle` (Cmd+Enter, 3-state cycle, never inserts a line break), `TabHandler` (Tab/Shift+Tab, always captured by the editor), `MoveBlock` (Cmd+Alt+Up/Down).
- Loose lists: blank lines between items split them into separate lists via a `{LIST_SEPARATOR}` placeholder; all lists are forced tight on load; `JoinAdjacentLists` re-merges them when the separator is deleted. -> notes: Lists and tasks
- Cmd+. folds a list item with children or a heading section. Folds survive edits, reordering, and splitting; any edit that would hide the cursor releases the fold. Hovering a foldable node shows a click-to-fold caret (gutter for list items, inline for headings). -> notes: Folding
- Fold state persists to `mde-state.json` keyed by file path as 1-based markdown line numbers, matched back by `{kind, text}`. -> notes: Folding

### Clipboard and paste

- `SmartClipboard` produces plain text (never a re-created \`\`\` fence) when copying inside a code block, just the text (no `- `/ `[ ] `marker) when copying inside one list item, and TSV when copying pure table cells. -> notes: Clipboard
- `handlePaste` intercepts list-shaped plain text and routes it through MDE's own file-load pipeline, so a pasted list is structurally identical to a loaded one. This is what actually fixes real-world (Obsidian) list pastes -- `transformPastedText` never fires when the clipboard carries `text/html`. -> notes: Paste and input rules
- `BacktickWrap`: a backtick typed over a non-empty single-line selection wraps it in inline code.

### Links

- The Link extension runs with `autolink: false`, `linkOnPaste: false`, `addPasteRules: () => []`, and a custom `isAllowedUri` that is REQUIRED -- TipTap's default validator rejects relative links containing a slash, which silently drops their marks on load. -> notes: Links
- Cmd/Ctrl+click follows a link; plain click places the cursor. Relative paths resolve against the source file's folder (CommonMark / GitHub / VS Code semantics), and a missing target offers to create the file. -> notes: Links

### Sidebar

- The project header is `position: sticky; top: 0` and needs an opaque background; `.sidebar-content` must carry NO `padding-top`. -> notes: Sidebar and outline
- Folder expand/collapse state is lifted to `Sidebar` (not `DirectoryNode`) so it survives view switches.
- File ops go through dedicated IPC handlers (`rename-file`, `trash-file`, `reveal-in-finder`, `create-file`, `create-directory`). Delete moves to Trash via `shell.trashItem()`, never permanent delete. Deleting a file also closes its tab, without queueing it as reopenable.
- Drag-drop within the sidebar moves files/folders via `renameFile`; dropping into own descendants or current parent is blocked.
- The outline highlights the last heading scrolled past the viewport's top reading line. -> notes: Sidebar and outline

### Checkpoints (version history)

Full design and as-built record: `CHECKPOINTS.md`. Short form here.

- The word "Git" appears in the UI exactly ONCE: the first bullet of the how-it-works recap, which credits it and says you never have to touch it. No button, label, menu item, dialog, or toast may name Git -- a second mention is a regression, not a precedent. No staging, no branches, no remotes, no merge conflicts -- the audience is non-technical writers reviewing what an AI agent did to their files. -> notes: Checkpoints
- Four attach states: `none` (dimmed tab + signpost to Settings), `managed` (writable), `foreign` (read-only + adopt button), `steppedBack` (read-only, not adoptable). -> notes: Checkpoints
- **`mde.auto` is a second, ORTHOGONAL axis, not a second write permission.** `mde.managed` says MDE may write to this folder; `mde.auto` says whether it acts on that unprompted. Manual is the default (`writeMarker` writes `auto = false`), automatic is opt-in from Settings, and a MISSING key reads as `true` -- absence can only mean a folder activated before the setting existed. -> notes: Checkpoints
- **Turning checkpoints on lives in Settings, and there is deliberately no "turn off" button.** Flipping back to manual is the whole off switch; deleting a history the user might want back is not a thing a checkbox should do. The sidebar's `none` state is a signpost with the EXPLANATION plus an "Open Settings" button -- do not move the explanation into Settings, since nobody browses Settings. -> notes: Checkpoints
- Full history browsing lives in a read-only TAB (`Tab.view === 'history'` -> `HistoryView`), not an app mode: inactive panes are hidden, not unmounted, so open buffers keep their unsaved edits and undo history. The sidebar panel stays the glance. Both share `src/components/vcRestore.ts` so they can't phrase an outcome differently. -> notes: Checkpoints
- `HistoryView` **is the ONLY checkpoint drill-down, and the sidebar is the PRESENT TENSE only.** The sidebar renders the changes list and two buttons; every drill-down -- including a click on an uncommitted file -- routes into the tab. Two drill-downs over the same data is how the two views ended up wording the same restore differently. -> notes: Checkpoints
- Uncommitted work is the bottom of the SAME ladder, not a fourth concept: nav levels `working` (the checkpoint slot) and `workingFile` (the file slot), reached with `{ kind: 'working', path? }`. `ChangesSection` is exported from `VersionPanel.tsx` and mounted in both places rather than reimplemented. `workingFile` deliberately has no Restore -- every other Restore lands on a version that IS in history. -> notes: Checkpoints
- **Navigation into the history tab is** `{ target, nonce }`**, never a bare target.** Re-requesting the same target is the normal case (Browse while already on that checkpoint's diff) and an unchanged prop fires no effect, so a bare target silently fails to zoom back out. `HistoryView` seeds `nav` lazily at mount and tracks an `appliedNonce` ref. -> notes: Checkpoints
- In the checkpoint list the WHOLE ROW drills in (no button), and the counts (files / +added / -removed) sit right-aligned on the row's SECOND line so the title above can run the full width. Totals come from a SEPARATE `vc-checkpoint-stats` call made after the list -- never fold them into `listCheckpoints`, which must stay a cheap log walk. The same split applies to uncommitted files: `vc-status-counts` runs after the changes list, never inside `computeStatus`. An unmeasurable count is absent, never `0`. -> notes: Checkpoints
- The per-file view (right-click -> View Change History, in the file explorer or a tab) is a SCOPE on the list level, not a fourth nav level; drilling into a checkpoint from it still shows every file that checkpoint changed. `listFileCheckpoints` needs `force: true` or `log` throws on a deleted file. -> notes: Checkpoints
- `FileContextMenu` **is shared by the file explorer and the tab bar** -- add a menu item once and both get it. It is mounted inside `FileExplorer`, not `Sidebar`, so its props thread one level deeper than they look.
- One cadence rule, source-agnostic, and only in automatic mode: more than 10 minutes since the last checkpoint + uncommitted changes + a quiet period -> checkpoint everything. No separate behavior for agent writes vs. the user's own edits. `--vc-eligibility-ms` / `--vc-poll-ms` override the constants for tests. -> notes: Checkpoints
- **In manual mode `tick()` must clear `lastSignature` before returning, and `flushRoot` must return early.** Not clearing it deadlocks the poll gate open and the poller spins at full rate forever; not gating the flush means closing a folder or quitting produces exactly the surprise checkpoint manual mode opted out of. Both are "nothing happened" tests, both mutation-verified. -> notes: Checkpoints
- Detection polls `statusMatrix` (which excludes gitignored files); the watcher is demoted to an unfiltered dirty-flag gate. The poller gate is `!sawChange && lastSignature === null` -- the second half prevents a deadlock after a single burst of edits. -> notes: Checkpoints
- The quiet signature MUST fold in mtime and size: `statusMatrix`'s WORKDIR field is a coarse enum, not a content hash, so a rewritten file looks identical across polls. -> notes: Checkpoints
- isomorphic-git has no `add -A` -- walk the status and call `remove` for deletions, or they silently vanish from checkpoints. Whole-tree restore must delete files that did not exist at the target, or you get a union of both states. -> notes: Checkpoints
- Restore deliberately bypasses `write-file-if-unchanged` and writes straight to disk, so the existing conflict machinery handles open tabs for free. -> notes: Checkpoints
- **Restoring one file never fires from a button.** The button says only "Restore" and opens `RestoreFileDialog`, which offers BOTH directions -- "Undo this change" (`checkpoint.parent`) and "Use this version" (`checkpoint.sha`) -- because "restore to this checkpoint" is genuinely ambiguous next to a red/green diff. The cards must stay tinted with the diff's own `--diff-del-*` / `--diff-add-*`, not generic danger/success: that colour match IS the explanation. -> notes: Checkpoints
- **A tooltip inside** `.sidebar-content` **must not be centre-anchored.** `[data-tooltip]::after` is absolutely positioned and `nowrap`, and opacity 0 still takes part in layout, so one on a right-edge button pushed the panel's scrollable width ~47px past its visible width -- a permanent horizontal scrollbar with nothing to scroll to, at every sidebar width. The scoped rule right-anchors them. -> notes: UI details

### Import and packaging

- DOCX: mammoth + turndown, with HTML preprocessing so turndown-plugin-gfm's table rule fires. PDF: `pdfjs-dist` legacy build in fake-worker mode, with position-based line grouping, column detection, heading detection by font height, and table detection. -> notes: Import (DOCX / PDF)
- `forge.config.ts`'s `packageAfterCopy` hook copies main-process externals plus their transitive prod deps into the packaged app, because electron-forge ships an empty `node_modules` inside `app.asar`. -> notes: Packaging and webpack
- Bootstrap Icons are self-hosted in `src/fonts/`, imported via CSS in renderer.tsx.
- Tooltips use a shared CSS `[data-tooltip]::after` bubble; buttons set `data-tooltip` + `aria-label`, not `title`. -> notes: UI details

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

**When troubleshooting test failures, run one test or one grep pattern first**, not the full suite. The full suite takes ~20s; a single test takes <1s. Use `--grep "test name fragment"` to isolate.

**All features need E2E test coverage.** Conversion features (PDF, DOCX import) are especially important to test since they depend on external libraries and webpack bundling behavior that can break silently.

All verification goes through E2E tests -- do not start the app interactively to check behavior.

**Sidebar tab selectors** use `[title="File Explorer"]` and `[title="Document Outline"]` (not text content) since tabs show icons. The Checkpoints tab uses `.qa-vc-tab`.

**A test whose assertion is "nothing happened" must be seen to fail before you trust it.** Break the mechanism, watch the test go red, then restore. Several checkpoint tests are of this kind and were verified that way. Note that `npx playwright test` does NOT rebuild -- run `npx electron-forge package` first or the probe tests the old bundle and "passes" meaninglessly. Beware the transient-frame trap too: an assertion whose expected value also holds BEFORE the data settles will pass on the pre-fetch render. -> notes: Checkpoints

`tests/packaged.spec.ts` **tests the PACKAGED artifact, not the dev tree.** The rest of the suite launches Electron against `.webpack/main` with the project's own `node_modules` present, so anything that only breaks inside `app.asar` (missing runtime deps) passes there and fails for the user. That spec extracts `out/**/app.asar` and `require()`s the externals out of it in a real Node process. It can't just launch the packaged binary: the Fuses config (`RunAsNode: false`, `EnableNodeCliInspectArguments: false`) prevents Playwright's Electron driver from attaching.

## Current status

212 E2E tests. The app has been manually tested and is in active use. Packaged app is named `MDE.app` (productName "MDE" in package.json, name "MDE" in forge.config.ts packagerConfig).

For what exists today, see the **Feature inventory** in `docs/architecture-notes.md` (and README.md for the user-facing summary). The test suite is the authoritative answer to "is this implemented?".

**Not yet done / known gaps:**

- DOCX export: menu item exists but handler is not wired in the renderer (Export as PDF *is* wired)
- **Images are DESTROYED on save.** There is no image node in the editor schema, so an `![](path)` reference is dropped when the document loads and is simply absent when it is serialized back. Confirmed by probe, not inferred. Opening such a file now raises a blocking warning (`ImageWarningDialog`, fed by `findImageReferences` in `utils/markdown.ts`) -- that is a STOPGAP, not the fix, and it must be removed in the same change that adds a real image node. See TASKS.md. -> notes: Images are dropped, and the warning that says so
- Toolbar hide/show setting not yet implemented

## CSS conventions

**Utility-first, with a Bootstrap-shaped vocabulary. GROW the utility layer -- don't route around it.** Compose from utilities before writing a component-specific class, and when you need a common semantic style that doesn't exist yet, ADD it to the `--- Utilities ---` block near the top of `src/index.css` rather than reaching for an inline style or a one-off class. That block is intentionally small today; it is meant to grow.

Naming and semantics follow **Bootstrap 5** so the vocabulary is guessable without reading the stylesheet. Use Bootstrap's actual class names -- `.small`, `.fw-bold` / `.fw-semibold` / `.fw-normal`, `.text-muted`, `.text-danger`, `.text-center`, `.d-flex`, `.gap-2`, `.mt-3`, `.align-items-center`, `.justify-content-between` -- and Bootstrap's spacing scale (`0`=0, `1`=.25rem, `2`=.5rem, `3`=1rem, `4`=1.5rem, `5`=3rem) and semantic color names (primary, secondary, success, danger, warning, info). Do NOT invent parallel names for things Bootstrap already names (`.text-gray` and `.fs-sm` were exactly that mistake, since removed). Semantic color utilities must resolve to the theme variables below, not literal hex -- e.g. `.text-danger { color: var(--danger-text); }`, `.text-primary { color: var(--accent); }` -- so they stay dark-mode correct.

Currently defined: `.small` (0.875em), `.fw-bold` (600), `.text-muted` (`var(--text-muted)`). Everything else is fair game to add on first real need -- add it because a component needs it now, not speculatively.

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
- Component-specific classes are still right for a genuine multi-property component with hover/state (`.settings-row`, `.fold-caret`). Utilities are for the recurring single-purpose bits -- spacing, size, weight, color, flex.
- Keep ALL utility definitions in the one `--- Utilities ---` block in `src/index.css`, never scattered.
- A utility class with no definition is invisible -- it silently renders as body text. If styling looks unapplied, check the class actually exists before debugging anything else. (`.text-muted`, `.fs-sm` and `.fw-bold` were used 34 times across the components while defined nowhere.)
