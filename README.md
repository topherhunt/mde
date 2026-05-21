# MDE (Markdown Editor)

A simple WYSIWYG Markdown browser/editor for macOS. Open a folder of `.md` files, edit them visually with a toolbar, and save back to Markdown. Features tabbed editing, file explorer sidebar, document outline, find/replace, syntax-highlighted code blocks, file conflict detection, PDF and DOCX export.

Inspired by this guy's MDV app: https://sockpuppet.org/blog/2026/05/12/emacsification/.

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

- After you added the "tentative tab open" feature (works great btw) now when I open a tab "for real", the Bold and UL buttons are selected, as if the cursor were focused in a bolded / ul zone. For that matter, when I click cursor around the file to areas w different formatting, there's no change in which toolbar buttons are marked as active.
- Cmd + Q (or App -> Quit) should prompt if you'll lose unsaved changes, same as closing a tab.
- The blue placeholder bar when dragging a tab works FANTASTIC but should be taller, it should go up and down 4 px more please.

---

- Toolbar works great, but let's clean up the look a bit please:
  - Add undo and redo arrow buttons before the paragraph/heading dropdown
  - "H" should have a yellow background to indicate that it's highlighting
  - OL and UL should be `1.` and `•` respectively
  - The link button gets a JS error:

prompt() is not supported.
    at eval (webpack-internal:///./src/components/Toolbar.tsx:34:28)
    at onMouseDown (webpack-internal:///./src/components/Toolbar.tsx:69:13)
    at executeDispatch (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:19115:9)
    at runWithFiberInDEV (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:871:30)
    at processDispatchQueue (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:19165:19)
    at eval (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:19766:9)
    at batchedUpdates$1 (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:3254:40)
    at dispatchEventForPluginEventSystem (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:19319:7)
    at dispatchEvent (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:23584:11)
    at dispatchDiscreteEvent (webpack-internal:///./node_modules/react-dom/cjs/react-dom-client.development.js:23552:11)

  - When cursor is in a table cell, there should be a "..." button floating at top of that col / left side of that row, it's a dropdown menu with options to: insert col/row before/after, or delete col/row.


- Please support hotkey Cmd + Shift + T to re-open the last tab you closed
- Please support hotkey Cmd + Option + left/right arrow to switch focus to the prev/next tab
