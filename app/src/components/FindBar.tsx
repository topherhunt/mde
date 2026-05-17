import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';

interface FindBarProps {
  editor: TipTapEditor;
  onClose: () => void;
}

export default function FindBar({ editor, onClose }: FindBarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const findMatches = useCallback((term: string, caseSens: boolean): { from: number; to: number }[] => {
    if (!term) return [];
    const doc = editor.state.doc;
    const matches: { from: number; to: number }[] = [];
    const searchStr = caseSens ? term : term.toLowerCase();

    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const text = caseSens ? node.text! : node.text!.toLowerCase();
      let index = 0;
      while ((index = text.indexOf(searchStr, index)) !== -1) {
        matches.push({ from: pos + index, to: pos + index + term.length });
        index += 1;
      }
    });

    return matches;
  }, [editor]);

  const doSearch = useCallback((term: string, caseSens: boolean) => {
    const matches = findMatches(term, caseSens);
    setMatchCount(matches.length);
    if (matches.length > 0) {
      setCurrentMatch(1);
      editor.commands.setTextSelection(matches[0]);
      scrollToSelection();
    } else {
      setCurrentMatch(0);
    }
  }, [editor, findMatches]);

  const scrollToSelection = useCallback(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const el = node instanceof HTMLElement ? node : node.parentElement;
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [editor]);

  const findNext = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive);
    if (matches.length === 0) return;
    const next = currentMatch >= matches.length ? 1 : currentMatch + 1;
    setCurrentMatch(next);
    editor.commands.setTextSelection(matches[next - 1]);
    scrollToSelection();
  }, [searchTerm, caseSensitive, currentMatch, editor, findMatches, scrollToSelection]);

  const findPrev = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive);
    if (matches.length === 0) return;
    const prev = currentMatch <= 1 ? matches.length : currentMatch - 1;
    setCurrentMatch(prev);
    editor.commands.setTextSelection(matches[prev - 1]);
    scrollToSelection();
  }, [searchTerm, caseSensitive, currentMatch, editor, findMatches, scrollToSelection]);

  const replaceOne = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive);
    if (matches.length === 0 || currentMatch === 0) return;
    const match = matches[currentMatch - 1];
    editor.chain()
      .focus()
      .setTextSelection(match)
      .insertContent(replaceTerm)
      .run();
    doSearch(searchTerm, caseSensitive);
  }, [searchTerm, replaceTerm, caseSensitive, currentMatch, editor, findMatches, doSearch]);

  const replaceAll = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive);
    if (matches.length === 0) return;
    // Replace from end to start so positions don't shift
    const reversed = [...matches].reverse();
    editor.chain().focus();
    for (const match of reversed) {
      editor.chain()
        .setTextSelection(match)
        .insertContent(replaceTerm)
        .run();
    }
    doSearch(searchTerm, caseSensitive);
  }, [searchTerm, replaceTerm, caseSensitive, editor, findMatches, doSearch]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    doSearch(value, caseSensitive);
  }, [caseSensitive, doSearch]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
    }
  }, [onClose, findNext, findPrev]);

  return (
    <div className="find-bar" onKeyDown={handleKeyDown}>
      <div className="find-bar-row">
        <input
          ref={inputRef}
          className="find-bar-input"
          type="text"
          placeholder="Find..."
          value={searchTerm}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
        <span className="find-bar-count">
          {searchTerm ? `${currentMatch}/${matchCount}` : ''}
        </span>
        <button className="find-bar-btn" onClick={findPrev} title="Previous (Shift+Enter)">▲</button>
        <button className="find-bar-btn" onClick={findNext} title="Next (Enter)">▼</button>
        <button
          className={`find-bar-btn find-bar-case ${caseSensitive ? 'active' : ''}`}
          onClick={() => {
            const next = !caseSensitive;
            setCaseSensitive(next);
            doSearch(searchTerm, next);
          }}
          title="Case Sensitive"
        >
          Aa
        </button>
        <button className="find-bar-btn find-bar-close" onClick={onClose} title="Close (Escape)">×</button>
      </div>
      <div className="find-bar-row">
        <input
          className="find-bar-input"
          type="text"
          placeholder="Replace..."
          value={replaceTerm}
          onChange={(e) => setReplaceTerm(e.target.value)}
        />
        <button className="find-bar-btn" onClick={replaceOne} title="Replace">Replace</button>
        <button className="find-bar-btn" onClick={replaceAll} title="Replace All">All</button>
      </div>
    </div>
  );
}
