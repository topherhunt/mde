# Dev feedback - scratch inbox

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

---

- 
- **Scrollbar is too dark & not visible enough.** Add a subtle lighter border to the native macOS scrollbar thumb so it's easier to locate on long files. Core constraint: any `::webkit-scrollbar` CSS opts out of native overlay behavior (thumb becomes always-visible and takes 8px of layout space); JS animation via rAF + injected `<style>` tag was attempted but Electron's handling of pseudo-element styles proved unreliable. Need a different approach -- research whether Electron exposes a way to style the overlay scrollbar without opting out of it, or whether a thin always-visible track is acceptable if the layout cost is handled (e.g. negative margin offset).
- (BIG) I want to support relative links to other md files on-disk (not just URLs). Rendering them as links already seems to work fine, but clicking on that url has no effect. Instead it should open the targeted file in a new tab, same as if you'd selected it in the sidebar. If linked to a file that doesn't exist, a pop-up should warn that it doesn't exist and ask if you want to create it.

---

- When opening a markdown that contains hard line breaks in its paragraphs, we preserve those hard line breaks (good) but on save we append a backslash at the end of each line to enforce their preservation (bad). The file should be saved without adding any such backslashes please.
