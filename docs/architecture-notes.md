# MDE Architecture Notes

Detailed rationale behind the invariants listed in `CLAUDE.md`. Read the relevant section here before changing the subsystem it covers -- most of these notes exist because the obvious implementation was tried first and broke something.

`CLAUDE.md` holds the short version (the rule). This file holds the long version (why the rule exists, and what happens if you break it).

---

## Saving and conflict detection

### Single write path

`write-file-if-unchanged` is the ONLY IPC that writes a document to disk. There is deliberately no raw `write-file` handler / `writeFile` bridge method -- it was removed so nothing can bypass the hash guard. Cross-file Find & Replace (`FindBar`) also routes through it (with `expectedHash: null`, safe because it writes freshly-read+transformed content and skips open dirty tabs). Do NOT add a raw write-file back; it would be a silent clobber bypass.

Main-process direct `fs.writeFile`s exist only for non-buffer files: state JSON, new-empty-file creation, DOCX/PDF import output, PDF export, launcher scripts.

### Two layers of conflict detection

File conflict detection is content-hash based, with two layers.

**(1) Safety backstop.** Saving goes through the `write-file-if-unchanged` IPC, which re-reads the file on disk, sha256-hashes it, and refuses the write (returning `{conflict:true}`) if that hash no longer matches the `diskHash` the tab recorded when it last read/wrote the file. A stale buffer therefore cannot clobber a newer on-disk version even if the watcher missed the change entirely -- the renderer raises the red banner instead. Pass `expectedHash: null` to force (new file / Save As). `hash-file` returns the on-disk hash; both use `hashContent()` in index.ts. Each `Tab` carries `diskHash` (set on open, save, reload, rename, silent-reload).

**(2) Live detection.** The `file-changed` handler recomputes the disk hash and compares to `tab.diskHash` -- if equal it's a no-op (ignores spurious watcher fires and our own writes); if different and the buffer is clean it silently reloads; if dirty it shows the banner. mtime is no longer used for the change decision (kept only as informational `diskMtime`).

### The banner must not fire on our own writes

Three fixes, all required, after users hit a red banner on files nothing else had touched:

1. `write-file-if-unchanged` treats a hash mismatch whose on-disk content is BYTE-IDENTICAL to what we were asked to write as success, not a conflict (the write would be a no-op, so nothing can be lost -- a real divergence still hashes differently); it adopts the disk hash and returns ok.
2. The renderer's `diskHash` is read from a synchronous `diskHashRef` Map (`recordDiskHash` / `knownDiskHash`), not from `activeTab.diskHash`: an autosave `setTimeout` closure captured before a manual Cmd+S quoted the PRE-save hash and self-conflicted. `tabsRef` does the same for `state.tabs` in the `file-changed` handler.
3. `saveActiveTab` holds a `savingRef` in-flight lock, cancels any pending autosave timer before writing, and the autosave timer re-checks `tab.dirty` / `tab.conflict` from `tabsRef` before firing.

Relatedly, edits that land WHILE a write is in flight (`activeEditor.state.doc !== docAtWrite`) leave the tab dirty and re-arm autosave instead of being marked clean.

On a real conflict the renderer deliberately does NOT adopt the on-disk hash -- it belongs to a version the user has not seen, and adopting it would let the next Cmd+S clobber it.

### Auto-save

Opt-in, disabled by default. When enabled via Settings, saves after 1s of inactivity. Stored as `autosave` in `mde-state.json`. IPC: `get-autosave`, `set-autosave`, `autosave-changed`.

---

## File watching

### Watch the directory, not the file

File watching watches the *containing directory* (filtered by basename, refcounted per dir in `dirWatchers`), NOT the file inode. `fs.watch` on a single file follows the inode, so an atomic save by another program (write temp + rename over original -- what most editors and Claude's file tools do) silently kills the watcher. Watching the directory survives atomic replaces. When the platform reports a null filename, the handler notifies all watched files in that dir and lets the renderer's hash comparison decide.

### Auto-reload proof banner

When a clean buffer is silently reloaded after an external change, a thin blue `.reload-notice` banner naming the file appears. It is `position: absolute` at the top of `.editor-area`, so it OVERLAYS the top of the buffer (never pushes the text down). It fades in, stays 5s, then fades out (`showReloadNotice` sets `reloadNotice`, schedules `hiding: true` at 5s for the fade-out animation, and clears at 5.3s). Purely informational -- positive proof that live detection is working.

### Sidebar refresh

The file sidebar auto-refreshes via recursive `fs.watch` on the project root (debounced 2s). On macOS this uses FSEvents (kernel-level, zero CPU idle cost).

---

## Editor wiring

### `useEditor` options must be memoized

The `extensions` array and `editorProps` object passed to `useEditor` in Editor.tsx MUST be `useMemo`'d with `[]` deps -- never inline literals. `useEditor` runs an effect on EVERY render that identity-diffs those options against the live editor (it ignores only the `on*` callbacks), so fresh literals make it call `editor.setOptions()` -> `view.setProps()` + `view.updateState()` on every render. That re-syncs the DOM selection during React's commit phase, which ProseMirror's DOM observer can read back and dispatch as a transaction -- transaction -> render -> setOptions -> transaction ... until React aborts with "Maximum update depth exceeded" (minified error #185, thrown from inside `dispatchTransaction`). Anything those closures reference must be module-level or a ref.

Relatedly, `MARK_DIRTY` in App's reducer returns the existing state object unchanged when nothing actually differs, so a keystroke in an already-dirty buffer doesn't re-render the whole app.

### Loading content

Initial file load uses a manual ProseMirror transaction with `addToHistory: false` so undo doesn't clear the buffer. Do not use `editor.commands.setContent()` for initial load -- TipTap's `beforeTransaction` event fires after history has already recorded the transaction.

`deserializeInto` (used for file-reload on disk change) uses `createNodeFromContent` + manual transaction, not `setContent()`, to avoid the file appearing as raw HTML.

### Leading-paragraph guard

The `LeadingParagraph` extension's `appendTransaction` prepends an empty paragraph (with `addToHistory: false`) whenever `doc.firstChild` is a `codeBlock`, so a document can never START with a code fence -- there's always a block above it to place the cursor. Self-healing (once a paragraph is first, it won't re-fire) and, on initial load, folds into the clean-doc snapshot so it doesn't mark the buffer dirty. Mirrors the existing trailing-block behavior at the end of the doc.

### Misc

- `confirm()` and `alert()` don't work in Electron's renderer. Use in-app toasts or inline confirmation UI instead.
- ProseMirror decorations (via Plugin with DecorationSet) are used for find-match highlighting and link-bar selection preservation. Always clean up decoration plugins on component unmount.
- Code block copy button uses a TipTap NodeView (CodeBlockWithCopy extending the plain `@tiptap/extension-code-block` CodeBlock) so ProseMirror's DOM reconciliation doesn't remove the button. Syntax highlighting is deliberately OFF -- code fences render as uniform unhighlighted text (color `--code-text`). We use the plain CodeBlock, NOT CodeBlockLowlight/lowlight; the `language` fence attribute is still stored and round-tripped through markdown, it just doesn't drive token colors. (The NodeView still adds a `language-<lang>` class to `<code>` but no CSS consumes it.)

---

## Markdown serialization

### HTML handling

tiptap-markdown is configured with `html: false` so raw HTML tags in Markdown (e.g. `<ol>` in body text) are treated as literal text, not parsed as HTML elements. The text node serializer is overridden to skip tiptap-markdown's `escapeHTML` (which converts `<` `>` to `&lt;` `&gt;`), preserving prose like "Apples > oranges." verbatim on save. Standard Markdown character escaping (via prosemirror-markdown's `esc()`) is still applied.

### A lone `~` is never escaped

`prosemirror-markdown`'s `esc()` escapes every `~`, so prose like "approx ~5" hit disk as `approx \~5`; markdown-it only opens a strikethrough on a DOUBLED `~~`, so a single tilde needs no escape. The `TextNode` override in Editor.tsx un-escapes just the span `state.text()` appended (`state.out` is a mutable public field), using `/(?<!\\~)\\~(?!\\~)/g` so a `\~` adjacent to another `\~` is LEFT escaped -- under-escaping there would silently turn literal `~~text~~` into a real strike on the next load, and over-escaping is the safe direction. This is a serializer change, so it affects saved files as well as the clipboard.

---

## Lists and tasks

### Unified list items

Todo lists are unified with regular bullet list items via an extended `ListItem` with a `checked` attribute (`null` = bullet, `false` = unchecked task, `true` = checked task). All items live in a single `<ul>` -- no separate TaskList/TaskItem node types. Checkboxes are rendered via CSS `::before` pseudo-elements on `li[data-checked]`, with click handling via a ProseMirror plugin. Checked items show strikethrough. The `- [ ]` / `- [x]` input rule detects task syntax typed inside a list item. Markdown serialization prepends `[ ] ` / `[x] ` based on the `checked` attr. Nesting mixed bullet/task items works naturally since they share one list type.

### Enter inside a task item: checked-ness follows the text

Splitting mid-item leaves both halves checked; splitting at the very START pushes the text (and its check) down and leaves a fresh UNCHECKED item above; splitting at the END keeps the text checked above and starts an unchecked item below. In every case the half that ends up empty is the unchecked one. Implemented after `splitListItem` in `UnifiedListItem`'s Enter: it captures `origChecked` / `atStart` / `atEnd` BEFORE the split, then `setNodeMarkup`s the lower item (the cursor lands there) and, for the at-start case, the upper sibling too.

### Enter at the end of a parent item

Enter at end of a parent list item (one that has a sublist) creates a new first child in the sublist rather than splitting the parent as a sibling. Only triggers when cursor depth is `liDepth + 1` (in the item's own paragraph). Enter on empty nested list items creates siblings (not bare `<p>` elements) -- the list-splitting behavior only applies at root level.

EXCEPTION: when that parent item is FOLDED, the new item is inserted at `$from.after(liDepth)` as a SIBLING below the whole folded subtree. A folded item reads as childless -- the cursor sits right before the `...` badge -- so putting the new line inside hidden content would look like it vanished. Unfolding first restores the first-child behavior.

### Checkbox hit-testing

The task checkbox is a `::before` pseudo-element, so the DOM click target is the whole `<li>` and the toggle has to hit-test the box BY HAND. `UnifiedListItem`'s `checkboxClick` plugin compares the click's offset from the `<li>`'s top-left against the `CHECKBOX_LEFT` / `CHECKBOX_TOP` / `CHECKBOX_SIZE` / `CHECKBOX_SLOP` constants in Editor.tsx, which MUST stay in sync with the `li[data-checked]::before` rule in index.css. The old test was `event.clientX > liRect.left + 4`, which made the entire first line of text (and every wrapped line below it) a toggle target.

### Backspace on an empty item

Backspace on an EMPTY list item that has a previous sibling deletes just that item and puts the cursor at the end of the item above (`ListItemBackspace` extension). TipTap's own list keymap otherwise outdents the item -- splitting the list in two -- or, at top level, converts the PREVIOUS item into a paragraph. Bails (default behavior) for the first item of a list, an item with a sublist, or a non-empty item.

Needs `priority: 1000` to beat ListKit: `ExtensionManager.get plugins()` does `sortExtensions([...extensions].reverse())` and sorts by priority DESCENDING, so a HIGHER priority number means its keymap plugin runs FIRST.

### Other list keybindings

- **Cmd+Enter** cycles the current line (or all selected lines) between 3 states: bullet list (`checked: null`), unchecked task (`checked: false`), checked task (`checked: true`). Implemented as a custom TipTap extension (`CmdEnterCycle`) that toggles the `checked` attr via `setNodeMarkup`. Must never insert a line break.
- **Tab / Shift+Tab**: in lists, indent/outdent; elsewhere, insert a tab character. Always captured by the editor -- never escapes to browser focus behavior. Implemented as a custom TipTap extension (`TabHandler`).
- **Cmd+Alt+Up/Down** moves the block containing the cursor (paragraph, heading, or list item) above/below its sibling. For list items, operates within the list; for top-level blocks, swaps with the neighboring block. Implemented as the `MoveBlock` TipTap extension.

### Loose lists

Blank lines (`\n\n`) between list items at the same or parent indent level split them into separate lists on load. A `{LIST_SEPARATOR}` placeholder (plain ASCII) is inserted before parsing to trick markdown-it into splitting, then `cleanParsedListHtml()` replaces the placeholder `<p>` with an empty paragraph in the editor. On save, adjacent lists with an empty paragraph between them produce the `\n\n`. All lists are forced "tight" on load (`data-tight="true"`, `<p>` wrappers inside `<li>` removed) so tiptap-markdown never adds blank lines between items within the same list. The `JoinAdjacentLists` ProseMirror plugin auto-merges adjacent lists of the same type, so deleting the separator paragraph joins them.

### `{LIST_SEPARATOR}` must never reach the document

Two guards in `utils/markdown.ts`:

1. `fencedLines()` marks every line inside a ``` / `~~~` fence (opening indent 0-3, closing fence same char and at least as long with nothing after it) and `splitLooseLists()` skips them -- list syntax inside a fence is CONTENT, and inserting a separator there put a literal `{LIST_SEPARATOR}` in the user's code sample, which then got SAVED BACK TO DISK.
2. `markdownToHtml()` is the single markdown -> editor-HTML entry point (file load, external reload, paste, help pages all call it); it counts separators in the source, counts them in the output, `console.error`s any excess, and scrubs them when the source had none of its own (when the source DID contain one we cannot tell the user's text from ours, so it is left alone rather than deleting their content).

---

## Folding

### What is folded lives on the node

Cmd+. toggles collapse on a list item with children, or on a heading (which hides every following block down to the next heading of the same or larger rank -- `headingFoldRange()`).

The fold is a `folded` attribute added to `listItem` and `heading` by the `FoldAttribute` extension (`addGlobalAttributes`, `rendered: false` so it never reaches the DOM, the clipboard, or a saved file) -- NOT a position set in the plugin. Position sets do not survive edits: moving a list item (Cmd+Alt+Up rewrites the whole span) or splitting one (Enter at the start makes `p` point at the NEW empty item) left the fold on the wrong node and put a phantom `...` badge on an unrelated sibling. An attribute travels with its node through every transform.

`keepOnSplit` stays default-true so a split hands the flag to the half that keeps the sublist; the plugin's `appendTransaction` then clears `folded` in two cases:

1. A node that is no longer foldable (`isFoldable()`), which is what cleans up the empty half.
2. A node whose hidden span (`hiddenRange()`) now CONTAINS THE SELECTION. This is a general safety net against an invisible cursor -- Tab on the item below a folded one sinks it into that folded sublist, so the line being typed would simply disappear; instead the fold releases.

It runs on `selectionSet` as well as `docChanged`, and `setFolded()`'s deliberate selection-move keeps folding itself from tripping it.

`foldKey`'s state is now just a derived cache: `apply()` recomputes `collapsed` with `collectFolded(tr.doc)` on every `docChanged` (App.tsx reads it via `getFoldedPositions()`; `applyFoldPositions()` restores a persisted set). Every fold transaction is tagged `FOLD_CHANGE` and `addToHistory: false`.

Decorations add a `folded` class to the `<li>`/heading plus a `fold-badge` widget; a folded heading's siblings each get a `fold-hidden` (`display: none`) node decoration, since a heading's section isn't nested inside it. `setFolded()` moves the selection out of the range it is about to hide (ProseMirror cannot place a cursor in a `display: none` block).

Cmd+. only folds the item the cursor is directly in (paragraph at depth `liDepth + 1`); cursor in a childless nested item does nothing -- the keystroke is consumed (`return true`) to prevent propagation.

### Folding must never touch dirty state

The clean-buffer snapshot is `docSignature(doc)` (a `doc.toJSON()` whose JSON replacer drops every `folded` key), not the raw JSON -- otherwise a fold would mark a clean buffer dirty. And `onTransaction`'s re-baseline (which fires for any `addToHistory: false` doc change) skips `FOLD_CHANGE` transactions: re-baselining there would have marked a buffer with UNSAVED EDITS as clean.

### Click-to-fold hover caret

The `foldKey` plugin also tracks a `hover` position (set via `SET_FOLD_HOVER` meta from a `mousemove` `handleDOMEvent`, cleared on `mouseleave` / toggle / docChange).

The hovered item is found by COORDINATES, not DOM target: `view.posAtCoords({left: clamp(clientX into editor), top: clientY})` resolves the position under the pointer's Y, then the innermost `listItem` ancestor is used. This makes the entire row -- including the left gutter where the caret lives -- a hover target, so moving onto the caret never dismisses it. (The caret sits at `left: -33px`, outside the li's box and even left of `.tiptap`, so DOM-target / `closest('li')` detection failed there.) A guard at the top of `mousemove` returns early when `event.target.closest('.fold-caret')` so hovering the caret never recomputes (which would detach it mid-click).

When hovering an unfolded foldable item (innermost only), a dim gray `.fold-caret` widget renders to its left -- no parents, no children. The caret carries a `data-tooltip` ("Fold sub-list" / "Fold section" + "(Cmd + .)") and its `mousedown` toggles the node's `folded` attr.

Headings are hovered the same way (via `$pos.parent.type.name === 'heading'` when no listItem ancestor is found), but their caret is rendered INLINE after the heading text (`.fold-caret-inline`, the same spot the `...` badge takes) -- `.editor-content`'s left padding is only 12px, so at the list gutter offset (`left: -33px`) a top-level heading's caret would land on the sidebar and be unclickable. `.fold-caret-inline` must stay AFTER `.fold-caret` in index.css: same specificity, so source order decides. The blue `::after` chevron remains list-item-only for the same reason.

### Fold state persistence

Stored in `mde-state.json` as `foldState: { [filePath]: number[] }` -- arrays of 1-based markdown line numbers. On fold/unfold, `foldPosToLineNumbers()` serializes the markdown and matches folded nodes' text to line numbers. On file load, `lineNumbersToFoldPositions()` matches persisted line numbers back to doc positions by text content.

Matching is by `{kind, text}` (`foldableLineTarget()` for a markdown line, `foldableNodeTarget()` for a node), so a heading only ever matches a heading and a list item a list item; a task item's `[ ] ` / `[x] ` counts as part of the marker, not the text (it isn't in the node's `textContent`). Both functions use `stripInlineMarkdown()` to strip bold/italic/code/link/escape formatting before comparing.

File rename (`rename-file` IPC) migrates fold state keys. External file reloads (silent and conflict-banner) save/restore fold state around `deserializeInto`.

Currently line-number-only; if folds are frequently lost from external edits, a djb2 hash of each line's text prefix can be added as a secondary matching fallback.

---

## Clipboard

### Tables

ProseMirror writes BOTH a `text/html` (real `<table>`, pastes into Word) and a `text/plain` representation. The `SmartClipboard` extension's `clipboardTextSerializer` handles the plain-text side: `tableSliceToTSV()` emits tab-separated rows (`\t` between cells, `\n` between rows; a single cell yields just its text) -- but ONLY when EVERY top-level node of the copied slice is `table` / `tableRow` / `tableCell` / `tableHeader`.

A MIXED slice (e.g. Cmd+A over a doc with prose and a table) must fall through to `serializer.serialize(content)`; tiptap-markdown does have a table serializer, so the table comes out as a real Markdown table alongside the headings/paragraphs/lists. Deciding the TSV path on "contains a table anywhere" silently dropped every non-table block from the copy -- do not reintroduce that.

### Code blocks

Copying from INSIDE a code block yields plain text everywhere, never a re-created ``` fence. `SmartClipboard` handles the `copy` / `cut` DOM events directly (via `handleDOMEvents`, which ProseMirror runs BEFORE its built-in `serializeForClipboard`): when the selection lies entirely within one code block (`selectionInsideCodeBlock` -- `$from.parent.type.spec.code && $from.sameParent($to)`; a whole-block `NodeSelection` fails this because `$from.parent` is then the doc), it writes the raw `textBetween(from,to,'\n')` to BOTH `text/plain` AND a plain `text/html` (HTML-escaped lines joined by `<br>`, no block wrapper, so a paste merges inline into e.g. a prose paragraph), `preventDefault()`s, and (for cut) deletes the selection.

Providing plain HTML -- not clearing it -- is required: with no HTML, ProseMirror's paste routes text through tiptap-markdown's markdown parser (so `- x` would become a list). Whole-block copies and the code-block copy button are untouched (they fall through to the default path / their own `writeText`).

### List items

Copying from inside ONE list item yields just the text -- no `- ` bullet, no `[ ] ` checkbox. A copied ProseMirror slice keeps every ancestor the selection sits under, so a nested task item used to serialize the ancestor item's marker AND its own, producing `- [ ] - [ ] the text` in the plain-text clipboard.

`clipboardTextSerializer` (after the TSV check) serializes only `$from.parent.cut(...)` when the selection is non-empty, within a single non-code textblock, and inside a `listItem`. Inline formatting (bold, links, code) is still serialized. A whole-item copy (which fails `sameParent`) is handled by the follow-up single-child check that unwraps a lone `bulletList` / `orderedList` / `listItem` -- one list item is a line of text, not a list -- while any sublist it carries keeps its markers.

---

## Paste and input rules

### Backtick-wrap

The `BacktickWrap` extension's `handleTextInput` intercepts a lone `` ` `` typed over a NON-EMPTY, single-line selection and runs `toggleCode()` (wrap in inline `code`) instead of replacing the selection. Bails if inside a code block (`$from.parent.type.spec.code`), if the range contains a `\n` (`doc.textBetween(from,to,'\n')`), or if there's no selection -- so a collapsed cursor still types a literal backtick.

### Paste dedent

Before tiptap-markdown parses pasted plain text, `dedentPastedText()` (via the `transformPastedText` editorProp) strips the whitespace prefix common to every non-blank line. Markdown copied from a nested position (e.g. an indented Obsidian list sub-tree) arrives with a leading tab / 4 spaces on every line, which markdown-it reads as an indented code block instead of a list; removing the shared indent restores the list while keeping deeper relative nesting. Skipped when the second arg (`inCode || plainText`) is true, so pasting into a code block or a Shift+plain paste stays verbatim.

NOTE: `transformPastedText` only runs on the TEXT clipboard path -- ProseMirror's rule is `asText = text && (plainText || inCode || !html)`, so when the clipboard also carries `text/html` (Obsidian and most editors always do) it takes the HTML path and this never fires. The `handlePaste` interceptor below is what actually fixes real-world list pastes; `dedentPastedText` remains the shared helper both call.

### List-paste interceptor

The `handlePaste` editorProp is the robust fix for pasting bulleted/numbered lists (esp. from Obsidian, whose clipboard always includes `text/html`). When the clipboard's `text/plain`, after `dedentPastedText()`, has a first non-blank line matching a list marker (`[-*+]` or `\d+[.)]`), it bypasses the HTML path entirely and routes the plain text through MDE's own file-load pipeline (`escapeBulletNumbers` -> `splitLooseLists` -> `parser.parse` -> `cleanParsedListHtml` -> `PMDOMParser.parseSlice` with `context: $from` -> `replaceSelection`), so a pasted list is structurally identical to a loaded one (proper nesting, tight lists, task checkboxes).

`escapeBulletNumbers` backslash-escapes an ordered marker that directly follows a bullet on the same line (`- 1. x` -> `- 1\. x`) so it stays a literal bullet (matching Obsidian) instead of collapsing into an empty parent bullet + ordered sub-list per CommonMark.

The interceptor bails (returns false, default path runs) for non-list text, Shift+plain paste (`view.input.shiftKey`), pastes into a code block, and non-text (image) clipboards -- so prose, Word tables (`text/html`), and code paste unchanged. Reaches the parser via `editorRef` (set in the onReady effect) to avoid a use-before-define on the `editor` const.

Merging a pasted list into an existing list item at a boundary keeps ProseMirror's native list-paste behavior (a leading empty item / last-item join can occur); the common case -- pasting onto an empty line or empty doc -- is clean.

---

## Links

### Link extension configuration

The Link extension is configured with `autolink: false`, `linkOnPaste: false`, and `addPasteRules: () => []` so typing/pasting a path like `docs/foo.md` stays literal text -- only real Markdown `[text](url)` links are created.

A custom `isAllowedUri` (`ctx.defaultValidate(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url)`) is REQUIRED: TipTap's default validator regex `[^a-z+.-:]` treats `.-:` as a character range covering `/`, so it rejects relative links that start with a lowercase letter and contain a slash (e.g. `docs/foo/09-bar.md`). Without the override, those links' marks are dropped while parsing HTML on load, so they collapse to plain text on the next save. The override accepts any scheme-less (relative) URL while still blocking dangerous schemes like `javascript:` / `data:`.

### Following links

Cmd/Ctrl+click on a link in the editor follows it (plain click is left alone so the cursor can be placed inside link text to edit). Implemented as `handleClick` in the Editor's `editorProps` -- it reads the raw `href` via `getAttribute('href')` (the `.href` property would resolve to an absolute `file://` URL) and calls an `onLinkClick` prop.

App's `handleLinkClick(href, sourceFilePath)` opens scheme URLs (`http:` / `mailto:` etc.) via `openExternal`; for relative paths it strips any `#anchor` / `?query` and resolves with `resolvePath()` from `utils/paths.ts` against the source file's folder (CommonMark / GitHub / VS Code semantics -- a bare path like `docs/foo.md` is relative to the current file, same as `./docs/foo.md`; `projectRoot` is used only as a fallback for an unsaved buffer). Then `getFileStats` decides: existing file -> `openFile`, directory -> toast, missing -> a `CreateFileDialog` that `createDirectory` + `createFile` + `openFile` on confirm.

The `onLinkClick` prop is bound per-tab in the Editor map; inside the Editor a ref (`onLinkClickRef`) bridges it into the once-created ProseMirror click closure.

---

## Import (DOCX / PDF)

### Import never mutates the source

The old flow renamed `report.docx` to `report.bak.docx` and filtered `.bak.` files out of the sidebar and quick-open index -- a file the user could see one moment and not the next, under a name they never chose.

Now the source stays exactly where it is, and the disambiguation happens at click time: `get-import-target` reports whether `<source>.md` exists, and if it does the renderer shows `ImportExistsDialog` (open the existing Markdown / convert again / cancel) instead of the first-time `ImportConfirmDialog`. `convert-import` takes `{ newCopy?: boolean }`; without it the handler refuses to write over an existing target, with it `nextFreeImportTarget()` walks `<source>.2.md`, `.3.md`, ... to the first free name. There is no code path that overwrites a converted Markdown -- it may contain hand edits.

### DOCX

DOCX conversion preprocesses mammoth's HTML before turndown: strips `<p>` inside cells, promotes first row `<td>` to `<th>` with `<thead>` / `<tbody>` wrapping, so turndown-plugin-gfm's table rule can convert them. All conversion libraries (mammoth, turndown, turndown-plugin-gfm, pdfjs-dist) are webpack externals in `webpack.main.config.ts`.

### PDF

PDF text extraction uses `pdfjs-dist/legacy/build/pdf.mjs` with the worker loaded into `globalThis.pdfjsWorker` (fake worker mode). Both `pdfjs-dist` and its worker are webpack externals -- they resolve from `node_modules` at runtime. Do NOT bundle them with webpack; the worker spawning mechanism breaks.

Extraction heuristics:

- Position-based line grouping; multi-column layout detection (splits left/right columns when a >15% page-width gap is found); paragraph break detection (>1.5x median line height); table detection (2+ aligned columns across 3+ consecutive lines).
- Text item joining uses gap-based spacing (>1px gap inserts space) rather than unconditional spaces, to handle PDFs with per-character text items (e.g. web-to-PDF renders).
- Heading detection compares each line's font height to the page's most frequent (body) height. Lines >1.4x body height become headings; distinct sizes map to H1/H2/H3/H4 in descending order.
- Column-split detection is suppressed when >30% of lines span both sides of the gap (indicating a wide table, not a two-column layout).
- Table cell merging: continuation rows (col 0 empty) are merged into the previous logical row, handling multi-line cell content that spans multiple PDF text lines.
- Table run detection allows single-cluster continuation lines mid-run (cell text wrapping to a line with content in only one column).
- Conversion escapes lines matching `^\d+\.` to prevent Markdown OL interpretation of numbers like "994164972.".

---

## Sidebar and outline

### Sticky project header

The sidebar's project header (`.tree-root-header`: folder name + New File / New Folder / Collapse All) is `position: sticky; top: 0` inside `.sidebar-content`'s scrollport, so it stays reachable in a long tree. It needs an opaque `background: var(--bg-secondary)` -- rows scroll underneath it. `.sidebar-content` must carry NO `padding-top`: padding on a scrollport sits above the `top: 0` sticky element, producing a transparent band that file rows visibly scroll through. (The outline view has its own `.outline { padding: 4px 0 }`, so it doesn't depend on the scrollport for that spacing.)

### Expand state

Sidebar folder expand/collapse state is lifted to the `Sidebar` component (not `DirectoryNode`) via a `Set<string>` of expanded paths, so it persists across explorer/outline view switches.

### File operations

File explorer context menu (rename, delete, copy path, reveal in OS file manager) and create file/folder use dedicated IPC handlers (`rename-file`, `trash-file`, `reveal-in-finder`, `create-file`, `create-directory`). Delete moves to Trash via `shell.trashItem()`, never permanent delete. Reveal uses `shell.showItemInFolder()`; the menu label is platform-aware ("Reveal in Finder" / "Show in Explorer" / "Show in Folder"). The copy-path item degrades to "Copy File Name" (copies `target.name`) when there's no project root the file sits under -- a relative path is only meaningful inside the project folder.

Deleting a file via the sidebar also closes any tab open to that file, without adding it to the reopenable closed-tabs queue.

### Drag-drop

Files and folders can be dragged within the sidebar to move them into different folders (or to root). Dragging onto a file targets its parent folder. Drop targets (folder rows, root header) show a pulsating blue outline. Uses `renameFile` IPC (fs.rename) for the move. Prevents dropping into own descendants or current parent.

### Outline active heading

`DocumentOutline` highlights (blue, `.outline-item.active` -> `var(--accent)`) the last heading whose top has scrolled to/above the editor viewport's top reading line. A scroll listener on the scroll container (`editor.view.dom.parentElement`, i.e. `.editor-content`) recomputes on rAF; the reading line is `scrollerTop + paddingTop + 4` so the first heading counts as active at the top of the document. Headings are walked in document order with an early break (once one is below the fold, the rest are too).

---

## App launch and window lifecycle

The `open-file` macOS event fires before `app.on('ready')` when launched via `mde .`. A `launchFileHandled` flag prevents the ready handler from creating a duplicate default window.

`open-file` with no window: a closed-but-not-quit app (macOS dock) opening a file creates a window via `createWindow(null, filePath)`, passing the path as `pendingFile` in `WindowState`. The renderer PULLS it on mount via the `get-pending-file` IPC (which clears it), rather than the main process PUSHING `open-file` on `did-finish-load` -- the push raced the renderer registering its listener, causing intermittent empty-screen loads.

---

## Packaging and webpack

### Main-process externals must be copied into the package

Webpack `externals` in the main process (`mammoth`, `turndown`, `turndown-plugin-gfm`, `pdfjs-dist`) are NOT bundled, and electron-forge's WebpackPlugin ships an EMPTY `node_modules` inside `app.asar` -- so without help they throw `Cannot find module 'turndown'` in the packaged app while working perfectly in dev.

`forge.config.ts`'s `packageAfterCopy` hook copies each external plus its transitive PROD dependency tree (resolved by walking up `node_modules` the way Node does) into the packaged app. The seed list lives in `webpack.main.config.ts` as `externalPackages`; keep it in sync with `externals`. Adding a new main-process external without adding it there reintroduces the bug.

### The macOS ad-hoc signature must be repaired after packaging

A BROKEN code signature is much worse than no signature. With no signature (or a valid ad-hoc one), Gatekeeper says "unidentified developer" and the user can still reach **Open Anyway** in System Settings > Privacy & Security. With a signature that does not match the bundle, macOS reports TAMPERING instead -- "MDE is damaged and can't be opened. You should move it to the Trash." -- and there is deliberately no override button, because clicking it would mean consenting to run modified code. The only escape is `xattr -dr com.apple.quarantine`, which is not something we can ask users to run.

Forge shipped exactly that. `FusesPlugin` ad-hoc signs the bundle during `packageAfterCopy` (it has to -- flipping fuses rewrites the Mach-O, and arm64 refuses to execute unsigned code). Packager then keeps mutating the bundle afterward: it renames the helper apps (`Electron Helper.app` -> `MDE Helper.app`) and rewrites `Info.plist` to inject the `ElectronAsarIntegrity` hash that our `EnableEmbeddedAsarIntegrityValidation` fuse requires. The signature is left describing a bundle that no longer exists:

```
$ codesign --verify --deep --strict MDE.app
MDE.app: invalid Info.plist (plist or signature have been modified)
$ codesign -dvvv MDE.app
Info.plist=not bound          <-- the plist was never sealed
```

This is [electron/forge#3757](https://github.com/electron/forge/issues/3757), closed as not planned, so the repair is ours to own. `forge.config.ts`'s `postPackage` hook re-signs the whole bundle ad-hoc (`codesign --force --deep --sign -`) and then runs `codesign --verify --deep --strict` as a gate, so the build FAILS rather than silently producing a "damaged" app. `--deep` is deprecated for real Developer ID signing but is the correct tool for a blanket ad-hoc repair.

Ordering works because `postPackage` runs inside the package step, which completes before makers run (`@electron-forge/core/dist/api/make.js` runs the package listr at line 129 and "Making distributables" at 153). Neither maker re-breaks it: MakerDMG hands the `.app` to `electron-installer-dmg` to build a filesystem image, and MakerZIP's `cross-zip` runs `zip -r -y`, where `-y` stores symlinks as symlinks (Electron frameworks are full of them, and a symlink-flattening zip is a classic way to re-corrupt a signature).

The hook is guarded on `platform === 'darwin'`: the release workflow builds Windows through the same `npm run release`, and `codesign` does not exist there. It fires for `package` and `pretest` too, not just `make`, so `npm test` always exercises it.

Verified end state, on the app inside the shipped DMG: `valid on disk`, `satisfies its Designated Requirement`, `Info.plist entries=32`, and `spctl` returns a plain `rejected` (the ordinary unnotarized rejection that still offers Open Anyway) rather than the tampering error.

This is NOT notarization. Reaching zero-friction launch still requires a $99/yr Apple Developer ID plus a notarization step, and macOS 15 Sequoia removed the old right-click > Open shortcut, so users must visit System Settings either way.

### `EnableCookieEncryption` is off because we are ad-hoc signed

The fuse makes Chromium create a `MDE Safe Storage` item in the user's login keychain. macOS ties a keychain ACL to the requesting app's code signature, and an ad-hoc signature's designated requirement is:

```
$ codesign -d -r- MDE.app
# designated => cdhash H"acd502346cbc829350302745ddf47acda435e1d6"
```

That is pinned to one exact binary. Every build produces a different cdhash, so macOS sees an unrecognized app on each release and prompts for the login keychain password ("MDE wants to use your confidential information stored in MDE Safe Storage"). **Always Allow** only holds until the next build, so this would be a password prompt on every single update.

Nothing in `src/` uses `safeStorage`, `encryptString`/`decryptString`, or cookies, so the fuse was protecting nothing and costing that prompt. It is off.

This is a consequence of ad-hoc signing, not of the re-sign hook -- a Developer ID certificate would give a stable team-identifier-based designated requirement that survives rebuilds, at which point the fuse can safely go back to `true`.

### Renderer config

Renderer webpack config does NOT use the `@vercel/webpack-asset-relocator-loader`. That loader breaks ESM imports from TipTap packages. It's only needed for native node modules in the main process.

Bootstrap Icons are self-hosted in `src/fonts/` (woff/woff2), imported via CSS in renderer.tsx.

---

## UI details

### Tooltips

Toolbar buttons and the fold caret use a shared CSS `[data-tooltip]::after` bubble (0.45s hover delay, themed via `--tooltip-bg` / `--tooltip-text`). Toolbar buttons set `data-tooltip` + `aria-label` (not `title`) with platform-aware shortcut hints (e.g. "Bold selection (Cmd + B)"); `MOD` is `Cmd` on darwin else `Ctrl`. The fold-caret tooltip is positioned to the right of the caret via a `.fold-caret[data-tooltip]::after` override.

### Help page

The Keyboard Shortcuts help page opens as a read-only tab. Content loaded from `docs/help/keyboard_shortcuts.md` via webpack `asset/source`. Read-only tabs hide the toolbar, TableMenu, and LinkPreview; the editor caret is transparent.

### Editor styling

- Paragraph spacing: `.editor-content .tiptap p` has `margin-top: 0.8em` (doubled from 0.4em) so paragraph-to-paragraph and list-to-paragraph gaps breathe. Headings already carry their own bottom margin, so `h1..h6 + p` overrides `margin-top` back to `0.4em` -- otherwise the gap under a heading would grow too. List margins are deliberately untouched.
- Horizontal rules show a blue outline (`var(--accent)`) when selected via `ProseMirror-selectednode` class.

---

## Checkpoints (version history)

Full design rationale lives in `CHECKPOINTS.md`, which is both the proposal and the as-built record. This section covers only what will bite someone changing the code.

Code: `src/git/` (`repo`, `status`, `checkpoint`, `checkpointer`, `history`, `restore`, `guards`, `ignore`), `src/components/VersionPanel.tsx`, `src/components/DiffView.tsx`, `src/utils/prosediff.ts`. Everything Git-touching runs in the MAIN process; the renderer never sees a repo object. Library is **isomorphic-git** (pure JS, no native deps, bundles normally) plus **jsdiff**.

### The word "Git" appears in the UI never

The audience is non-technical writers reviewing what an AI agent did to their files. No staging, no branches, no remotes, no merge conflicts. The tab is "Checkpoints" with a `bi-clock-history` icon -- deliberately not a branch icon, which reads as "this is for programmers" to exactly the person we are trying not to scare.

### History is append-only

There is no operation anywhere that destroys or rewrites a commit. Restore reads old content and writes it as a NEW checkpoint on top (the shape of `git revert`), and always takes a safety checkpoint of the current state first. Consequences: detached HEAD is unreachable, "I lost my work" is structurally impossible, and no action needs a scary confirmation. Do not add `reset --hard`, amend, or rebase to this feature for any reason.

### The marker grants write mode, and nothing else does

`mde.managed = true` in `.git/config` is the ONLY thing that makes a repo writable. `.git/config` is the right home: inside `.git/`, so never in the working tree, never in a diff, never committed, and it survives a move, rename, copy, or zip. Do NOT key managed-ness off a path in `mde-state.json` -- that breaks on exactly the rename case (there is a test).

Four attach states: `none` (no repo -- dimmed tab, opt-in screen), `managed` (writable), `foreign` (a repo MDE did not create -- read-only browsing plus an explicit adopt button), `steppedBack` (marker present but a remote or a second branch appeared -- read-only, and NOT adoptable). Live evidence outranks the marker, always. A false negative costs one click; a false positive means MDE silently commits into a developer's real project.

### Opt-in is mandatory

Opening a folder never creates a repo. The user turns it on from the dimmed tab, and setup runs guardrails, seeds `.gitignore`, inits, writes the marker, and makes an initial checkpoint in one step. The `?` in the panel header toggles the how-it-works recap, which also auto-opens once right after first setup -- a help affordance nobody clicks is the same as no help.

### The cadence rule -- there is exactly one

> If it has been more than 10 minutes since the last checkpoint, and there are uncommitted changes, wait for a quiet period, then checkpoint everything.

Deliberately source-agnostic: no different behavior for agent writes vs. the user's own edits. An earlier draft had two settle windows and collapsed on the mixed case (you edit a file, then Claude rewrites it -- which window applies?). A rule with a conditional inside it is one nobody can predict. Explicitly rejected: urgency escalation on volume (it splits bursts, and mid-burst states are the worst possible restore targets) and using the Git index as a debounce buffer (it strands real content in `.git/objects` that the UI cannot see or reach).

`--vc-eligibility-ms` and `--vc-poll-ms` override the two constants so tests do not wait ten minutes.

### Detection: poll status, gate on the watcher

Change detection derives from `statusMatrix`, NOT from watcher events, and this is correctness rather than taste: **`statusMatrix` excludes gitignored files and watcher events do not**. Driving the settle window off watcher events means any frequently-rewritten ignored file (`.obsidian/workspace.json`, Dropbox sync traffic, a build watcher) resets it forever, and real changes sit uncommitted with no visible cause. The watcher is demoted to a dirty-flag gate -- `sawChange = true`, unfiltered, undebounced -- and that is its entire job.

**The poller gate is `!sawChange && lastSignature === null`, and both halves are load-bearing.** Gating on the watcher alone deadlocks the most common case in the feature: one burst of edits, then silence. The burst sets the flag, the first tick consumes it, and with no further filesystem events no later tick ever runs -- so the settle window never completes and the changes sit there until the next unrelated edit. `lastSignature !== null` means "the last tick saw uncommitted changes", which is exactly when we must keep polling regardless of the watcher.

**The signature must fold in mtime and size.** `statusMatrix`'s WORKDIR field is a coarse enum (0 absent / 1 same as HEAD / 2 different), NOT a content hash, so a file rewritten with different content produces a byte-identical row both times. A signature built from the matrix alone compares equal across two polls mid-burst and commits a half-finished agent operation. Test: "no checkpoint lands mid-burst".

Poll interval self-calibrates: `max(60s, lastStatusDuration * 100)`, capped at 15 minutes. Measured 52-74ms on this repo with 33k gitignored entries, so a real Markdown folder is far cheaper.

### isomorphic-git has no racy-clean rule

`compareStats` reuses an index entry's cached hash when the mtime SECOND, ctime second, size, inode, and mode all still match. mtime granularity is one second. **So a write landing in the same second as the `git.add` that recorded those stats, at the same byte length, is invisible -- permanently, until something else touches the file.** Real Git closes this with the racy-clean rule; isomorphic-git does not implement it. For a feature promising "nothing is ever lost", a file silently missing from the changes list is the worst available failure.

Two halves, both required:

- `computeStatus` passes **`refresh: false`**, making status read-only with respect to the index. With the default, a status that merely happened to run in the same second as a write would poison the stat cache with nothing following it to undo the damage. This makes `git.add` the only writer of index stats in the whole system.
- `createCheckpoint` calls **`deraceIndex`** right after committing, rewriting the index entry (via `updateIndex` with an explicit oid, which stores zeroed stats) for any just-committed file whose mtime second is the current second. Zeroed stats never compare equal to a real file, so the next status hashes it for real.

Do NOT "fix" this by deleting `.git/index` between checkpoints. `git.commit` builds its tree FROM the index, so the index must stay COMPLETE even though it is never left dirty -- each checkpoint adds only the changed files on top of what is already there. "Transient" means no uncommitted content, not empty.

### Other traps

- **isomorphic-git has no `add -A`.** You must walk the status yourself and call `remove` for deletions and `add` for everything else. Forgetting the `remove` half silently drops deletions from checkpoints.
- **Never return `null` from a `walk` map.** `_walk` treats `null` as PRUNE (`if (parent !== null) { ...recurse... }`), so returning it for the `'.'` root entry silently prunes the entire walk and every checkpoint reports zero files, with no error anywhere. `undefined` is the value that means "not a result". Directory entries must also return `undefined` so the walker recurses into them.
- **Whole-tree restore must delete.** Write every blob at the target commit, then remove files that exist now but did not exist then. Forgetting the deletion half yields a union of both states, which is worse than either.
- **Restore deliberately bypasses `write-file-if-unchanged`** and writes straight to disk. That guard is for renderer buffers; here the existing conflict machinery is what we want, and it works for free -- clean tabs silently reload with the blue banner, dirty tabs raise the red one.
- **The `.git/` write loop is structurally prevented, not filtered.** Committing writes to `.git/`, the watcher sees it, `sawChange` goes true, and the resulting status is empty so nothing happens -- and `lastCommitAt` was just reset anyway. Two independent reasons it cannot loop, neither requiring the watcher to know what a path is.

### Testing

`tests/version-control.spec.ts`, 27 tests. Tab selector is `.qa-vc-tab`; the rest are `qa-vc-*` / `qa-diff-*`.

Two of those tests assert that NOTHING happened (no mid-burst commit, no missing change row), and a "nothing happened" test is worthless until it has been seen to fail. Both were verified by mutation: reverting the mtime/size half of `statusSignature` makes the mid-burst test commit six times during the burst, and disabling `deraceIndex` makes the same-second test report zero changes. Re-verify the same way if you touch either mechanism.

`makeTmpDir` calls `fs.realpathSync`. macOS hands out `/var/folders/...`, a symlink to `/private/var/...`, and isomorphic-git resolves it -- without the realpath the renderer's `projectRoot` and the main process's repo root are two different strings and every event is silently dropped.

Not covered by tests: quit-time capture (`before-quit` -> `flushAll`), because `before-quit` is skipped under `isTest` -- Playwright closes the app on every teardown and a real flush would fight the harness.

---

## Feature inventory

What exists today, for orientation. This list goes stale faster than the notes above -- the test suite is authoritative.

- Electron shell with IPC bridge, menu bar (including Window menu with Hide/Minimize), drag-drop (with blue pulse overlay)
- TipTap WYSIWYG editor with Markdown load/save
- File explorer sidebar:
  - Resizable via drag handle (140--600px, width persisted to mde-state.json)
  - Root header with New File (`bi-file-earmark-plus`), New Folder (`bi-folder-plus`), Collapse All (`bi-arrows-collapse`) buttons -- sticky at the top of the scroll, so only the file/folder list below it scrolls
  - Selection state with teal highlight; Enter to rename selected item
  - Creates files/folders in selected folder or as sibling to selected file
  - Right-click context menu: Rename, Delete (confirmation dialog, moves to Trash), Copy Relative Path (or "Copy File Name" when no project folder is set; shows info toast), Reveal in Finder. Folders also show New File / New Folder. Dismissable with Escape.
  - Keyboard: Arrow Up/Down (navigate), Arrow Right/Left (expand/collapse folders), Enter (rename), Escape (deselect), Cmd+Backspace (delete with confirmation dialog)
  - Clicking outside sidebar deselects
  - Folder expand/collapse state persists across explorer/outline view switches
- Document outline sidebar (icon tabs with rounded bg, not text+underline). The heading at the current scroll position (top of the viewport) is highlighted blue; the rest are default color.
- Tabbed editor with smart dirty tracking (undo back to original clears dirty), scroll position preserved across tab switches (saved via scroll event listeners, restored on tab activation)
- Toolbar with Bootstrap Icons (headings dropdown, bold, italic, strike, highlight, lists, todo list, blockquote, code, link, table, HR) -- wraps on narrow windows, undo/redo gray out when unavailable. Each button shows a styled tooltip on hover hinting its keyboard shortcut (e.g. "Bold selection (Cmd + B)").
- Link editing via floating LinkBar (top-right of editor, like FindBar) -- preserves text selection highlight via ProseMirror decorations while editing URL
- Link preview popup (top-right of editor area when cursor is in a link)
- Cmd/Ctrl+click a link to follow it: relative file links open in a new tab (resolved against the current file's folder, per standard Markdown semantics); a missing target prompts to create the file; external URLs open in the browser. Plain click still positions the cursor for editing.
- Find/replace bar (inline below toolbar) with match highlighting (yellow border for all matches, yellow bg for active match), case-sensitive and whole-word filters, disabled nav when <=1 match, inline "Replace all" confirmation
- Code block copy button (NodeView-based, top-right corner, appears on hover)
- Table cell actions dropdown (three-dots trigger centered on top-right cell border, viewport-aware dropdown alignment, icons for insert/delete row/column)
- Copying table cells: a single cell copies just its text; multiple cells copy as tab-separated rows (pastes as plain text in editors, as a real table into Word via the HTML clipboard). Select-all over a mixed document copies everything -- prose, lists, AND the table as a Markdown table.
- File conflict detection (hash-guarded save that can never clobber a stale file; silent reload with a blue "detected changes" proof banner; red conflict banner when the buffer is dirty). Watches the containing directory so it survives atomic saves.
- Quick Open command palette (Cmd+O) with fuzzy search, file indexing (10s TTL cache)
- DOCX/PDF import: converts to `.{ext}.md` on click (e.g. `report.pdf.md` -- preserves original extension). The source file is never renamed, moved, or hidden. Clicking a source that already has its Markdown beside it opens an "Already converted" dialog (`.qa-import-exists`) offering to open that Markdown (primary) or convert again into a new numbered copy (`report.pdf.2.md`, `.3.md`, ...) -- conversion never overwrites.
- PDF export (via Electron printToPDF)
- Tools -> Word Count: a modal (`.qa-word-count`) showing word count, character count, and estimated page count (300 words/page) as `selection / whole document` -- or, when nothing is selected, the document figure alone with no `0 / ` prefix. Counts are snapshotted when the dialog opens. Escape or clicking the backdrop closes it. No keyboard shortcut -- menu only.
- Dark mode support (light / dark / system default, stored in user state file)
- Settings dialog (Cmd+,) with theme selector, spellcheck toggle, auto-save toggle (1s debounce), terminal launcher installer
- Terminal launcher: `mde .` opens a folder from the terminal (installed via Settings)
- Toast notifications with semantic colors (danger, info variants -- separate text/border color variables for contrast in dark mode) and scale animations
- Window dimensions and position persisted and restored on reopen (debounced 500ms save on resize/move)
- Custom app icon (icon.icns, generated from icon.png)
- Rainbow wave color animation on project title in the title bar (12s cycle, 0.6s stagger per letter)
- Keyboard Shortcuts help page: opens as a read-only tab from Help menu or empty-state link. Uses `initialContent` and `readOnly` tab properties.
- Help menu with Keyboard Shortcuts item (sends `show-keyboard-shortcuts` IPC)
- Code folding: Cmd+. on a list item with children, or on a heading, toggles fold. A folded heading hides everything down to the next heading of the same or larger rank. When folded, the content is hidden, a blue "..." badge appears after the text, and (for list items) a blue chevron caret appears to the left of the bullet/checkbox. Fold state persists across file close/reopen and external file changes, and survives reordering (Cmd+Alt+Up/Down) and splitting (Enter) the surrounding items. Clicking the caret or badge unfolds, as does any edit that would put the cursor inside the hidden content. Hovering an unfolded foldable node shows a dim gray caret that folds just that node on click.
- Task list editing: Enter carries checked-ness with the text. Only a click inside the checkbox itself toggles it. Backspace on an empty middle item deletes that item and moves the cursor to the end of the item above. Copying text inside a list item gives plain text with no `- ` / `[ ] ` marker.
- Sidebar defaults to the outline tab when a file is opened with no project folder set (the explorer would be empty, so the outline is more useful).
- Checkpoints: a third sidebar tab (`bi-clock-history`) giving a folder an undo history for AI-driven edits, backed by Git and never described as Git. Off until the user opts in -- the tab is dimmed, and turning it on runs guardrails (refuses inside a parent repo, warns about nested repos and big folders), seeds `.gitignore`, and makes an initial checkpoint. A `?` in the panel header toggles a how-it-works recap that also auto-opens once after setup. **Changes** lists everything that has moved since the last checkpoint (yours or an agent's), with the count on the tab badge; **History** lists checkpoints, expandable to their file lists. Checkpoints happen automatically (10-minute cadence, only after things go quiet) or on demand with an optional message. Clicking any file opens a word-level prose diff in a modal -- added words green, removed words red, long unchanged stretches collapsed -- with **Put this version back** in the footer. Restore works per-file or for the whole folder, always append-only: the current state is checkpointed first and restoring adds a new checkpoint on top, so nothing is ever lost. Repos MDE did not create are read-only history browsing plus an explicit adopt button.
