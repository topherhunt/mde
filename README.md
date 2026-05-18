# MDE (Markdown Editor)

A simple WYSIWYG Markdown browser/editor for macOS. Open a folder of `.md` files, edit them visually with a toolbar, and save back to Markdown. Features tabbed editing, file explorer sidebar, document outline, find/replace, syntax-highlighted code blocks, file conflict detection, PDF and DOCX export.

## Getting started

```
npm install
npm start
```

Drag a folder onto the window to open it as a project, or use File > Open.

## Tests

```
npm test
```

Runs headless Playwright E2E tests against a packaged build.

## Build & distribute

```
npm run make
```

Produces a distributable `.app` (macOS) in the `out/make/` directory.
