# MDE (Markdown Editor)

A simple but sturdy WYSIWYG Markdown browser/editor for macOS. Written in Electron, inspired by Obsidian and VS Code. Drag in a folder or file to view/edit.

Inspired by [Thomas Ptacek's MDV app](https://sockpuppet.org/blog/2026/05/12/emacsification/).

> ❗ **Alpha (v0.1).** Stable and usable, but expect rough edges. Bug reports and feature requests welcome.

## Why MDE?

MDE fills the gap between Obsidian and VS Code for Markdown editing:

- **True WYSIWYG** -- like Obsidian, you see formatted text as you type, not raw Markdown syntax
- **Folder-based, no vault lock-in** -- open any folder from the terminal (`mde .`) or drag it onto the window or dock icon, like VS Code
- **Auto-convert PDF & DOCX** -- click a PDF or DOCX in the sidebar and it's converted to editable Markdown on the spot, with the original kept as a backup (Warning: conversion is not perfect)

## Features

- **WYSIWYG editing** -- formatting toolbar with headings, bold, italic, strikethrough, highlight, lists, todo lists, blockquotes, code, links, tables, and horizontal rules
- **File Explorer & Document Outline sidebar** -- keyboard-navigable, resizable, with context menu (rename, delete, copy path)
- **Tabbed editing** -- open multiple files, reorder by drag, tentative (preview) tabs on single-click
- **Find and replace** -- match highlighting, case-sensitive and whole-word filters, inline replace-all confirmation
- **Quick Open** -- Cmd+O fuzzy file search across the project
- **Standard editing tools** -- links, code blocks, tables
- **DOCX and PDF import/export** -- converts to Markdown on click, preserving structure (tables, headings, columns) where possible (not perfect!)
- **File conflict detection** -- detects external changes; silent reload or warning banner
- **Dark mode** -- light, dark, or follow system preference
- **Terminal launcher** -- `mde .` to open a folder from the command line

![Preview](docs/preview1.png)

## How to install

Download the latest build for your platform from the [releases page](https://github.com/topherhunt/mde/releases).

### macOS (Apple Silicon)

The app isn't code-signed, so macOS will block ("quarantine") it by default, giving you no option to proceed. To open the app:

1. Right-click (or Control-click) `MDE.app` and select **Open**
2. Click **Open** in the confirmation dialog

You only need to do this once. After that, macOS will remember your choice and let you open it normally.

### Windows

The app isn't code-signed, so Windows SmartScreen will show a warning the first time you launch it. Click **More info** → **Run anyway** to proceed.

## Note on HTML in Markdown

Handling `<` and `>` characters in Markdown is a surprisingly subtle problem. MDE does not render raw HTML -- tags like `<ol>` or `<div>` are displayed as literal text, not interpreted as HTML elements. As a side effect, if your `.md` files contain HTML entities like `&gt;` or `&lt;`, MDE may convert them to their literal characters (`>`, `<`) on save. This improves readability but means MDE-edited files may differ slightly from files authored in raw-text editors that preserve HTML entities verbatim.

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


- Support right-click to convert to .docx or .pdf, w standard nice-looking formatting & colors (customizable)
  - PDF export -- does this require chrome/puppeteer? can it just use the built-in engine?
- **Add Claude agent support.**
- Build to Windows (for Claire & Anny). Claude says this is straightforward w Electron Forge.
- Support .csv files too. Plan this out.

### For Claude

- Thanks, the readme "what's different from Obsidian/VS Code" list is a good start, but what other unique or special advantages / features does this app have? I didn't mean for you to treat that as an exhaustive list.
- Toolbar buttons' text/icon color should be light gray, maybe #d6d6d6, not white please. It's too distractey currently. The selected-button style/colors can stay same.
- The new keyboard shortcuts non-editable buffer works fantastic, but let's hide the toolbar and hide any conceivable controls for editing. For example, you should not be able to place your cursor within a table cell, and if you do, then the controls to-like the drop-down button of options to add or delete rows should not show.
- Please also write the Keyboard Shortcuts help file to docs/help/keyboard_shortcuts.md so it doesn't need to be hard-coded as a constant in KEYBOARD_SHORTCUTS_CONTENT, that seems wasteful, right?
- Empty buffer when there's no page open: add 0.5rem margin between lines. (use standard bootstrap5-style utils like my-2)
- When the text cursor is in the editor, the hotkey Cmd + Enter cycles that line between 3 states: bullet, unchecked task, and checked task. This applies to all lines selected if you selected a range of lines. Under NO circumstances does Cmd + Enter insert a line break.
- Pressing `tab` when cursor is in a li (ol, ul, or task) attempts to indent it. The 1st line cannot be indented. This previously worked but it seems to have switched to selecting DOM inputs like in a browser page (not desireable).
- BUG: Something in our cleaning-html logic caused file-reload to break. So if you open a file, then it gets altered on-disk by VS Code or something else, it will reload in the buffer as ugly raw html.
