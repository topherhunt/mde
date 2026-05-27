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

- **WYSIWYG editing** -- formatting toolbar with headings, bold, italic, strikethrough, highlight, lists, todo lists, blockquotes, code, links, tables, and horizontal rules.
- **Structured lists** -- Obsidian and VS Code both make it easy to produce invalid bullet/number/task lists. MDE gives you opinionated constraints.
- [ ] **File Explorer & Document Outline sidebar** -- keyboard-navigable, resizable, with context menu (rename, delete, copy path)
- [ ] **Tabbed editing** -- open multiple files, reorder by drag, tentative (preview) tabs on single-click
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

- Build a new release to fix the crashing bugs etc. Write a changelog.
- Support right-click to convert to .docx or .pdf, w standard nice-looking formatting & colors (customizable)
  - PDF export -- does this require chrome/puppeteer? can it just use the built-in engine?
- **Add Claude agent support.**
- Build to Windows (for Claire & Anny). Claude says this is straightforward w Electron Forge.
- Support .csv files too. Plan this out.

### For Claude

- So you did fix the bug where when you place your cursor in a list sub item and you press Command Enter, then that sub item's state gets cycled instead of the parent state getting cycled. But if I click and drag to select a range of text, the parent/root item is still what gets cycled. Instead of the *selected lines* all getting cycled. This happens if the even if the selected range is just one character within a single list item. The root item is cycled state instead of the current item that you're selecting in.

---

- Fix on pressing Cmd + Enter with multiple bullets of different nestings selected: You partly fixed it. What I'm finding now is that if li elements that are NOT PARENTS of each other are selected, Cmd + Enter behaves properly. But if a selection contains BOTH A PARENT AND ITS CHILD, Cmd + Enter only partly applies the state-change (eg. just to the child) and re-pressing it has no further effect, it gets "trapped" rather than cycling status with each hotkey press. In the following example, selecting and cycling items 3-5 works great; selecting and cycling elements 2-3 does not.

```
- number 1
  - number 2
    - number 3
  - number 4
- number 5
```

- Fix on Cmd + Alt + up/down:
  - If your cursor is in an indented list item and it has no siblings, Cmd + Alt + up/down does move / reparent it successfully, but it also creates an empty li item where there previously was none. It should not do that.
  - If a range of lines is selected, this should move all selected lines together as a unit, if possible, rather than just moving the line the cursor is on.

- About page, text: can you make it centered, and can you make the url a clickable link?
