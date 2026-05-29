# Changelog

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
