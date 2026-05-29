# MDE (Markdown Editor)

A simple but sturdy WYSIWYG Markdown browser/editor for macOS and Windows. Written in Electron, inspired by Obsidian and VS Code. Drag in a folder or file to view/edit.

Inspired by [Thomas Ptacek's MDV app](https://sockpuppet.org/blog/2026/05/12/emacsification/).

> ❗ **Alpha (v0.1).** Stable and usable, but expect rough edges. Bug reports and feature requests welcome.

## Why MDE?

MDE fills some gaps between Obsidian and VS Code for Markdown editing:

- **True WYSIWYG** -- like Obsidian, you see formatted text as you type, not raw Markdown syntax
- **Folder-based, no vault lock-in** -- open any folder from the terminal (`mde .`) or drag it onto the window or dock icon, like VS Code. No special vault folder to set up. Every folder gets the same treatment.
- **Auto-convert PDF & DOCX** -- click a PDF or DOCX in the sidebar and it's converted to editable Markdown on the spot, with the original kept as a backup (Warning: conversion is not perfect)
- **File conflict detection** -- smart auto-reload or warning is displayed if file conflicts are detected. I've been burned by Obsidian and VS Code's wonky file-conflict handling.

## Features

- **WYSIWYG editing** -- formatting toolbar with headings, bold, italic, strikethrough, highlight, lists, todo lists, blockquotes, code, links, tables, and horizontal rules..
- **Structured lists** -- Obsidian and VS Code both make it easy to produce invalid bullet/number/task lists. MDE gives you opinionated constraints.
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

Run `MDE-<version> Setup.exe`. Because the app isn't code-signed, Windows SmartScreen ("Windows protected your PC") will appear the first time you run the installer **and** the first time you launch the app:

1. Click **More info**
2. Click **Run anyway**

You only need to do this once per machine. (Your browser may also warn that the download is "not commonly downloaded" -- choose **Keep** / **Keep anyway**.)

Once installed, double-clicking a `.md` file or choosing MDE from **Open with** will open it in MDE.

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

On Windows the launcher adds itself to your user `PATH`, so open a **new** terminal window after installing it before running `mde`.

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

Produces distributables in the `out/make/` directory. Note that Electron Forge only builds for the OS you run it on: macOS produces a `.dmg`, Windows produces a Squirrel `Setup.exe`. You **cannot** reliably cross-build the Windows installer from macOS (it needs Windows-native tooling), so releases are built in CI instead.

### Cutting a release (GitHub Actions)

Releases are built and published by `.github/workflows/release.yml`, triggered by pushing a version tag:

```
# bump "version" in package.json first (so the installer filename matches), then:
git tag v0.2.0
git push origin v0.2.0
```

This runs two parallel build jobs (`macos-latest` -> `.dmg`, `windows-latest` -> `Setup.exe`) and attaches both to a GitHub Release for that tag. The Release is created as a **draft** -- review it, smoke-test the Windows installer (file associations only register during a real install), then click **Publish**. To auto-publish instead, remove `draft: true` from the workflow.

Notes:
- The workflow file must exist on the commit the tag points to, so push your changes to `main` before tagging.
- The macOS build is Apple Silicon (arm64) only -- `macos-latest` runners are arm64. Intel Macs aren't covered.
- You can also trigger the workflow manually (Actions tab -> "Build and Release" -> Run workflow) to verify the builds compile without creating a release.

### Running the test suite on Windows

`.github/workflows/windows-tests.yml` runs the full Playwright E2E suite on `windows-latest` to catch Windows-specific breakage (path handling, launch behavior). It's manually triggered: Actions tab -> **Windows Tests** -> **Run workflow**.

On failure it uploads Playwright traces as a build artifact; download and inspect with `npx playwright show-trace <trace.zip>`.

(`workflow_dispatch` workflows only appear in the Actions tab once the file is on the default branch, so push to `main` first.)

## Tasks

### For me

- Support right-click to convert to .docx or .pdf, w standard nice-looking formatting & colors (customizable)
  - PDF export -- does this require chrome/puppeteer? can it just use the built-in engine?
- **Add Claude agent support.**
- Build to Windows (for Claire & Anny). Claude says this is straightforward w Electron Forge.
- Support .csv files too. Plan this out.

### For Claude

1. Title bar: what's the easiest way to do this? How does titleBarOverlay work?
2. launchFileHandled: Straightforward? Tricky? Please proceed
3. Please do add windows terminal launcher support, yes
4. File associations: Great, please proceed.
5. Can you help me convert the existing icon to a windows .ico?
6. PLease do fix to CmdOrCtrl

- I will NOT do code signing. Our readme should instruct users in how to bypass any unsigned-app warnings.
- I'll do testing manually, thanks

---

- If a file is opened in mde and no project folder is set, default to the outline tab please. It's a more useful default in that case.
- Bug: If I close the mde window (but don't quit the app, so it's still in the dock) and then drag a .md file onto the dock icon, or double-click the .md file to open it with MDE, *sometimes* (not always) the MDE window opens but to just an empty screen, with no file loaded. Other times it does open that first file correctly. If any file IS already open, this bug doesn't happen and opening a 2nd file via double-click etc always seems to work correctly.
