# MDE (Markdown Editor)

A simple WYSIWYG Markdown browser/editor for macOS. Open a folder of `.md` files, edit them visually with a toolbar, and save back to Markdown. Features tabbed editing, file explorer sidebar, document outline, find/replace, syntax-highlighted code blocks, file conflict detection, dark mode, and PDF export.

Inspired by this guy's MDV app: https://sockpuppet.org/blog/2026/05/12/emacsification/.

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

- The code fence copy button works great, but (1) please anchor its position to vertically center on the top border of the code fence, rather than being fully inside the code fence. And, as you scroll, its position should not scroll with you (it's currently using js to recompute position when your mouse moves, which looks glitchy, I think CSS lets you anchor it to the fence top boundary instead to save on performance, right?)
- I'd like to know if you can add an icon before each menu item in the table cell actions list. So currently there's actions for insert row before, insert row after, delete this row, insert column before, insert column after, and delete this column. For the remove ones, you can use the standard trash bootstrap icon. For the insert row & column, ones, please use the `layout-sidebar-inset` icon, rotated as needed (where 0deg rotation = add column to the left).
- Can you please make it so that when I press Command O, instead of opening the standard Mac OS Finder file selector, which A, it takes a couple seconds, it's pretty slow to power up, and B, it requires navigating to find an arbitrary file to select. I want a fuzzy search command palette like what VS Code or Obsidian has. So in Obsidian, if I press Command O, it pops up a... It's like similar to Spotlight. It's like a big search bar. And it, as I type, it filters down to show matches, like the best matches among files that are detected in this project folder. And I can open any of those. Please implement this as similar to Obsidian's quick search function as possible. Ensure that it is optimized for performance. This should not bog down if I'm in a folder that has 200 million files in it. So what I think would make sense is that when you first open a project folder, it runs an index on all of the contents in that folder, or maybe it needs to periodically rerun an index when it detects any file changes or additions within that folder. I don't know what makes the most sense. But this needs to be something that's lightweight and not consuming a lot of resources. And I want to know what you would advise for.
