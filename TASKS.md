# Tasks

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

---

To do

- WIP
  - Guard & blue banner notice when a file is changed on-disk
  - If you have text selected (with no newlines in it) and you press \`, it should wrap that selection in backticks like a `code fence` , rather than replacing the selection with a backtick.
  - Improve support of copying and pasting content from a code fence, into elsewhere in the same codefence. Content copied from in a code fence should not be wrapped in code fence markdown gates. It should just be treated as plain text.
  - Improve support for copying & pasting mixed bullet/task-lists from Obsidian into MDE. Currently often it pastes as a code fence (??).
  - A document should never be able to begin with a code fence. There should always be one separate line above it so that you have a place where you can press the up arrow or back arrow or click the cursor, click the mouse cursor to place content before the code fence. Same as at the end (which already works as expected).

### Wishlist / maybe

- When opening a markdown that contains hard line breaks in its paragraphs, we preserve those hard line breaks (good) but on save we append a backslash at the end of each line to enforce their preservation (bad). The file should be saved without adding any such backslashes please.
- **Scrollbar is too dark & not visible enough.** Add a subtle lighter border to the native macOS scrollbar thumb so it's easier to locate on long files. Core constraint: any `::webkit-scrollbar` CSS opts out of native overlay behavior (thumb becomes always-visible and takes 8px of layout space); JS animation via rAF + injected `<style>` tag was attempted but Electron's handling of pseudo-element styles proved unreliable. Need a different approach -- research whether Electron exposes a way to style the overlay scrollbar without opting out of it, or whether a thin always-visible track is acceptable if the layout cost is handled (e.g. negative margin offset).
