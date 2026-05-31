# Dev feedback - scratch inbox

The dev (Topher) drops notes in here about change requests, questions, things to look into, bugs, etc. and will periodically instruct Claude to go through and process these items.

---

- IMPORTANT BUG: When I open a file that has many existing relative links to local markdown files, edit and then save the file, it appears to REMOVE those links. This is NOT desired or OK behavior. At my request, you previously, recently, made a change where as I'm typing, if I type simply document.md or something, it will not automatically convert it to a link. And I wonder if you got overzealous and started stripping out links that were already created for local files. That should not be happening. Those relative local links are useful in important contexts for Claude code when it's navigating content. See its complaint here:

> - \~20 inline cross-reference links were stripped (37 markdown links removed, 17 re-added), e.g. `00-canon.md` collapsed to bare `00-canon.md`, and \[client\]/\[Howler\] links removed.

- (BIG) I want to support relative links to other md files on-disk (not just URLs). Rendering them as links already seems to work fine, but clicking on that url has no effect. Instead it should open the targeted file in a new tab, same as if you'd selected it in the sidebar. If linked to a file that doesn't exist, a pop-up should warn that it doesn't exist and ask if you want to create it.
