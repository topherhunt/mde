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

- Outline view looks great, but there's some weird bugs. One or more at least. Let's start with the most obvious: if I click on a header / entry once, it jumps to that point in the file; if I click on the same header again, it then smoothscrolls to a random-seeming point in the middle of the document, the same point, without regard to what header it should be focusing on. Even though the text cursor stays on the targeted header, the scroll _moves away from_ that targeted header.
- Less margins around the editable text area please. 0.75rem in each direction?
- When you click in a link, it should not immediately open the link. Instead it should place your cursor there (like with any other text), and when your cursor is inside a link, a pop-up should appear below the link displaying the URL in linkable form. Clicking that pop-up URL should open the link in your standard browser (not in a pop-up window in teh electron app).
- If you click the link icon and you only have a cursor placement (no text range selected), it should pop up an alert "Select some text first."
