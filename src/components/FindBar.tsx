import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Editor as TipTapEditor } from '@tiptap/react';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Tab } from '../types';
import { basename, joinPath } from '../utils/paths';

interface FindBarProps {
  editor: TipTapEditor;
  onClose: () => void;
  focusTrigger?: number;
  projectRoot?: string | null;
  tabs?: Tab[];
  onOpenFile?: (filePath: string) => void;
  onToast?: (msg: string, variant?: string) => void;
}

interface FileMatchResult {
  filePath: string;
  fileName: string;
  count: number;
}

function countTextMatches(text: string, term: string, caseSens: boolean, whole: boolean): number {
  if (!term) return 0;
  const searchStr = caseSens ? term : term.toLowerCase();
  const haystack = caseSens ? text : text.toLowerCase();
  let count = 0;
  let idx = 0;
  while ((idx = haystack.indexOf(searchStr, idx)) !== -1) {
    if (whole) {
      const before = idx > 0 ? haystack[idx - 1] : ' ';
      const after = idx + searchStr.length < haystack.length ? haystack[idx + searchStr.length] : ' ';
      if (!/\w/.test(before) && !/\w/.test(after)) count++;
    } else {
      count++;
    }
    idx += 1;
  }
  return count;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export default function FindBar({ editor, onClose, focusTrigger, projectRoot, tabs, onOpenFile, onToast }: FindBarProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [matchCount, setMatchCount] = useState(0);
  const [confirmingAll, setConfirmingAll] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const [fileMode, setFileMode] = useState<'current' | 'all'>('current');
  const [fileMatches, setFileMatches] = useState<FileMatchResult[]>([]);
  const [allFilesSearching, setAllFilesSearching] = useState(false);
  const [confirmingAllFiles, setConfirmingAllFiles] = useState(false);
  const searchCounterRef = useRef(0);
  const pendingSearchRef = useRef<string | null>(null);

  const pluginKeyRef = useRef(new PluginKey('find-highlight'));

  useEffect(() => {
    if (focusTrigger !== undefined && focusTrigger > 0) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focusTrigger]);

  useEffect(() => {
    inputRef.current?.focus();
    const pendingTerm = pendingSearchRef.current;
    if (pendingTerm !== null) {
      pendingSearchRef.current = null;
      doSearch(pendingTerm, caseSensitive, wholeWord);
    }
    return () => {
      const key = pluginKeyRef.current;
      const plugins = editor.state.plugins.filter(p => p.spec.key !== key);
      if (plugins.length !== editor.state.plugins.length) {
        editor.view.updateState(editor.state.reconfigure({ plugins }));
      }
    };
  }, [editor]);

  const findMatches = useCallback((term: string, caseSens: boolean, whole: boolean): { from: number; to: number }[] => {
    if (!term) return [];
    const doc = editor.state.doc;
    const matches: { from: number; to: number }[] = [];
    const searchStr = caseSens ? term : term.toLowerCase();

    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const text = caseSens ? node.text! : node.text!.toLowerCase();
      let index = 0;
      while ((index = text.indexOf(searchStr, index)) !== -1) {
        if (whole) {
          const before = index > 0 ? text[index - 1] : ' ';
          const after = index + searchStr.length < text.length ? text[index + searchStr.length] : ' ';
          if (/\w/.test(before) || /\w/.test(after)) {
            index += 1;
            continue;
          }
        }
        matches.push({ from: pos + index, to: pos + index + term.length });
        index += 1;
      }
    });

    return matches;
  }, [editor]);

  const updateHighlights = useCallback((matches: { from: number; to: number }[], activeIndex: number) => {
    const key = pluginKeyRef.current;
    const decorations = matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === activeIndex ? 'find-match-active' : 'find-match',
      })
    );
    const decoSet = DecorationSet.create(editor.state.doc, decorations);

    const existingPlugins = editor.state.plugins.filter(p => p.spec.key !== key);
    const plugin = new Plugin({
      key,
      props: { decorations: () => decoSet },
    });
    editor.view.updateState(editor.state.reconfigure({ plugins: [...existingPlugins, plugin] }));
  }, [editor]);

  const doSearch = useCallback((term: string, caseSens: boolean, whole: boolean) => {
    const matches = findMatches(term, caseSens, whole);
    setMatchCount(matches.length);
    if (matches.length > 0) {
      setCurrentMatch(1);
      editor.commands.setTextSelection(matches[0]);
      updateHighlights(matches, 0);
      scrollToSelection();
    } else {
      setCurrentMatch(0);
      updateHighlights([], -1);
    }
  }, [editor, findMatches, updateHighlights]);

  const scrollToSelection = useCallback(() => {
    const { node } = editor.view.domAtPos(editor.state.selection.from);
    const el = node instanceof HTMLElement ? node : node.parentElement;
    el?.scrollIntoView({ block: 'nearest' });
  }, [editor]);

  const searchAllFiles = useCallback(async (term: string, caseSens: boolean, whole: boolean) => {
    if (!projectRoot || !term) {
      setFileMatches([]);
      setAllFilesSearching(false);
      return;
    }
    const myCount = ++searchCounterRef.current;
    setAllFilesSearching(true);
    try {
      const files = await window.mde.listProjectFiles(projectRoot);
      const results: FileMatchResult[] = [];
      for (const relativePath of files) {
        if (searchCounterRef.current !== myCount) return;
        const filePath = joinPath(projectRoot, relativePath);
        const content = await window.mde.readFile(filePath);
        const count = countTextMatches(content, term, caseSens, whole);
        if (count > 0) {
          results.push({ filePath, fileName: basename(relativePath) || relativePath, count });
        }
      }
      if (searchCounterRef.current === myCount) {
        setFileMatches(results);
        setAllFilesSearching(false);
      }
    } catch {
      if (searchCounterRef.current === myCount) setAllFilesSearching(false);
    }
  }, [projectRoot]);

  const replaceAllFiles = useCallback(async () => {
    if (!projectRoot || !searchTerm) return;
    setAllFilesSearching(true);
    setConfirmingAllFiles(false);
    let totalReplaced = 0;
    let filesChanged = 0;
    let skippedDirty = 0;
    try {
      const files = await window.mde.listProjectFiles(projectRoot);
      const flags = caseSensitive ? 'g' : 'gi';
      const pattern = wholeWord
        ? new RegExp(`\\b${escapeRegExp(searchTerm)}\\b`, flags)
        : new RegExp(escapeRegExp(searchTerm), flags);

      for (const relativePath of files) {
        const filePath = joinPath(projectRoot, relativePath);
        const openTab = tabs?.find(t => t.filePath === filePath);
        if (openTab?.dirty) { skippedDirty++; continue; }

        const content = await window.mde.readFile(filePath);
        let matchCount = 0;
        const newContent = content.replace(pattern, () => { matchCount++; return replaceTerm; });

        if (matchCount > 0) {
          // Forces the write (null): content was just read+transformed and dirty tabs are
          // skipped above. writeFileIfUnchanged is the only document-write path.
          await window.mde.writeFileIfUnchanged(filePath, newContent, null);
          totalReplaced += matchCount;
          filesChanged++;
        }
      }

      let msg = `Replaced ${totalReplaced} occurrence${totalReplaced !== 1 ? 's' : ''} in ${filesChanged} file${filesChanged !== 1 ? 's' : ''}.`;
      if (skippedDirty > 0) {
        msg += ` Skipped ${skippedDirty} file${skippedDirty !== 1 ? 's' : ''} with unsaved changes.`;
      }
      onToast?.(msg);
      await searchAllFiles(searchTerm, caseSensitive, wholeWord);
    } catch (err: any) {
      onToast?.(`Replace failed: ${err?.message || err}`, 'danger');
      setAllFilesSearching(false);
    }
  }, [projectRoot, searchTerm, replaceTerm, caseSensitive, wholeWord, tabs, searchAllFiles, onToast]);

  const findNext = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive, wholeWord);
    if (matches.length === 0) return;
    const next = currentMatch >= matches.length ? 1 : currentMatch + 1;
    setCurrentMatch(next);
    editor.commands.setTextSelection(matches[next - 1]);
    updateHighlights(matches, next - 1);
    scrollToSelection();
  }, [searchTerm, caseSensitive, wholeWord, currentMatch, editor, findMatches, scrollToSelection, updateHighlights]);

  const findPrev = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive, wholeWord);
    if (matches.length === 0) return;
    const prev = currentMatch <= 1 ? matches.length : currentMatch - 1;
    setCurrentMatch(prev);
    editor.commands.setTextSelection(matches[prev - 1]);
    updateHighlights(matches, prev - 1);
    scrollToSelection();
  }, [searchTerm, caseSensitive, wholeWord, currentMatch, editor, findMatches, scrollToSelection, updateHighlights]);

  const replaceOne = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive, wholeWord);
    if (matches.length === 0 || currentMatch === 0) return;
    const match = matches[currentMatch - 1];
    editor.chain()
      .focus()
      .setTextSelection(match)
      .insertContent(replaceTerm)
      .run();
    doSearch(searchTerm, caseSensitive, wholeWord);
  }, [searchTerm, replaceTerm, caseSensitive, wholeWord, currentMatch, editor, findMatches, doSearch]);

  const replaceAll = useCallback(() => {
    const matches = findMatches(searchTerm, caseSensitive, wholeWord);
    if (matches.length === 0) return;
    const reversed = [...matches].reverse();
    editor.chain().focus();
    for (const match of reversed) {
      editor.chain()
        .setTextSelection(match)
        .insertContent(replaceTerm)
        .run();
    }
    doSearch(searchTerm, caseSensitive, wholeWord);
  }, [searchTerm, replaceTerm, caseSensitive, wholeWord, editor, findMatches, doSearch]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    if (fileMode === 'current') {
      doSearch(value, caseSensitive, wholeWord);
    } else {
      searchAllFiles(value, caseSensitive, wholeWord);
    }
  }, [caseSensitive, wholeWord, doSearch, fileMode, searchAllFiles]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'Enter' && fileMode === 'current') {
      if (e.shiftKey) {
        findPrev();
      } else {
        findNext();
      }
    }
  }, [onClose, findNext, findPrev, fileMode]);

  const toggleFileMode = useCallback(() => {
    const newMode = fileMode === 'current' ? 'all' : 'current';
    setFileMode(newMode);
    setConfirmingAll(false);
    setConfirmingAllFiles(false);
    if (newMode === 'all') {
      searchAllFiles(searchTerm, caseSensitive, wholeWord);
    } else {
      setFileMatches([]);
      doSearch(searchTerm, caseSensitive, wholeWord);
    }
  }, [fileMode, searchTerm, caseSensitive, wholeWord, searchAllFiles, doSearch]);

  const totalFileMatches = fileMatches.reduce((sum, f) => sum + f.count, 0);
  const showAllFilesToggle = !!projectRoot;

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
        {fileMode === 'current' ? (
          <span className={`find-bar-count ${matchCount > 0 ? 'find-bar-count-active' : ''}`}>
            {searchTerm ? `${currentMatch}/${matchCount}` : ''}
          </span>
        ) : (
          <span className={`find-bar-count ${fileMatches.length > 0 ? 'find-bar-count-active' : ''}`}>
            {allFilesSearching ? '...' : (searchTerm ? `${totalFileMatches} in ${fileMatches.length}f` : '')}
          </span>
        )}
        <button className="find-bar-btn" onClick={findPrev} disabled={fileMode === 'all' || matchCount <= 1} title="Previous (Shift+Enter)">▲</button>
        <button className="find-bar-btn" onClick={findNext} disabled={fileMode === 'all' || matchCount <= 1} title="Next (Enter)">▼</button>
        <button
          className={`find-bar-btn find-bar-case ${caseSensitive ? 'active' : ''}`}
          onClick={() => {
            const next = !caseSensitive;
            setCaseSensitive(next);
            if (fileMode === 'current') doSearch(searchTerm, next, wholeWord);
            else searchAllFiles(searchTerm, next, wholeWord);
          }}
          title="Case Sensitive"
        >
          Aa
        </button>
        <button
          className={`find-bar-btn find-bar-case ${wholeWord ? 'active' : ''}`}
          onClick={() => {
            const next = !wholeWord;
            setWholeWord(next);
            if (fileMode === 'current') doSearch(searchTerm, caseSensitive, next);
            else searchAllFiles(searchTerm, caseSensitive, next);
          }}
          title="Whole Word"
        >
          <i className="bi bi-textarea-t" />
        </button>
        {showAllFilesToggle && (
          <button
            className={`find-bar-btn find-bar-case ${fileMode === 'all' ? 'active' : ''}`}
            onClick={toggleFileMode}
            title={fileMode === 'all' ? 'Search current file only' : 'Search all project files'}
          >
            <i className="bi bi-files" />
          </button>
        )}
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
        {fileMode === 'current' ? (
          <>
            <button className="find-bar-btn" onClick={replaceOne} disabled={matchCount === 0} title="Replace">Replace</button>
            {confirmingAll ? (
              <>
                <span className="find-bar-confirm-label">Replace {matchCount}?</span>
                <button className="find-bar-btn btn-primary" onClick={() => { setConfirmingAll(false); replaceAll(); }}>Yes</button>
                <button className="find-bar-btn" onClick={() => setConfirmingAll(false)}>No</button>
              </>
            ) : (
              <button className="find-bar-btn" onClick={() => matchCount > 0 && setConfirmingAll(true)} disabled={matchCount === 0} title="Replace All">All</button>
            )}
          </>
        ) : (
          <>
            {confirmingAllFiles ? (
              <>
                <span className="find-bar-confirm-label">
                  Replace {totalFileMatches} in {fileMatches.length} file{fileMatches.length !== 1 ? 's' : ''}?
                </span>
                <button className="find-bar-btn btn-primary" onClick={replaceAllFiles} disabled={allFilesSearching}>Yes</button>
                <button className="find-bar-btn" onClick={() => setConfirmingAllFiles(false)}>No</button>
              </>
            ) : (
              <button
                className="find-bar-btn"
                onClick={() => totalFileMatches > 0 && setConfirmingAllFiles(true)}
                disabled={totalFileMatches === 0 || allFilesSearching}
                title="Replace in all project files (skips files with unsaved changes)"
              >
                Replace in All Files
              </button>
            )}
          </>
        )}
      </div>
      {fileMode === 'all' && (
        <div className="find-bar-file-results">
          {allFilesSearching && (
            <div className="find-bar-file-status">Searching...</div>
          )}
          {!allFilesSearching && searchTerm && fileMatches.length === 0 && (
            <div className="find-bar-file-status">No matches found</div>
          )}
          {fileMatches.map(({ filePath, fileName, count }) => (
            <div
              key={filePath}
              className="find-bar-file-match"
              onClick={() => {
                pendingSearchRef.current = searchTerm;
                onOpenFile?.(filePath);
              }}
            >
              <span className="find-bar-file-name">{fileName}</span>
              <span className="find-bar-file-count">{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
