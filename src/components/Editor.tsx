import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent, Editor as TipTapEditor, createNodeFromContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { ListItem } from '@tiptap/extension-list';
import taskListPlugin from 'markdown-it-task-lists';
import { common, createLowlight } from 'lowlight';
import { Markdown as MarkdownExt } from 'tiptap-markdown';
import Text from '@tiptap/extension-text';
import { Extension, InputRule, mergeAttributes } from '@tiptap/core';
import { TextSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment } from '@tiptap/pm/model';
import { Tab } from '../types';
import { splitLooseLists, cleanParsedListHtml } from '../utils/markdown';
import TableMenu from './TableMenu';

// Override tiptap-markdown's text serializer which blindly converts all < and >
// to &lt; &gt;, mangling prose like "Apples > oranges." on save.
// With html:false, markdown-it already treats <ol> etc. as literal text on parse,
// so we just need to output raw text without the escapeHTML step.
const TextNode = Text.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.text(node.text);
        },
        parse: {},
      },
    };
  },
});

// When copying a single list item, strip the list wrapper so the clipboard gets
// just the text, not "- text". Multi-item copies keep the list markers.
const SmartClipboard = Extension.create({
  name: 'smartClipboard',
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('smartClipboard'),
        props: {
          clipboardTextSerializer: (slice) => {
            // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
            const serializer = editor.storage.markdown.serializer;
            const { content } = slice;
            if (content.childCount === 1) {
              const child = content.firstChild!;
              if ((child.type.name === 'bulletList' || child.type.name === 'orderedList')
                  && child.childCount === 1) {
                return serializer.serialize(child.firstChild!.content).trim();
              }
            }
            return serializer.serialize(content);
          },
        },
      }),
    ];
  },
});

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
          state.renderContent(node);
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
            if (event.clientX > liRect.left + 4) return false;
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
            const para = li.firstChild!;
            const sublistStart = $from.before(liDepth) + 1 + para.nodeSize;
            const schema = state.schema;
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

        if (!editor.commands.splitListItem('listItem')) return false;
        if (isTask) {
          const { $from: $new } = editor.state.selection;
          for (let d = $new.depth; d > 0; d--) {
            if ($new.node(d).type.name === 'listItem') {
              const pos = $new.before(d);
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(pos, undefined, {
                  ...$new.node(d).attrs, checked: false,
                })
              );
              break;
            }
          }
        }
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
    const $selFrom = tr.doc.resolve(newBlockStart + 1);
    const $selTo = tr.doc.resolve(newBlockStart + blockSize - 1);
    tr.setSelection(TextSelection.between($selFrom, $selTo));
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

  const $selFrom = tr.doc.resolve(insertPos + 1);
  const $selTo = tr.doc.resolve(insertPos + blockSize - 1);
  tr.setSelection(TextSelection.between($selFrom, $selTo));
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

export const foldKey = new PluginKey('codeFolding');
const TOGGLE_FOLD = 'toggleFold';
export const RESTORE_FOLDS = 'restoreFolds';

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
    .replace(/==(.+?)==/g, '$1')        // ==highlight==
    .replace(/`(.+?)`/g, '$1')          // `code`
    .replace(/\[(.+?)\]\(.+?\)/g, '$1') // [link](url)
    .replace(/\\(.)/g, '$1')            // backslash escapes (\> \\ \( etc.)
    .trim();
}

// Convert folded doc positions to markdown line numbers by serializing
// the document and matching each folded item's text to its line.
// Compares plain text (formatting stripped) so bold/italic/etc. don't break matching.
export function foldPosToLineNumbers(editor: any, positions: Set<number>): number[] {
  if (!positions.size) return [];
  const md: string = editor.storage.markdown.getMarkdown();
  const lines = md.split('\n');
  const markerRe = /^([ \t]*)([-*+]|\d+[.)]) /;
  const lineNumbers: number[] = [];

  for (const pos of positions) {
    const node = editor.state.doc.nodeAt(pos);
    if (!node || node.type.name !== 'listItem') continue;
    const para = node.firstChild;
    if (!para) continue;
    const text = para.textContent.trim();

    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(markerRe);
      if (m) {
        const lineText = stripInlineMarkdown(lines[i].substring(m[0].length));
        if (lineText === text && !lineNumbers.includes(i + 1)) {
          lineNumbers.push(i + 1); // 1-based
          break;
        }
      }
    }
  }
  return lineNumbers;
}

// Convert persisted markdown line numbers back to doc positions on load.
// Walks the markdown to find list items at those lines, then matches them
// to listItem nodes in the parsed document by their text content.
// Compares plain text (formatting stripped) so bold/italic/etc. don't break matching.
export function lineNumbersToFoldPositions(doc: any, markdown: string, lineNumbers: number[]): number[] {
  if (!lineNumbers.length) return [];
  const lines = markdown.split('\n');
  const markerRe = /^([ \t]*)([-*+]|\d+[.)]) /;
  const targetTexts = new Set<string>();

  for (const ln of lineNumbers) {
    const line = lines[ln - 1]; // 1-based to 0-based
    if (!line) continue;
    const m = line.match(markerRe);
    if (m) {
      targetTexts.add(stripInlineMarkdown(line.substring(m[0].length)));
    }
  }

  const positions: number[] = [];
  const matched = new Set<string>();
  doc.descendants((node: any, pos: number) => {
    if (node.type.name !== 'listItem') return true;
    const hasSublist = node.childCount > 1 &&
      (node.lastChild.type.name === 'bulletList' || node.lastChild.type.name === 'orderedList');
    if (!hasSublist) return true;
    const para = node.firstChild;
    if (!para) return true;
    const text = para.textContent.trim();
    if (targetTexts.has(text) && !matched.has(text)) {
      positions.push(pos);
      matched.add(text);
    }
    return true;
  });
  return positions;
}

const CodeFolding = Extension.create({
  name: 'codeFolding',
  addKeyboardShortcuts() {
    return {
      'Mod-.': ({ editor }) => {
        const { state } = editor;
        const { $from } = state.selection;
        // Find the innermost listItem the cursor is directly in (paragraph child)
        for (let d = $from.depth; d > 0; d--) {
          const node = $from.node(d);
          if (node.type.name !== 'listItem') continue;
          // Only fold if cursor is in this item's own paragraph, not in a child list
          if ($from.depth !== d + 1 || $from.parent.type.name !== 'paragraph') break;
          const hasSublist = node.childCount > 1 &&
            (node.lastChild!.type.name === 'bulletList' || node.lastChild!.type.name === 'orderedList');
          if (!hasSublist) return true;
          const pos = $from.before(d);
          editor.view.dispatch(state.tr.setMeta(TOGGLE_FOLD, pos));
          return true;
        }
        return false;
      },
    };
  },
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: foldKey,
        state: {
          init() { return { collapsed: new Set<number>() }; },
          apply(tr, value) {
            const restorePositions = tr.getMeta(RESTORE_FOLDS) as number[] | undefined;
            if (restorePositions) {
              return { collapsed: new Set(restorePositions) };
            }
            const togglePos = tr.getMeta(TOGGLE_FOLD);
            if (togglePos !== undefined) {
              const next = new Set(value.collapsed);
              if (next.has(togglePos)) next.delete(togglePos);
              else next.add(togglePos);
              return { collapsed: next };
            }
            if (!tr.docChanged) return value;
            const next = new Set<number>();
            for (const oldPos of value.collapsed) {
              const mapped = tr.mapping.map(oldPos);
              try {
                const $pos = tr.doc.resolve(mapped);
                if ($pos.nodeAfter && $pos.nodeAfter.type.name === 'listItem') {
                  next.add(mapped);
                }
              } catch { /* position no longer valid */ }
            }
            return { collapsed: next };
          },
        },
        props: {
          handleDOMEvents: {
            mousedown(view, event) {
              const target = event.target as HTMLElement;
              if (!target) return false;
              // Click on "..." badge widget
              if (target.classList.contains('fold-badge')) {
                event.preventDefault();
                const li = target.closest('li.folded');
                if (li) {
                  const pos = view.posAtDOM(li, 0) - 1;
                  view.dispatch(view.state.tr.setMeta(TOGGLE_FOLD, pos));
                }
                return true;
              }
              // Click in left padding area of folded li (where the caret is)
              const li = target.closest('li.folded');
              if (li) {
                const liRect = li.getBoundingClientRect();
                if (event.clientX < liRect.left) {
                  event.preventDefault();
                  const pos = view.posAtDOM(li, 0) - 1;
                  view.dispatch(view.state.tr.setMeta(TOGGLE_FOLD, pos));
                  return true;
                }
              }
              return false;
            },
          },
          decorations(state) {
            const { collapsed } = foldKey.getState(state);
            if (!collapsed.size) return DecorationSet.empty;
            const decos: Decoration[] = [];
            for (const pos of collapsed) {
              try {
                const node = state.doc.nodeAt(pos);
                if (!node || node.type.name !== 'listItem') continue;
                decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'folded' }));
                // "..." badge at end of the first paragraph's content
                const para = node.firstChild;
                if (para) {
                  const badgePos = pos + 1 + para.nodeSize - 1;
                  decos.push(Decoration.widget(badgePos, () => {
                    const span = document.createElement('span');
                    span.className = 'fold-badge';
                    span.textContent = '...';
                    return span;
                  }, { side: 1 }));
                }
              } catch { /* ignore */ }
            }
            return DecorationSet.create(state.doc, decos);
          },
        },
      }),
    ];
  },
});

const lowlight = createLowlight(common);

const CodeBlockWithCopy = CodeBlockLowlight.extend({
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
}

export default function Editor({ tab, onReady, onDestroy, onDirtyChange }: EditorProps) {
  const loadedRef = useRef(false);
  const cleanDocRef = useRef<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: false,
        text: false,
        listItem: false,
      }),
      TextNode,
      Highlight,
      Link.configure({
        openOnClick: false,
      }),
      TableKit.configure({
        table: { resizable: true },
      }),
      CodeBlockWithCopy.configure({
        lowlight,
      }),
      UnifiedListItem,
      CmdEnterCycle,
      TabHandler,
      MoveBlock,
      JoinAdjacentLists,
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
    ],
    editorProps: {
      handleTripleClickOn(view, pos, node, nodePos) {
        if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
          const from = nodePos + 1;
          const to = nodePos + 1 + node.content.size;
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
          return true;
        }
        return false;
      },
    },
    onTransaction: ({ transaction: t, editor: e }) => {
      if (loadedRef.current && t.getMeta('addToHistory') === false && t.docChanged) {
        cleanDocRef.current = JSON.stringify(e.state.doc.toJSON());
      }
      // Persist fold state when it changes
      if (t.getMeta(TOGGLE_FOLD) !== undefined || t.getMeta(RESTORE_FOLDS)) {
        if (tab.filePath) {
          const { collapsed } = foldKey.getState(e.state);
          const lineNumbers = foldPosToLineNumbers(e, collapsed);
          window.mde.setFoldState(tab.filePath, lineNumbers);
        }
      }
    },
    onUpdate: ({ editor: e }) => {
      if (loadedRef.current) {
        const current = JSON.stringify(e.state.doc.toJSON());
        onDirtyChange(current !== cleanDocRef.current);
      }
    },
  });

  useEffect(() => {
    if (!editor) return;
    onReady(editor);
    return () => onDestroy();
  }, [editor]);

  const prevDirtyRef = useRef(tab.dirty);
  useEffect(() => {
    if (prevDirtyRef.current && !tab.dirty && editor) {
      cleanDocRef.current = JSON.stringify(editor.state.doc.toJSON());
    }
    prevDirtyRef.current = tab.dirty;
  }, [tab.dirty, editor]);

  useEffect(() => {
    if (!editor || loadedRef.current) return;
    if (tab.readOnly) editor.setEditable(false);
  }, [editor, tab.readOnly]);

  useEffect(() => {
    if (!editor || loadedRef.current) return;

    if (tab.initialContent) {
      // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
      const html = cleanParsedListHtml(editor.storage.markdown.parser.parse(splitLooseLists(tab.initialContent)));
      const doc = createNodeFromContent(html, editor.schema, { slice: false });
      const { tr } = editor.state;
      tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection(0);
      cleanDocRef.current = JSON.stringify(editor.state.doc.toJSON());
      loadedRef.current = true;
      return;
    }

    if (!tab.filePath) return;

    window.mde.readFile(tab.filePath).then(async content => {
      // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
      const html = cleanParsedListHtml(editor.storage.markdown.parser.parse(splitLooseLists(content)));
      const doc = createNodeFromContent(html, editor.schema, { slice: false });
      const { tr } = editor.state;
      tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection(0);
      cleanDocRef.current = JSON.stringify(editor.state.doc.toJSON());
      loadedRef.current = true;

      // Restore persisted fold state (line numbers -> doc positions)
      const savedLines = await window.mde.getFoldState(tab.filePath!);
      if (savedLines.length) {
        const positions = lineNumbersToFoldPositions(editor.state.doc, content, savedLines);
        if (positions.length) {
          const foldTr = editor.state.tr;
          foldTr.setMeta(RESTORE_FOLDS, positions);
          foldTr.setMeta('addToHistory', false);
          editor.view.dispatch(foldTr);
        }
      }
    });
  }, [editor, tab.filePath]);

  if (!editor) return null;

  return (
    <div className="editor-wrapper">
      <EditorContent editor={editor} className={`editor-content ${tab.readOnly ? 'editor-readonly' : ''}`} />
      {!tab.readOnly && <LinkPreview editor={editor} />}
      {!tab.readOnly && <TableMenu editor={editor} />}
    </div>
  );
}

function LinkPreview({ editor }: { editor: TipTapEditor }) {
  const [link, setLink] = useState<{ url: string; top: number; left: number } | null>(null);

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
    <div className="link-preview" style={{ top: link.top, left: link.left }}>
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

