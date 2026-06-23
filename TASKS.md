# Dev feedback - scratch inbox

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

---

- (BIG) I want to support relative links to other md files on-disk (not just URLs). Rendering them as links already seems to work fine, but clicking on that url has no effect. Instead it should open the targeted file in a new tab, same as if you'd selected it in the sidebar. If linked to a file that doesn't exist, a pop-up should warn that it doesn't exist and ask if you want to create it.

---

- If you rename a file in the sidebar and that file is currently open, rename the tab in the tab bar and ensure the editor buffer correctly "links" to that renamed file so further edits don't re-save to the old filepath.
- If you click once on a file in the sidebar and then press `enter`, it should trigger the rename dialog. Currently instead of that, the cursor jumps immediately into the editor buffer on 1st click, so `enter` just creates a newline at the top of the file. Clicking on the file in the sidebar should not jump focus immediately into the editor.
- If you copy & paste a bulleted task list from Obsidian, some items checked & others unchecked, the checked/unchecked status should be recreated accurately in the MDE editor.
- The scroll bar for the editor buffer on the right hand side is a nice, pleasant, unobtrusive dark, but when the scroll is very long, it's too dark. Can you give it a slightly lighter border so it's easier to at least see where it is, that tiny little pill, as it's scrolling down a very long file?
- When your focus is NOT in the Find & Replace bar, pressing Cmd + F should jump focus into it (the find field), NOT toggle it closed.
- The Find & Replace bar should also have an "all files" mode, which finds and/or replaces across all (markdown/text) files in the project folder. Carefully think through how to do this in a safe and transparent way that's compatible with our tabbed-browsing UI.

---

- When opening a markdown that contains hard line breaks in its paragraphs, we preserve those hard line breaks (good) but on save we append a backslash at the end of each line to enforce their preservation (bad). The file should be saved without adding any such backslashes please.
- If I paste in markdown text into a MDE Markdown document, it should format it. Like it should accept the formatting and integrate it rather than literally texting pasting that thing as if it's plain text. For example, if I copy from a bulleted list with task items, it should paste that in correctly as unchecked task items or checked task items as appropriate. I noticed that this didn't seem to work when I copy markdown shaped text from Obsidian and paste it in here.
