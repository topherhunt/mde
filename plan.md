# MDE -- Markdown Editor

A simple, sturdy, WYSIWYG markdown editor for macOS. Inspired by the\
"Emacsification" thesis: build personal tools that solve your actual\
problems instead of settling for what's on the App Store.

Reference: <https://sockpuppet.org/blog/2026/05/12/emacsification/>

---

## Stack

<table style="min-width: 75px;">
<colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><th colspan="1" rowspan="1"><p>Layer</p></th><th colspan="1" rowspan="1"><p>Choice</p></th><th colspan="1" rowspan="1"><p>Rationale</p></th></tr><tr><td colspan="1" rowspan="1"><p>Shell</p></td><td colspan="1" rowspan="1"><p>Electron (electron-forge)</p></td><td colspan="1" rowspan="1"><p>Mature, good testing story, familiar web tech</p></td></tr><tr><td colspan="1" rowspan="1"><p>UI framework</p></td><td colspan="1" rowspan="1"><p>React</p></td><td colspan="1" rowspan="1"><p>First-class TipTap bindings; enormous ecosystem! 😻</p><ul class="tight" data-tight="true"><li><p>Something else</p></li><li><p>oeuoeunth</p></li></ul></td></tr><tr><td colspan="1" rowspan="1"><p>Editor</p></td><td colspan="1" rowspan="1"><p>TipTap (ProseMirror)</p></td><td colspan="1" rowspan="1"><p>Structured document model, Markdown serde, toolbar commands</p></td></tr><tr><td colspan="1" rowspan="1"><p>Markdown parse</p></td><td colspan="1" rowspan="1"><p>markdown-it (via TipTap)</p></td><td colspan="1" rowspan="1"><p>TipTap's Markdown extension uses this under the hood</p></td></tr><tr><td colspan="1" rowspan="1"><p>Markdown serial</p></td><td colspan="1" rowspan="1"><p>tiptap-markdown</p></td><td colspan="1" rowspan="1"><p>Serialize TipTap document back to Markdown on save</p></td></tr><tr><td colspan="1" rowspan="1"><p>Syntax highlight</p></td><td colspan="1" rowspan="1"><p>lowlight (via CodeBlockLowlight)</p></td><td colspan="1" rowspan="1"><p>TipTap extension, highlight.js-based, zero config</p></td></tr><tr><td colspan="1" rowspan="1"><p>PDF export</p></td><td colspan="1" rowspan="1"><p>Electron printToPDF</p></td><td colspan="1" rowspan="1"><p>Free -- renders current editor content</p></td></tr><tr><td colspan="1" rowspan="1"><p>DOCX export</p></td><td colspan="1" rowspan="1"><p>html-docx-js</p></td><td colspan="1" rowspan="1"><p>"Good enough" .docx from HTML. Not high fidelity</p></td></tr><tr><td colspan="1" rowspan="1"><p>Find/replace</p></td><td colspan="1" rowspan="1"><p>ProseMirror search plugin</p></td><td colspan="1" rowspan="1"><p>Or custom floating bar using TipTap commands</p></td></tr><tr><td colspan="1" rowspan="1"><p>File watching</p></td><td colspan="1" rowspan="1"><p>chokidar (or Node fs.watch)</p></td><td colspan="1" rowspan="1"><p>Detect on-disk changes to open files</p></td></tr><tr><td colspan="1" rowspan="1"><p>Testing</p></td><td colspan="1" rowspan="1"><p>Playwright (Electron mode)</p></td><td colspan="1" rowspan="1"><p>Headless E2E tests, officially supported</p></td></tr><tr><td colspan="1" rowspan="1"><p>Package manager</p></td><td colspan="1" rowspan="1"><p>npm</p></td><td colspan="1" rowspan="1"><p>Simple, no fuss</p></td></tr></tbody>
</table>

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Main Process (Electron)                                │
│                                                         │
│  - Window management (one window per project folder)    │
│  - File I/O (read, write, watch)                        │
│  - Menu bar (File, Edit, etc.)                          │
│  - Drag-drop handling at the app level                  │
│  - PDF/DOCX export                                      │
│  - IPC bridge to renderer                               │
└────────────────────────┬────────────────────────────────┘
                         │ IPC (contextBridge)
┌────────────────────────┴────────────────────────────────┐
│  Renderer Process (React)                               │
│                                                         │
│  ┌────────────┐  ┌────────────────────────────────────┐ │
│  │  Sidebar   │  │  Editor Area                       │ │
│  │            │  │                                    │ │
│  │ [Explorer] │  │  ┌──────────────────────────────┐  │ │
│  │ [Outline]  │  │  │  Tab Bar                     │  │ │
│  │            │  │  ├──────────────────────────────┤  │ │
│  │ File tree  │  │  │  Toolbar                     │  │ │
│  │ or         │  │  │  H1-H6 | B I | OL UL | ...   │  │ │
│  │ H1/H2/H3   │  │  ├──────────────────────────────┤  │ │
│  │ outline    │  │  │                              │  │ │
│  │            │  │  │  TipTap WYSIWYG Editor       │  │ │
│  │            │  │  │                              │  │ │
│  │            │  │  │                              │  │ │
│  │            │  │  │                              │  │ │
│  └────────────┘  │  └──────────────────────────────┘  │ │
│                  └────────────────────────────────────┘ │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Find/Replace bar (floating, top-right, Cmd+F)   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

### Process boundary

All file system operations live in the main process. The renderer never\
touches `fs` directly. Communication happens through a typed IPC API\
exposed via `contextBridge`:

- `readFile(path)` -- returns Markdown string
- `writeFile(path, content)` -- writes Markdown string
- `watchFile(path)` / `unwatchFile(path)` -- file change notifications
- `listDirectory(path)` -- returns directory tree for file explorer
- `showSaveDialog()` / `showOpenDialog()` -- native file dialogs
- `exportPDF(htmlContent)` -- triggers printToPDF
- `exportDOCX(htmlContent)` -- converts via html-docx-js, saves
- `getFileStats(path)` -- mtime for conflict detection

### State management

React context + useReducer for app state. No Redux, no Zustand -- the\
state shape is small:

- Open tabs (path, TipTap editor instance, dirty flag, disk mtime)
- Active tab index
- Sidebar mode (explorer / outline)
- Project root path
- File tree (lazy-loaded on expand)
- Conflict state per tab (none / banner)

TipTap owns the document state internally. We read from it on save\
(serialize to Markdown) and on outline generation (extract headings).

---

## Features (v1 scope)

### 1. Project / file opening

- **Drag folder onto app icon or window** -- opens a new window with\
  that folder as the project root. File explorer sidebar shows its\
  contents.
- **Drag file onto app icon or window** -- opens the file in a new tab\
  in the current window (or a new window if none exists).
- **File &gt; Open Folder** and **File &gt; Open File** menu items.
- **Double-click a file in the explorer sidebar** -- opens in a new tab\
  (or focuses existing tab if already open).
- One window per project folder. Multiple tabs per window.

### 2. Sidebar

Two tabs at the top of the sidebar, toggled by icon buttons:

**File Explorer tab (default):**

- Tree view of the project folder
- Folders are collapsible
- Only shows `.md` and `.markdown` files (plus folders)
- Single-click to preview, double-click to open in a tab

**Document Outline tab:**

- Extracted from the active tab's TipTap document
- Shows H1, H2, H3 as a nested tree
- Click a heading to scroll to it in the editor

### 3. Tab bar

- Horizontal tabs above the editor, below the toolbar
- Each tab shows the filename
- Unsaved changes indicated by a dot or italic filename (like VS Code)
- Close button on each tab (prompts to save if dirty)
- Middle-click to close
- Cmd+W to close active tab

### 4. Toolbar

A compact mini-toolbar above the tab bar (or between tab bar and\
editor -- TBD during implementation). Buttons for:

| Action | Notes |
| --- | --- |
| Heading level | Dropdown: H1, H2, H3, H4, H5, H6, Paragraph |
| Bold | Cmd+B |
| Italic | Cmd+I |
| Strikethrough | Cmd+Shift+X |
| Ordered list | Cmd+Shift+7 |
| Unordered list | Cmd+Shift+8 |
| Blockquote | Cmd+Shift+B |
| Code (inline) | Cmd+E |
| Code block | Cmd+Shift+E (with syntax highlighting) |
| Link | Cmd+K -- prompts for URL |
| Table | Insert a 3x3 table, then resize |
| Highlight | Mark/highlight text |
| Horizontal rule | \--- |

Buttons reflect the current selection state (bold button is "active"\
when cursor is in bold text, etc.).

### 5. WYSIWYG editor

- TipTap editor with Markdown serialization
- On load: read `.md` file, parse Markdown to TipTap document
- On save: serialize TipTap document back to Markdown, write to disk
- Renders headings, bold, italic, strikethrough, lists, blockquotes,\
  code blocks (with syntax highlighting), tables, links, images,\
  horizontal rules, highlights
- Images: renders existing `![alt](path)` references by resolving\
  relative paths against the file's directory. No image insertion in v1.
- Keyboard shortcuts for all toolbar actions
- Standard editing: undo/redo (Cmd+Z / Cmd+Shift+Z), cut/copy/paste
- Paste Markdown from clipboard and have it parse correctly

### 6. Find and replace

- Cmd+F opens a floating bar at the top-right of the editor pane
- Text input for search term, match count indicator
- Up/down arrows to navigate between matches
- "Replace" and "Replace All" fields/buttons
- Escape or close button to dismiss
- Case-sensitive toggle

### 7. File saving

- **No auto-save.** Changes persist only on File &gt; Save or Cmd+S.
- Tab shows unsaved indicator (dot/asterisk) when buffer differs from\
  last-saved state.
- Save writes the TipTap document serialized as Markdown back to the\
  original file path.
- "Save As" (Cmd+Shift+S) for saving to a new path.
- New/untitled documents prompt for a save location on first save.

### 8. File conflict detection

Poll open files' `mtime` every \~2 seconds (or use chokidar fs watcher).

Three scenarios:

1. **Disk changed, no unsaved edits in buffer:** Silently reload the\
   file content into the editor. No user friction.

2. **Disk changed, user HAS unsaved edits:** Display a prominent red\
   warning banner at the top of the editor:

   > "This file was modified on disk. Your unsaved changes may conflict.\
   > Copy your work before reloading."
   >
   > \[Reload from Disk\] \[Save As...\]

   - Save (Cmd+S) is **disabled** while this banner is showing. The\
     user must either reload (losing their buffer) or Save As to a\
     different file.
   - The user can continue editing the buffer (not frozen) so they can\
     select and copy their work.
   - The banner is impossible to miss -- red background, full-width,\
     above the editor content.

3. **User tries to save, but disk changed since last load (belt and\
   suspenders):** Same banner and behavior as scenario 2. Catches the\
   race where the file changed between polls.

### 9. Export

- **File &gt; Export as PDF** -- uses Electron's `printToPDF` on the\
  rendered editor content. Opens a save dialog for the output path.
- **File &gt; Export as DOCX** -- converts editor HTML via `html-docx-js`.\
  Output quality is "functional, not pretty." Opens a save dialog.

---

## Non-goals (v1)

- Image insertion (drag-drop, paste, toolbar button) -- v2
- Vim / Emacs keybindings -- never
- Split pane / source view -- not planned
- Auto-save -- explicitly excluded
- Spell check -- maybe v2, but Electron/Chromium has built-in\
  spellcheck that may just work for free
- Plugin system -- not planned
- Git integration -- not planned
- Themes / dark mode -- maybe v2 (or free if we use CSS variables)
- Collaborative editing -- not planned

---

## Decisions and rationale

**Why Electron over Tauri?**\
Tauri's macOS testing story is immature. No good headless E2E harness.\
Electron + Playwright is battle-tested.

**Why TipTap over raw contenteditable?**\
Raw contenteditable is a well-known source of pain (cursor bugs, paste\
handling, nested list behavior). TipTap provides a structured document\
model with Markdown serde, and the toolbar "just works." It's the boring\
correct choice.

**Why React over SolidJS?**\
TipTap has first-class React bindings (`@tiptap/react`). SolidJS\
bindings are community-maintained and thin. Since TipTap is the core of\
this app, ecosystem support wins over Solid's arguably cleaner\
reactivity model. Performance differences are irrelevant in an Electron\
app.

**Why no auto-save?**\
Explicit save is a deliberate UX choice. It keeps the mental model\
simple: what's on disk is what you last saved. Combined with conflict\
detection, this avoids the "which version is real?" confusion that\
auto-save can cause.

**Why disable Save on conflict instead of freezing the editor?**\
Freezing the editor means you can't copy your work out. Disabling Save\
means you can't accidentally clobber the disk version. The user retains\
agency to rescue their edits via copy-paste or Save As.

---

## Concerns and risks

1. **Markdown round-trip fidelity.** Converting MD -&gt; TipTap document\
   -&gt; MD may not be lossless. Some Markdown constructs (HTML blocks,\
   footnotes, unusual list nesting) may not survive. Mitigation: test\
   with real-world documents early. Accept that edge cases exist and\
   document them.

2. **html-docx-js quality.** The library is not actively maintained and\
   produces basic output. Complex tables and code blocks may not render\
   well. Acceptable for v1 -- functional, not beautiful.

3. **Large files.** TipTap/ProseMirror can struggle with very large\
   documents (10k+ lines). Not a v1 concern -- most Markdown files are\
   well under this.

4. **File watcher reliability.** `fs.watch` is notoriously unreliable\
   across platforms. chokidar is the standard workaround but adds a\
   dependency. Worth it for reliable conflict detection.

5. **Paste behavior.** Pasting rich HTML from browsers into TipTap needs\
   care -- it should convert to clean Markdown-compatible structures, not\
   dump raw HTML. TipTap handles this reasonably well by default, but\
   may need tuning.

---

## Implementation phases

### Phase 1: Skeleton

- electron-forge scaffold with React
- Main process: window management, IPC bridge
- Renderer: React shell with sidebar + editor area + tab bar
- TipTap editor with basic Markdown load/save
- Open a single hardcoded file and edit it

### Phase 2: File management

- File explorer sidebar (read project directory, tree view)
- Tab management (open, close, switch, dirty indicator)
- Cmd+S save, Save As, File &gt; Open
- Drag-drop folder/file onto window and app icon

### Phase 3: Toolbar and formatting

- All toolbar buttons wired to TipTap commands
- Heading dropdown, bold, italic, lists, blockquote, code, link,\
  table, highlight, horizontal rule
- Keyboard shortcuts
- Active state reflection on buttons

### Phase 4: Document outline and find/replace

- Outline sidebar tab (extract headings from TipTap doc)
- Click-to-scroll
- Find/replace floating bar (Cmd+F)

### Phase 5: Conflict detection

- File watcher (chokidar)
- mtime comparison on save
- Red warning banner, Save disable, reload/Save As flow

### Phase 6: Export

- PDF export via printToPDF
- DOCX export via html-docx-js

### Phase 7: Polish and testing

- Playwright E2E test suite (headless)
- Edge cases: empty files, missing files, permission errors
- Keyboard navigation and accessibility basics
- App icon, window title, menu bar polish
