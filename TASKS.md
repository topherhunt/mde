# Tasks

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

To do

- [x] Bug I just hit, and it comes up once a day or so (with medium-heavy use of this app in different folders, with Claude frequently updating files that I'm viewing):

```
Uncaught Error: Minified React error #185; visit https://react.dev/errors/185 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.
    at Po (index.js:2:396248)
    at Oo (index.js:2:395773)
    at fa (index.js:2:428092)
    at ca (index.js:2:427704)
    at Qn.t (index.js:2:650985)
    at index.js:2:720765
    at Array.forEach (<anonymous>)
    at Qn.emit (index.js:2:720752)
    at Qn.dispatchTransaction (index.js:2:750000)
    at pn.dispatch (index.js:2:1120121)
```

https://react.dev/errors/185 is `Maximum update depth exceeded. This can happen when a component repeatedly calls setState inside componentWillUpdate or componentDidUpdate. React limits the number of nested updates to prevent infinite loops.`

- [x] If you have a big document that contains mixed markdown, you know, standard formatting with headers and bullets, and one or more tables mixed in, and you press Command A to select all, and you press Command C to copy, when you paste, it only pastes the table. It doesn't paste any of the other content. It should paste everything that was selected. That's really important. 
- [x] Add Tools -> Word Count that opens a pop-up dialog that breaks down the word count, character count, and est page count (assuming 300 words / page) for the current selection and for the whole document. In format: Word count:     355 / 1728 etc.
- [x] Converting from docX is broken, troubleshoot why.
- [ ] Double margin above each paragraph. So adjacent paragraphs have more breathing room between them.
- [ ] When your cursor is in the middle of a checked-off task and you press `enter`, the newly-created task should be checked too.
- [ ] When your cursor is at the START of a checked task and you press `enter`, the UPPER line should be unchecked and the LOWER line should be checked (ie checked-ness should follow the text of the completed/checked task).
- [ ] When you have a task list item, clicking at the *start of the line* *of text* should not toggle checked status. You should need to click IN the checkbox. The toggle-hitbox extends too far to the right.
- [ ] When I select the full text of a task and copy it, and then paste it into a plaintext environment like claude-code or VS Code, I get a double `- [ ]` like this: `- [ ] - [ ] "to be trued up at month end" seems unnecessary. I'd rather give them a precise, but generously conservative, number that makes room for all our metered usage, and not talk about any truing up.` - ideally the copy would create both an html version (with the task li) and a plaintext version (no li or `- [ ]` just the selected text itself) - so if I cmd + shift + V then it should just paste the text itself, no html or `- [ ]`.
- [ ] If I copy text that contains a \~, then in the copied text, there's the escape character before it, like `\~`. That escape shouldn't be included in the copied text.
- [ ] If you have a nested list of 3 items, and the middle item is empty and you press backspace while cursor is on it, it outdents (effectively splitting the list. It shouldn't do that; instead it should just delete that list item, moving cursor up to the end of previous item.
- [ ] The red warning "This file was modified on disk. Your unsaved changes may conflict. Copy your work before reloading." isn't working properly. It often appears when I KNOW for fact that nothing else was modifying the target file, I just edited the file with no issue 2 minutes previously. It's important to keep the bulletproof overwrite-protection in place, but it seems too hair-trigger currently...?
  - It might have something to do with the race condition when I make edits at the same moment an autosave is triggered.
- [ ] Folded lists act weird when you're reordering other list items to above/below a folded item or adding a new item before or after a folded item:
  - If you have a folded item, then you place your cursor in the sibling item below/after it and press Cmd + Opt + Up to reorder up, the folded/collapsed content expands and the `...` symbol incorrectly appears after the item you moved up, even though that item has no folded content. Clicking on the `...` causes it to disappear.
  - Same thing happens when you click the cursor at the beginning of a folded item and press `enter` to add a new sibling before it. That sibling gets the `...` and the folded item is un-folded. What SHOULD happen is, the folded content should stay folded, even though it's now at a different line index.
  - Similarly, if you place Your cursor in a list item that is the prior or above sibling of a folded list item, and then press Cmd + Opt + Down to reorder that bare list item down, the folded content gets un-folded, and the sibling item BELOW those two items gets a phantom `...` next to it, which disappears when clicked.
- Support folding headings in addition to list items. All content down to the next same-or-larger-level heading is included in the fold.
- When opening a .md file that contains a \`\`\` codefence with bulleted lists inside it, the `{LIST_SEPARATOR}` tag is being added even though it wasn't present in the original document written by claude (mde added it on load and then never cleaned it out). As a final post step you need to check to make sure all such tags are in fact stripped out and otherwise treated as a rendering error.
- [ ] The sidebar file explorer's header row (folder name + action buttons) should be sticky at the top of the scroll; only the actual folders/files container below that should scroll.
- [ ] 

### Wishlist / maybe

- When opening a markdown that contains hard line breaks in its paragraphs, we preserve those hard line breaks (good) but on save we append a backslash at the end of each line to enforce their preservation (bad). The file should be saved without adding any such backslashes please.
- **Scrollbar is too dark & not visible enough.** Add a subtle lighter border to the native macOS scrollbar thumb so it's easier to locate on long files. Core constraint: any `::webkit-scrollbar` CSS opts out of native overlay behavior (thumb becomes always-visible and takes 8px of layout space); JS animation via rAF + injected `<style>` tag was attempted but Electron's handling of pseudo-element styles proved unreliable. Need a different approach -- research whether Electron exposes a way to style the overlay scrollbar without opting out of it, or whether a thin always-visible track is acceptable if the layout cost is handled (e.g. negative margin offset).
