# MDE Architecture Notes

Detailed rationale behind the invariants listed in `CLAUDE.md`. Read the relevant section here before changing the subsystem it covers -- most of these notes exist because the obvious implementation was tried first and broke something.

`CLAUDE.md` holds the short version (the rule). This file holds the long version (why the rule exists, and what happens if you break it).

---

## Saving and conflict detection

### Single write path

`write-file-if-unchanged` is the ONLY IPC that writes a document to disk. There is deliberately no raw `write-file` handler / `writeFile` bridge method -- it was removed so nothing can bypass the hash guard. Cross-file Find & Replace (`FindBar`) also routes through it (with `expectedHash: null`, safe because it writes freshly-read+transformed content and skips open dirty tabs). Do NOT add a raw write-file back; it would be a silent clobber bypass.

Main-process direct `fs.writeFile`s exist only for non-buffer files: state JSON, new-empty-file creation, DOCX/PDF import output, PDF/DOCX export (`export-document`, which derives its own `.pdf`/`.docx` path from the source, so it cannot be aimed at a document), launcher scripts.

### Two layers of conflict detection

File conflict detection is content-hash based, with two layers.

**(1) Safety backstop.** Saving goes through the `write-file-if-unchanged` IPC, which re-reads the file on disk, sha256-hashes it, and refuses the write (returning `{conflict:true}`) if that hash no longer matches the `diskHash` the tab recorded when it last read/wrote the file. A stale buffer therefore cannot clobber a newer on-disk version even if the watcher missed the change entirely -- the renderer raises the red banner instead. Pass `expectedHash: null` to force (new file / Save As). `hash-file` returns the on-disk hash; both use `hashContent()` in index.ts. Each `Tab` carries `diskHash` (set on open, save, reload, rename, silent-reload).

**(2) Live detection.** The `file-changed` handler recomputes the disk hash and compares to `tab.diskHash` -- if equal it's a no-op (ignores spurious watcher fires and our own writes); if different and the buffer is clean it silently reloads; if dirty it shows the banner. mtime is no longer used for the change decision (kept only as informational `diskMtime`).

### The banner must not fire on our own writes

Three fixes, all required, after users hit a red banner on files nothing else had touched:

1. `write-file-if-unchanged` treats a hash mismatch whose on-disk content is BYTE-IDENTICAL to what we were asked to write as success, not a conflict (the write would be a no-op, so nothing can be lost -- a real divergence still hashes differently); it adopts the disk hash and returns ok.
2. The renderer's `diskHash` is read from a synchronous `diskHashRef` Map (`recordDiskHash` / `knownDiskHash`), not from `activeTab.diskHash`: an autosave `setTimeout` closure captured before a manual Cmd+S quoted the PRE-save hash and self-conflicted. `tabsRef` does the same for `state.tabs` in the `file-changed` handler.
3. `saveActiveTab` holds a `savingRef` in-flight lock, cancels any pending autosave timer before writing, and the autosave timer re-checks `tab.dirty` / `tab.conflict` from `tabsRef` before firing.

`saveActiveTab` needs `activeEditor`, and a missing one THROWS (surfacing in the red error banner) instead of returning. `registerEditor` / `unregisterEditor` compare against `activeTabIdRef`, never a captured `activeTab`: each Editor calls the `onDestroy` it captured at mount, when its own tab was active, so closing a background tab used to null the active tab's editor and turn every save into a silent no-op.

Relatedly, edits that land WHILE a write is in flight (`activeEditor.state.doc !== docAtWrite`) leave the tab dirty and re-arm autosave instead of being marked clean.

On a real conflict the renderer deliberately does NOT adopt the on-disk hash -- it belongs to a version the user has not seen, and adopting it would let the next Cmd+S clobber it.

### Auto-save

Opt-in, disabled by default. When enabled via Settings, saves after 1s of inactivity. Stored as `autosave` in `mde-state.json`. IPC: `get-autosave`, `set-autosave`, `autosave-changed`.

---

## File watching

### Watch the directory, not the file

File watching watches the *containing directory* (one watcher per dir in `dirWatchers`, filtered by basename), NOT the file inode. Each basename records which windows (webContents ids) watch it, and events go only to those: a shared per-file flag let one window's unwatch (closing a tab, replacing a preview tab) silently stop another window with the same file open from ever reloading it, and a window mid-save must not receive the event for its own write. A closing window releases its watches. `fs.watch` on a single file follows the inode, so an atomic save by another program (write temp + rename over original -- what most editors and Claude's file tools do) silently kills the watcher. Watching the directory survives atomic replaces. When the platform reports a null filename, the handler notifies all watched files in that dir and lets the renderer's hash comparison decide.

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

### Images (`utils/imageNode.ts`)

An inline, atom `image` node -- inline because Markdown images are inline, so `see ![x](a.png) here` stays one paragraph. Before it existed there was no node to hold an `<img>`, so ProseMirror discarded every image on load and the next save wrote the file without them.

- **The saved form is the source text, verbatim.** markdown-it normalizes the destination (`<my cat.png>` -> `my%20cat.png`, `café` -> `caf%C3%A9`, `&amp;` -> `&`) and flattens the alt to plain text (`*pic*` -> `pic`), so rebuilding `![alt](src)` from attrs rewrites the user's reference on every save. `captureSource` wraps markdown-it's inline `image` rule (via `ruler.__rules__`, guarded by a WeakSet since tiptap-markdown calls `setup` per parse), slices `state.src` across what the rule consumed, and stores it as `data-markdown` -> the `markdown` attr. The serializer writes it with `state.text(raw, false)`, not `write()`, so continuation lines inside quotes/lists get re-prefixed. Only an image with no `markdown` attr (pasted HTML) is rebuilt from its attrs.
- **Reference-style `![alt][ref]` is saved in the resolved inline form**, not verbatim: markdown-it consumes the `[ref]: url` definition and nothing in the document holds it, so a verbatim reference would dangle. Reference-style LINKS get the same rewrite (stock prosemirror-markdown behavior).
- **Local files load through `mde-file://local/<path>`**, a privileged standard scheme registered in `index.ts`. The renderer's origin is `http://localhost` in dev, from which Chromium refuses `file://`. The fixed `local` host is required: under a standard scheme `mde-file:///Users/x` parses `Users` as the host and lowercases it. The handler serves only image extensions and sends `Access-Control-Allow-Origin: *` so DOCX export can draw the image to a canvas and read it back. Forge's dev-server CSP is extended in `forge.config.ts` to allow `mde-file:` and `http(s):` images; packaged builds send no CSP.
- **Relative paths resolve against the document's folder** (`resolveImageSrc`, the same rule links follow) via `editor.storage.image.baseDir`, which `Editor` sets before each load. A file renamed or moved while open keeps resolving against its old folder until it is reopened.
- **A failed load shows `.image-missing`**: a dashed box plus small muted-red text. On `error`, a local path is stat'ed to choose between "can't be found" and "can't be displayed"; a remote one says "can't be loaded". The node and its `markdown` attr are untouched, so the reference saves unchanged.
- **Selecting an image overlays its path** (`.image-path`, shown by CSS only under `.ProseMirror-selectednode`), and **right-click opens `ImageContextMenu`** (Reveal in Finder, Remove from Document). The node view handles `contextmenu` -- it has `getPos()` -- selects the node and dispatches `IMAGE_MENU_EVENT`, which the React menu listens for on `view.dom`. Reveal is offered only for a local file that actually loaded. Arrow keys select an inline atom only when ProseMirror's state knows where the caret is; a headless test window never has focus, so native caret moves don't reach the state and tests place the caret with `setTextSelection` first.
- **A paste with images asks first (`utils/pasteImages.ts`, `PasteImagesDialog`)**, so an image never lands in the document as a `data:` URL. `handlePaste` hands off to the dialog when the clipboard is a bare image file (a screenshot) or HTML containing `http(s):`/`data:` images; Word and Excel put a picture of the selection beside their HTML, so image files count only when there is no HTML. A screenshot can be saved or cancelled; web content can also keep its images as links or drop them, except that an embedded `data:` image can't stay a link and is dropped. Save writes into a folder beside the document (default `images/`) through the `save-image` IPC, which downloads remote images with `net.fetch` in main (no CORS there), decodes `data:` URLs, takes the extension from the name or the content type, refuses non-images, and writes with `flag: 'wx'` plus a `-2`, `-3` suffix, so an existing file is never overwritten. The resolved HTML is then pasted with `view.pasteHTML`, which re-enters `handlePaste` with no clipboardData and so runs the normal pipeline. A ProseMirror-internal copy (`data-pm-slice`) skips the dialog: its images are already references. An image that fails to save is dropped if embedded, otherwise kept as a link, and a toast counts the failures. Cancel aborts the whole paste. Undo removes the reference but leaves the saved file on disk.
- **Drop and the toolbar's Insert Image reuse the paste dialog.** `handleDrop` runs `pasteNeedingImageChoice` on the drop's DataTransfer (so a web page's image dragged in asks too), moves the caret to the drop point, and hands off exactly as a paste does. ProseMirror's drop handler bubbles on to App's window-level one, which opens documents and would reject an image as unsupported, so the editor records the event in `imageDropsHandled` and App skips its image files while still opening any documents alongside. App's full-window "Drop to open" wash is skipped when every dragged item is an image, so the editor's drop cursor shows where it will land. The toolbar can't reach the Editor's dialog state, so its button dispatches `INSERT_IMAGE_EVENT` on `view.dom`; the Editor runs the `pick-images` picker (opened in the document's folder) and queues the chosen paths, which `save-image` copies by `{ path }`. A picked or dropped file is always COPIED, even one already beside the document.
- **Removing an image's file asks first (`utils/imageDeletion.ts`, `DeleteImageDialog`).** `ImageDeleteGuard`'s `filterTransaction` rejects an edit that removes the document's last reference to a local file that has DISPLAYED in this editor (`storage.image.shownFiles`, filled on the node view's `load`), and hands the rejected transaction to the Editor via `IMAGE_DELETE_EVENT`. It must be a filter, not an after-the-fact undo: undo would also revert whatever typing the history grouped with the deletion. Keep and Delete re-dispatch the held transaction tagged `IMAGE_DELETE_ANSWERED` (only if the document is still the one it was built on); Delete then trashes via `trash-file` (`shell.trashItem`). Cancel drops it. Loads/reloads and folds (`addToHistory: false`), undo/redo, and cut (the image is headed for a paste) are never held. Only this document is checked -- another document showing the same file is not.
- **The table serializer is overridden (`MarkdownTable` in `Editor.tsx`)**: tiptap-markdown's skips every cell whose `textContent` is blank, and an image-only cell has none, so its image vanished on save. The override renders a cell that holds an image; everything else matches stock, including `[table]` for tables Markdown can't express.

### A lone `~` is never escaped

`prosemirror-markdown`'s `esc()` escapes every `~`, so prose like "approx ~5" hit disk as `approx \~5`; markdown-it only opens a strikethrough on a DOUBLED `~~`, so a single tilde needs no escape. The `TextNode` override in Editor.tsx un-escapes just the span `state.text()` appended (`state.out` is a mutable public field), using `/(?<!\\~)\\~(?!\\~)/g` so a `\~` adjacent to another `\~` is LEFT escaped -- under-escaping there would silently turn literal `~~text~~` into a real strike on the next load, and over-escaping is the safe direction. The same override un-escapes the brackets of an Obsidian wikilink (`[[note]]`, `![[pic.png|300]]`), which `esc()` wrote as `\[\[note\]\]` on every save. A link label can't contain unescaped brackets, so `[[x]]` reparses as the same literal text; only the four brackets are un-escaped, never the content. MDE doesn't resolve wikilinks -- they stay literal text, preserved. This is a serializer change, so it affects saved files as well as the clipboard.

### Highlight and text color (`utils/colorMarks.ts`)

MDE-specific syntax: `==text==` (yellow), `=={blue}text==` (named highlight), `[text]{red}` (text color). Only the ten `PALETTE` names are colors; anything else stays literal. Files store the NAME; CSS maps it to a per-theme shade (`--highlight-<name>` / `--text-color-<name>`), which is why the palette never has to be light- or dark-specific in the file. Stock Highlight had no Markdown serializer, and tiptap-markdown's HTML fallback emits `""` under `html: false`, so every highlight was silently dropped on save.

- **`textColorRule` returns false in silent mode, deliberately.** markdown-it's `parseLinkLabel(..., disableNested=true)` probes the label with `skipToken` (silent mode) and rejects the link if any complete bracketed token appears inside it. If the rule matched there, `[read the [docs]{red}](a.md)` would stop being a link. Declining makes the inner brackets plain nesting, which the link rule allows, and the real (non-silent) pass still colors them.
- **Priorities put both marks OUTSIDE links** (highlight 1200, textColor 1100, Link 1000): a highlight around a link is one continuous `<mark>` rather than three padded pieces, and a link inside colored text keeps its own color and underline. Cmd+click uses `closest('a')`, so nesting order doesn't matter to it.
- **Both marks are `mixable`**, or prosemirror-markdown won't reorder them around links/bold and emits unbalanced delimiters. Highlight also has `expelEnclosingWhitespace`, since `== x==` cannot open.
- **Inline code no longer excludes every mark** (`Code.extend({ excludes: 'bold italic strike underline link' })`). Stock `excludes: '_'` meant a loaded `==a `x` b==` lost the highlight on `x`. Markdown can express color around code because code is always the innermost mark.
- **`parse.setup` is guarded by a WeakSet.** tiptap-markdown calls it on EVERY parse against the same markdown-it instance, so unguarded rules pile up.
- **Escaping** (`escapeColorSyntax`, applied in the `TextNode` serializer): a `==` run not spaced on both sides becomes `\=\=` (a text-node edge counts as unspaced), and a leading `{palettename}` is escaped because it could land right after an opener. `a == b` is left alone. `[` / `]` are already escaped by `esc()`.
- **The stock input rule is replaced and paste rules removed**: the stock rule would turn a typed `=={blue}x==` into a yellow highlight of `{blue}x`.
- Palette contrast was checked against WCAG: body text passes on every highlight in both themes, and the link accent is >= 3.0 on every highlight.

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

### An item that opens with a list (`- 1. x`)

markdown-it parses `- 1. x` as an `<li>` whose first child is an `<ol>`, but `listItem`'s schema is `paragraph block*`. ProseMirror's DOM parser can't fit the list there, so it closes the item and hoists the list into the PARENT item: on save, `- 1. x` became an empty `- ` line plus a dedented `1. x`, and the nesting was gone. `cleanParsedListHtml` inserts an empty `<p></p>` before any leading `<ul>`/`<ol>` in an `<li>`, and `UnifiedListItem`'s serializer skips an empty first paragraph followed by a list, so the inner marker is written on the item's own line again. Task items are exempt from the skip: `- [ ] 1. x` parses back as paragraph text, not a list. In the editor, such an item shows an empty bullet line above the inner list. Items that open with other blocks (`- # h`, `- > q`) are untested.

---

## Folding

### What is folded lives on the node

Cmd+. toggles collapse on a list item with children, or on a heading (which hides every following block down to the next heading of the same or larger rank -- `headingFoldRange()`).

The fold is a `folded` attribute added to `listItem` and `heading` by the `FoldAttribute` extension (`addGlobalAttributes`, `rendered: false` so it never reaches the DOM, the clipboard, or a saved file) -- NOT a position set in the plugin. Position sets do not survive edits: moving a list item (Cmd+Alt+Up rewrites the whole span) or splitting one (Enter at the start makes `p` point at the NEW empty item) left the fold on the wrong node and put a phantom `...` badge on an unrelated sibling. An attribute travels with its node through every transform.

`keepOnSplit` stays default-true so a split hands the flag to the half that keeps the sublist; the plugin's `appendTransaction` then clears `folded` in two cases:

1. A node that is no longer foldable (`isFoldable()`), which is what cleans up the empty half.
2. A node whose hidden span (`hiddenRange()`) would hide the selection (`selectionHiddenBy()`): the anchor or head of a text selection strictly inside it, or a selected node wholly inside it. This is a general safety net against an invisible cursor -- Tab on the item below a folded one sinks it into that folded sublist, so the line being typed would simply disappear; instead the fold releases.

The test is deliberately on the selection's ENDS, not overlap. An overlap test unfolded every fold a drag-select or Cmd+A merely passed over. A spanning selection needs no unfold to be correct: the clipboard is serialized from the document slice, not the DOM, so copying it carries the hidden content in both `text/plain` and `text/html`.

It runs on `selectionSet` as well as `docChanged`, and `setFolded()` uses the same predicate for its deliberate selection-move, so folding itself never trips it.

`foldKey`'s state is now just a derived cache: `apply()` recomputes `collapsed` with `collectFolded(tr.doc)` on every `docChanged` (App.tsx reads it via `getFoldedPositions()`; `applyFoldPositions()` restores a persisted set). Every fold transaction is tagged `FOLD_CHANGE` and `addToHistory: false`.

Decorations add a `folded` class to the `<li>`/heading plus a `fold-badge` widget; a folded heading's siblings each get a `fold-hidden` (`display: none`) node decoration, since a heading's section isn't nested inside it. `setFolded()` moves the selection out of the range it is about to hide (ProseMirror cannot place a cursor in a `display: none` block).

Cmd+. only folds the item the cursor is directly in (paragraph at depth `liDepth + 1`); cursor in a childless nested item does nothing -- the keystroke is consumed (`return true`) to prevent propagation.

### Folding must never touch dirty state

The clean-buffer snapshot is `docSignature(doc)` (a `doc.toJSON()` whose JSON replacer drops every `folded` key), not the raw JSON -- otherwise a fold would mark a clean buffer dirty. And `onTransaction`'s re-baseline (which fires for any `addToHistory: false` doc change) skips `FOLD_CHANGE` transactions: re-baselining there would have marked a buffer with UNSAVED EDITS as clean.

### Click-to-fold hover caret

The `foldKey` plugin also tracks a `hover` position (set via `SET_FOLD_HOVER` meta from a `mousemove` `handleDOMEvent`, cleared on `mouseleave` / toggle / docChange).

The hovered item is found by COORDINATES, not DOM target: `view.posAtCoords({left: clamp(clientX into editor), top: clientY})` resolves the position under the pointer's Y, then the innermost `listItem` ancestor is used. This makes the entire row -- including the left gutter where the caret lives -- a hover target, so moving onto the caret never dismisses it. (The caret sits at `left: -33px`, outside the li's box and even left of `.tiptap`, so DOM-target / `closest('li')` detection failed there.) A guard at the top of `mousemove` returns early when `event.target.closest('.fold-caret')` so hovering the caret never recomputes (which would detach it mid-click).

When hovering an unfolded foldable item (innermost only), a dim gray `.fold-caret` widget renders to its left -- no parents, no children. The caret carries a `data-tooltip` ("Fold sub-list" / "Fold section" + "(Cmd + .)") and its `mousedown` toggles the node's `folded` attr.

Headings are hovered the same way (via `$pos.parent.type.name === 'heading'` when no listItem ancestor is found), but their caret is rendered after the heading text (`.fold-caret-inline`, the same spot the `...` badge takes) -- absolutely positioned with `auto` offsets, so it sits at its static position but takes no space in the line, into a `padding-right` every heading reserves for it. Headings also carry `overflow-x: clip`: the caret's tooltip is laid out even while invisible, and on a full-width heading it stuck ~124px out and gave the editor a horizontal scrollbar. Clip (unlike hidden) makes no scroll container and leaves vertical overflow visible. An in-flow caret wrapped onto a new line whenever a heading nearly filled its line, so just moving the mouse down the headings reflowed the whole page -- `.editor-content`'s left padding is only 12px, so at the list gutter offset (`left: -33px`) a top-level heading's caret would land on the sidebar and be unclickable. `.fold-caret-inline` must stay AFTER `.fold-caret` in index.css: same specificity, so source order decides. The blue `::after` chevron remains list-item-only for the same reason.

### Fold state persistence

Stored in `mde-state.json` as `foldState: { [filePath]: number[] }` -- arrays of 1-based markdown line numbers. On fold/unfold, `foldPosToLineNumbers()` serializes the markdown and matches folded nodes' text to line numbers. On file load, `lineNumbersToFoldPositions()` matches persisted line numbers back to doc positions by text content.

Matching is by `{kind, text}` (`foldableLineTarget()` for a markdown line, `foldableNodeTarget()` for a node), so a heading only ever matches a heading and a list item a list item; a task item's `[ ] ` / `[x] ` counts as part of the marker, not the text (it isn't in the node's `textContent`). Both functions use `stripInlineMarkdown()` to strip bold/italic/code/link/escape formatting before comparing.

File rename (`rename-file` IPC) migrates fold state keys. External file reloads (silent and conflict-banner) save/restore fold state around `deserializeInto`.

Currently line-number-only; if folds are frequently lost from external edits, a djb2 hash of each line's text prefix can be added as a secondary matching fallback.

---

## Clipboard

### Plain text is literal text

Every copy writes BOTH a `text/html` (ProseMirror's own, rich: headings, bold, links, real `<table>` for Word) and a `text/plain`. The `text/plain` is ALWAYS the literal characters with no Markdown syntax -- no `#`, `- `, `1. `, `[ ] `, `**`, backticks or fences -- because it is what Cmd+Shift+V (`PlainTextPaste`) and every other app's plain paste reads. `SmartClipboard`'s `clipboardTextSerializer` is `fragmentToPlainText(slice.content)`: blocks are joined by a blank line, list items (at any depth, no indentation) and table rows by `\n`, table cells by `\t`, a hard break is `\n`, and atoms with no text (images, horizontal rules) contribute nothing. A cell selection's slice is bare `tableRow`s with no table parent, so the top-level separator is picked from the first child.

Every node recurses into its children, so no block can be dropped from the copy. A "contains a table anywhere" shortcut once silently dropped every non-table block -- never decide the whole slice's output on what it contains.

**Copy as Markdown** (Edit menu, `copy-as-markdown` IPC, and `TextContextMenu` on right-click inside a selection) is the way to get Markdown source: `selectionToMarkdown` writes ONLY `text/plain`, so a paste into MDE goes through tiptap-markdown's parser and comes back rich. Text inside one list item drops the item's marker (a slice carries every ancestor item, so a nested task would read `- [ ] - [x] text`), and a lone whole item sheds its own marker while any sublist keeps theirs. The menu's plain Copy runs `document.execCommand('copy')`, so it goes through exactly the same handlers as Cmd+C.

Paste INSIDE MDE is unaffected: ProseMirror reads the `text/html` (with its `data-pm-slice` structure) unless the paste is plain (Shift) or lands in a code block, where it takes the literal `text/plain`.

### Code blocks and inline code

Copying a selection whose only content is code yields plain text in BOTH flavours, so it pastes as plain text everywhere -- never a re-created ``` fence or code span. `SmartClipboard` handles the `copy` / `cut` DOM events directly (via `handleDOMEvents`, which ProseMirror runs BEFORE its built-in `serializeForClipboard`). `codeOnlySelectionRange` accepts an interior selection, a whole-block `NodeSelection`, or a drag that spills into neighbouring blocks without selecting any of their inline content (e.g. end of the line above to start of the line below); it rejects any selected inline node outside the block, or a second code block. `inlineCodeOnlySelectionRange` accepts a selection inside one textblock whose every inline node carries the `code` mark (part or all of a span). On a match it writes the raw `textBetween` (clipped to the block) to `text/plain` AND a plain `text/html` (HTML-escaped lines joined by `<br>`, no block wrapper, so a paste merges inline into e.g. a prose paragraph), `preventDefault()`s, and (for cut) deletes the whole selection.

Providing plain HTML -- not clearing it -- is required: with no HTML, ProseMirror's paste routes text through tiptap-markdown's markdown parser (so `- x` would become a list). Mixed selections fall through to the default path and keep their rich HTML; the code-block copy button uses its own `writeText`.

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

A pure `#anchor` link is handled inside the Editor's `handleClick`, before `onLinkClick`: `findHeadingByAnchor()` (`utils/markdown.ts`) matches it against GitHub-style heading slugs (lowercase, punctuation dropped, spaces -> `-`, repeats suffixed `-1`, `-2` in document order), puts the cursor at the heading, then calls `scrollIntoView({ behavior: 'smooth' })` on its DOM node. The selection must be set FIRST: the fold plugin releases any fold whose hidden span contains the selection, and a `display: none` heading has nothing to scroll to. The transaction deliberately omits `tr.scrollIntoView()`, which would jump instantly. An unmatched anchor falls through to App, which toasts. `doc.md#section` opens the file but does not yet scroll to the section.

The `onLinkClick` prop is bound per-tab in the Editor map; inside the Editor a ref (`onLinkClickRef`) bridges it into the once-created ProseMirror click closure.

---

## Plain-text files

### Which files, and where that is decided

`utils/fileKinds.ts` (`fileKind`) is the single answer to "how does this file open", shared by the main process and the renderer: `markdown` (WYSIWYG), `plaintext` (literal editor), `importable` (preview), `image` (read-only image tab), `other` (does not open). `IMAGE_TYPES` there is also the set `mde-file:` serves, so an image the explorer offers is always one the tab can show. Plain text is a fixed allowlist of extensions plus exact names (`.gitignore`, `.editorconfig`, `.env`, `Makefile`, `Dockerfile`, `LICENSE`) -- no content sniffing, since a misread binary is exactly the file that gets corrupted. Every dotfile is hidden from the explorer, Quick Open and Find in all files unless Settings > Show hidden files (`showHiddenFiles` in `mde-state.json`, off by default) is on, and even then only the allowlisted names are listed (`isHiddenName`); dot-directories always stay hidden. The main process reads the setting on every `list-directory` and `walkProjectFiles`, and toggling it clears the file index cache and broadcasts `project-files-changed`, so the explorer re-lists at once. The editor kind is fixed on the tab at open (`tab.plainText`), so a rename never swaps editors under a live buffer.

### Literal round trip

`.txt` used to open in the WYSIWYG editor and be rewritten by the Markdown round trip on save. `PlainTextEditor` (CodeMirror 6, no language package, so no highlighting) saves back exactly what it loaded plus the user's edits. Three traps:

- **Line endings.** CodeMirror splits on any break and `toString()` joins with `\n`, which would rewrite a CRLF file. A `<textarea>` is no better -- the HTML spec normalizes its value to `\n`. A file with ONE kind of break is edited normalized and saved with `sliceString(0, len, thatBreak)`; a file that MIXES them sets `EditorState.lineSeparator` to `\n`, so each `\r` stays in the text and shows as a special-char marker. Do not use the `\n`-separator mode for uniform CRLF files: the cursor's line end is then AFTER the `\r`, and typing there corrupts the line. `buildState` throws if the initial state does not serialize back to the input.
- **Encoding.** `read-file` decodes as UTF-8, which silently turns invalid bytes into U+FFFD. Plain-text tabs read via `read-plain-text`, which throws unless the bytes contain no NUL and re-encode identically; `openFile` checks first and shows a toast instead of opening. A BOM survives as a visible character.
- **Dirty state** is `doc.eq(cleanDoc)` -- a plain comparison, so undoing back to the loaded text marks it clean.

Save, Save As, reload and the `file-changed` handler go through App's `DocBuffer` (`serialize` / `version` / `reloadFrom`), implemented by `markdownBuffer` and by the `PlainTextHandle`; the hash guard, conflict banner and autosave are shared unchanged. Find (Cmd+F) opens CodeMirror's own search panel, not `FindBar`. Reloading a plain-text buffer resets its undo history.

### Find and Replace in all files

`FindBar`'s project-wide mode once read every listed file through `read-file` and force-wrote any match back (`expectedHash: null`), so a PDF or image containing the search term came back with every invalid byte turned into U+FFFD. Now:

- Only `markdown` and `plaintext` kinds are read or written (`searchableKind`); everything else is never opened.
- Both search and replace read through `read-plain-text`, so a file that is not exact UTF-8 is skipped and reported ("not UTF-8 text") rather than rewritten lossily. This applies to markdown too.
- Replace takes `hashFile` BEFORE the read and writes with that hash, so a change landing anywhere between hash and write is refused (reported as "changed on disk while replacing") instead of clobbered. Hashing after the read would leave a window. Open tabs with unsaved changes are skipped as before.
- Counting and replacing share `projectPattern` (a non-overlapping regex, whole-word via `(?<!\w)`/`(?!\w)` lookarounds), so the confirmation's count is the number replaced. The current-file mode still counts its own way.
- The confirmation and the result toast name the kinds: "Replace 5 in 2 markdown and 2 plain-text files?".

The read-then-write race between hash and write has no E2E test; it needs a write timed inside one IPC round trip.

## Import (DOCX / PDF)

### Import never mutates the source

The old flow renamed `report.docx` to `report.bak.docx` and filtered `.bak.` files out of the sidebar and quick-open index -- a file the user could see one moment and not the next, under a name they never chose.

Now the source stays exactly where it is, and the disambiguation happens in the preview's bar (below): `get-import-target` reports whether `<source>.md` exists, and if it does the bar offers "Open <name>.md" (primary) and "Convert again" instead of "Convert to Markdown". `convert-import` takes `{ newCopy?: boolean }`; without it the handler refuses to write over an existing target, with it `nextFreeImportTarget()` walks `<source>.2.md`, `.3.md`, ... to the first free name. There is no code path that overwrites a converted Markdown -- it may contain hand edits.

### Preview

Clicking (or dropping, or reopening) a `.pdf`/`.docx` opens a read-only tab with `view: 'preview'` (`components/ImportPreview.tsx`) -- `openFile` routes it there, so tentative tabs, Cmd+Shift+T, and the File menu's file actions all work unchanged. A preview tab is never watched, hashed, or saved. `ImportBar` stands where the toolbar would and carries the caveats the old confirm dialog showed: the source is left untouched, formatting may be simplified.

- **PDF**: an `<iframe>` on the file's `mde-file:` URL, which serves `.pdf` as `application/pdf`; Chromium's built-in viewer (a `chrome-extension://mhjfbm...` frame inside ours) renders and scrolls it. The src carries `#toolbar=0&navpanes=0` to drop the viewer's own toolbar and thumbnail pane, since the sidebar outline replaces them. On Electron 42 this needs no `webPreferences.plugins`. `npm start` serves the renderer under `forge.config.ts`'s `devContentSecurityPolicy`, which must list `mde-file:` in `frame-src` -- the suite loads file:// with no CSP, so only the test that replays that policy as a header catches it.
- **DOCX**: `preview-docx` returns mammoth's raw HTML (none of the turndown table preprocessing), shown inside `.editor-content .tiptap` to borrow the editor's typography. mammoth emits a fixed tag vocabulary but attribute VALUES come from the document, and a `javascript:` href would run beside the preload bridge -- so `sanitizeDocxHtml` keeps only allowlisted tags and safe `href`/`src` values, and link clicks never navigate the window (`#id` scrolls the preview, anything else goes to `openExternal`).
- **Outline**: each preview reports `PreviewOutlineItem`s (`{level, text, select}`) to App, keyed by tab id, and the sidebar's Outline mode shows them instead of `DocumentOutline` while a preview tab is active. For a DOCX the highlight tracks scrolling, using `DocumentOutline`'s reading line; for a PDF it marks the last jump, since the PDF's scroll lives inside the viewer's own frame. PDF: `preview-pdf-outline` returns the file's bookmarks (nested, levels from depth) via pdfjs, or one "Page N" entry per page when it has none; no font-size heading guessing. The viewer IGNORES a `#page=N` hash change on a loaded document, so a jump remounts the iframe (`key` = a nonce) with the new hash. DOCX: headings are read from the rendered preview, and each entry re-queries its heading by index on click -- React re-applies the `dangerouslySetInnerHTML` once after the outline is reported, so an element captured at that moment is already detached.

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

## Export (PDF / DOCX)

Right-click a markdown file (file explorer or tab) > Export as PDF / DOCX, or File > Export > as .PDF / as .DOCX for the active tab, writes `<name>.pdf` / `<name>.docx` beside it. No save dialog. The menu path exists so nothing is reachable only by right-click (see File operations); on an untitled buffer, a help tab, or the history tab it toasts instead. A taken name raises `ExportConflictDialog` (`.qa-export-conflict`): Overwrite, Create Another Copy (`name 2.pdf`, `name 3.pdf`, ...), or Cancel. The IPC's `onExisting: 'ask'` writes nothing when the name is taken; the renderer asks, then calls again with the answer.

Both formats are built in `utils/exportDocument.ts` from the ProseMirror document -- never from the window, which is what the original `printToPDF` on the app window did (one page, sidebar and toolbar included). An open file exports its live buffer, unsaved edits included; a closed one is parsed by a module-level headless `Editor` built from `buildExtensions()` (exported from `Editor.tsx`), so it parses exactly as opening it would.

- **PDF**: `getHTMLFromFragment` + a print stylesheet (0.5in margins), printed by the main process in a throwaway hidden `BrowserWindow` (JS off). The page is loaded from a temp file, not a `data:` URL, because Chromium caps those at 2MB.
- **DOCX**: the `docx` library, node by node, so Word gets real Heading 1-6 styles, numbered/bulleted lists, and tables. Tasks are list levels whose bullet is a ☐/☑ glyph; a checked item is struck and greyed. Each ordered list is its own numbering `instance` so it restarts at its `start`. An unmapped node or mark THROWS (surfaced as an "Export failed" toast) rather than silently dropping content.
- Palette colors use the LIGHT-theme shades in both formats, duplicated from `index.css` as `Record<PaletteColor, string>` so a new palette name fails to compile until it has one.
- Links: a URL with a scheme stays external; a `#heading` link that resolves (via `headingAnchors` / `normalizeAnchor` in `utils/markdown.ts`, the same slugs Cmd+click uses) becomes an internal jump -- an `id` on the heading in the PDF, a bookmark + `InternalHyperlink` in DOCX. Anything else (`other.md`, a missing heading) keeps its text and loses the link. DOCX bookmark names are `_heading<N>` because Word allows only letters, digits and underscores, and only LINKED headings get one.
- Images resolve against the SOURCE file's folder, as in the editor. PDF keeps each image's URL (the hidden print window loads `mde-file:` too); DOCX draws each one to a canvas and embeds it as PNG, capped to the 6.5in text width. One that won't load (missing, or remote without CORS headers -- DOCX only) becomes the text `[image not found: <src>]` in both formats rather than throwing.
- Never pass `tableHeader: false` to docx's `TableRow`. It writes `<w:tblHeader w:val="off"/>`, which Word honours but mammoth (and so MDE's own DOCX import) reads as ON, turning every row into a header.

## Sidebar and outline

### Sticky project header

The sidebar's project header (`.tree-root-header`: folder name + New File / New Folder / Collapse All) is `position: sticky; top: 0` inside `.sidebar-content`'s scrollport, so it stays reachable in a long tree. It needs an opaque `background: var(--bg-secondary)` -- rows scroll underneath it. `.sidebar-content` must carry NO `padding-top`: padding on a scrollport sits above the `top: 0` sticky element, producing a transparent band that file rows visibly scroll through. (The outline view has its own `.outline { padding: 4px 0 }`, so it doesn't depend on the scrollport for that spacing.)

### Expand state

Sidebar folder expand/collapse state is lifted to the `Sidebar` component (not `DirectoryNode`) via a `Set<string>` of expanded paths, so it persists across explorer/outline view switches.

### File operations

File explorer context menu (rename, delete, copy path, reveal in OS file manager) and create file/folder use dedicated IPC handlers (`rename-file`, `trash-file`, `reveal-in-finder`, `create-file`, `create-directory`). Delete moves to Trash via `shell.trashItem()`, never permanent delete. Reveal uses `shell.showItemInFolder()`; the menu label is platform-aware ("Reveal in Finder" / "Show in Explorer" / "Show in Folder"). The copy-path item degrades to "Copy File Name" (copies `target.name`) when there's no project root the file sits under -- a relative path is only meaningful inside the project folder.

Deleting a file via the sidebar also closes any tab open to that file, without adding it to the reopenable closed-tabs queue.

The File menu mirrors the context menu's file actions for the ACTIVE tab (Rename..., Move to Trash..., Reveal in Finder, Copy Relative Path, View Change History, plus Export), so someone who never right-clicks isn't locked out. They arrive as one `file-action` IPC and reuse the tab bar's rename/delete dialogs and `copyFilePath` / `relativeToProject` from `FileContextMenu.tsx`. Where the context menu would HIDE an item (no checkpoints, file outside the folder, untitled buffer), the menu item is always present and toasts the reason instead. Menu items take the window from Electron's click argument rather than `getFocusedWindow()`, so `clickMenuItem` in `tests/electron-helpers.ts` can drive them headless.

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

This is [electron/forge#3757](https://github.com/electron/forge/issues/3757), closed as not planned, so the repair is ours to own. `forge.config.ts`'s `postPackage` hook re-signs the whole bundle ad-hoc (`codesign --force --deep --sign -`), adds and signs the Quick Look appex, re-seals the app WITHOUT `--deep` (see Quick Look preview for why the order is fixed), and then runs `codesign --verify --deep --strict` as a gate, so the build FAILS rather than silently producing a "damaged" app. `--deep` is deprecated for real Developer ID signing but is the correct tool for a blanket ad-hoc repair.

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

## Quick Look preview

Two native app extensions in `MDE.app/Contents/PlugIns/`: `MDEQuickLook.appex` (spacebar preview, rendered HTML) and `MDEThumbnail.appex` (Finder icon, the document's opening text drawn large enough to skim). They are separate extension points, so separate bundles; both compile `quicklook/Shared.swift`, which runs `render.js` in JavaScriptCore. `quicklook/build.ts` compiles and signs both from `postPackage`, driven by its `EXTENSIONS` table. No Xcode project: an appex is a plist plus a Mach-O linked with `-e _NSExtensionMain`, and `swiftc` from the Command Line Tools is enough.

### Ad-hoc signing is sufficient

Verified by spike before building anything: an ad-hoc-signed, sandboxed appex inside an ad-hoc-signed host that lives outside `/Applications` is discovered by PlugInKit, launched by runningboard, granted its sandbox, and shown by Finder on spacebar. No Developer ID needed. macOS picks the extension up once LaunchServices has registered the app, which happens on first launch.

### Signing order is fixed, and `--verify` cannot see it go wrong

`codesign --force --deep` re-signs nested code, and it re-signs the appex WITHOUT its entitlements. An unsandboxed preview extension is silently never loaded -- and `codesign --verify --deep --strict` still passes, because the signature is valid, just wrong. Mutation-verified: adding `--deep` back to the final re-seal left strict verify green and stripped the entitlements. So `postPackage` goes: `--deep` repair of Electron's helpers -> `buildQuickLookExtension` (signs the appex with `quicklook/entitlements.plist`) -> re-seal the app without `--deep` -> strict verify -> `verifyQuickLookExtension`, which fails the build if the sandbox entitlement is gone. `tests/packaged.spec.ts` asserts the same thing.

Each appex's `CFBundleIdentifier` is derived from the host's at build time (`<host id>.quicklook`, `<host id>.thumbnail`); macOS rejects an extension whose ID is not prefixed by its host's.

### The host must import the markdown UTI

Extensions match files by UTI, and on a stock Mac nothing declares `net.daringfireball.markdown`, so `.md` files get a dynamic `dyn.*` type and the extension never fires. `forge.config.ts`'s `extendInfo` carries a `UTImportedTypeDeclarations` entry for it. An import loses to any installed app that EXPORTS the type, so it cannot fight another app's declaration.

If another app also ships a markdown Quick Look extension, macOS chooses between them (which one wins is unverified); the user can disable either under System Settings > General > Login Items & Extensions > Quick Look. There is no declarative way for an extension to defer to others.

### Rendering: the editor's markdown-it, in JavaScriptCore

`PreviewProvider.swift` is a data-based `QLPreviewProvider` (`QLIsDataBasedPreview`) that returns an HTML page. It evaluates markdown-it's UMD build (copied from `node_modules` at build time, the same copy tiptap-markdown uses) plus `quicklook/render.js` in a `JSContext`, with the editor's options (`html: false`, `breaks: true`), so a file previews the way it parses on open. `render.js` also tags `- [ ]` / `- [x]` items with `data-checked` (styled like the editor's checkboxes) and replaces images with their alt text, since a data-based preview has no base URL to resolve a relative path against. JS errors, a missing resource, or non-UTF-8 input throw, and Quick Look falls back to its own preview.

The thumbnail does NOT render HTML: `QLThumbnailReply` wants a drawing block, and WebKit is too heavy for an icon. `render.js`'s `thumbnailBlocks` walks markdown-it's token stream and returns the first 40 blocks as plain text plus a kind (heading level, paragraph, bullet, numbered, task, quote, code); `ThumbnailProvider.swift` draws them with AppKit on a white US-Letter-shaped page, body text at 7.5% of page width (about 27 characters per line, several times the system text thumbnail's size). Tables are skipped.

The system's own `TextThumbnailExtension` handles `public.plain-text`, which markdown conforms to; ours claims the more specific type and wins -- but a running `com.apple.quicklook.ThumbnailsAgent` caches the extension list, so after registering a fresh build it keeps using the system one until it is killed (`killall -9 com.apple.quicklook.ThumbnailsAgent`; plain SIGTERM leaves it lingering). Finder also caches thumbnails per file; `qlmanage -r cache` clears that.

### Testing

The extensions run in Quick Look's own processes, out of Playwright's reach, so the Finder check (spacebar, and icons in a folder of `.md` files) is manual, once per release. `qlmanage -t -x -s 512 -o <dir> file.md` writes the thumbnail to a PNG for a closer look. Everything around them is automated: `tests/quicklook.spec.ts` runs `renderMarkdown` and `thumbnailBlocks` through JXA (`osascript -l JavaScript`), which IS JavaScriptCore, so syntax Node accepts but JSC rejects would fail there; `tests/packaged.spec.ts` checks each built appex's entitlements, ID, extension point, architecture, the host's UTI import, and runs both functions from the bundled copies of the JS. The Swift drawing code has no automated test.

Bootstrap Icons are self-hosted in `src/fonts/` (woff/woff2), imported via CSS in renderer.tsx.

---

## UI details

### Tooltips

Toolbar buttons and the fold caret use a shared CSS `[data-tooltip]::after` bubble (0.45s hover delay, themed via `--tooltip-bg` / `--tooltip-text`). Toolbar buttons set `data-tooltip` + `aria-label` (not `title`) with platform-aware shortcut hints (e.g. "Bold selection (Cmd + B)"); `MOD` is `Cmd` on darwin else `Ctrl`. The fold-caret tooltip is positioned to the right of the caret via a `.fold-caret[data-tooltip]::after` override.

The bubble is `position: absolute`, `white-space: nowrap`, and centred on its button with `translateX(-50%)` -- and `opacity: 0` still takes part in layout. Inside `.sidebar-content`, which is a narrow scrollport, that is enough to widen the scrollable area on its own: the Checkpoints panel's "How checkpoints work" button sits at the right edge of the header, and its bubble pushed `scrollWidth` from 239 to 286, leaving a permanent horizontal scrollbar with nothing visible to scroll to. Because those buttons are pinned to the right edge, widening the sidebar never absorbed it -- the overrun was constant, which is the tell that it is a fixed-size overhang and not overflowing content.

`.sidebar-content [data-tooltip]::after` therefore right-anchors the bubble (`left: auto; right: 0; transform: none`) and lets it wrap. Overflowing to the LEFT would be the same geometry, but left overflow does not extend a scroll region in LTR, so the panel stays scroll-free either way. Diagnosing this needed a probe that neutralised `content` on the pseudo-element and re-measured: pseudo-elements are invisible to `querySelectorAll`, so walking the DOM for an element wider than its parent finds nothing at all.

### Help page

The Keyboard Shortcuts help page opens as a read-only tab. Content loaded from `docs/help/keyboard_shortcuts.md` via webpack `asset/source`. Read-only tabs hide the toolbar, TableMenu, and LinkPreview; the editor caret is transparent.

### Editor styling

- Paragraph spacing: `.editor-content .tiptap p` has `margin-top: 0.8em` (doubled from 0.4em) so paragraph-to-paragraph and list-to-paragraph gaps breathe. Headings already carry their own bottom margin, so `h1..h6 + p` overrides `margin-top` back to `0.4em` -- otherwise the gap under a heading would grow too. List margins are deliberately untouched.
- Horizontal rules show a blue outline (`var(--accent)`) when selected via `ProseMirror-selectednode` class.

---

## Checkpoints (version history)

Full design rationale lives in `CHECKPOINTS.md`, which is both the proposal and the as-built record. This section covers only what will bite someone changing the code.

Code: `src/git/` (`repo`, `status`, `checkpoint`, `checkpointer`, `history`, `restore`, `guards`, `ignore`, `titles`), `src/components/VersionPanel.tsx`, `src/components/HistoryView.tsx`, `src/components/DiffView.tsx`, `src/components/vcRestore.ts`, `src/utils/prosediff.ts`. Everything Git-touching runs in the MAIN process; the renderer never sees a repo object. Library is **isomorphic-git** (pure JS, no native deps, bundles normally) plus **jsdiff**.

### The word "Git" appears in the UI exactly once

The audience is non-technical writers reviewing what an AI agent did to their files. No staging, no branches, no remotes, no merge conflicts. The tab is "Checkpoints" with a `bi-clock-history` icon -- deliberately not a branch icon, which reads as "this is for programmers" to exactly the person we are trying not to scare.

The one exception is the FIRST bullet of the how-it-works recap (`HelpCard`, class `qa-vc-help-git`), which says outright that checkpoints are a simplified automatic front end to Git and that you never have to touch Git itself. That is not a softening of the rule, it is the rule's one honest place: the credit belongs somewhere, "your history is kept in a standard, portable format" is reassurance rather than jargon, and it is in a panel someone opens deliberately rather than in the working UI. Nowhere else -- no button, label, menu item, dialog, or toast -- names Git, and adding a second mention is a regression, not a precedent.

### Restoring one file asks WHICH version, because "this checkpoint" is ambiguous

A single "put this version back" button was quietly unanswerable. You reach it while looking at a red-and-green diff, and "restore to this checkpoint" can mean either side of it: the way the file was BEFORE that change, or the way it came out AFTER. Nothing on the button said which, and the two are opposites. Worse, the case that sends someone looking -- "I changed `details.md` weeks ago, I want that undone, and I have no idea which checkpoint last touched it" -- is exactly the one where guessing wrong is silent.

So the button is now just **Restore** and it opens `RestoreFileDialog`, which offers both directions side by side rather than asking yes/no to one hidden interpretation. The left card is tinted with `--diff-del-bg` / `--diff-del-word` and the right with `--diff-add-bg` / `--diff-add-word` -- the diff's OWN red and green, not generic danger/success. That is the mechanism, not decoration: "before this change" and "the red lines you were just looking at" have to be visibly the same thing, or the dialog is a differently-worded copy of the ambiguity it exists to remove.

Implementation notes:

- "Undo this change" is `restoreFile(root, checkpoint.parent, path)`. It needed no new machinery at all: `restoreFile` already accepts any sha and already handles "the file did not exist there" by deleting it after a safety checkpoint. `VcCheckpoint.parent` comes free off `git.log`'s `commit.parent[0]` in `toCheckpoint`, so no extra read.
- The root checkpoint has no parent, so "Undo this change" is disabled there with the reason spelled out. A checkpoint that CREATED the file makes undo a deletion, and one that DELETED it makes the after-side a deletion; both are stated in the card before the click, driven by a `VcChangeKind` the caller passes in (`file.kind` from the file list, `diffKind(diff)` from the diff view -- which is why `DiffView`'s restore button is disabled until its diff lands).
- Restoring one file always discards EVERY later change to that file, not only this checkpoint's -- the file goes back to a point in time. That is the one consequence the two cards cannot convey, so the dialog counts the later checkpoints that touched the file (the index of the target sha in `vcFileHistory`, newest-first) and says so.
- The count is `null` until measured and `-1` when unmeasurable, never collapsed to `0`. "Not counted yet" and "nothing came after" look identical on screen, which made a test asserting the warning's absence pass against a build that never hid it. `data-later` on the dialog root exists only so a test can tell those apart; nothing in the UI reads it.
- Whole-folder restore keeps ONE action and its own dialog, and the difference is not "the folder case is less ambiguous" -- it is that the answer already exists somewhere else. For a whole folder, "before this checkpoint" IS the next checkpoint down the list, so a second button would duplicate the neighbouring row's action inside every dialog. For a single file that is not true: the version before a checkpoint touched it may be many checkpoints back, with no row in the current list standing for it. So `RestoreAllDialog` says which side you land on in words ("back to how it stood at the *end* of X, that checkpoint's changes included") and points at the alternative ("restore to the checkpoint just below this one instead"), gated on `checkpoint.parent` so the root checkpoint does not point at a row that does not exist. The button label lost its "to here" for the same reason the one-file button is just "Restore": a label is the wrong place to answer which side.

### History is append-only

There is no operation anywhere that destroys or rewrites a commit. Restore reads old content and writes it as a NEW checkpoint on top (the shape of `git revert`), and always takes a safety checkpoint of the current state first. Consequences: detached HEAD is unreachable, "I lost my work" is structurally impossible, and no action needs a scary confirmation. Do not add `reset --hard`, amend, or rebase to this feature for any reason.

### The marker grants write mode, and nothing else does

`mde.managed = true` in `.git/config` is the ONLY thing that makes a repo writable. `.git/config` is the right home: inside `.git/`, so never in the working tree, never in a diff, never committed, and it survives a move, rename, copy, or zip. Do NOT key managed-ness off a path in `mde-state.json` -- that breaks on exactly the rename case (there is a test).

Five attach states: `none` (no repo -- dimmed tab, opt-in screen), `managed` (writable), `foreign` (a repo MDE did not create -- read-only browsing plus an explicit adopt button), `steppedBack` (marker present but a remote or a second branch appeared -- read-only, and NOT adoptable), and `off` (the user turned watching off for this folder; it overrides the other four -- see "Turning a folder off"). Live evidence outranks the marker, always. A false negative costs one click; a false positive means MDE silently commits into a developer's real project.

### Opt-in is mandatory, and it lives in Settings

Opening a folder never creates a repo. Turning checkpoints on is a **Settings** decision -- `CheckpointSettings`, at the bottom of the Settings dialog -- and setup from there runs guardrails, seeds `.gitignore`, inits, writes the marker, and makes an initial checkpoint in one step. The `?` (in the panel header and again in Settings) opens the how-it-works recap as a DIALOG, and it auto-opens once right after first setup: a help affordance nobody clicks is the same as no help, and nine paragraphs wedged into a 250px sidebar was not a readable one.

The sidebar's `none` state is a signpost, not a control -- but it keeps the whole explanation and adds an "Open Settings" button. Moving the explanation into Settings alongside the button would hide the feature from exactly the people it was built for, because nobody browses Settings.

There is deliberately **no "turn off" button** that undoes activation. Off means flipping back to manual: the history is real work the user may want back, and a checkbox that deletes it is not a thing this feature should own. The "Watch this folder for changes" switch is not that button -- it deletes nothing and only stops MDE looking. Adopting a `foreign` repo moved to Settings for the same reason activation did -- it is the same decision.

### Two axes, not one permission

`mde.managed` says MDE **may** write to this folder. `mde.auto` says whether it **does so unprompted**. They are orthogonal, and conflating them is the mistake to avoid: a folder can be fully managed and still never checkpoint on its own.

Manual is the default. `writeMarker` writes `mde.auto = false` explicitly on every activation, so automatic is opt-in rather than opt-out -- turning checkpoints on and letting an app write to your folder on a timer are two different consents, and the opt-in flow only asks for the first. That explicit write is also what makes the read asymmetric: **a MISSING `mde.auto` reads as `true`**, because absence can only mean the folder was activated before the setting existed. Folders that were already checkpointing automatically keep doing so.

Manual mode costs two guards, and both are load-bearing:

- `tick()` returns early **after clearing `state.lastSignature`**. The poll gate is `!sawChange && lastSignature === null`; leaving a signature recorded holds the gate open forever, so the poller would spin at its full rate on any folder with one uncommitted file. The watcher still sets `sawChange`, and status is still published, so the badge stays live either way.
- `flushRoot()` returns early too. The flush exists because the 10-minute rule can leave that much work uncaptured, so closing a folder or quitting is the last chance -- but a surprise checkpoint is precisely what manual mode opted out of, and nothing is at risk: the files are already on disk.

### The cadence rule -- there is exactly one

> In automatic mode: if it has been more than 10 minutes since the last checkpoint, and there are uncommitted changes, wait for a quiet period, then checkpoint everything.

Deliberately source-agnostic: no different behavior for agent writes vs. the user's own edits. An earlier draft had two settle windows and collapsed on the mixed case (you edit a file, then Claude rewrites it -- which window applies?). A rule with a conditional inside it is one nobody can predict. Explicitly rejected: urgency escalation on volume (it splits bursts, and mid-burst states are the worst possible restore targets) and using the Git index as a debounce buffer (it strands real content in `.git/objects` that the UI cannot see or reach).

`--vc-eligibility-ms` and `--vc-poll-ms` override the two constants so tests do not wait ten minutes.

### Detection: poll status, gate on the watcher

Change detection derives from `statusMatrix`, NOT from watcher events, and this is correctness rather than taste: **`statusMatrix` excludes gitignored files and watcher events do not**. Driving the settle window off watcher events means any frequently-rewritten ignored file (`.obsidian/workspace.json`, Dropbox sync traffic, a build watcher) resets it forever, and real changes sit uncommitted with no visible cause. The watcher is demoted to a dirty-flag gate -- `sawChange = true`, unfiltered, undebounced -- and that is its entire job.

**The poller gate is `!sawChange && lastSignature === null`, and both halves are load-bearing.** Gating on the watcher alone deadlocks the most common case in the feature: one burst of edits, then silence. The burst sets the flag, the first tick consumes it, and with no further filesystem events no later tick ever runs -- so the settle window never completes and the changes sit there until the next unrelated edit. `lastSignature !== null` means "the last tick saw uncommitted changes", which is exactly when we must keep polling regardless of the watcher.

**The signature must fold in mtime and size.** `statusMatrix`'s WORKDIR field is a coarse enum (0 absent / 1 same as HEAD / 2 different), NOT a content hash, so a file rewritten with different content produces a byte-identical row both times. A signature built from the matrix alone compares equal across two polls mid-burst and commits a half-finished agent operation. Test: "no checkpoint lands mid-burst".

Poll interval self-calibrates: `max(60s, lastStatusDuration * 100)`, capped at 15 minutes. Measured 52-74ms on this repo with 33k gitignored entries, so a real Markdown folder is far cheaper.

**Status walks run on a worker thread, never the main process, where their cost landed on saves, reads, and every IPC reply.** The poller is not the only caller: the sidebar badge refreshes on each `project-files-changed` (any watcher event, 2s debounce, in ANY attach state but `none`, panel open or not). On a code repo with 360MB of packs and agents writing into an ignored `tmp/` every second, each walk blocked the main process for ~6s -- beachballs and typing lag. The cause is an isomorphic-git race: it SHA-1s a whole pack on first read (`_checksumVerified`), but every object read that was waiting for the pack to load runs the check too, and a walk reads sibling folders' trees concurrently. That repo hashed 20GB per walk (92 x 220MB), synchronously. It needs HEAD's root tree OUTSIDE the big pack (loose, or in a newer pack), so all subtree reads pile onto the pack's load; a fixture whose root tree shares the pack hashes once and looks fine. The defences, each with a mutation-verified test in "Status walks":

- **Each pack is loaded once, before the walk** (`loadPacksOneAtATime` in `src/git/statusWalk.ts`). Reading the first object of each `.idx` one at a time, through the shared `cache`, verifies each pack before the walk's concurrent reads can pile onto it. On that repo a cold walk went from 6.4s to ~0.4s (6.6s of CPU to ~0.7s). The test fixture puts HEAD's root tree outside the pack for the reason above and counts bytes through `crypto.createHash`.
- **The walk is on a worker** (`src/git/statusWorker.ts`, its own webpack entry, loaded by path from beside `index.cjs`; the walk itself is `statusWalk.ts`, importable in-process by tests). `status.ts` keeps pacing, coalescing, and the lock on the main side and sends the worker one message per walk. A worker that crashes, fails to load, or is stopped rejects every walk in flight and is replaced on the next request -- nothing hangs. It stops after 5 quiet minutes (an idle worker is ~20MB RSS; its packs would have gone cold by then anyway) and on quit. Only inside the packaged `app.asar` can the load fail while the dev suite passes, so `--self-test-status=<dir>` walks `<dir>` on the worker and prints JSON, and `tests/packaged.spec.ts` runs it against the built binary.
- **Packs are cached across walks, in the worker; the index never is.** With a fresh `cache` every call, every walk reloads (and re-hashes) every pack; reusing the pack map took that walk from ~6s to ~165ms. Pack files are immutable per name, so the map is safe to keep (entries whose `.idx` vanished are pruned; a root's packs are released after 5 idle minutes or on folder close). The index is NOT carried over: isomorphic-git's index-staleness check is whole-second mtime + size + inode, `deraceIndex` rewrites it in place, and a same-second same-size rewrite would leave a cached index silently stale.
- **Walks and checkpoints never overlap (`withIndexLock`, per root).** isomorphic-git writes `.git/index` in place and its own lock is per thread, so a worker walk could read the index half-rewritten by `createCheckpoint`'s `git.add` on the main thread. `createCheckpoint` holds the lock for its whole run; `observeStatus` takes it for each walk.
- **Observers go through `observeStatus`: coalesced and paced.** Requests that arrive while a walk is pending share it (each still gets a walk that began after it asked), and a walk cannot start until 9x the previous walk's cost has passed, capping the worker at ~10% of a core whatever the repo. Only `createCheckpoint` calls `computeStatus` directly (already holding the lock), since a commit must see the tree at the moment of the click.

- `computeStatus` passes **`refresh: false`**, making status read-only with respect to the index. With the default, a status that merely happened to run in the same second as a write would poison the stat cache with nothing following it to undo the damage. This makes `git.add` the only writer of index stats in the whole system.
- `createCheckpoint` calls **`deraceIndex`** right after committing, rewriting the index entry (via `updateIndex` with an explicit oid, which stores zeroed stats) for any just-committed file whose mtime second is the current second. Zeroed stats never compare equal to a real file, so the next status hashes it for real.

Do NOT "fix" this by deleting `.git/index` between checkpoints. `git.commit` builds its tree FROM the index, so the index must stay COMPLETE even though it is never left dirty -- each checkpoint adds only the changed files on top of what is already there. "Transient" means no uncommitted content, not empty.

### Turning a folder off, and the slow-folder warning

Settings > "Watch this folder for changes" puts a folder in the `off` attach state: no poller, no status walks, no history tab, its packs released. It is keyed by path in `mde-state.json` (`vcOff`), unlike the marker, because it grants nothing -- a renamed folder that comes back on costs one walk -- and because writing into a `foreign` repo's `.git/config` is exactly what MDE must not do. `vc-set-off` drops paths that no longer exist on every write. A tick already waiting on a paced walk when the folder is unwatched discards its result (`state.stopped`), or the badge lights up after the folder was turned off.

Three walks in a row of 1s or more (`watchForSlowWalks` in `status.ts`; `--vc-slow-walk-ms` overrides the threshold) raise a dismissible warning banner offering that switch, once per folder per session. A streak, because one walk can stall behind a busy machine.

### Failures are logged and shown, never swallowed

Every main-process failure the UI reports also goes to `~/Library/Logs/MDE/main.log` with its stack (`src/log.ts`; `--log-file=` redirects it, test runs default to the temp folder; one `.old` rotation at 5MB). A failed status walk returns `error` from `vc-get-status`: the panel replaces the changes list with a danger notice, and App toasts each new message once. The poller logs every failure but broadcasts only every third in a row (`vc-status-error`), since one failure is usually a file caught mid-write. `vc-checkpoint-files` rethrows, so the history tab shows an error instead of "Loading..." forever; the stats and counts calls log and return `{}`, since an absent count already reads as unmeasurable.

### Restore moves BYTES, and only the bytes that differ

A restore corrupted a user's PDF, and the mechanism is worth remembering because it looks like nothing at the call site. `readFileAt` decoded a git blob into a JS string and `writeFileEnsuringDir` wrote it back with `'utf8'`. Every byte sequence that is not valid UTF-8 becomes U+FFFD on the way in, and U+FFFD serialises to `EF BF BD` on the way out. Markdown survives this untouched, so it passed every test and every manual check; a PDF, an image, or a `.docx` is destroyed silently and permanently.

Two rules now hold the line:

- **`readBlobAt` returns a `Buffer` and restore writes that Buffer.** `readFileAt` (the string form) still exists for the diff viewer, which genuinely needs text. Nothing that writes to disk may go through it.
- **`writeIfDifferent` byte-compares before writing.** Whole-folder restore used to rewrite every file in the tree unconditionally, which turned one damaged file into a folder-wide rewrite and disturbed the mtime of files nobody had touched. Now an identical file is left completely alone -- which is also what makes "restore everything" honest when the target is already the current state (`filesWritten === 0` -> "nothing needed restoring" rather than a fabricated "restored 3 files").

Both have repro tests that were confirmed failing first.

### Titles are a sidecar, never a commit rewrite

The pencil on a checkpoint stores a display title in **`.git/mde-titles.json`**, keyed by sha, written temp-then-rename. It never touches the commit.

Rewriting the stored message would mean writing a new commit object for that checkpoint and for every descendant, then moving the branch ref. isomorphic-git has no rebase, so all of that would be hand-rolled -- and it would change the shas that existing `MDE-Restore:` trailers name, turning every restore entry in the list into a dangling reference. It also punctures the append-only rule the rest of the feature leans on. File CONTENT could never be harmed either way (blobs and trees are content-addressed and immutable), so this is a referential-integrity and implementation-risk argument, not a corruption one -- but a cosmetic label does not justify any of it.

`.git/` is the right home for the same reasons as the managed marker: never in the working tree, never in a diff, never one more change to think about, and it travels with the folder. Losing the sidecar degrades to the generated title, which is the correct failure mode for a field whose only job is recognition. `readTitles` therefore never throws -- a missing or malformed file just means "no custom titles". `toCheckpoint` applies it, so every history read gets it without each caller remembering to look.

### History is a tab, not a mode

`Tab.view === 'history'` renders `HistoryView` in the main area instead of an `Editor`. Deliberately a tab: an app-wide mode that hid the editor would have to either unmount live buffers (losing unsaved work and undo history) or keep a hidden editor receiving keystrokes and watcher events. As a tab, Cmd+W, Cmd+S, the conflict banner, and drag-drop all already have correct answers, and inactive panes are `display: none` rather than unmounted -- there is a test asserting an unsaved edit survives a trip through history.

**The split is by TENSE.** The sidebar is the present -- what has moved since the last checkpoint, and the button that captures it. The tab is the past -- browsing, per-file line counts, full-width diffs, retitling, and restore. Both go through `src/components/vcRestore.ts` so they can never phrase an outcome differently, which matters because "Restored 3 files" on an operation that changed nothing was a real reported bug.

**The tab is the ONLY drill-down of any kind.** The sidebar had a second one -- expand a checkpoint, list its files, open a diff overlay -- reimplementing the tab's three levels over the same data in a quarter of the width, and the two had already drifted on restore wording. Removing it left one overlay behind, for the **Changes** list; that one is gone too now. Clicking an uncommitted file routes into the tab like everything else.

Uncommitted work models as the **bottom two levels of the same ladder**, not a fourth concept: `working` occupies the checkpoint slot and `workingFile` the file slot, so the breadcrumb reads `Checkpoints > Unsaved changes > note.md` with exactly the shape a real checkpoint has. That is honest about what it is -- the checkpoint you are about to make. `ChangesSection` is exported from `VersionPanel.tsx` and mounted in both places rather than reimplemented, for the same reason restore is shared; the only difference between the two mounts is the width they get.

`workingFile` deliberately has **no Restore button**. Every other Restore lands on a version that is in history; discarding work that was never checkpointed is unrecoverable, and that is not what the button means anywhere else.

Per-file `+n −n` counts on the changes rows come from `vc-status-counts`, a separate call made after the list -- the same cheap-walk/expensive-counts split as the checkpoint list, for the same reason. It refetches on every status broadcast rather than only when the set of paths changes: editing the same file again moves its numbers without changing the list. `files` is a fresh array on each poll, so that identity IS the cadence, and the cost is bounded by the poll interval rather than by typing speed.

Every entry into the tab is external to it (the Browse button, a sidebar checkpoint, a right-click), so `App` owns a `HistoryNavRequest` and the tab reads it. It must be `{ target, nonce }`, not a bare target: re-requesting the *same* target is the common case ("Browse" while already on a diff of the newest checkpoint) and an unchanged prop fires no effect. `HistoryView` seeds `nav` lazily from the request at mount and tracks an `appliedNonce` ref -- seeding in an effect instead would paint the unfiltered list first and fetch a page nobody asked for.

The file scope (`View change history` on a right-click) is a **filter on the list level**, not a fourth nav level: `Nav` carries `scope`, and the load effect keys on `[projectRoot, vc.historyKey, scopePath]` where `scopePath` is a plain string (an object literal would refetch forever). Drilling in from a scoped list still shows everything the checkpoint changed, and the scope survives the round trip. `FileContextMenu` is mounted by both the file explorer and the tab bar, so the two menus stay identical by construction -- note it lives inside `FileExplorer`, not `Sidebar`, so props for it thread one level deeper than it looks.

`listFileCheckpoints` needs `force: true` or `log` **throws** when the file is missing at the starting ref -- deletion is exactly when this list gets asked for. `depth` counts matching commits, so it is a real page size. `follow` is deliberately unused: it mutates `filepath` mid-walk, and a subtly wrong history is worse than a short one when it is what a restore decision is made from.

**The list row has no button.** The whole row drills in, which frees the width a "See what changed" button was taking and puts a GitHub-style diff-stat bar at its right end. It stays a `div` with `role="button"` rather than becoming a `<button>`, because the rename pencil is a button and nesting them is invalid HTML; the pencil and the editing form both `stopPropagation` so renaming does not also navigate away.

The bar's line totals come from `vc-checkpoint-stats`, a **separate call made after the list resolves**. Listing is a cheap log walk; measuring is a diff per changed file per checkpoint, and folding it into `listCheckpoints` would make the whole page wait on the slowest part of itself. The renderer's map is keyed by sha -- a content address -- so it doubles as a cache across paging and the refetch a retitle triggers. How many blocks are filled scales **logarithmically** against the largest checkpoint currently on screen: a folder's first checkpoint records every file in it and is routinely a hundred times bigger than any later edit, so a linear scale would flatten every real day's work to one block. An unmeasurable checkpoint draws empty slots, never a zero-length bar, for the same reason the per-file counts render nothing.

Line counts in the detail view are opt-in (`checkpointFiles(root, sha, { counts: true })`) and doubly capped -- 200 files, 2 MB per side -- because counting costs two blob reads plus a diff per file. Unmeasured files render **nothing**, never `+0 −0`: a zero would read as "this file did not really change", which is a lie.

### Other traps

- **isomorphic-git has no `add -A`.** You must walk the status yourself and call `remove` for deletions and `add` for everything else. Forgetting the `remove` half silently drops deletions from checkpoints.
- **Never return `null` from a `walk` map.** `_walk` treats `null` as PRUNE (`if (parent !== null) { ...recurse... }`), so returning it for the `'.'` root entry silently prunes the entire walk and every checkpoint reports zero files, with no error anywhere. `undefined` is the value that means "not a result". Directory entries must also return `undefined` so the walker recurses into them.
- **Whole-tree restore must delete.** Write every blob at the target commit, then remove files that exist now but did not exist then. Forgetting the deletion half yields a union of both states, which is worse than either.
- **Restore deliberately bypasses `write-file-if-unchanged`** and writes straight to disk. That guard is for renderer buffers; here the existing conflict machinery is what we want, and it works for free -- clean tabs silently reload with the blue banner, dirty tabs raise the red one.
- **The changed-files badge's colour follows the MODE.** Grey (`var(--text-muted)`) is the default and means "status number": in automatic mode the count resolves itself within minutes whether or not anyone looks at it, and on a `foreign` or `steppedBack` folder MDE will never act on it and neither can the user. Red (`.sidebar-tab-badge-alert`) is added for exactly one case -- `attach === 'managed' && auto !== true` -- where it is literally true that nothing but the user pressing the button will ever clear it. Red is a call to action; that state is the only one with an action. The test compares the computed colour against injected probe elements for `var(--text-muted)` and `var(--danger)` rather than an `rgb()` literal, so it holds in either theme.
- **The `.git/` write loop is structurally prevented, not filtered.** Committing writes to `.git/`, the watcher sees it, `sawChange` goes true, and the resulting status is empty so nothing happens -- and `lastCommitAt` was just reset anyway. Two independent reasons it cannot loop, neither requiring the watcher to know what a path is.

### Testing

`tests/version-control.spec.ts`. Tab selector is `.qa-vc-tab`; the rest are `qa-vc-*` (sidebar), `qa-hist-*` (history tab), `qa-diff-*` (diff viewer).

Five of those tests assert that NOTHING happened (no mid-burst commit, no missing change row, no history rewrite on a retitle, no automatic checkpoint in manual mode, no flush on closing a folder in manual mode), and a "nothing happened" test is worthless until it has been seen to fail. All five were verified by mutation: reverting the mtime/size half of `statusSignature` makes the mid-burst test commit six times during the burst, disabling `deraceIndex` makes the same-second test report zero changes, making the `vc-set-title` handler also create a checkpoint turns the retitle test's sha assertion red, and deleting either `!vcState.auto` guard (in `tick()` or in `flushRoot()`) turns the two manual-mode tests red within a second. Re-verify the same way if you touch any of them.

The manual/automatic pair is deliberately structured so the "nothing happened" half can never be vacuous: the flush test runs the automatic case FIRST in the same app, so the assertion that manual stayed put is measured against a path that was just proven to work.

The literal quit flush is not reachable from a test -- `before-quit` returns early under `--test-headless` so Playwright can close the app at all -- so the flush is exercised through the folder-close path (`unwatch-project`), which calls the identical `flushRoot`.

A mutation probe caught a subtler failure than the one it was aimed at. Removing `force: true` from `listFileCheckpoints` left the deleted-file test GREEN, and the library was not the reason: a standalone script confirmed the throw. The test was passing on a **transient frame** -- after the right-click the component re-rendered with the new scope header while `checkpoints` still held the previous unscoped list, which happened to have the same length as the expected scoped one, and Playwright asserts on the first matching frame. Any assertion whose expected value also holds before the data settles is worthless. The fix was to seed a third checkpoint so the scoped count (2) can never equal the unscoped one (3), plus a negative assertion on content that only the unscoped list contains. With that, the probe goes red as it should.

`makeTmpDir` calls `fs.realpathSync`. macOS hands out `/var/folders/...`, a symlink to `/private/var/...`, and isomorphic-git resolves it -- without the realpath the renderer's `projectRoot` and the main process's repo root are two different strings and every event is silently dropped.

Not covered by tests: quit-time capture (`before-quit` -> `flushAll`), because `before-quit` is skipped under `isTest` -- Playwright closes the app on every teardown and a real flush would fight the harness.

---

## Feature inventory

What exists today, for orientation. This list goes stale faster than the notes above -- the test suite is authoritative.

- Electron shell with IPC bridge, menu bar (including Window menu with Hide/Minimize), drag-drop (with blue pulse overlay)
- TipTap WYSIWYG editor with Markdown load/save
- Literal plain-text editor (CodeMirror, monospace, no highlighting) for allowlisted text files; byte-exact round trip including CRLF/mixed line endings, BOM, trailing whitespace
- File explorer icons per kind: `bi-markdown`, `bi-code-slash` (plain text, muted name), `bi-file-earmark-pdf`, `bi-file-earmark-word`
- File explorer sidebar:
  - Resizable via drag handle (140--600px, width persisted to mde-state.json)
  - Root header with New File (`bi-file-earmark-plus`), New Folder (`bi-folder-plus`), Collapse All (`bi-arrows-collapse`) buttons -- sticky at the top of the scroll, so only the file/folder list below it scrolls
  - Selection state with teal highlight; Enter to rename selected item
  - Creates files/folders in selected folder or as sibling to selected file
  - Right-click context menu: View Change History (files only, hidden when checkpoints are off), Rename, Delete (confirmation dialog, moves to Trash), Copy Relative Path (or "Copy File Name" when no project folder is set; shows info toast), Reveal in Finder. Folders also show New File / New Folder. Dismissable with Escape. The same menu component is what a tab right-click shows.
  - Keyboard: Arrow Up/Down (navigate), Arrow Right/Left (expand/collapse folders), Enter (rename), Escape (deselect), Cmd+Backspace (delete with confirmation dialog)
  - Clicking outside sidebar deselects
  - Folder expand/collapse state persists across explorer/outline view switches
- Document outline sidebar (icon tabs with rounded bg, not text+underline). The heading at the current scroll position (top of the viewport) is highlighted blue; the rest are default color.
- Tabbed editor with smart dirty tracking (undo back to original clears dirty), scroll position preserved across tab switches (saved via scroll event listeners, restored on tab activation)
- Toolbar with Bootstrap Icons (headings dropdown, bold, italic, strike, highlight, text-color and highlight-color palette menus, lists, todo list, blockquote, code, link, table, HR) -- wraps on narrow windows, undo/redo gray out when unavailable. A right-aligned caret (or View > Toggle Toolbar, Cmd+Alt+T) slides it out and leaves a floating expand button in the editor's top-right; visibility persists as `toolbar` in `mde-state.json`. Each button shows a styled tooltip on hover hinting its keyboard shortcut (e.g. "Bold selection (Cmd + B)").
- Link editing via floating LinkBar (top-right of editor, like FindBar) -- preserves text selection highlight via ProseMirror decorations while editing URL
- Link preview popup (top-right of editor area when cursor is in a link)
- Cmd/Ctrl+click a link to follow it: relative file links open in a new tab (resolved against the current file's folder, per standard Markdown semantics); a missing target prompts to create the file; external URLs open in the browser. Plain click still positions the cursor for editing.
- Find/replace bar (inline below toolbar) with match highlighting (yellow border for all matches, yellow bg for active match), case-sensitive and whole-word filters, disabled nav when <=1 match, inline "Replace all" confirmation. An all-files mode searches and replaces across the project's markdown and plain-text files only, its confirmation naming how many of each kind will change
- Code block copy button (NodeView-based, top-right corner, appears on hover)
- Table cell actions dropdown (three-dots trigger centered on top-right cell border, viewport-aware dropdown alignment, icons for insert/delete row/column)
- Copying table cells: a single cell copies just its text; multiple cells copy as tab-separated rows (pastes as plain text in editors, as a real table into Word via the HTML clipboard). Select-all over a mixed document copies everything -- prose, lists, AND the table as a Markdown table.
- File conflict detection (hash-guarded save that can never clobber a stale file; silent reload with a blue "detected changes" proof banner; red conflict banner when the buffer is dirty). Watches the containing directory so it survives atomic saves.
- Quick Open command palette (Cmd+O) with fuzzy search, file indexing (10s TTL cache)
- DOCX/PDF import: clicking one opens a read-only preview tab (PDF in Chromium's viewer, DOCX as sanitized HTML) whose top bar converts it to `.{ext}.md` (e.g. `report.pdf.md` -- preserves original extension). The source file is never renamed, moved, or hidden. When the Markdown already exists, the bar offers to open it (primary) or convert again into a new numbered copy (`report.pdf.2.md`, `.3.md`, ...) -- conversion never overwrites.
- Image files (png, jpg, gif, webp, svg, avif, bmp, ico): clicking one opens a read-only tab showing it scaled down to fit the pane; a file that cannot be decoded says so instead of showing a broken image
- Images: shown inline from relative, absolute, or remote paths; a missing one shows a placeholder naming its path. The reference is saved exactly as written. Selecting one shows its path; right-click reveals the file or removes the image; removing the last reference to a file on disk asks whether to move the file to the Trash too. Pasting a screenshot or web content with images asks whether to save them to a folder beside the document (default `images/`), keep web images as links, or drop them; never inlined as `data:` URLs. Dropping an image file onto the document, or the toolbar's Insert Image picker, takes the same dialog and copies the file in
- Export to PDF / DOCX from the right-click menu or File > Export, written beside the source with an overwrite / copy / cancel prompt when the name is taken; in-page heading links survive as jumps
- Finder Quick Look (spacebar) preview of `.md` files, macOS only: a native appex rendering with the editor's markdown-it options, task checkboxes styled like the editor's, light/dark aware, images shown as alt text
- Finder icon thumbnails of `.md` files, macOS only: the opening headings, text, lists and tasks drawn large enough to skim
- Tools -> Word Count: a modal (`.qa-word-count`) showing word count, character count, and estimated page count (300 words/page) as `selection / whole document` -- or, when nothing is selected, the document figure alone with no `0 / ` prefix. Counts are snapshotted when the dialog opens. Escape or clicking the backdrop closes it. No keyboard shortcut -- menu only.
- Dark mode support (light / dark / system default, stored in user state file)
- Settings dialog (Cmd+,) with theme selector, spellcheck toggle, auto-save toggle (1s debounce), show-hidden-files toggle (lists `.gitignore`, `.env` and the other allowlisted dotfiles), terminal launcher installer
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
- Checkpoints: a third sidebar tab (`bi-clock-history`) giving a folder an undo history for AI-driven edits, backed by Git and never described as Git. Off until the user opts in from **Settings > Checkpoints** -- the tab is dimmed until then and points there -- and turning it on runs guardrails (refuses inside a parent repo, warns about nested repos and big folders), seeds `.gitignore`, and makes an initial checkpoint. Checkpoints are **manual by default**: you save them yourself with an optional message, and a checkbox in Settings turns on automatic ones (10-minute cadence, only after things go quiet). A `?` in the panel header and in Settings opens a how-it-works recap dialog that also auto-opens once after setup. The sidebar is the present tense: **Changes** lists everything that has moved since the last checkpoint (yours or an agent's), each row with its own `+n −n`, and the count sits on the tab badge -- red while checkpoints are manual, since nothing but you will clear it; grey once they are automatic. Clicking a changed file opens it in the history tab under `Checkpoints > Unsaved changes > file`. **Browse all checkpoints** opens the full history in a read-only tab: checkpoint list (each row showing files touched and `+added −removed`) -> that checkpoint's files (with per-file `+n −n` line counts) -> a full-width word-level prose diff (added words green, removed red, long unchanged stretches collapsed), with breadcrumbs back up and a pencil on any checkpoint to give it a clearer description. Right-click a file or its tab for **View change history** to scope the list to one file. Restore works per-file or for the whole folder, always append-only: the current state is checkpointed first and restoring adds a new checkpoint on top, so nothing is ever lost. Restoring one file asks which version you mean -- the way it was *before* that change or *after* it -- in a dialog colour-matched to the diff's red and green. Restoring to a state the folder already matches says so instead of claiming work it did not do. Repos MDE did not create are read-only history browsing plus an explicit adopt button in Settings.
