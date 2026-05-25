# MDE (Markdown Editor)

A simple but sturdy WYSIWYG Markdown browser/editor for macOS. Written in Electron, inspired by Obsidian and VS Code. Drag in a folder or file to view/edit.

Inspired by [Thomas Ptacek's MDV app](https://sockpuppet.org/blog/2026/05/12/emacsification/).

> ❗ **Alpha (v0.1).** Stable and usable, but expect rough edges. Bug reports and feature requests welcome. 

## Features

- **WYSIWYG editing** -- write Markdown visually with a formatting toolbar (headings, bold, italic, strikethrough, highlight, lists, blockquote, code, links, tables, horizontal rules)
- **File explorer sidebar** -- browse, create, rename, and delete files and folders; right-click context menu; keyboard navigation
- **Document outline sidebar** -- jump to any heading in the current document
- **Tabbed editing** -- open multiple files; smart dirty tracking (undo back to saved state clears the dirty flag)
- **Find and replace** -- match highlighting, inline replace-all confirmation
- **Code blocks** -- syntax-highlighted with one-click copy button
- **Table editing** -- insert/delete rows and columns via a cell actions menu
- **Link editing** -- floating link bar for editing URLs without losing your text selection
- **Quick Open** -- Cmd+O fuzzy file search across the project
- **DOCX and PDF import** -- converts to Markdown on click, preserving structure where possible
- **PDF export** -- print any document to PDF
- **File conflict detection** -- detects external changes; silent reload or warning banner
- **Dark mode** -- light, dark, or follow system preference
- **Terminal launcher** -- `mde .` to open a folder from the command line
- **Spellcheck** -- toggleable in settings

## System requirements

- macOS (Apple Silicon)

## Getting started

```
npm install
npm start
```

Drag a folder onto the window to open it as a project, or use File &gt; Open.

### Terminal launcher

Open Settings (Cmd+,) and click "Install terminal launcher" to enable opening folders from the terminal:

```
mde .              # Open current directory
mde ~/my-notes     # Open a specific folder
```

## Tests

```
npm test
```

Runs headless Playwright E2E tests against a packaged build.

## Dev & test caveats

- In dev and test, dragging files/folders onto the dock app icon doesn't work. You need to manually test on the packaged app.
- In test, dragging files/folders into the app window doesn't work AFAICT. The tests skip this step and simulate triggering the drop, meaning potential bug space.

## Build & distribute

```
npm run make
```

Produces a distributable `.app` (macOS) in the `out/make/` directory.

## Tasks

### For me

- Todo lists (checkable)

- TODO: Test the .docx & .pdf flow.

  - How much do they lose of the original structure & content?

- Support .csv files too. Plan this out.

### For Claude
