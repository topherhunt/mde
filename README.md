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

## Dev & test caveats

- In dev and test, dragging files/folders onto the dock app icon doesn't work. You need to manually test on the packaged app.
- In test, dragging files/folders into the app window doesn't work AFAICT. The tests skip this step and simulate triggering the drop, meaning potential bug space.

## Build & distribute

```
npm run make
```

Produces a distributable `.app` (macOS) in the `out/make/` directory.

## Tasks

- Thank you. Tab scrolling works fantastic now, but when you open a new tab, it should auto-scroll to the right so that that tab is within view fully.
- Great, so the prompt that appears when you try to close a tab that has unsaved changes works great. But that prompt should also appear if you attempted to save, but then you enter the conflict state because you get that warning banner saying that there's a conflict. Cmd + W or clicking x shouldn't let you accidentally close this without a prompt.
- Anytime I open a file, edit it, and then try to save, I get the red warning banner as if there were a conflicting write: "This file was modified on disk. Your unsaved changes may conflict. Copy your work before reloading." There was no modification on disk. False positive?

