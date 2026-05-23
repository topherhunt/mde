# MDE (Markdown Editor)

A simple WYSIWYG Markdown browser/editor for macOS. Open a folder of `.md` files, edit them visually with a toolbar, and save back to Markdown. Features tabbed editing, file explorer sidebar, document outline, find/replace, syntax-highlighted code blocks, file conflict detection, dark mode, and PDF export.

Inspired by this guy's MDV app: https://sockpuppet.org/blog/2026/05/12/emacsification/.

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

- TODO: Test the .docx & .pdf flow.
  - How much do they lose of the original structure & content?

- Support .csv files too. Plan this out.

### For Claude

- "Convert PDF" confirmation dialog: There's still no margin above the buttons, between the buttons, and the buttons are still not centered. Did this fall through the cracks?
- Also, "Convert & Open" button fails again on this error msg: `Conversion failed: Setting up fake worker failed: "Cannot find module './pdf.worker.mjs'".`
- Find & Replace panel, further fixes:
  - If there's one or more match, the indicator of how many matches there are, the like the whatever, should be bold white. I'm sorry, not bold, just white instead of grey.
  - If no matches are found, the Replace button should be disabled/grayed, not just the All button.

---

- In the "Convert PDF to Markdown" (or DOCX ...) dialog: wrap the filenames in <code></code> please so they stand out better.
- "Convert PDF to markdown" still failed: `Conversion failed: Setting up fake worker failed: "Cannot find module '/Users/topher/Sites/personal/mde/.webpack/main/pdf.worker.mjs' imported from /Users/topher/Sites/personal/mde/.webpack/main/index.js".` Can you set up a test in the suite to test converting a PDF? Do you already have one? Glaring omission if not, please note the importance of test coverage in CLAUDE.md. Use `test-conversion/2026-02 HDP32 ....pdf` to see the error.
- .docx conversion likewise fails. Please ensure a test for this, use the .docx in test-conversion/ for an example.
- Please add a right-click menu to each item in the File Explorer, with the following options:
  - Rename
  - Delete (with confirm dialog, moves to trash, does NOT perma-delete)
  - Copy Relative Path
- File Explorer, root folder name bar, right side, please add icon buttons for adding a new .md file (use `file-earmark-plus` icon) and adding a new folder (use folder-plus).
