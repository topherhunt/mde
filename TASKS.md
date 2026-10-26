# Tasks

*The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.*

---

- Sidebar filenames should always be white; the icon color should be used to indicate file type (markdown, plaintext, docx/pdf, other). Grayed out filenames / folder names should indicate if it's gitignored.
- I think I want to make the git support more generalizable.
  - It should have full support for listing/viewing dirty files and browsing commit history even if it's read-only.
  - There should probably be a setting for "let MDE commit checkpoints for this folder", so it doesn't need to check for branches etc every single time the app loads, if that setting is enabled it effectively "remembers" MDE's assessment that it can safely commit here.
  - The file explorer sidebar should color files according to their git dirty status, same as VS Code.
- Support plaintext viewing & editing of plaintext files (.txt, .json, .gitignore, and other known-plaintext filenames/patterns). The critically important detail to get right there is that editing them should be literal. It should write and read without any modifications, without any trimming of white space, without any formatting cleanup or anything like that. Maybe for simplicity, we should treat it like an unsyntax highlighted code editor where effectively it just displays the monospaced text of whatever the file is and you can edit that text to your heart's content and it will save your changes when you save the buffer or when autosave is enabled. But loading and saving will not cause any formatting alterations or whitespace alterations in the way that currently we've had issues with the markdown content where loading and saving causes substantial alterations and quote-unquote cleanup to the formatting of the markdown content, many of which I would like to undo, but I haven't gotten around to documenting exactly what needs to be corrected about it.
  - Plain text files which are not markdown should be shown in a slightly different color, maybe a slightly faded light gray, which is different from the standard white color that markdown files are shown in in the sidebar, so that you have some visual indicator that they are a different type of file. And maybe on the left side of the, like to the left of the file name, maybe there should be a small faded code icon indicating that that's a code file effectively, or plain text or something. It's not a markdown file. And when you open it, it'll be shown in a different format. No toolbar, no formatting, no wysiwyg.

### Wishlist / maybe

- When opening a markdown that contains hard line breaks in its paragraphs, we preserve those hard line breaks (good) but on save we append a backslash at the end of each line to enforce their preservation (bad). The file should be saved without adding any such backslashes please.
