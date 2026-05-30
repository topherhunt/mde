# Dev feedback - scratch inbox

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

---

- If you Cmd + Opt + arrow up/down to reorder content, and you just had a cursor placement but not a text range selected, please stick with the cursor placement, rather than converting it into a text rang selection. Expanding to a text range selection is only useful if you ALREADY have a range selected.
- This is a bit of a niggly nitpick, but if I I want a way with just my keyboard to select the entirety of the bullet line that I'm in. So if I have my cursor in the middle of a bullet list item that spans multiple lines, Cmd + Left arrow brings me to the beginning of this wrapped-line but re-pressing that hotkey has zero effort. On re-press, if you're already at the beginning of the wrapped-line, it should move you to the beginning of the *paragraph/list item* that you're in. (another way to put it: Cmd + <- should first jump your cursor to the beginning of the *wrapped* line, then when pressed again should send you to the beginning of the *actual* line.) Likewise Cmd + Right arrow should bring you first to the end of the wrapped-line, then to the end of the list item / paragraph. These should stack with shift as normal, so I can place my cursor at the start of the bullet-list item and press Cmd + Shift + Right arrow twice in order to select the whole multi-wrapped list item.

- (BIG) I want to support relative links to other md files on-disk (not just URLs). Rendering them as links already seems to work fine, but clicking on that url has no effect. Instead it should open the targeted file in a new tab, same as if you'd selected it in the sidebar. If linked to a file that doesn't exist, a pop-up should warn that it doesn't exist and ask if you want to create it.
