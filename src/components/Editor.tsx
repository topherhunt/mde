import React, { useEffect, useRef, useState, useCallback, useLayoutEffect, useMemo } from 'react';
import { useEditor, EditorContent, Editor as TipTapEditor, createNodeFromContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Code from '@tiptap/extension-code';
import Link from '@tiptap/extension-link';
import { Table, TableKit } from '@tiptap/extension-table';
import CodeBlock from '@tiptap/extension-code-block';
import Placeholder from '@tiptap/extension-placeholder';
import { ListItem } from '@tiptap/extension-list';
import taskListPlugin from 'markdown-it-task-lists';
import { Markdown as MarkdownExt } from 'tiptap-markdown';
import Text from '@tiptap/extension-text';
import { Extension, InputRule, mergeAttributes } from '@tiptap/core';
import { TextSelection, NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, EditorProps as PMEditorProps } from '@tiptap/pm/view';
import { Fragment, DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { Tab } from '../types';
import { findHeadingByAnchor, markdownToHtml } from '../utils/markdown';
import { ImageNode } from '../utils/imageNode';
import { dirname } from '../utils/paths';
import { ColorHighlight, TextColor, escapeColorSyntax } from '../utils/colorMarks';
import TableMenu from './TableMenu';
import ImageContextMenu from './ImageContextMenu';
import PasteImagesDialog from './PasteImagesDialog';
import { INSERT_IMAGE_EVENT, PendingPaste, WebImageChoice, imageDropsHandled, pasteNeedingImageChoice, resolveWebPaste, saveImageFiles } from '../utils/pasteImages';

// Override tiptap-markdown's text serializer which blindly converts all < and >
// to &lt; &gt;, mangling prose like "Apples > oranges." on save.
// With html:false, markdown-it already treats <ol> etc. as literal text on parse,
// so we just need to output raw text without the escapeHTML step.
// prosemirror-markdown's esc() backslash-escapes EVERY `~`, so prose like "approx ~5"
// went to disk (and to the clipboard) as "approx \~5". Only a DOUBLED `~~` opens a
// strikethrough in markdown-it, so a lone tilde needs no escape at all. A `\~` that sits
// next to another `\~` is left alone: under-escaping there would silently turn literal
// "~~text~~" into a strike on the next load, and over-escaping is the safe direction.
const LONE_ESCAPED_TILDE = /(?<!\\~)\\~(?!\\~)/g;
// esc() also escapes brackets, which turned Obsidian's `[[note]]` / `![[pic.png]]` into
// `\[\[note\]\]` on every save. A label can't hold unescaped brackets, so `[[x]]` reparses as
// the same literal text; only the brackets are un-escaped, never what's inside.
const ESCAPED_WIKILINK = /\\\[\\\[((?:(?!\\[[\]])[^\n])+?)\\\]\\\]/g;

const TextNode = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          // state.text() runs esc() internally, so undo its tilde and wikilink escaping (and
          // add the `==` / `{color}` escaping it knows nothing about) on just the span of
          // output this call appended.
          const start = state.out.length;
          state.text(node.text);
          state.out = state.out.slice(0, start) + escapeColorSyntax(state.out.slice(start)
            .replace(LONE_ESCAPED_TILDE, '~').replace(ESCAPED_WIKILINK, '[[$1]]'));
        },
        parse: {},
      },
    };
  },
});

const TABLE_NODE_NAMES = ['table', 'tableRow', 'tableCell', 'tableHeader'];

const cellSpans = (cell: any) => cell.attrs.colspan > 1 || cell.attrs.rowspan > 1;

// tiptap-markdown's table serializer, except that a cell holding an image is written even when
// its text is blank. The stock one skips every blank-text cell, so an image-only cell lost its
// image on save. A table Markdown can't express (spans, multi-paragraph cells, a header
// cell outside the first row) still writes tiptap-markdown's `[table]`, as before.
const MarkdownTable = Table.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          const rows: any[] = [];
          node.forEach((row: any) => rows.push(row));
          const expressible = rows.every((row, i) => {
            let ok = true;
            row.forEach((cell: any) => {
              if ((cell.type.name === 'tableHeader') !== (i === 0) || cellSpans(cell) || cell.childCount > 1) ok = false;
            });
            return ok;
          });
          if (!expressible) {
            state.write('[table]');
            state.closeBlock(node);
            return;
          }
          state.inTable = true;
          rows.forEach((row, i) => {
            state.write('| ');
            row.forEach((cell: any, _offset: number, j: number) => {
              if (j) state.write(' | ');
              const content = cell.firstChild;
              let hasImage = false;
              content.forEach((child: any) => { if (child.type.name === 'image') hasImage = true; });
              if (content.textContent.trim() || hasImage) state.renderInline(content);
            });
            state.write(' |');
            state.ensureNewLine();
            if (i === 0) {
              state.write(`| ${Array.from({ length: row.childCount }, () => '---').join(' | ')} |`);
              state.ensureNewLine();
            }
          });
          state.closeBlock(node);
          state.inTable = false;
        },
        parse: {},
      },
    };
  },
});

// Convert a copied slice into tab-separated rows -- but ONLY when the slice is
// nothing BUT table structure (a cell selection, a row, or a whole table on its own).
// Returns null otherwise, including for a mixed selection such as Cmd+A over a
// document with prose AND a table: there the whole slice goes to the markdown
// serializer instead, which renders the table as a Markdown table alongside
// everything else. (Deciding on "contains a table anywhere" used to silently drop
// every non-table block from the copied text.)
// A single selected cell yields just its text -- no tabs/newlines.
function tableSliceToTSV(content: Fragment): string | null {
  const rows: string[][] = [];

  const collectRow = (rowNode: any) => {
    const cells: string[] = [];
    rowNode.forEach((cell: any) => cells.push(cell.textContent));
    rows.push(cells);
  };

  let allTable = true;
  content.forEach((node: any) => {
    if (!TABLE_NODE_NAMES.includes(node.type.name)) allTable = false;
  });
  if (!allTable || content.childCount === 0) return null;

  content.forEach((node: any) => {
    const name = node.type.name;
    if (name === 'table') {
      node.forEach((row: any) => { if (row.type.name === 'tableRow') collectRow(row); });
    } else if (name === 'tableRow') {
      collectRow(node);
    } else {
      // tableCell / tableHeader
      rows.push([node.textContent]);
    }
  });

  return rows.map((r) => r.join('\t')).join('\n');
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The range of code text to copy when the selection's ONLY content is inside one
// code block: an interior selection, a NodeSelection of the block, or a drag that
// spills into empty neighbouring blocks. Null when any inline content outside the
// block, or a second code block, is selected.
function codeOnlySelectionRange(state: any): { from: number; to: number } | null {
  const { from, to, empty } = state.selection;
  if (empty) return null;
  let block: { start: number; end: number } | null = null;
  let codeBlocks = 0;
  let outside = false;
  state.doc.nodesBetween(from, to, (node: any, pos: number) => {
    if (node.type.spec.code && node.isTextblock) {
      codeBlocks++;
      block = { start: pos + 1, end: pos + 1 + node.content.size };
      return false;
    }
    if (node.isInline) outside = true;
    return !outside;
  });
  if (outside || codeBlocks !== 1) return null;
  const range = { from: Math.max(from, block!.start), to: Math.min(to, block!.end) };
  return range.from < range.to ? range : null;
}

// The selection when it lies within one textblock and every selected inline node
// carries the inline code mark -- part or all of a `code span`. Null otherwise.
function inlineCodeOnlySelectionRange(state: any): { from: number; to: number } | null {
  const { from, to, empty, $from, $to } = state.selection;
  const code = state.schema.marks.code;
  if (empty || !code || !$from.sameParent($to) || !$from.parent.isTextblock) return null;
  let allCode = true;
  state.doc.nodesBetween(from, to, (node: any) => {
    if (node.isInline && !code.isInSet(node.marks)) allCode = false;
  });
  return allCode ? { from, to } : null;
}

// Depth of the innermost listItem the position sits inside, or 0 for none.
function listItemDepth($pos: any): number {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'listItem') return d;
  }
  return 0;
}

const insideListItem = ($pos: any): boolean => listItemDepth($pos) > 0;

// When copying a single list item, strip the list wrapper so the clipboard gets
// just the text, not "- text". Multi-item copies keep the list markers.
const SmartClipboard = Extension.create({
  name: 'smartClipboard',
  addProseMirrorPlugins() {
    const editor = this.editor;
    // Copy/cut of a selection whose only content is code -- one code block or one
    // inline code span (see the two *SelectionRange helpers): write the raw text to
    // BOTH text/plain and a plain text/html. Handling the DOM event ourselves --
    // before ProseMirror's serializeForClipboard runs -- means the code is never
    // wrapped in a ``` fence or backticks in either representation, so it pastes as
    // plain text ANYWHERE, not as re-created code. Returns false when text outside
    // the code is selected too, so mixed copies keep their Markdown on the normal path.
    const copyCodeAsPlainText = (view: any, event: ClipboardEvent, isCut: boolean): boolean => {
      const { state } = view;
      const range = codeOnlySelectionRange(state) ?? inlineCodeOnlySelectionRange(state);
      if (!range) return false;
      const data = event.clipboardData;
      if (!data) return false;
      const text = state.doc.textBetween(range.from, range.to, '\n');
      event.preventDefault();
      data.clearData();
      data.setData('text/plain', text);
      // Inline HTML (lines joined by <br>, no block wrapper) so a paste merges into
      // the target inline -- e.g. into a prose paragraph -- as plain text rather than
      // spawning new blocks. Providing SOME html is required: with none, ProseMirror
      // routes the text through tiptap-markdown's parser (so "- x" would become a list).
      data.setData('text/html', text.split('\n').map(escapeHtml).join('<br>'));
      if (isCut) {
        view.dispatch(state.tr.deleteSelection().scrollIntoView().setMeta('uiEvent', 'cut'));
      }
      return true;
    };
    return [
      new Plugin({
        key: new PluginKey('smartClipboard'),
        props: {
          handleDOMEvents: {
            copy: (view, event) => copyCodeAsPlainText(view, event as ClipboardEvent, false),
            cut: (view, event) => copyCodeAsPlainText(view, event as ClipboardEvent, true),
          },
          clipboardTextSerializer: (slice) => {
            // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
            const serializer = editor.storage.markdown.serializer;
            const { content } = slice;
            // Table selections (CellSelection or a copied table) -- tiptap-markdown has no
            // table serializer and would emit "[table]". Emit tab-separated rows instead,
            // which paste cleanly as plain text (e.g. VS Code) and as a real table into Word
            // (which reads the text/html representation ProseMirror writes alongside this one).
            const tsv = tableSliceToTSV(content);
            if (tsv !== null) return tsv;
            // Text selected inside ONE list item copies as just that text -- no "- "
            // bullet, no "[ ] " checkbox. A copied slice keeps every ancestor the
            // selection sits under, so a nested task item used to serialize the
            // ancestor item's marker AND its own, giving "- [ ] - [ ] the text".
            // Inline formatting (bold, links, code) is still serialized.
            const { $from, $to, empty } = editor.state.selection;
            if (!empty && $from.sameParent($to) && $from.parent.isTextblock
                && !$from.parent.type.spec.code && insideListItem($from)) {
              const inline = $from.parent.cut($from.parentOffset, $to.parentOffset);
              return serializer.serialize(Fragment.from(inline)).trim();
            }
            // Whole-item copies (a selection spanning the item's own boundaries, so the
            // rule above doesn't apply) still shed the item's own marker: one list item
            // is a line of text, not a list. Any sublist it carries keeps its markers.
            if (content.childCount === 1) {
              const child = content.firstChild!;
              if ((child.type.name === 'bulletList' || child.type.name === 'orderedList')
                  && child.childCount === 1) {
                return serializer.serialize(child.firstChild!.content).trim();
              }
              if (child.type.name === 'listItem') {
                return serializer.serialize(child.content).trim();
              }
            }
            return serializer.serialize(content);
          },
        },
      }),
    ];
  },
});

// Checkbox geometry, relative to the <li>'s top-left corner. Mirrors the
// `li[data-checked]::before` rule in index.css (left: -18px; top: 5px; 14x14).
const CHECKBOX_LEFT = -18;
const CHECKBOX_TOP = 5;
const CHECKBOX_SIZE = 14;
const CHECKBOX_SLOP = 2;

const UnifiedListItem = ListItem.extend({
  addAttributes() {
    return {
      checked: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const v = el.getAttribute('data-checked');
          return v === null ? null : v === 'true';
        },
        renderHTML: (attrs: Record<string, any>) => {
          if (attrs.checked === null) return {};
          return { 'data-checked': String(attrs.checked) };
        },
      },
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          if (node.attrs.checked !== null) {
            state.write(node.attrs.checked ? '[x] ' : '[ ] ');
          }
          // An empty paragraph before a list is the placeholder cleanParsedListHtml adds for
          // `- 1. x`; skipping it writes the inner marker on the item's own line. Not for tasks,
          // where `- [ ] 1. x` would parse back as paragraph text.
          const first = node.firstChild;
          const skipFirst = node.attrs.checked === null && first.type.name === 'paragraph'
            && first.content.size === 0 && /^(bullet|ordered)List$/.test(node.maybeChild(1)?.type.name);
          node.forEach((child: any, _: number, i: number) => {
            if (!(skipFirst && i === 0)) state.render(child, node, i);
          });
        },
        parse: {
          setup(markdownit: any) {
            markdownit.use(taskListPlugin);
          },
          updateDOM(element: HTMLElement) {
            element.querySelectorAll('.task-list-item').forEach((item) => {
              const input = item.querySelector('input');
              if (input) {
                item.setAttribute('data-checked', String(input.checked));
                input.remove();
              }
              item.classList.remove('task-list-item');
            });
            element.querySelectorAll('.contains-task-list').forEach((list) => {
              list.classList.remove('contains-task-list');
              list.removeAttribute('data-type');
            });
          },
        },
      },
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /^\[([xX ]?)\]\s$/,
        handler: ({ state, range, match }: { state: any; range: { from: number; to: number }; match: RegExpMatchArray }) => {
          const tr = state.tr;
          const $from = state.doc.resolve(range.from);
          if ($from.parent.type.name !== 'paragraph') return;
          if (range.from !== $from.start()) return;
          for (let d = $from.depth - 1; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              const liPos = $from.before(d);
              const checked = match[1]?.toLowerCase() === 'x';
              tr.delete(range.from, range.to);
              tr.setNodeMarkup(tr.mapping.map(liPos), undefined, {
                ...$from.node(d).attrs, checked,
              });
              return;
            }
          }
        },
      }),
    ];
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('checkboxClick'),
        props: {
          handleClick: (view, pos, event) => {
            const target = event.target as HTMLElement;
            const li = target.closest('li[data-checked]');
            if (!li) return false;
            const liRect = li.getBoundingClientRect();
            // The checkbox is a ::before pseudo-element, so the click target is the <li>
            // itself and we have to hit-test the box by hand. Only a click actually
            // inside it (plus a couple of px of slop) toggles -- clicking the first
            // character of the text, or anywhere on a wrapped second line, must place
            // the cursor. Keep in sync with li[data-checked]::before in index.css.
            const x = event.clientX - liRect.left;
            const y = event.clientY - liRect.top;
            const inBox = x >= CHECKBOX_LEFT - CHECKBOX_SLOP
              && x <= CHECKBOX_LEFT + CHECKBOX_SIZE + CHECKBOX_SLOP
              && y >= CHECKBOX_TOP - CHECKBOX_SLOP
              && y <= CHECKBOX_TOP + CHECKBOX_SIZE + CHECKBOX_SLOP;
            if (!inBox) return false;
            let liPos: number;
            try {
              liPos = view.posAtDOM(li, 0) - 1;
            } catch {
              return false;
            }
            const node = view.state.doc.nodeAt(liPos);
            if (!node || node.type.name !== 'listItem' || node.attrs.checked === null) return false;
            view.dispatch(
              view.state.tr.setNodeMarkup(liPos, undefined, {
                ...node.attrs, checked: !node.attrs.checked,
              })
            );
            return true;
          },
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }: { editor: any }) => {
        const { state } = editor;
        const { $from } = state.selection;

        let liDepth = 0;
        let isTask = false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'listItem') {
            liDepth = d;
            isTask = $from.node(d).attrs.checked !== null;
            break;
          }
        }
        if (!liDepth) return false;

        const li = $from.node(liDepth);
        const hasSublist = li.childCount > 1 && (li.lastChild!.type.name === 'bulletList' || li.lastChild!.type.name === 'orderedList');

        if (hasSublist && $from.depth === liDepth + 1) {
          const atParaEnd = $from.pos === $from.end(liDepth + 1);

          if (atParaEnd) {
            const schema = state.schema;
            // A FOLDED item acts as if it had no children at all: the cursor is sitting
            // right before the "..." badge, so Enter puts a SIBLING below the whole folded
            // subtree rather than a first child inside content the user can't see.
            // Unfold first and the branch below runs instead, giving the first child back.
            if (li.attrs.folded) {
              const newItem = schema.nodes.listItem.create(
                { checked: isTask ? false : null },
                schema.nodes.paragraph.create()
              );
              const insertPos = $from.after(liDepth);
              const tr = state.tr.insert(insertPos, newItem);
              tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
              editor.view.dispatch(tr);
              return true;
            }
            const para = li.firstChild!;
            const sublistStart = $from.before(liDepth) + 1 + para.nodeSize;
            const newItem = schema.nodes.listItem.create(
              { checked: isTask ? false : null },
              schema.nodes.paragraph.create()
            );
            const tr = state.tr.insert(sublistStart + 1, newItem);
            tr.setSelection(TextSelection.create(tr.doc, sublistStart + 3));
            editor.view.dispatch(tr);
            return true;
          }
        }

        // For empty nested list items, just create a sibling instead of
        // lifting out (which creates a bare <p> inside the parent <li>)
        const paraNode = $from.parent;
        const isEmptyPara = paraNode.type.name === 'paragraph' && paraNode.content.size === 0;
        if (isEmptyPara && liDepth > 1) {
          // Check if the list containing this item is nested inside another listItem
          let isNested = false;
          for (let d = liDepth - 1; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') { isNested = true; break; }
          }
          if (isNested) {
            // If this empty item is the FINAL child of its sublist (no siblings
            // below it), outdent to the parent level instead of nesting deeper.
            // If it has siblings below, just create an empty sibling.
            const parentList = $from.node(liDepth - 1);
            const isLastChild = $from.index(liDepth - 1) === parentList.childCount - 1;
            if (isLastChild) {
              editor.commands.liftListItem('listItem');
              return true;
            }
            const schema = state.schema;
            const newItem = schema.nodes.listItem.create(
              { checked: isTask ? false : null },
              schema.nodes.paragraph.create()
            );
            const insertPos = $from.after(liDepth);
            const tr = state.tr.insert(insertPos, newItem);
            tr.setSelection(TextSelection.create(tr.doc, insertPos + 2));
            editor.view.dispatch(tr);
            return true;
          }
        }

        // Checked-ness follows the TEXT. Splitting in the middle of a checked task
        // leaves both halves checked; splitting at the very start pushes the text (and
        // its check) down and leaves a fresh UNCHECKED item above it; splitting at the
        // end keeps the text checked above and starts a new unchecked item below.
        // In every case the half that ends up empty is the one that becomes unchecked.
        const origChecked = $from.node(liDepth).attrs.checked;
        const atStart = $from.parentOffset === 0;
        const atEnd = $from.parentOffset === $from.parent.content.size;

        if (!editor.commands.splitListItem('listItem')) return false;
        if (isTask) {
          const { $from: $new } = editor.state.selection;
          const d = listItemDepth($new);
          if (d) {
            // splitListItem leaves the cursor in the LOWER of the two items.
            const lowerPos = $new.before(d);
            const tr = editor.state.tr.setNodeMarkup(lowerPos, undefined, {
              ...$new.node(d).attrs, checked: atEnd ? false : origChecked,
            });
            const index = $new.index(d - 1);
            if (atStart && index > 0) {
              const upper = $new.node(d - 1).child(index - 1);
              tr.setNodeMarkup(lowerPos - upper.nodeSize, undefined, {
                ...upper.attrs, checked: false,
              });
            }
            editor.view.dispatch(tr);
          }
        }
        return true;
      },
    };
  },
});

// Backspace on an EMPTY list item that has a previous sibling deletes just that item
// and drops the cursor at the end of the item above. TipTap's own list keymap either
// outdents (splitting the list in two) or, at top level, turns the PREVIOUS item into
// a paragraph -- both wildly out of proportion to "remove this blank line".
// Needs a higher priority than ListKit so its Backspace binding runs first: TipTap
// sorts extensions by priority descending and runs their keymaps in that order.
const ListItemBackspace = Extension.create({
  name: 'listItemBackspace',
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const { $from } = selection;
        const d = listItemDepth($from);
        if (!d) return false;

        const li = $from.node(d);
        // Only a blank item with nothing hanging off it -- an item with a sublist would
        // orphan its children, and a non-empty one has text the user still wants.
        if (li.childCount !== 1 || li.firstChild!.content.size !== 0) return false;
        // The first item of a list keeps the default behavior (outdent / lift out).
        if ($from.index(d - 1) === 0) return false;

        const liPos = $from.before(d);
        const tr = state.tr.delete(liPos, liPos + li.nodeSize);
        // liPos - 1 now sits just inside the end of the previous item; near(-1) walks
        // back to the last text position in it (the deepest last child, if it nests).
        tr.setSelection(TextSelection.near(tr.doc.resolve(liPos - 1), -1));
        editor.view.dispatch(tr.scrollIntoView());
        return true;
      },
    };
  },
});

const TabHandler = Extension.create({
  name: 'tabHandler',
  addKeyboardShortcuts() {
    return {
      'Tab': ({ editor }) => {
        if (editor.isActive('listItem')) {
          editor.commands.sinkListItem('listItem');
        } else {
          editor.commands.insertContent('\t');
        }
        return true;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('listItem')) {
          const { $from } = editor.state.selection;
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              const parentList = $from.node(d - 1);
              if (parentList.type.name === 'bulletList' || parentList.type.name === 'orderedList') {
                const grandparent = d - 2 >= 0 ? $from.node(d - 2) : null;
                if (grandparent && grandparent.type.name === 'listItem') {
                  editor.commands.liftListItem('listItem');
                }
              }
              break;
            }
          }
        }
        return true;
      },
    };
  },
});

// Insert clipboard text verbatim (no Markdown parsing, no auto-linking),
// splitting on newlines into hard breaks so line structure survives.
// Strip the whitespace prefix that every non-blank line shares. Markdown copied
// from a nested position (e.g. an indented list sub-tree from Obsidian) arrives with
// a leading tab / 4 spaces on every line, which markdown-it parses as an indented
// code block instead of a list. Removing the common indentation restores the list
// structure while leaving relative (deeper) nesting intact.
function dedentPastedText(text: string): string {
  const lines = text.split('\n');
  const nonBlank = lines.filter((l) => l.trim().length > 0);
  if (nonBlank.length === 0) return text;
  let prefix = nonBlank[0].match(/^[ \t]*/)![0];
  for (const line of nonBlank) {
    const ws = line.match(/^[ \t]*/)![0];
    let i = 0;
    while (i < prefix.length && i < ws.length && prefix[i] === ws[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return text;
  }
  return lines.map((l) => (l.startsWith(prefix) ? l.slice(prefix.length) : l)).join('\n');
}

// Escape an ordered-list marker that sits directly inside a bullet item -- e.g.
// "- 1. SIS" -- by backslash-escaping the dot/paren ("- 1\. SIS"). Without this,
// markdown-it (correctly per CommonMark, but not how Obsidian renders it) reads
// "- 1. x" as a bullet whose sole content is an ordered sub-list, which collapses
// into an empty parent bullet + a stray "1." item on paste. Only the number that
// immediately follows a bullet marker on the SAME line is touched, so a genuine
// ordered sub-list on its own line (or a top-level "1. x") is left alone.
function escapeBulletNumbers(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/^(\s*[-*+]\s+)(\d+)([.)])(\s)/, '$1$2\\$3$4'))
    .join('\n');
}

function insertAsPlainText(editor: any, text: string) {
  if (!text) return;
  const lines = text.split('\n');
  const content: any[] = [];
  lines.forEach((line, i) => {
    if (i > 0) content.push({ type: 'hardBreak' });
    if (line.length) content.push({ type: 'text', text: line });
  });
  try {
    editor.chain().focus().insertContent(content).run();
  } catch {
    editor.chain().focus().insertContent(text).run();
  }
}

// Cmd+Shift+V: paste as plain text, stripping any formatting (like Google Docs).
const PlainTextPaste = Extension.create({
  name: 'plainTextPaste',
  addKeyboardShortcuts() {
    return {
      'Mod-Shift-v': ({ editor }) => {
        navigator.clipboard.readText().then(text => insertAsPlainText(editor, text)).catch(() => {});
        return true;
      },
    };
  },
});

// Typing ` with a non-empty, single-line selection wraps the selection in inline
// code (like a `code fence`) instead of replacing it with a literal backtick.
const BacktickWrap = Extension.create({
  name: 'backtickWrap',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('backtickWrap'),
        props: {
          handleTextInput(view, from, to, text) {
            if (text !== '`' || from === to) return false;
            const { state } = view;
            // Inside a code block a backtick is a literal character -- leave it alone.
            if (state.selection.$from.parent.type.spec.code) return false;
            if (!state.schema.marks.code) return false;
            // Only single-line selections: a `\n` means the range spans a block
            // boundary (or a hard break), which inline code can't wrap.
            if (state.doc.textBetween(from, to, '\n').includes('\n')) return false;
            editor.chain().focus().toggleCode().run();
            return true;
          },
        },
      }),
    ];
  },
});

// The document must never begin with a code block: with no block above it there's
// nowhere to place the cursor to add content before it. Whenever the first child is
// a code block, prepend an empty paragraph. (The end already gets a trailing block.)
const LeadingParagraph = Extension.create({
  name: 'leadingParagraph',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('leadingParagraph'),
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          const first = newState.doc.firstChild;
          if (!first || first.type.name !== 'codeBlock') return null;
          const paragraph = newState.schema.nodes.paragraph;
          if (!paragraph) return null;
          return newState.tr.insert(0, paragraph.create()).setMeta('addToHistory', false);
        },
      }),
    ];
  },
});

const CmdEnterCycle = Extension.create({
  name: 'cmdEnterCycle',
  addKeyboardShortcuts() {
    return {
      'Mod-Enter': ({ editor }) => {
        const { state } = editor.view;
        const { from, to } = state.selection;
        const { $from } = state.selection;
        const collapsed = from === to;

        // Find the reference listItem to determine cycle target.
        // Collapsed: innermost listItem at cursor. Extended: first listItem in range.
        let foundChecked: null | boolean = undefined as any;
        if (collapsed) {
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              foundChecked = $from.node(d).attrs.checked;
              break;
            }
          }
        } else {
          // Use $from ancestry first (innermost at selection start)
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              foundChecked = $from.node(d).attrs.checked;
              break;
            }
          }
          // Fallback: scan range for the first listItem
          if (foundChecked === undefined as any) {
            state.doc.nodesBetween(from, to, (node) => {
              if (foundChecked !== undefined as any) return false;
              if (node.type.name === 'listItem') {
                foundChecked = node.attrs.checked;
                return false;
              }
            });
          }
        }

        // No list context: create a bullet list
        if (foundChecked === undefined as any) {
          editor.chain().focus().toggleBulletList().run();
          return true;
        }

        // Cycle: null (bullet) -> false (unchecked) -> true (checked) -> null
        let targetChecked: null | boolean;
        if (foundChecked === null) targetChecked = false;
        else if (foundChecked === false) targetChecked = true;
        else targetChecked = null;

        if (collapsed) {
          // Collapsed cursor: only toggle the innermost listItem
          for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type.name === 'listItem') {
              const pos = $from.before(d);
              editor.view.dispatch(
                state.tr.setNodeMarkup(pos, undefined, { ...$from.node(d).attrs, checked: targetChecked })
              );
              break;
            }
          }
          return true;
        }

        // Extended selection: toggle listItems whose own paragraph text overlaps selection
        const tr = state.tr;
        const items: { pos: number; node: any }[] = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'listItem') {
            const first = node.firstChild;
            if (first && first.type.name === 'paragraph') {
              const pStart = pos + 1;
              const pEnd = pStart + first.nodeSize;
              if (pEnd > from && pStart < to) {
                items.push({ pos, node });
              }
            }
          }
        });
        for (const { pos, node } of items) {
          const mapped = tr.mapping.map(pos);
          tr.setNodeMarkup(mapped, undefined, { ...node.attrs, checked: targetChecked });
        }
        editor.view.dispatch(tr);
        return true;
      },
    };
  },
});

function moveBlock(editor: any, direction: 'up' | 'down'): boolean {
  const { state } = editor;
  const { from, to } = state.selection;
  const { $from } = state.selection;
  // If the user only had a cursor (no range), keep it a cursor after moving --
  // don't expand the moved block into a full text selection.
  const wasCollapsed = from === to;

  let targetDepth = 1;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name === 'listItem') {
      targetDepth = d;
      break;
    }
  }

  const parentNode = $from.node(targetDepth - 1);
  const contentStart = $from.start(targetDepth - 1);

  // Find all sibling items at targetDepth that overlap the selection
  let firstIdx: number, lastIdx: number;
  if (from === to) {
    firstIdx = lastIdx = $from.index(targetDepth - 1);
  } else {
    firstIdx = parentNode.childCount;
    lastIdx = -1;
    parentNode.forEach((_child: any, childOffset: number, index: number) => {
      const childStart = contentStart + childOffset;
      const childEnd = childStart + _child.nodeSize;
      if (childEnd > from && childStart < to) {
        if (index < firstIdx) firstIdx = index;
        if (index > lastIdx) lastIdx = index;
      }
    });
    if (lastIdx === -1) {
      firstIdx = lastIdx = $from.index(targetDepth - 1);
    }
  }

  const siblingIndex = direction === 'up' ? firstIdx - 1 : lastIdx + 1;

  if (siblingIndex >= 0 && siblingIndex < parentNode.childCount) {
    // Swap selected block of items with the adjacent sibling
    const siblingNode = parentNode.child(siblingIndex);
    const movingNodes: any[] = [];
    for (let i = firstIdx; i <= lastIdx; i++) movingNodes.push(parentNode.child(i));

    // Calculate the range covering all moving items
    let blockStartOffset = 0;
    parentNode.forEach((_child: any, childOffset: number, index: number) => {
      if (index === firstIdx) blockStartOffset = childOffset;
    });
    const blockStart = contentStart + blockStartOffset;
    let blockEndOffset = 0;
    parentNode.forEach((_child: any, childOffset: number, index: number) => {
      if (index === lastIdx) blockEndOffset = childOffset + _child.nodeSize;
    });
    const blockEnd = contentStart + blockEndOffset;

    const blockSize = blockEnd - blockStart;
    const tr = state.tr;
    const allNodes = [...movingNodes];
    let newBlockStart: number;
    if (direction === 'up') {
      const siblingStart = blockStart - siblingNode.nodeSize;
      tr.replaceWith(siblingStart, blockEnd, Fragment.from([...allNodes, siblingNode]));
      newBlockStart = siblingStart;
    } else {
      const siblingEnd = blockEnd + siblingNode.nodeSize;
      tr.replaceWith(blockStart, siblingEnd, Fragment.from([siblingNode, ...allNodes]));
      newBlockStart = blockStart + siblingNode.nodeSize;
    }
    if (wasCollapsed) {
      tr.setSelection(TextSelection.create(tr.doc, newBlockStart + (from - blockStart)));
    } else {
      const $selFrom = tr.doc.resolve(newBlockStart + 1);
      const $selTo = tr.doc.resolve(newBlockStart + blockSize - 1);
      tr.setSelection(TextSelection.between($selFrom, $selTo));
    }
    editor.view.dispatch(tr);
    return true;
  }

  // Cross-parent case: move nested list item(s) to an adjacent parent's sublist.
  if (targetDepth < 3) return false;
  const grandparent = $from.node(targetDepth - 2);
  if (grandparent.type.name !== 'listItem') return false;

  const uncleListDepth = targetDepth - 2;
  const uncleList = $from.node(uncleListDepth - 1);
  const uncleIndex = $from.index(uncleListDepth - 1);
  const targetUncleIndex = direction === 'up' ? uncleIndex - 1 : uncleIndex + 1;
  if (targetUncleIndex < 0 || targetUncleIndex >= uncleList.childCount) return false;

  const targetUncle = uncleList.child(targetUncleIndex);
  if (targetUncle.type.name !== 'listItem') return false;

  // Collect moving nodes
  const movingNodes: any[] = [];
  for (let i = firstIdx; i <= lastIdx; i++) movingNodes.push(parentNode.child(i));

  let blockStartOffset = 0;
  parentNode.forEach((_child: any, childOffset: number, index: number) => {
    if (index === firstIdx) blockStartOffset = childOffset;
  });
  const blockStart = contentStart + blockStartOffset;
  let blockEndOffset = 0;
  parentNode.forEach((_child: any, childOffset: number, index: number) => {
    if (index === lastIdx) blockEndOffset = childOffset + _child.nodeSize;
  });
  const blockEnd = contentStart + blockEndOffset;

  const blockSize = blockEnd - blockStart;
  const tr = state.tr;
  const parentListType = parentNode.type;

  // Remove the items from their current location.
  // If removing all children, delete the entire parent list to avoid
  // ProseMirror auto-filling an empty listItem (schema requires listItem+).
  const parentPos = contentStart - 1;
  if (parentNode.childCount === movingNodes.length) {
    tr.delete(parentPos, parentPos + parentNode.nodeSize);
  } else {
    tr.delete(blockStart, blockEnd);
  }

  // Resolve into the target uncle after the delete
  const $uncle = tr.doc.resolve(tr.mapping.map(
    direction === 'up'
      ? $from.before(uncleListDepth) - targetUncle.nodeSize
      : $from.after(uncleListDepth)
  ) + 1);

  let uncleItemDepth = -1;
  for (let d = $uncle.depth; d > 0; d--) {
    if ($uncle.node(d).type.name === 'listItem') {
      uncleItemDepth = d;
      break;
    }
  }
  if (uncleItemDepth === -1) return false;

  const uncleItemNode = $uncle.node(uncleItemDepth);
  const uncleItemPos = $uncle.before(uncleItemDepth);

  let existingSublist: any = null;
  let existingSublistPos = -1;
  uncleItemNode.forEach((child: any, offset: number) => {
    if (child.type === parentListType) {
      existingSublist = child;
      existingSublistPos = uncleItemPos + 1 + offset;
    }
  });

  let insertPos: number;
  const movingFragment = Fragment.from(movingNodes);
  if (existingSublist) {
    if (direction === 'up') {
      insertPos = existingSublistPos + existingSublist.nodeSize - 1;
    } else {
      insertPos = existingSublistPos + 1;
    }
    tr.insert(insertPos, movingFragment);
  } else {
    const newList = parentListType.create(null, movingFragment);
    insertPos = uncleItemPos + 1 + uncleItemNode.content.size;
    tr.insert(insertPos, newList);
    insertPos += 1;
  }

  if (wasCollapsed) {
    tr.setSelection(TextSelection.create(tr.doc, insertPos + (from - blockStart)));
  } else {
    const $selFrom = tr.doc.resolve(insertPos + 1);
    const $selTo = tr.doc.resolve(insertPos + blockSize - 1);
    tr.setSelection(TextSelection.between($selFrom, $selTo));
  }
  editor.view.dispatch(tr);
  return true;
}

const MoveBlock = Extension.create({
  name: 'moveBlock',
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-ArrowUp': ({ editor }) => moveBlock(editor, 'up'),
      'Mod-Alt-ArrowDown': ({ editor }) => moveBlock(editor, 'down'),
    };
  },
});

// Cmd+Left / Cmd+Right: the browser's native behavior moves to the start/end of
// the wrapped (visual) line. We let that first press happen, then -- once the
// cursor already sits at the wrapped-line boundary -- a second press jumps to
// the start/end of the whole paragraph or list item. Shift extends at each
// stage, so Cmd+Shift+Left twice selects the entire (multi-line) item.
function lineThenBlockBoundary(editor: any, dir: 'left' | 'right', extend: boolean): boolean {
  // On non-Mac, Ctrl+Arrow means word movement, not line -- leave it native.
  const isMac = typeof window !== 'undefined' && window.mde?.platform === 'darwin';
  if (!isMac) return false;

  const { view } = editor;
  const { state } = view;

  // Read the live caret from the DOM. ProseMirror's state.selection can lag a
  // native (browser-handled) cursor motion within a rapid keypress sequence, so
  // on the second press its state would still report the pre-move position.
  const domSel = view.dom.ownerDocument.getSelection();
  if (!domSel || !domSel.focusNode || !view.dom.contains(domSel.focusNode)) return false;
  let pos: number, anchor: number;
  try {
    pos = view.posAtDOM(domSel.focusNode, domSel.focusOffset);
    anchor = view.posAtDOM(domSel.anchorNode, domSel.anchorOffset);
  } catch {
    return false;
  }

  const $head = state.doc.resolve(pos);
  if (!$head.parent.isTextblock) return false;

  const blockStart = $head.start();
  const blockEnd = $head.end();
  const boundary = dir === 'left' ? blockStart : blockEnd;
  if (pos === boundary) return false; // already at the block boundary
  // Going right needs a character to the left to measure the current line.
  if (dir === 'right' && pos <= blockStart) return false;

  // Detect whether the cursor already sits at the wrapped-line boundary by
  // measuring the adjacent characters: at a soft wrap the char on one side
  // lands on a different visual line than the cursor's own line. (Comparing
  // coordsAtPos side -1 vs +1 at the same position is unreliable around the
  // space at a wrap point, so we measure the neighbouring positions instead.)
  let atWrapBoundary = false;
  try {
    if (dir === 'left') {
      const cursorLine = view.coordsAtPos(pos);      // char to the right -- cursor's line
      const prevChar = view.coordsAtPos(pos - 1);    // char to the left
      atWrapBoundary = prevChar.bottom <= cursorLine.top + 1;
    } else {
      const cursorLine = view.coordsAtPos(pos - 1);  // char to the left -- cursor's line
      const nextChar = view.coordsAtPos(pos);        // char to the right
      atWrapBoundary = nextChar.top >= cursorLine.bottom - 1;
    }
  } catch {
    atWrapBoundary = false;
  }
  if (!atWrapBoundary) return false;

  const tr = state.tr;
  if (extend) {
    tr.setSelection(TextSelection.create(state.doc, anchor, boundary));
  } else {
    tr.setSelection(TextSelection.create(state.doc, boundary));
  }
  view.dispatch(tr.scrollIntoView());
  return true;
}

const LineBoundaryNav = Extension.create({
  name: 'lineBoundaryNav',
  addKeyboardShortcuts() {
    return {
      'Mod-ArrowLeft': ({ editor }) => lineThenBlockBoundary(editor, 'left', false),
      'Mod-ArrowRight': ({ editor }) => lineThenBlockBoundary(editor, 'right', false),
      'Mod-Shift-ArrowLeft': ({ editor }) => lineThenBlockBoundary(editor, 'left', true),
      'Mod-Shift-ArrowRight': ({ editor }) => lineThenBlockBoundary(editor, 'right', true),
    };
  },
});

const JoinAdjacentLists = Extension.create({
  name: 'joinAdjacentLists',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('joinAdjacentLists'),
        appendTransaction(_transactions, _oldState, newState) {
          const joinPoints: number[] = [];
          newState.doc.descendants((node, pos) => {
            if (node.type.name === 'bulletList' || node.type.name === 'orderedList') {
              const end = pos + node.nodeSize;
              const $end = newState.doc.resolve(end);
              if ($end.nodeAfter && $end.nodeAfter.type === node.type) {
                joinPoints.push(end);
              }
            }
          });
          if (!joinPoints.length) return null;
          const tr = newState.tr;
          for (let i = joinPoints.length - 1; i >= 0; i--) {
            tr.join(joinPoints[i]);
          }
          return tr;
        },
      }),
    ];
  },
});

// Dirty tracking compares this, not the raw doc JSON: `folded` is view state stored on
// the node, so folding must not make a clean buffer look edited (nor an edited one clean).
export function docSignature(doc: any): string {
  return JSON.stringify(doc.toJSON(), (key, value) => (key === 'folded' ? undefined : value));
}

export const foldKey = new PluginKey('codeFolding');
// Tags every transaction that changes a `folded` attribute. Two consumers care: the
// fold-state persistence hook in this file, and the dirty-tracking baseline (a fold
// must never mark a clean buffer dirty, nor a dirty buffer clean).
export const FOLD_CHANGE = 'foldChange';
const SET_FOLD_HOVER = 'setFoldHover';

// Platform-aware modifier label for shortcut hints in tooltips.
const MOD_LABEL = (typeof window !== 'undefined' && window.mde?.platform === 'darwin') ? 'Cmd' : 'Ctrl';

function listItemHasSublist(node: any): boolean {
  return node.childCount > 1 &&
    (node.lastChild.type.name === 'bulletList' || node.lastChild.type.name === 'orderedList');
}

// The span of top-level blocks a folded heading hides: everything after it up to the
// next heading of the same or larger rank (## stops at ## and #, not at ###). Returns
// null when the heading has nothing under it -- i.e. it isn't foldable.
function headingFoldRange(doc: any, pos: number): { from: number; to: number } | null {
  const heading = doc.nodeAt(pos);
  if (!heading || heading.type.name !== 'heading') return null;
  const $pos = doc.resolve(pos);
  if ($pos.depth !== 0) return null; // only top-level headings fold
  const level = heading.attrs.level;
  const from = pos + heading.nodeSize;
  let to = from;
  for (let i = $pos.index(0) + 1; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name === 'heading' && child.attrs.level <= level) break;
    to += child.nodeSize;
  }
  return to > from ? { from, to } : null;
}

// A node is foldable only while it actually has something to hide. Deleting a folded
// item's sublist (or the content under a folded heading) makes its `folded` attr stale;
// the plugin's appendTransaction clears those.
function isFoldable(doc: any, node: any, pos: number): boolean {
  if (node.type.name === 'listItem') return listItemHasSublist(node);
  if (node.type.name === 'heading') return headingFoldRange(doc, pos) !== null;
  return false;
}

// The document span a folded node hides -- its sublist, or the blocks under a heading.
// The node's own first line (the one that stays visible) is never part of it.
function hiddenRange(doc: any, node: any, pos: number): { from: number; to: number } | null {
  if (node.type.name === 'heading') return headingFoldRange(doc, pos);
  if (node.type.name === 'listItem' && listItemHasSublist(node)) {
    return { from: pos + 1 + (node.firstChild?.nodeSize ?? 0), to: pos + node.nodeSize };
  }
  return null;
}

// Whether a fold over `range` would hide where the user is: either end of a text selection,
// or a selected node. A selection that merely SPANS the range has both ends visible, so the
// fold stays -- and copying it still carries the hidden content, since the clipboard is
// serialized from the document, not the DOM.
function selectionHiddenBy(selection: any, range: { from: number; to: number }): boolean {
  if (selection instanceof NodeSelection) return selection.from >= range.from && selection.to <= range.to;
  const inside = (pos: number) => pos > range.from && pos < range.to;
  return inside(selection.anchor) || inside(selection.head);
}

// Fold flags live ON the nodes (a `folded` attribute), not in a plugin-held Set of
// document positions. Positions are only meaningful for the doc that produced them:
// moving a list item (Cmd+Alt+Up) or splitting one (Enter at the start of a folded item)
// rewrites the surrounding range, and a mapped position then points at whatever node
// happens to sit there -- which is how a folded item silently unfolded and its "..."
// badge reappeared on an unrelated sibling. An attribute travels with its node through
// every transform. This walk just re-derives the position cache the decorations use.
function collectFolded(doc: any): Set<number> {
  const folded = new Set<number>();
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'heading') {
      if (node.attrs.folded) folded.add(pos);
      return false;
    }
    if (node.type.name === 'listItem') {
      if (node.attrs.folded) folded.add(pos);
      return true;
    }
    return !node.isTextblock; // no fold flags live inside inline content
  });
  return folded;
}

// Set (or flip) the fold flag on one node. Not added to history: folding is a view
// concern, so undo should step through the user's edits, not their folds.
function setFolded(view: any, pos: number, folded: boolean): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node) return false;
  const tr = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, folded });
  if (folded) {
    // Never leave the cursor inside content we just hid -- ProseMirror can't put a
    // selection in a display:none block. (Reachable via the caret, which folds whatever
    // is under the pointer without moving the cursor first.) Park it on the folded line.
    const isHeading = node.type.name === 'heading';
    const hidden = hiddenRange(view.state.doc, node, pos);
    if (hidden && selectionHiddenBy(view.state.selection, hidden)) {
      const line = isHeading ? node : node.firstChild;
      const end = pos + (isHeading ? 1 : 2) + (line?.content.size ?? 0);
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(end, tr.doc.content.size))));
    }
  }
  tr.setMeta(FOLD_CHANGE, true);
  tr.setMeta('addToHistory', false);
  view.dispatch(tr);
  return true;
}

function toggleFold(view: any, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  return node ? setFolded(view, pos, !node.attrs.folded) : false;
}

// Positions of every currently folded node -- the shape App.tsx persists.
export function getFoldedPositions(editor: any): Set<number> {
  const fold = foldKey.getState(editor.state);
  return fold ? fold.collapsed : new Set<number>();
}

// Restore a persisted fold set after a file load or external reload.
export function applyFoldPositions(editor: any, positions: number[]): void {
  if (!positions.length) return;
  const { tr } = editor.state;
  for (const pos of positions) {
    const node = tr.doc.nodeAt(pos);
    if (node && isFoldable(tr.doc, node, pos)) {
      tr.setNodeMarkup(pos, undefined, { ...node.attrs, folded: true });
    }
  }
  if (!tr.steps.length) return;
  tr.setMeta(FOLD_CHANGE, true);
  tr.setMeta('addToHistory', false);
  editor.view.dispatch(tr);
}

// Fold state persistence uses markdown line numbers to identify folded items.
// Currently line-number-only: if a file is edited externally and line numbers
// shift, fold state is lost. If this proves too fragile, we can add a djb2
// hash of each folded line's text prefix as a 2nd-pass fallback to re-match
// folds even when line numbers have drifted.

// Strip markdown inline formatting so we can compare plain text content
// against markdown source lines regardless of bold, italic, code, etc.
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold**
    .replace(/__(.+?)__/g, '$1')        // __bold__
    .replace(/\*(.+?)\*/g, '$1')        // *italic*
    .replace(/_(.+?)_/g, '$1')          // _italic_
    .replace(/~~(.+?)~~/g, '$1')        // ~~strike~~
    .replace(/==(?:\{[a-z]+\})?(.+?)==/g, '$1') // ==highlight== / =={blue}highlight==
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link](url)
    .replace(/(?<!\\)\[([^[\]]*)\]\{[a-z]+\}/g, '$1') // [text]{red}, after links so either may nest
    .replace(/\\(.)/g, '$1')            // backslash escapes (\> \\ \( etc.)
    .trim();
}

type FoldTarget = { kind: 'listItem' | 'heading'; text: string };

const LIST_MARKER_RE = /^([ \t]*)([-*+]|\d+[.)]) /;
const HEADING_MARKER_RE = /^(#{1,6}) +/;
const TASK_MARKER_RE = /^\[[ xX]\] +/;

// What a markdown source line contributes to fold matching, or null when the line is
// neither a heading nor a list item. The task checkbox is part of the marker, not the
// text -- the editor node's textContent doesn't include it.
function foldableLineTarget(line: string): FoldTarget | null {
  const h = line.match(HEADING_MARKER_RE);
  if (h) return { kind: 'heading', text: stripInlineMarkdown(line.slice(h[0].length)) };
  const m = line.match(LIST_MARKER_RE);
  if (m) return { kind: 'listItem', text: stripInlineMarkdown(line.slice(m[0].length).replace(TASK_MARKER_RE, '')) };
  return null;
}

// The same identity, read off a document node.
function foldableNodeTarget(node: any): FoldTarget | null {
  if (node.type.name === 'heading') return { kind: 'heading', text: node.textContent.trim() };
  if (node.type.name === 'listItem') {
    const para = node.firstChild;
    return para ? { kind: 'listItem', text: para.textContent.trim() } : null;
  }
  return null;
}

// Convert folded doc positions to markdown line numbers by serializing
// the document and matching each folded node's text to its line.
// Compares plain text (formatting stripped) so bold/italic/etc. don't break matching.
export function foldPosToLineNumbers(editor: any, positions: Set<number>): number[] {
  if (!positions.size) return [];
  const md: string = editor.storage.markdown.getMarkdown();
  const lines = md.split('\n');
  const lineNumbers: number[] = [];

  for (const pos of positions) {
    const node = editor.state.doc.nodeAt(pos);
    const target = node ? foldableNodeTarget(node) : null;
    if (!target) continue;

    for (let i = 0; i < lines.length; i++) {
      if (lineNumbers.includes(i + 1)) continue;
      const line = foldableLineTarget(lines[i]);
      if (line && line.kind === target.kind && line.text === target.text) {
        lineNumbers.push(i + 1); // 1-based
        break;
      }
    }
  }
  return lineNumbers;
}

// Convert persisted markdown line numbers back to doc positions on load.
// Walks the markdown to find the foldable line at each number, then matches it
// to a node in the parsed document by kind + text content.
// Compares plain text (formatting stripped) so bold/italic/etc. don't break matching.
export function lineNumbersToFoldPositions(doc: any, markdown: string, lineNumbers: number[]): number[] {
  if (!lineNumbers.length) return [];
  const lines = markdown.split('\n');
  const targets: FoldTarget[] = [];

  for (const ln of lineNumbers) {
    const target = foldableLineTarget(lines[ln - 1] ?? ''); // 1-based to 0-based
    if (target) targets.push(target);
  }
  if (!targets.length) return [];

  const positions: number[] = [];
  const used = new Set<number>();
  const match = (node: any, pos: number) => {
    if (!isFoldable(doc, node, pos)) return;
    const cand = foldableNodeTarget(node);
    if (!cand) return;
    const idx = targets.findIndex((t, i) => !used.has(i) && t.kind === cand.kind && t.text === cand.text);
    if (idx >= 0) {
      used.add(idx);
      positions.push(pos);
    }
  };

  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'heading') {
      match(node, pos);
      return false;
    }
    if (node.type.name === 'listItem') {
      match(node, pos);
      return true;
    }
    return !node.isTextblock;
  });
  return positions;
}

// Whether a node is folded is stored ON the node. `rendered: false` keeps it out of the
// DOM and the HTML round-trip entirely -- it's editor state, not document content, so it
// never reaches the clipboard or a saved file. `keepOnSplit` stays at its default (true):
// splitting a folded item hands the flag to the half that KEEPS the sublist (the lower
// one), and the appendTransaction below clears it from the empty half that no longer has
// anything to hide. That's what makes Enter at the start of a folded item leave the fold
// intact instead of moving the "..." badge onto a new empty sibling.
const FoldAttribute = Extension.create({
  name: 'foldAttribute',
  addGlobalAttributes() {
    return [{
      types: ['listItem', 'heading'],
      attributes: { folded: { default: false, rendered: false } },
    }];
  },
});

// The position of the foldable node the cursor sits in: the innermost list item whose
// own paragraph holds the cursor, or the heading it's inside. Null when neither.
function foldTargetAtCursor(state: any): number | null {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) {
    if ($from.node(d).type.name !== 'listItem') continue;
    // Only the item the cursor is directly in -- not an ancestor whose child list it's in.
    if ($from.depth !== d + 1 || $from.parent.type.name !== 'paragraph') return null;
    return $from.before(d);
  }
  if ($from.parent.type.name === 'heading') return $from.before($from.depth);
  return null;
}

const CodeFolding = Extension.create({
  name: 'codeFolding',
  addKeyboardShortcuts() {
    return {
      'Mod-.': ({ editor }) => {
        const pos = foldTargetAtCursor(editor.state);
        if (pos === null) return false;
        const node = editor.state.doc.nodeAt(pos);
        // Consume the keystroke even when there's nothing to fold, so it never
        // propagates to the browser from inside a childless item or a bare heading.
        if (!node || !isFoldable(editor.state.doc, node, pos)) return true;
        toggleFold(editor.view, pos);
        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: foldKey,
        state: {
          init(_config, state) { return { collapsed: collectFolded(state.doc), hover: null as number | null }; },
          apply(tr, value) {
            // Hover position for the click-to-fold caret. Doesn't touch fold state.
            const hoverMeta = tr.getMeta(SET_FOLD_HOVER) as number | null | undefined;
            if (!tr.docChanged) {
              if (hoverMeta === undefined || hoverMeta === value.hover) return value;
              return { ...value, hover: hoverMeta };
            }
            // The doc changed, so the fold flags -- which live on the nodes -- are the
            // only truth about what's folded. Re-read them instead of mapping positions.
            // The hover caret's coordinates are stale after an edit, so it's dropped.
            return { collapsed: collectFolded(tr.doc), hover: hoverMeta ?? null };
          },
        },
        // Two ways a fold flag goes stale, both cleared here:
        // (1) The node stops being foldable (its sublist gets deleted, or the blocks under
        //     a heading are removed) -- no invisible fold state should linger on it.
        // (2) An end of the selection lands INSIDE the hidden range. Tab on the item below
        //     a folded one sinks it into that folded sublist, so the line the user is typing
        //     on would just disappear. Unfold instead: whatever the cursor is in stays visible.
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some(t => t.docChanged || t.selectionSet)) return null;
          const { collapsed } = foldKey.getState(newState);
          let tr = null;
          for (const pos of collapsed) {
            const node = newState.doc.nodeAt(pos);
            if (!node) continue;
            if (isFoldable(newState.doc, node, pos)) {
              const hidden = hiddenRange(newState.doc, node, pos);
              if (!hidden || !selectionHiddenBy(newState.selection, hidden)) continue;
            }
            tr = tr || newState.tr;
            // Attribute-only markup changes preserve node size, so earlier edits in this
            // same transaction never invalidate the positions still to come.
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, folded: false });
          }
          if (!tr) return null;
          tr.setMeta(FOLD_CHANGE, true);
          tr.setMeta('addToHistory', false);
          return tr;
        },
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement;
              if (!target) return false;
              // Click on "..." badge widget
              if (target.classList.contains('fold-badge')) {
                event.preventDefault();
                const el = target.closest('.folded');
                if (el) toggleFold(view, view.posAtDOM(el, 0) - 1);
                return true;
              }
              // Click in the left padding area of a folded node (where the caret is)
              const el = target.closest('.folded');
              if (el) {
                const rect = el.getBoundingClientRect();
                if (event.clientX < rect.left) {
                  event.preventDefault();
                  toggleFold(view, view.posAtDOM(el, 0) - 1);
                  return true;
                }
              }
              return false;
            },
            // Track which foldable (not-yet-folded) node the mouse is over so we can show
            // a gray "fold this" caret to its left. Only the innermost list item under
            // the cursor is marked -- never its parents or children.
            mousemove(view, event) {
              const fold = foldKey.getState(view.state);
              // While the pointer is on the caret itself, keep it shown -- recomputing here
              // could clear the hover and detach the caret out from under a click.
              if ((event.target as HTMLElement)?.closest?.('.fold-caret')) return false;
              let pos: number | null = null;
              // Resolve the document position under the pointer's vertical position rather
              // than its DOM target. Probing by coordinates -- with the X clamped into the
              // editor -- makes the whole row a hover target, including the left gutter where
              // the caret sits. So moving the mouse onto the caret never dismisses it.
              try {
                const rect = view.dom.getBoundingClientRect();
                const probeX = Math.min(Math.max(event.clientX, rect.left + 1), rect.right - 1);
                const coords = view.posAtCoords({ left: probeX, top: event.clientY });
                if (coords) {
                  const $pos = view.state.doc.resolve(coords.pos);
                  // Only the innermost list item under the pointer -- never its parents.
                  let candidate: number | null = null;
                  for (let d = $pos.depth; d >= 1; d--) {
                    if ($pos.node(d).type.name === 'listItem') {
                      candidate = $pos.before(d);
                      break;
                    }
                  }
                  if (candidate === null && $pos.parent.type.name === 'heading') {
                    candidate = $pos.before($pos.depth);
                  }
                  if (candidate !== null && !fold.collapsed.has(candidate)) {
                    const node = view.state.doc.nodeAt(candidate);
                    if (node && isFoldable(view.state.doc, node, candidate)) pos = candidate;
                  }
                }
              } catch { /* ignore */ }
              if (pos !== fold.hover) {
                view.dispatch(view.state.tr.setMeta(SET_FOLD_HOVER, pos).setMeta('addToHistory', false));
              }
              return false;
            },
            mouseleave(view) {
              const fold = foldKey.getState(view.state);
              if (fold.hover !== null) {
                view.dispatch(view.state.tr.setMeta(SET_FOLD_HOVER, null).setMeta('addToHistory', false));
              }
              return false;
            },
          },
          decorations(state) {
            const { collapsed, hover } = foldKey.getState(state);
            const decos: Decoration[] = [];
            const badge = (at: number) => {
              decos.push(Decoration.widget(at, () => {
                const span = document.createElement('span');
                span.className = 'fold-badge';
                span.textContent = '...';
                return span;
              }, { side: 1 }));
            };
            for (const pos of collapsed) {
              const node = state.doc.nodeAt(pos);
              if (!node) continue;
              if (node.type.name === 'listItem') {
                if (!listItemHasSublist(node)) continue;
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'folded' }));
                // "..." badge at end of the first paragraph's content
                const para = node.firstChild;
                if (para) badge(pos + 1 + para.nodeSize - 1);
              } else if (node.type.name === 'heading') {
                const range = headingFoldRange(state.doc, pos);
                if (!range) continue;
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'folded' }));
                badge(pos + node.nodeSize - 1);
                // A heading's content isn't nested inside it, so hide each block after it
                // individually rather than by collapsing one wrapper.
                let at = range.from;
                while (at < range.to) {
                  const child = state.doc.nodeAt(at);
                  if (!child) break;
                  decos.push(Decoration.node(at, at + child.nodeSize, { class: 'fold-hidden' }));
                  at += child.nodeSize;
                }
              }
            }
            // Gray click-to-fold caret on the hovered (foldable, not-folded) node.
            if (hover !== null && !collapsed.has(hover)) {
              const node = state.doc.nodeAt(hover);
              if (node && isFoldable(state.doc, node, hover)) {
                const hoverPos = hover;
                const isHeading = node.type.name === 'heading';
                // A list item has the list's indent to its left to hang the caret in. A
                // top-level heading has no such gutter (it would land on the sidebar), so
                // its caret goes inline after the text -- exactly where the "..." badge
                // will appear once it's folded.
                const at = isHeading ? hoverPos + node.nodeSize - 1 : hoverPos + 1;
                decos.push(Decoration.node(hoverPos, hoverPos + node.nodeSize, { class: 'fold-hoverable' }));
                decos.push(Decoration.widget(at, (view) => {
                  const span = document.createElement('span');
                  span.className = isHeading ? 'fold-caret fold-caret-inline' : 'fold-caret';
                  span.setAttribute('data-tooltip', `Fold ${isHeading ? 'section' : 'sub-list'} (${MOD_LABEL} + .)`);
                  span.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // The resulting doc change also clears the hover, removing this caret.
                    toggleFold(view, hoverPos);
                  });
                  return span;
                }, { side: isHeading ? 1 : -1, key: `fold-caret-${hoverPos}` }));
              }
            }
            if (!decos.length) return DecorationSet.empty;
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

// Plain CodeBlock (not CodeBlockLowlight): code fences render as uniform,
// unhighlighted text -- no per-token syntax colors.
const CodeBlockWithCopy = CodeBlock.extend({
  addNodeView() {
    return ({ node, editor: _editor, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.classList.add('code-block-wrapper');

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      if (node.attrs.language) code.classList.add(`language-${node.attrs.language}`);
      pre.appendChild(code);

      const btn = document.createElement('button');
      btn.className = 'code-copy-btn';
      btn.contentEditable = 'false';
      btn.title = 'Copy code';
      btn.innerHTML = '<i class="bi bi-clipboard"></i>';
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        navigator.clipboard.writeText(code.textContent || '');
        btn.innerHTML = '<i class="bi bi-check-lg"></i>';
        setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 1500);
      });

      wrapper.appendChild(btn);
      wrapper.appendChild(pre);

      return { dom: wrapper, contentDOM: code };
    };
  },
});

interface EditorProps {
  tab: Tab;
  onReady: (editor: TipTapEditor) => void;
  onDestroy: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onLinkClick: (href: string) => void;
  onToast: (msg: string, variant?: string) => void;
}

// The editor's full extension list. Also used headlessly by utils/exportDocument.ts, so an
// exported file parses exactly the way it opens.
export function buildExtensions() {
  return [
    StarterKit.configure({
      codeBlock: false,
      code: false,
      text: false,
      listItem: false,
      // StarterKit bundles its own Link extension (autolink + paste rules on
      // by default). Disable it so the configured Link below is the only one.
      link: false,
    }),
    TextNode,
    // Stock inline code excludes EVERY other mark, so highlighting a phrase skipped its code
    // and a loaded `==a `x` b==` lost the highlight on `x`. Color marks may wrap code;
    // Markdown can express that, since code is always the innermost mark.
    Code.extend({ excludes: 'bold italic strike underline link' }),
    ColorHighlight,
    TextColor,
    ImageNode,
    Link.extend({
      // The Link extension's paste rule runs linkifyjs over pasted text and
      // marks anything URL-shaped as a link, regardless of the autolink /
      // linkOnPaste options (those only gate the editor plugins). Disable it
      // so pasting "docs/foo/09-bar.md" stays literal text.
      addPasteRules() {
        return [];
      },
    }).configure({
      openOnClick: false,
      // Don't turn plain text into links. Pasting or typing something like
      // "docs/foo/09-bar.md" should stay literal text, not become a link.
      // Real Markdown links ([text](url)) are still parsed on load.
      autolink: false,
      linkOnPaste: false,
      // TipTap's default isAllowedUri regex contains `[^a-z+.-:]`, where
      // `.-:` is (almost certainly unintentionally) a character RANGE
      // covering `/`. That makes it reject relative links that start with a
      // lowercase letter and contain a slash (e.g. "docs/foo/09-bar.md"):
      // the link mark is dropped while parsing HTML on load, so the link
      // collapses to plain text on the next save. Accept a URL if the
      // default validator passes OR if it has no scheme at all (a relative
      // path) -- dangerous schemes like javascript:/data: still carry a
      // scheme prefix and remain blocked by the default validator.
      isAllowedUri: (url, ctx) => ctx.defaultValidate(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url),
    }),
    TableKit.configure({ table: false }),
    MarkdownTable.configure({ resizable: true }),
    CodeBlockWithCopy,
    UnifiedListItem,
    ListItemBackspace,
    CmdEnterCycle,
    TabHandler,
    BacktickWrap,
    LeadingParagraph,
    PlainTextPaste,
    MoveBlock,
    LineBoundaryNav,
    JoinAdjacentLists,
    FoldAttribute,
    CodeFolding,
    Placeholder.configure({
      placeholder: 'Start writing...',
    }),
    SmartClipboard,
    MarkdownExt.configure({
      html: false,
      breaks: true,
      transformCopiedText: false,
      transformPastedText: true,
    }),
  ];
}

export default function Editor({
  tab, onReady, onDestroy, onDirtyChange, onLinkClick, onToast,
}: EditorProps) {
  const loadedRef = useRef(false);
  const cleanDocRef = useRef<string | null>(null);
  // Keep the latest onLinkClick reachable from the ProseMirror handleClick closure,
  // which is created once when the editor is initialized.
  const onLinkClickRef = useRef(onLinkClick);
  onLinkClickRef.current = onLinkClick;
  // Lets the handlePaste editorProp reach the tiptap-markdown parser without a
  // use-before-define reference to the `editor` const being created below.
  const editorRef = useRef<TipTapEditor | null>(null);
  // A paste or drop with images waits here for PasteImagesDialog. Reached from the editorProps via the ref.
  const [pendingPaste, setPendingPaste] = useState<PendingPaste | null>(null);
  const setPendingPasteRef = useRef(setPendingPaste);

  // `extensions` and `editorProps` MUST keep a stable identity across renders.
  // useEditor runs an effect on EVERY render that diffs the options it was given
  // against the live editor's options (ignoring only the on* callbacks); a fresh
  // array/object literal always compares unequal, so it would call
  // editor.setOptions() -> view.setProps() + view.updateState() on every single
  // render. Besides being wasted work per keystroke, that re-syncs the DOM
  // selection from React's commit phase, which can be read back by ProseMirror's
  // DOM observer as a change and dispatched as a transaction -- transaction ->
  // React render -> setOptions -> transaction ... until React aborts the render
  // loop with "Maximum update depth exceeded" (error #185).
  // Everything referenced below is module-level or a ref, so [] deps are correct.
  const extensions = useMemo(buildExtensions, []);

  const editorProps = useMemo<PMEditorProps>(() => ({
      // Obsidian (and most editors) put BOTH text/plain and text/html on the
      // clipboard. ProseMirror's rule is `asText = text && (plainText || inCode ||
      // !html)`, so whenever HTML is present it takes the HTML path and NEVER runs
      // transformPastedText (our dedent). That path mis-parses an indented Obsidian
      // list sub-tree as a code block, and turns "- 1. x" bullets into empty-bullet
      // + ordered-sublist noise. Intercept genuine markdown-list pastes here and run
      // them through the SAME pipeline MDE uses to load a file, so a pasted list is
      // structurally identical to a loaded one. Everything else (prose, code blocks,
      // Word tables via text/html) falls through to the default path untouched.
      handlePaste(view, event) {
        const cd = (event as ClipboardEvent).clipboardData;
        if (!cd) return false;
        // Shift-paste (plain) and pasting into a code block stay verbatim.
        if ((view as any).input?.shiftKey) return false;
        if (view.state.selection.$from.parent.type.spec.code) return false;
        const withImages = pasteNeedingImageChoice(cd);
        if (withImages) {
          setPendingPasteRef.current(withImages);
          return true;
        }
        const raw = cd.getData('text/plain');
        if (!raw) return false;
        const dedented = dedentPastedText(raw);
        const firstNonBlank = dedented.split('\n').find((l) => l.trim().length > 0);
        // Only hijack pastes that are actually a markdown list.
        if (!firstNonBlank || !/^[ \t]*([-*+]|\d+[.)])\s/.test(firstNonBlank)) return false;

        const md = escapeBulletNumbers(dedented);
        const html = markdownToHtml(editorRef.current!, md);
        const container = document.createElement('div');
        container.innerHTML = html;
        // preserveWhitespace must be FALSE (matching the file-load path): markdown-it
        // leaves a "\n" between an item's text and its nested <ul> (e.g. "<li>Questions\n
        // <ul>..."). preserveWhitespace:true would keep that newline as a trailing
        // soft-break in the paragraph -- a visible blank line before every child list
        // that vanishes on serialize (why it disappears when you copy back out).
        const slice = PMDOMParser.fromSchema(view.state.schema).parseSlice(container, {
          preserveWhitespace: false,
          context: view.state.selection.$from,
        });
        // replaceSelection with a context-parsed (open) slice merges the pasted list
        // into the current list when the cursor is already inside one.
        view.dispatch(
          view.state.tr.replaceSelection(slice).scrollIntoView().setMeta('paste', true).setMeta('uiEvent', 'paste'),
        );
        return true;
      },
      // Dropped image files, and a web page's images dragged in, take the same dialog as a paste.
      // The caret moves to the drop point first, so the paste path inserts them there.
      handleDrop(view, event, _slice, moved) {
        const dt = (event as DragEvent).dataTransfer;
        if (moved || !view.editable || !dt) return false;
        const withImages = pasteNeedingImageChoice(dt);
        if (!withImages) return false;
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!at) return false;
        const $at = view.state.doc.resolve(at.pos);
        if ($at.parent.type.spec.code) return false;
        imageDropsHandled.add(event);
        view.dispatch(view.state.tr.setSelection(TextSelection.near($at)));
        setPendingPasteRef.current(withImages);
        return true;
      },
      handleClick(view, pos, event) {
        // Cmd/Ctrl+click follows a link: opens a relative file in a new tab (App
        // handles existence checks / create prompts) or an external URL in the browser.
        // A plain click falls through so the cursor can be placed inside link text.
        if (!event.metaKey && !event.ctrlKey) return false;
        const target = event.target as HTMLElement;
        const anchor = target.closest('a');
        if (!anchor) return false;
        // getAttribute keeps the raw href (e.g. "../docs/foo.md"); the .href property
        // would resolve it to an absolute file:// URL.
        const href = anchor.getAttribute('href');
        if (!href) return false;
        event.preventDefault();
        const headingPos = href.startsWith('#') ? findHeadingByAnchor(view.state.doc, href.slice(1)) : null;
        if (headingPos !== null) {
          // Selecting the heading also releases any fold hiding it (see the fold plugin),
          // which must happen before scrolling: a display:none block has no position.
          // No tr.scrollIntoView() -- that would jump instantly instead of animating.
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPos + 1)));
          (view.nodeDOM(headingPos) as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' });
          return true;
        }
        onLinkClickRef.current(href);
        return true;
      },
      handleTripleClickOn(view, pos, node, nodePos) {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          const from = nodePos + 1;
          const to = nodePos + 1 + node.content.size;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
          return true;
        }
        return false;
      },
      // Runs before tiptap-markdown parses pasted plain text (and before pasting
      // into a code block). `codeOrPlain` is true when pasting into a code block or
      // via an explicit plain-text (Shift) paste -- leave those verbatim; only dedent
      // markdown that's about to be structurally parsed.
      transformPastedText(text: string, codeOrPlain: boolean): string {
        if (codeOrPlain) return text;
        return dedentPastedText(text);
      },
      transformPastedHTML(html: string): string {
        const div = document.createElement('div');
        div.innerHTML = html;
        div.querySelectorAll('li').forEach((li: HTMLElement) => {
          const input = li.querySelector('input[type="checkbox"]');
          if (input) {
            const isChecked = (input as HTMLInputElement).checked;
            li.setAttribute('data-checked', isChecked ? 'true' : 'false');
            input.remove();
            li.classList.remove('task-list-item');
          }
        });
        div.querySelectorAll('ul, ol').forEach((list: HTMLElement) => {
          list.classList.remove('contains-task-list');
          list.removeAttribute('data-type');
        });
        return div.innerHTML;
      },
  }), []);

  const editor = useEditor({
    extensions,
    editorProps,
    onTransaction: ({ transaction: t, editor: e }) => {
      // A fold changes the document (the flag is a node attribute) but not the FILE, so it
      // must never re-baseline the clean snapshot -- doing so would mark a buffer with
      // unsaved edits as clean. docSignature ignores the flag, so nothing needs re-reading.
      if (loadedRef.current && t.getMeta('addToHistory') === false && t.docChanged && !t.getMeta(FOLD_CHANGE)) {
        cleanDocRef.current = docSignature(e.state.doc);
      }
      // Persist fold state when it changes
      if (t.getMeta(FOLD_CHANGE) && tab.filePath) {
        window.mde.setFoldState(tab.filePath, foldPosToLineNumbers(e, getFoldedPositions(e)));
      }
    },
    onUpdate: ({ editor: e }) => {
      if (loadedRef.current) {
        onDirtyChange(docSignature(e.state.doc) !== cleanDocRef.current);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    editorRef.current = editor;
    onReady(editor);
    return () => onDestroy();
  }, [editor]);


  const prevDirtyRef = useRef(tab.dirty);
  useEffect(() => {
    if (prevDirtyRef.current && !tab.dirty && editor) {
      cleanDocRef.current = docSignature(editor.state.doc);
    }
    prevDirtyRef.current = tab.dirty;
  }, [tab.dirty, editor]);

  useEffect(() => {
    if (!editor || loadedRef.current) return;
    if (tab.readOnly) editor.setEditable(false);
  }, [editor, tab.readOnly]);

  // Image node views resolve relative paths against this as they are created, and pasted images
  // are saved beside it. Declared before the load effect so it is set before the first load.
  useEffect(() => {
    if (editor) (editor.storage as any).image.baseDir = tab.filePath ? dirname(tab.filePath) : null;
  }, [editor, tab.filePath]);

  // The toolbar's Insert Image button: pick files, then the same dialog as a paste.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onInsert = async () => {
      const files = await window.mde.pickImages((editor.storage as any).image.baseDir);
      if (files.length) setPendingPaste({ kind: 'files', files });
    };
    dom.addEventListener(INSERT_IMAGE_EVENT, onInsert);
    return () => dom.removeEventListener(INSERT_IMAGE_EVENT, onInsert);
  }, [editor]);

  useEffect(() => {
    if (!editor || loadedRef.current) return;

    if (tab.initialContent) {
      const html = markdownToHtml(editor, tab.initialContent);
      const doc = createNodeFromContent(html, editor.schema, { slice: false });
      const { tr } = editor.state;
      tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection(0);
      cleanDocRef.current = docSignature(editor.state.doc);
      loadedRef.current = true;
      return;
    }

    if (!tab.filePath) return;

    window.mde.readFile(tab.filePath).then(async content => {
      const html = markdownToHtml(editor, content);
      const doc = createNodeFromContent(html, editor.schema, { slice: false });
      const { tr } = editor.state;
      tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection(0);
      cleanDocRef.current = docSignature(editor.state.doc);
      loadedRef.current = true;

      // Restore persisted fold state (line numbers -> doc positions)
      const savedLines = await window.mde.getFoldState(tab.filePath!);
      if (savedLines.length) {
        applyFoldPositions(editor, lineNumbersToFoldPositions(editor.state.doc, content, savedLines));
      }
    });
  }, [editor, tab.filePath]);

  if (!editor) return null;

  const docDir: string | null = (editor.storage as any).image.baseDir;

  const cancelPaste = () => {
    setPendingPaste(null);
    editor.commands.focus();
  };

  const finishPaste = async (choice: WebImageChoice, folder: string) => {
    const pending = pendingPaste!;
    setPendingPaste(null);
    editor.commands.focus();
    try {
      if (pending.kind === 'files') {
        const paths = await saveImageFiles(pending.files, docDir!, folder);
        editor.chain().focus().insertContent(paths.map((src) => ({ type: 'image', attrs: { src, alt: '' } }))).run();
      } else {
        const { html, failed } = await resolveWebPaste(pending.html, choice, docDir, folder);
        editor.view.pasteHTML(html);
        if (failed) onToast(`${failed} image${failed === 1 ? '' : 's'} could not be saved; any from the web stayed as links.`, 'danger');
      }
    } catch (err) {
      onToast(`Could not save the image: ${err instanceof Error ? err.message : String(err)}`, 'danger');
    }
  };

  return (
    <div className="editor-wrapper">
      <EditorContent editor={editor} className={`editor-content ${tab.readOnly ? 'editor-readonly' : ''}`} />
      {!tab.readOnly && <LinkPreview editor={editor} />}
      {!tab.readOnly && <TableMenu editor={editor} />}
      <ImageContextMenu editor={editor} />
      {pendingPaste && <PasteImagesDialog pending={pendingPaste} canSave={docDir !== null} onChoose={finishPaste} onCancel={cancelPaste} />}
    </div>
  );
}

function LinkPreview({ editor }: { editor: TipTapEditor }) {
  const [link, setLink] = useState<{ url: string; top: number; left: number } | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // After render, shift the preview left if it would overflow the editor's
  // right edge, so the URL and the remove-link button stay on screen.
  useLayoutEffect(() => {
    const el = previewRef.current;
    if (!el || !link) return;
    const wrapper = editor.view.dom.closest('.editor-wrapper');
    if (!wrapper) return;
    const wrapperWidth = wrapper.getBoundingClientRect().width;
    const elWidth = el.offsetWidth;
    const maxLeft = wrapperWidth - elWidth - 8;
    el.style.left = `${Math.max(8, Math.min(link.left, maxLeft))}px`;
  }, [link, editor]);

  const update = useCallback(() => {
    if (!editor.isActive('link')) {
      setLink(null);
      return;
    }
    const href = editor.getAttributes('link').href;
    if (!href) { setLink(null); return; }

    const { $from } = editor.state.selection;
    const linkMark = $from.marks().find(m => m.type.name === 'link');
    if (!linkMark) { setLink(null); return; }

    let linkStart = $from.pos;
    const parent = $from.parent;
    const parentOffset = $from.start();
    parent.forEach((child, offset) => {
      const childStart = parentOffset + offset;
      const childEnd = childStart + child.nodeSize;
      if (child.marks.some(m => m.eq(linkMark)) && childStart <= $from.pos && childEnd >= $from.pos) {
        linkStart = childStart;
      }
    });

    const coords = editor.view.coordsAtPos(linkStart);
    const wrapper = editor.view.dom.closest('.editor-wrapper');
    if (!wrapper) { setLink(null); return; }
    const rect = wrapper.getBoundingClientRect();
    setLink({
      url: href,
      top: coords.bottom - rect.top + 4,
      left: coords.left - rect.left,
    });
  }, [editor]);

  useEffect(() => {
    editor.on('selectionUpdate', update);
    editor.on('transaction', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('transaction', update);
    };
  }, [editor, update]);

  if (!link) return null;

  return (
    <div ref={previewRef} className="link-preview" style={{ top: link.top, left: link.left }}>
      <a
        href={link.url}
        onClick={(e) => {
          e.preventDefault();
          window.mde.openExternal(link.url);
        }}
      >
        {link.url}
      </a>
      <button
        className="link-preview-unlink"
        title="Remove link"
        onMouseDown={(e) => {
          e.preventDefault();
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
        }}
      >
        ✕
      </button>
    </div>
  );
}

