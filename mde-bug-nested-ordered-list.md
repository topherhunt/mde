# MDE bug: an ordered list nested in a bullet item gets flattened

## Principle

MDE must honor and preserve all valid standard Markdown (CommonMark + GFM) without destructive or substantive modification. Saving a file the user didn't edit should leave it unchanged. Where MDE normalizes syntax, the rendered meaning must stay identical, and a whole-document reformat should never be a side effect of an edit somewhere else.

## Repro

Input (valid CommonMark, written by Claude Code into `2026-10-03 UI spec.md`):

```markdown
- Plan van Aanpak PDF format
  - Header block: Locatie, Bewoner, ...
  - 1. Regenwatervolume
    - Algemeen: woningtype, huur/koop & woningeigenaar, straatfoto.
    - Dakoppervlakte en waterberging: the kadasterkaart ...
  - 2. Infiltratie: Tuindelen table, ...
  - 3. Bodemgegevens: the bodemsituatie choice, ...
  - 4. Plan van aanpak
    - Regenpijpen: one compact row per pijp ...
    - Wensen van de bewoner.
  - 5. Materialenlijst en uitvoering: ...
  - Bijlage: boorprofiel image ...
```

Expected: each `  - 1. Regenwatervolume` line is a bullet item whose content is an ordered list starting at that number, and the 4-space children stay nested under it. The file should come back unchanged.

Actual, after the file was next edited and saved in MDE (the exact trigger wasn't isolated):

```markdown
- Plan van Aanpak PDF format
  - Header block: Locatie, Bewoner, ...
  - 
  1. Regenwatervolume
  - Algemeen: woningtype, huur/koop & woningeigenaar, straatfoto.
  - Dakoppervlakte en waterberging: the kadasterkaart ...
  - 
  2. Infiltratie: Tuindelen table, ...
  - 
  3. Bodemgegevens: the bodemsituatie choice, ...
  - 
  4. Plan van aanpak
  - Regenpijpen: one compact row per pijp ...
  - Wensen van de bewoner.
  - 
  5. Materialenlijst en uitvoering: ...
  - Bijlage: boorprofiel image ...
```

What went wrong:

1. Each `- 1. X` item was split into an empty bullet (`  - `) plus an ordered item (`  1. X`) on its own line, at the bullet's indent instead of nested inside it. That ends the bullet list and starts an ordered list, so the rendered structure changes.
2. The children of the numbered items were dedented by two spaces, so they became siblings rather than children.
3. The result renders as empty bullets, interleaved with numbered items and flat bullets. Content was preserved, but the nesting, which carries the meaning, was lost.

Likely cause: the serializer handles a list item whose first block is another list incorrectly. It emits the outer marker on a line by itself, then writes the inner list with the outer item's indent instead of the content indent (marker width + 1).

## Lesser normalizations seen in the same file

These don't change the rendered output, but they're unrequested rewrites. Ideally MDE leaves them alone:

- Table delimiter rows rewritten from `|---|---|` to `| --- | --- |`.
- `#` escaped to `\#` in a table header cell (`| # |` became `| \# |`), and a leading `>` in table cells escaped to `\>`. Neither needs escaping there.
- The blank line between the end of a table and the following list item was removed.

## Workaround in use

Section numbers are now put inside bold text (`- **1. Regenwatervolume**`), so the item no longer starts with an ordered-list marker.
