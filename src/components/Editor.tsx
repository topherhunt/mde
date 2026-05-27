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
import { Fragment } from '@tiptap/pm/model';
import { Tab } from '../types';
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
        let isTask = false;
        for (let d = $from.depth; d > 0; d--) {
          if ($from.node(d).type.name === 'listItem') {
            isTask = $from.node(d).attrs.checked !== null;
            break;
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
          // Fallback: scan range for the first leaf listItem
          if (foundChecked === undefined as any) {
            const allItems: any[] = [];
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'listItem') allItems.push({ pos, node });
            });
            const leaves = allItems.filter(({ pos, node }) => {
              const end = pos + node.nodeSize;
              return !allItems.some(o => o.pos > pos && o.pos < end);
            });
            if (leaves.length > 0) foundChecked = leaves[0].node.attrs.checked;
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

        // Extended selection: find deepest (leaf) listItems overlapping selection
        const tr = state.tr;
        const items: { pos: number; node: any }[] = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'listItem') {
            items.push({ pos, node });
          }
        });
        // Filter to only leaf listItems (those that don't contain other listItems in the set)
        const leafItems = items.filter(({ pos, node }) => {
          const end = pos + node.nodeSize;
          return !items.some(other => other.pos > pos && other.pos < end);
        });
        for (const { pos, node } of leafItems) {
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
  const { $from } = state.selection;

  let targetDepth = 1;
  for (let d = $from.depth; d > 0; d--) {
    const name = $from.node(d).type.name;
    if (name === 'listItem') {
      targetDepth = d;
      break;
    }
  }

  const parentNode = $from.node(targetDepth - 1);
  const indexInParent = $from.index(targetDepth - 1);
  const siblingIndex = direction === 'up' ? indexInParent - 1 : indexInParent + 1;

  if (siblingIndex >= 0 && siblingIndex < parentNode.childCount) {
    // Simple case: swap with sibling within the same parent
    const movingNode = parentNode.child(indexInParent);
    const siblingNode = parentNode.child(siblingIndex);
    const movingStart = $from.before(targetDepth);
    const movingEnd = $from.after(targetDepth);
    const cursorOffset = $from.pos - movingStart;
    const tr = state.tr;
    if (direction === 'up') {
      const siblingStart = movingStart - siblingNode.nodeSize;
      tr.replaceWith(siblingStart, movingEnd, Fragment.from([movingNode, siblingNode]));
      tr.setSelection(TextSelection.create(tr.doc, siblingStart + cursorOffset));
    } else {
      const siblingEnd = movingEnd + siblingNode.nodeSize;
      tr.replaceWith(movingStart, siblingEnd, Fragment.from([siblingNode, movingNode]));
      tr.setSelection(TextSelection.create(tr.doc, movingStart + siblingNode.nodeSize + cursorOffset));
    }
    editor.view.dispatch(tr);
    return true;
  }

  // Cross-parent case: move a nested list item to an adjacent parent's sublist.
  // Only applies when inside a nested list (parent is a list inside a listItem).
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

  const movingNode = parentNode.child(indexInParent);
  const movingStart = $from.before(targetDepth);
  const movingEnd = $from.after(targetDepth);
  const cursorOffset = $from.pos - movingStart;
  const tr = state.tr;

  // Find the target uncle's sublist of the same type as our parent list
  const parentListType = parentNode.type;
  let targetSublistOffset = -1;
  let targetSublistNode: any = null;
  targetUncle.forEach((child: any, offset: number) => {
    if (child.type === parentListType) {
      targetSublistOffset = offset;
      targetSublistNode = child;
    }
  });

  // Remove the item from its current location
  tr.delete(movingStart, movingEnd);

  // Find the uncle's position in the document
  const unclePos = tr.mapping.map($from.before(uncleListDepth));
  const targetUnclePos = direction === 'up'
    ? unclePos - 1  // position before current uncle -> previous uncle
    : unclePos;     // we need to recalculate after delete

  // Recalculate: resolve into the target uncle to find/create the sublist
  const $uncle = tr.doc.resolve(tr.mapping.map(
    direction === 'up'
      ? $from.before(uncleListDepth) - targetUncle.nodeSize
      : $from.after(uncleListDepth)
  ) + 1);

  // Walk up from $uncle to find the listItem
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

  // Check if the uncle already has a sublist of the right type
  let existingSublist: any = null;
  let existingSublistPos = -1;
  uncleItemNode.forEach((child: any, offset: number) => {
    if (child.type === parentListType) {
      existingSublist = child;
      existingSublistPos = uncleItemPos + 1 + offset;
    }
  });

  let insertPos: number;
  if (existingSublist) {
    if (direction === 'up') {
      // Insert at the end of the existing sublist
      insertPos = existingSublistPos + existingSublist.nodeSize - 1;
    } else {
      // Insert at the start of the existing sublist
      insertPos = existingSublistPos + 1;
    }
    tr.insert(insertPos, movingNode);
  } else {
    // Create a new sublist wrapping our item, append to the uncle listItem
    const newList = parentListType.create(null, Fragment.from(movingNode));
    insertPos = uncleItemPos + 1 + uncleItemNode.content.size;
    tr.insert(insertPos, newList);
    insertPos += 1; // account for the list open tag
  }

  tr.setSelection(TextSelection.create(tr.doc, insertPos + cursorOffset));
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
      const html = editor.storage.markdown.parser.parse(tab.initialContent);
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

    window.mde.readFile(tab.filePath).then(content => {
      // @ts-expect-error tiptap-markdown adds storage.markdown at runtime
      const html = editor.storage.markdown.parser.parse(content);
      const doc = createNodeFromContent(html, editor.schema, { slice: false });
      const { tr } = editor.state;
      tr.replaceWith(0, tr.doc.content.size, (doc as any).content);
      tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
      editor.commands.setTextSelection(0);
      cleanDocRef.current = JSON.stringify(editor.state.doc.toJSON());
      loadedRef.current = true;
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

