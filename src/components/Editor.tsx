import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useEditor, EditorContent, Editor as TipTapEditor, createNodeFromContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TableKit } from '@tiptap/extension-table';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import taskListPlugin from 'markdown-it-task-lists';
import { common, createLowlight } from 'lowlight';
import { Markdown as MarkdownExt } from 'tiptap-markdown';
import Text from '@tiptap/extension-text';
import { Extension } from '@tiptap/core';
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
              if ((child.type.name === 'bulletList' || child.type.name === 'taskList' || child.type.name === 'orderedList')
                  && child.childCount === 1) {
                return serializer.serialize(child.firstChild!.content).trim();
              }
            }
            return compactListGaps(serializer.serialize(content));
          },
        },
      }),
    ];
  },
});

function compactListGaps(md: string): string {
  return md.replace(/^([ \t]*- (?:\[[ x]\] )?[^\n]+)\n{2,}(?=[ \t]*- )/gm, '$1\n');
}

// Override tiptap-markdown's taskList parse to split mixed bullet/task lists into
// separate <ul> elements, so non-task items don't get spurious checkboxes.
const SplitMixedTaskList = TaskList.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          return state.renderList(node, '  ', () =>
            ((this as any).editor.storage.markdown.options.bulletListMarker || '-') + ' '
          );
        },
        parse: {
          setup(markdownit: any) {
            markdownit.use(taskListPlugin);
          },
          updateDOM(element: HTMLElement) {
            [...element.querySelectorAll('.contains-task-list')].forEach((list) => {
              const items = [...list.children] as HTMLElement[];
              const runs: { isTask: boolean; items: HTMLElement[] }[] = [];
              let cur: { isTask: boolean; items: HTMLElement[] } | null = null;
              for (const item of items) {
                const isTask = item.classList.contains('task-list-item');
                if (!cur || cur.isTask !== isTask) {
                  cur = { isTask, items: [] };
                  runs.push(cur);
                }
                cur.items.push(item);
              }
              const parent = list.parentNode!;
              for (const run of runs) {
                const ul = list.cloneNode(false) as HTMLElement;
                ul.classList.remove('contains-task-list');
                if (run.isTask) {
                  ul.setAttribute('data-type', 'taskList');
                }
                for (const item of run.items) ul.appendChild(item);
                parent.insertBefore(ul, list);
              }
              parent.removeChild(list);
            });
            [...element.querySelectorAll('.task-list-item')].forEach((item) => {
              const input = item.querySelector('input');
              item.setAttribute('data-type', 'taskItem');
              if (input) {
                item.setAttribute('data-checked', String(input.checked));
                input.remove();
              }
            });
          },
        },
      },
    };
  },
});

const TabHandler = Extension.create({
  name: 'tabHandler',
  addKeyboardShortcuts() {
    return {
      'Tab': ({ editor }) => {
        if (editor.isActive('listItem') || editor.isActive('taskItem')) {
          editor.commands.sinkListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem');
        } else if (editor.isActive('codeBlock')) {
          editor.commands.insertContent('\t');
        } else {
          editor.commands.insertContent('\t');
        }
        return true;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('listItem') || editor.isActive('taskItem')) {
          editor.commands.liftListItem(editor.isActive('taskItem') ? 'taskItem' : 'listItem');
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
        const { bulletList, taskList, listItem, taskItem } = state.schema.nodes;

        // Find the first list item to determine cycle target
        let foundType: string | null = null;
        let foundChecked = false;
        state.doc.nodesBetween(from, to, (node) => {
          if (foundType) return false;
          if (node.type.name === 'taskItem') {
            foundType = 'taskItem';
            foundChecked = node.attrs.checked;
            return false;
          }
          if (node.type.name === 'listItem') {
            foundType = 'listItem';
            return false;
          }
        });

        // No list context: create a bullet list
        if (!foundType) {
          editor.chain().focus().toggleBulletList().run();
          return true;
        }

        // Cycle: bullet -> unchecked task -> checked task -> bullet
        let target: 'uncheckedTask' | 'checkedTask' | 'bullet';
        if (foundType === 'listItem') target = 'uncheckedTask';
        else if (!foundChecked) target = 'checkedTask';
        else target = 'bullet';

        if (from === to) {
          // Collapsed cursor
          if (target === 'checkedTask') {
            let tr = state.tr;
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (node.type.name === 'taskItem') {
                tr = tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: true });
              }
            });
            editor.view.dispatch(tr);
          } else if (target === 'uncheckedTask') {
            editor.chain().focus().toggleBulletList().toggleTaskList().run();
          } else {
            editor.chain().focus().toggleTaskList().toggleBulletList().run();
          }
          return true;
        }

        // Extended selection: convert only the selected items within each list
        let tr = state.tr;
        const targetListType = target === 'bullet' ? bulletList : taskList;

        // Find lists and which of their items overlap the selection
        const listData: { pos: number; node: any; selectedIndices: Set<number> }[] = [];
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (node.type.name === 'bulletList' || node.type.name === 'taskList') {
            const selected = new Set<number>();
            node.forEach((child: any, childOffset: number, index: number) => {
              const itemPos = pos + 1 + childOffset;
              const itemEnd = itemPos + child.nodeSize;
              if (itemEnd > from && itemPos < to) {
                selected.add(index);
              }
            });
            if (selected.size > 0) {
              listData.push({ pos, node, selectedIndices: selected });
            }
            return false;
          }
        });

        // Process in reverse document order so positions stay valid
        listData.sort((a, b) => b.pos - a.pos);

        // Track the bounds of all converted items for selection restoration
        let selStart = Infinity;
        let selEnd = -1;

        for (const { pos, node: listNode, selectedIndices } of listData) {
          if (listNode.type === targetListType) {
            // Already the right list type -- just update checked attrs on selected items
            if (target !== 'bullet') {
              const wantChecked = target === 'checkedTask';
              listNode.forEach((child: any, childOffset: number, index: number) => {
                if (selectedIndices.has(index)) {
                  const mappedPos = tr.mapping.map(pos + 1 + childOffset);
                  if (child.attrs.checked !== wantChecked) {
                    tr = tr.setNodeMarkup(mappedPos, undefined, { ...child.attrs, checked: wantChecked });
                  }
                  selStart = Math.min(selStart, mappedPos);
                  selEnd = Math.max(selEnd, mappedPos + child.nodeSize);
                }
              });
            } else {
              listNode.forEach((child: any, childOffset: number, index: number) => {
                if (selectedIndices.has(index)) {
                  const mappedPos = tr.mapping.map(pos + 1 + childOffset);
                  selStart = Math.min(selStart, mappedPos);
                  selEnd = Math.max(selEnd, mappedPos + child.nodeSize);
                }
              });
            }
            continue;
          }

          // Build replacement: split list into original + converted segments
          const segments: { selected: boolean; children: any[] }[] = [];
          let current: { selected: boolean; children: any[] } | null = null;

          listNode.forEach((child: any, _offset: number, index: number) => {
            const isSelected = selectedIndices.has(index);
            if (!current || current.selected !== isSelected) {
              current = { selected: isSelected, children: [] };
              segments.push(current);
            }
            current.children.push(child);
          });

          const replacementNodes: any[] = [];
          let convertedOffset = 0;
          let convertedSize = 0;
          let offsetAccum = 0;
          for (const seg of segments) {
            if (!seg.selected) {
              const children = seg.children.map((c: any) => c.copy(c.content));
              const node = listNode.type.create(listNode.attrs, Fragment.from(children));
              replacementNodes.push(node);
              offsetAccum += node.nodeSize;
            } else {
              convertedOffset = offsetAccum;
              const children = seg.children.map((c: any) => {
                if (target === 'bullet') return listItem.create(null, c.content, c.marks);
                return taskItem.create({ checked: target === 'checkedTask' }, c.content, c.marks);
              });
              const node = targetListType.create(null, Fragment.from(children));
              replacementNodes.push(node);
              convertedSize = node.nodeSize;
              offsetAccum += node.nodeSize;
            }
          }

          const mapped = tr.mapping.map(pos);
          tr = tr.replaceWith(mapped, mapped + listNode.nodeSize, Fragment.from(replacementNodes));

          // Track the converted list's bounds in the new document
          const convertedListPos = mapped + convertedOffset;
          selStart = Math.min(selStart, convertedListPos);
          selEnd = Math.max(selEnd, convertedListPos + convertedSize);
        }

        // Set selection to span the converted items
        if (selStart < selEnd) {
          try {
            const $start = tr.doc.resolve(selStart);
            const $end = tr.doc.resolve(selEnd);
            tr.setSelection(TextSelection.between($start, $end));
          } catch {
            // Fallback: leave selection as-is
          }
        }
        editor.view.dispatch(tr);
        return true;
      },
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
      SplitMixedTaskList,
      TaskItem.configure({
        nested: true,
      }),
      CmdEnterCycle,
      TabHandler,
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

