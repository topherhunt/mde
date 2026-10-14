import React, { useEffect, useRef } from 'react';
import { EditorState, Text } from '@codemirror/state';
import { EditorView, keymap, highlightSpecialChars } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, insertTab, indentLess } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel } from '@codemirror/search';
import { Tab } from '../types';

// What App needs from a plain-text tab. Saving writes `serialize()` verbatim.
export interface PlainTextHandle {
  serialize(): Promise<string>;
  // A new value after every edit; a save compares it before and after its write.
  version(): unknown;
  reloadFrom(filePath: string): Promise<void>;
  focus(): void;
  openSearch(): void;
}

// The single line break `text` uses, or null when it mixes them.
function uniformLineBreak(text: string): string | null {
  const used = new Set(text.match(/\r\n|\r|\n/g));
  if (used.size > 1) return null;
  return used.size ? [...used][0] : '\n';
}

// CodeMirror normally splits lines on any break and joins them with "\n", which would rewrite
// a CRLF file. A file with one kind of break is edited normalized and saved with that break; a
// file that mixes them splits on "\n" only, so every "\r" stays in the text as a visible character.
function buildState(content: string, onDocChanged: (doc: Text) => void): { state: EditorState; lineBreak: string } {
  const uniform = uniformLineBreak(content);
  const state = EditorState.create({
    doc: content,
    extensions: [
      uniform === null ? EditorState.lineSeparator.of('\n') : [],
      history(),
      highlightSpecialChars(),
      search({ top: true }),
      EditorView.lineWrapping,
      keymap.of([{ key: 'Tab', run: insertTab, shift: indentLess }, ...searchKeymap, ...historyKeymap, ...defaultKeymap]),
      EditorView.updateListener.of((u) => { if (u.docChanged) onDocChanged(u.state.doc); }),
    ],
  });
  const lineBreak = uniform ?? '\n';
  if (state.doc.sliceString(0, state.doc.length, lineBreak) !== content) {
    throw new Error('The plain-text editor could not reproduce this file exactly, so it was not opened for editing.');
  }
  return { state, lineBreak };
}

interface PlainTextEditorProps {
  tab: Tab;
  onReady: (handle: PlainTextHandle) => void;
  onDestroy: () => void;
  onDirtyChange: (dirty: boolean) => void;
}

export default function PlainTextEditor({ tab, onReady, onDestroy, onDirtyChange }: PlainTextEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // The document as it is on disk; the buffer is dirty whenever it differs.
  const cleanDocRef = useRef<Text | null>(null);
  const onDirtyChangeRef = useRef(onDirtyChange);
  onDirtyChangeRef.current = onDirtyChange;

  useEffect(() => {
    let cancelled = false;
    let lineBreak = '\n';
    const onDocChanged = (doc: Text) => onDirtyChangeRef.current(!doc.eq(cleanDocRef.current!));
    const load = (content: string) => {
      const built = buildState(content, onDocChanged);
      lineBreak = built.lineBreak;
      cleanDocRef.current = built.state.doc;
      return built.state;
    };

    window.mde.readPlainText(tab.filePath!).then((content) => {
      if (cancelled) return;
      const view = new EditorView({ parent: hostRef.current!, state: load(content) });
      viewRef.current = view;
      onReady({
        serialize: async () => view.state.doc.sliceString(0, view.state.doc.length, lineBreak),
        version: () => view.state.doc,
        reloadFrom: async (filePath) => {
          const head = view.state.selection.main.head;
          view.setState(load(await window.mde.readPlainText(filePath)));
          view.dispatch({ selection: { anchor: Math.min(head, view.state.doc.length) } });
        },
        focus: () => view.focus(),
        openSearch: () => openSearchPanel(view),
      });
    });
    return () => {
      cancelled = true;
      if (viewRef.current) {
        viewRef.current.destroy();
        viewRef.current = null;
        onDestroy();
      }
    };
  }, []);

  // App marks the tab clean only when nothing was typed during the write, so what is in the
  // buffer now is what is on disk.
  const prevDirtyRef = useRef(tab.dirty);
  useEffect(() => {
    if (prevDirtyRef.current && !tab.dirty && viewRef.current) cleanDocRef.current = viewRef.current.state.doc;
    prevDirtyRef.current = tab.dirty;
  }, [tab.dirty]);

  return <div ref={hostRef} className="plaintext-editor qa-plaintext-editor" />;
}
