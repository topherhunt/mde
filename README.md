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


- When you click in a link, it should not immediately open the link. Instead it should place your cursor there (like with any other text), and when your cursor is inside a link (via click or via arrowkeys), a pop-up should appear below the link displaying the URL in linkable form. Clicking that pop-up URL should open the link in your standard browser (not in a pop-up window in teh electron app, as it currently does).
- If you click the link icon and you only have a cursor placement (no text range selected), it should pop up an alert "Select some text first."


---

- Scrolling in the outline isn't working as expected. 1st click should scroll so the target div is at the top of the visible viewport.
- Clicking IN a link still opens a pop-up window (in Electron) of that url. It should not do so, as previously requested. Also, the tooltipped link floating below the link should be anchored to the link position, not to the cursor position, so it doesn't move each time you move the cursor or type to edit link text. Also, the tooltipped link URL doesn't WORK -- it doesn't open the url in your default browser.

---

- In the Files pane, your main folder doesn't need to be a collapsible w triangle, because it's the ONLY root-level folder. Just make it a bolded header, maybe w a bottom border, and then the content below it can be 1 nesting less indented, to better use horizontal real estate.
- If you drag in another file or folder from Finder, the whole window should get a blue pulsating overlay so you know it's a valid drop zone. Currently it's like "eh, maybe this will work?" - it doesn't give much feedback.
