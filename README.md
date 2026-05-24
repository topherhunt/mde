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

- For the toasts etc, the Bootstrap-style semantic colors aren't dialed in. The text color needs to be lighter & brighter so it doesn't come across as dimmed and squinty against that blue/red background. At least in dark mode. So the semantic text color needs to not be the same as the alert border color.
- PDF conversion is substantially better, but still substantially broken. See for example test-conversion/hdp32-tax-bill.pdf.md - It now has lots of new lines like it should and the text is semi-readable but you can see that there's lots of sections where in the original PDF there were two visually very clearly delineated divs or containers which maybe the markup doesn't exist for the text to be properly scoped within those containers but two side-by-side containers each of which has multiple lines of text and in the final markdown version each line is is it kind of hops back and forth between the two containers for each line so the lines are interleaved between the containers so you're constantly switching context trying to make sense of what you're reading. It's not how it's supposed to look, and it's not particularly usable. Do you think that sort of thing can be fixed?
  - Also, see the test-conversion/sample-20-page-pdf-a4-size.pdf, when it autoconverts, why is the 1st table not rendered in .md as a table but just as separate text-lines, whereas the other tables DO properly render as markdown tables yay?
  - Please be careful and thoughtful in thinking through what we do from here and what pathways we have available. I would like to improve this, but I'm afraid of making it worse again. It could get worse again.
- Likewise the .docx conversion is wayyyy better now, but it's still doing rigid weird stuff and not producing particularly clean markdown. For example many tables in the sample .docx file convert to markdown riddled with html like `     <table style="min-width: 100px;"><colgroup><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"><col style="min-width: 25px;"></colgroup><tbody><tr><td colspan="1" rowspan="1"><p>Code</p></td><td colspan="1" rowspan="1"><p>Status</p></td><td colspan="1" rowspan="1"><p>Category</p></td><td colspan="1" rowspan="1"><p>Description</p></td></tr><tr><td colspan="1" rowspan="1"><p>200</p></td><td colspan="1" rowspan="1"><p>OK2</p></td><td colspan="1" rowspan="1"><p>Success</p></td><td colspan="1" rowspan="1"><p>Request succeeded</p></td></tr><tr><td colspan="1" rowspan="1"><p>...` -- Can we convince it to clean this up so that it just prints out as a markdown table and strips out all of that HTML? Ideally, it should convert to Markdown with zero HTML tags in it. We don't care about preserving the fancy formatting.
- The file explorer sidebar does not persist folder collapse expand state. So, if you switch to the outline view and then you switch back to the file explorer, everything all the folders have gotten collapsed again. That should not be the case, it should remember that state. So, folders that were expanded should stay expanded. Additionally, to the right of the new file and new folder icons, we also need a "close all folders" button, use the `arrows-collapse` icon please.
- Also, the root folder title in the top centered title bar should be white, not gray, please. Or maybe, you know what? White and, oh, you know what? Let's have some fun with that. Let's pick a kind of rainbow of colors and then slowly, very slowly, each letter will individually animate through those colors. Like, almost like a wave. Like the first one turns... It starts out white and the first one turns a little bit rose and then the second one turns a little bit rose and the first one turns a little bit orange and something like that. It like it like does like a like a wave style color animation where there's a sequence of colors that it slowly cycles through very subtly, almost like hard to notice, except that each time you glance back, it's a slightly different color wave.
- When a file or folder is selected in the sidebar:
  - `Cmd + Backspace` triggers deletion flow (with prompt) same as right-click -> Delete.
  - arrow key up/down switches focus to the prev/next item in the sidebar list.
  - if focusing on a folder, arrow key RIGHT expands the folder and LEFT collapses it.
  - clicking in the editor or on a tab or anywhere else de-selects it.
