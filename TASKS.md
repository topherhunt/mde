# Tasks

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

To do:

- [ ] The red warning "This file was modified on disk. Your unsaved changes may conflict. Copy your work before reloading." isn't working properly. It often appears when I KNOW for fact that nothing else was modifying the target file, I just edited the file with no issue 2 minutes previously. It's important to keep the bulletproof overwrite-protection in place, but it seems too hair-trigger currently...?
  - It might have something to do with the race condition when I make edits at the same moment an autosave is triggered.
- [ ] Folded lists act weird when you're reordering other list items to above/below a folded item or adding a new item before or after a folded item:
  - If you have a folded item, then you place your cursor in the sibling item below/after it and press Cmd + Opt + Up to reorder up, the folded/collapsed content expands and the `...` symbol incorrectly appears after the item you moved up, even though that item has no folded content. Clicking on the `...` causes it to disappear.
  - Same thing happens when you click the cursor at the beginning of a folded item and press `enter` to add a new sibling before it. That sibling gets the `...` and the folded item is un-folded. What SHOULD happen is, the folded content should stay folded, even though it's now at a different line index.
  - Similarly, if you place Your cursor in a list item that is the prior or above sibling of a folded list item, and then press Cmd + Opt + Down to reorder that bare list item down, the folded content gets un-folded, and the sibling item BELOW those two items gets a phantom `...` next to it, which disappears when clicked.
- Support folding headings in addition to list items. All content down to the next same-or-larger-level heading is included in the fold.
- When opening a .md file that contains a \`\`\` codefence with bulleted lists inside it, the `{LIST_SEPARATOR}` tag is being added even though it wasn't present in the original document written by claude (mde added it on load and then never cleaned it out). As a final post step you need to check to make sure all such tags are in fact stripped out and otherwise treated as a rendering error.
- [ ] The sidebar file explorer's header row (folder name + action buttons) should be sticky at the top of the scroll; only the actual folders/files container below that should scroll.
- \[ \]

### Wishlist / maybe

- When opening a markdown that contains hard line breaks in its paragraphs, we preserve those hard line breaks (good) but on save we append a backslash at the end of each line to enforce their preservation (bad). The file should be saved without adding any such backslashes please.
- **Scrollbar is too dark & not visible enough.** Add a subtle lighter border to the native macOS scrollbar thumb so it's easier to locate on long files. Core constraint: any `::webkit-scrollbar` CSS opts out of native overlay behavior (thumb becomes always-visible and takes 8px of layout space); JS animation via rAF + injected `<style>` tag was attempted but Electron's handling of pseudo-element styles proved unreliable. Need a different approach -- research whether Electron exposes a way to style the overlay scrollbar without opting out of it, or whether a thin always-visible track is acceptable if the layout cost is handled (e.g. negative margin offset).
