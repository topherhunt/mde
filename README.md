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

- Thank you for adding escape support to the table cell drop-down button menu. The button itself is not quite right positioned. It's positioned with its right border aligned with the right edge of the cell you're in. Instead, the the midpoint of the button should be aligned with the right border. So it's it's centered over the intersection. Not centered over the I don't know what it's centered over currently, but it's it's not the midsection, it's not the intersection of the cell borders.
- Thank you for the link warning. Replacing it with a toast is great, but the toast should be semantic colored, similar to bootstrap alerts, like flash alerts. Let's make this one the danger color. Do you already have semantic classes for text, danger, button danger, and so on? Please ensure that you have those. And yeah, we want this toast to be ordered background color and text color aligning with Bootstrap 5 semantic color for danger.
- Great, so one of the next things that we need to support is the interoperability with docx and PDF files. I don't know what is the easiest way to support this. It's a bit complicated because one of the future features that I'm thinking of that's going to be super important is a desktop light version, which effectively It allows you to act like Claude Code or Claude Desktop, but it gives a very minimal MCP function set for Claude so that it can list and read and modify, create and delete files within this folder and maybe run some very simple calculations, but it's a whitelist of very limited operations. It's not like the free form of Cloudcode that can install scripts and run any command it want. It'll probably have a fuzzy search available. Things that someone who's editing a book outline would need Claude Desktop for. It needs to support that use case thoroughly. So anyway, one of the things that we'll need is the ability to download and import a docx file into Markdown so that it can interop with the bot AI system. But then we gotta think through what is the best way to link that docx file. Like should we consume it and delete it? Or should we flag that it's out of date if the markdown changes? Or should we keep it up to date if the markdown changes? Or what do you think is the best way to do that?
  - One idea: maybe when you open a .docx for the first time, it warns you that it will convert it to plaintext .md format for easy editing and AI interop, and any changes will be auto-written back to the .docx file, destructively simplifying the format of the original docx, and are you sure you want to do that. Then once you confirm, it creates a .md file named "{docx-filename}.docx.md" and, after any changes to that .md, it overwrites the .docx to match. How does that sound? We could do the same for PDF...? Would those auto-conversions-on-save be costly performance-wise? Maybe it's better to DELETE the .docx after converting it to .md, and then you can right-click to write the latest version back to .docx anytime you want?

- Support .csv files too
