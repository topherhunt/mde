# MDE (Markdown Editor)

A simple but sturdy WYSIWYG Markdown browser/editor for macOS. Written in Electron, inspired by Obsidian and VS Code. Drag in a folder or file to view/edit.

Inspired by [Thomas Ptacek's MDV app](https://sockpuppet.org/blog/2026/05/12/emacsification/).

> ❗ **Alpha (v0.1).** Stable and usable, but expect rough edges. Bug reports and feature requests welcome.

## Why MDE?

MDE fills the gap between Obsidian and VS Code for Markdown editing:

- **True WYSIWYG** -- like Obsidian, you see formatted text as you type, not raw Markdown syntax
- **Folder-based, no vault lock-in** -- open any folder from the terminal (`mde .`) or drag it onto the window or dock icon, like VS Code. No project files, no config, no setup.
- **Auto-convert PDF & DOCX** -- click a PDF or DOCX in the sidebar and it's converted to editable Markdown on the spot, with the original kept as a backup (Warning: conversion is not perfect)
- **File conflict detection** -- smart auto-reload or warning is displayed if file conflicts are detected. I've been burned by Obsidian and VS Code's wonky file-conflict handling.

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

Drag a folder onto the window to open it as a project, or use File > Open.

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

- (Fix the mess w bullet vs task list items)
  - Items getting needlessly separated out into different lists when they can
- When you're flipping back and forth between tabs, the app should remember your scroll position. Currently if you scroll down then switch to another tab and then switch back, it jumps to where your *text cursor* is -- better than top of document, but still jarring and disruptive to focus.
- New hotkey (And please don't forget to add this to the shortcuts document): Cmd + Opt + down/up moves the line the cursor is in, above/below the neighboring element. So it seamlessly swaps positions of li's, paragraphs, and headings without getting confused or mangling / merging their syntax. You can let me know what you think here as far as the best app approach and best practices, but I think the only challenge will be that LI items are technically sub-children inside a UL or OL, whereas paragraphs sit on their own and headings sit on their own. I'm guessing that w won't be a huge challenge for you.u
- Files sidebar: If you right-click on a folder, the menu should include items to create a new file or a new folder inside it.
- Files sidebar: The right-click menu should be dismissable by pressing `esc`.
- Bug: If in the files sidebar you press the command delete keyboard shortcut to delete one file or folder, and then you press enter to confirm that, it appears to enter the UI into a stuck state where you can no longer press that same hotkey again, that that hotkey seems to be permanently made invalid Until you totally re-render the file's sidebar by clicking on the outline and then clicking back.
- In the settings menu you should be able to set a checkbox to enable autosave mode, which is disabled by default. In autosave mode, as you make changes, there's a debounce and after a second, like yeah, one second of inactivity, it auto-saves or writes your file changes as if you'd pressed Cmd + S.
