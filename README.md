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

### For Claude

- In the Find & Replace bar:
  - The Up + Down arrows look good but should be grayed/disabled (like toolbar buttons) if 0 or 1 matches are found so no next/prev is relevant.
  - The smooth-scroll is nice but it should be like 200ms instead of like 1s. Currently way too slow, it's distracting.
  - Can you yellow-border any found matches in the page so your eye is drawn to the match? And yellow-highlight the current match? Especially important if you're doing a replace.
  - "Replace All" button should prompt to confirm before executing.
-  Hey, so I'm looking at the PDF and DocX conversion flow, logic and UI. So far it looks good. the confirmation dialogue, I like your initial stab at it, but we need to tweak the formatting. So the title definitely needs to be bold and maybe it should be also centered. Also there should be at least one rem of margin above buttons and between the buttons. And let's also center the buttons div, please. Actually, you know what I'm realizing? There are... The text, the description text that you have in that dialogue confirmation box, it's like several paragraphs... It's like three different paragraphs and then the buttons div. But there's not any spacing between the paragraphs. So please, whether they're paragraphs or flex elements or whatever, please ensure that there's... I don't know. Well, okay, for the text... Let's just keep it one paragraph. Let's smoosh it into one paragraph. It doesn't need to be three separate lines. But the buttons div def definitely needs a rem spacing above it and a rem between the buttons, and it needs to be centered.
- Also, once I finish reading that and I actually click the blue convert and open button, I get an error message saying parse pdf is not a function.
- Also, minor visual glitch, when you select some text and then you press Command Key or you click the Link button, it'll pop down the... But the selection itself disappears. You cannot see which text you selected. And that is useful queuing information. Is it possible to keep the selection, to retain the selection visible, even though your focus is in a different element?

---

- Support .csv files too
