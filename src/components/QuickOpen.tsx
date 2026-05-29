import React, { useState, useEffect, useRef, useCallback } from 'react';
import { basename, joinPath } from '../utils/paths';

interface QuickOpenProps {
  projectRoot: string;
  onSelect: (filePath: string) => void;
  onClose: () => void;
}

function fuzzyMatchStr(query: string, target: string, baseIndex: number): { score: number; indices: number[] } | null {
  const indices: number[] = [];
  let qi = 0;
  let score = 0;
  let prevIdx = -1;

  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) {
      indices.push(baseIndex + ti);
      score += 1;
      if (prevIdx === baseIndex + ti - 1) score += 3;
      if (ti === 0 || '/\\-_.'.includes(target[ti - 1])) score += 2;
      prevIdx = baseIndex + ti;
      qi++;
    }
  }

  if (qi < query.length) return null;
  return { score, indices };
}

function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const fileName = basename(t) || t;
  const fileStart = t.length - fileName.length;

  const fileMatch = fuzzyMatchStr(q, fileName, fileStart);
  if (fileMatch) {
    if (fileName.includes(q)) fileMatch.score += 5;
    return fileMatch;
  }

  return fuzzyMatchStr(q, t, 0);
}

function HighlightedText({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices);
  const parts: React.ReactNode[] = [];
  let run = '';
  let inMatch = false;
  for (let i = 0; i < text.length; i++) {
    const isMatch = set.has(i);
    if (isMatch !== inMatch) {
      if (run) parts.push(inMatch ? <b key={i}>{run}</b> : run);
      run = '';
      inMatch = isMatch;
    }
    run += text[i];
  }
  if (run) parts.push(inMatch ? <b key="end">{run}</b> : run);
  return <>{parts}</>;
}

export default function QuickOpen({ projectRoot, onSelect, onClose }: QuickOpenProps) {
  const [query, setQuery] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    window.mde.listProjectFiles(projectRoot).then(all =>
      setFiles(all.filter(f => /\.(md|markdown|txt)$/i.test(f)))
    );
  }, [projectRoot]);

  const results = useCallback(() => {
    if (!query.trim()) {
      return files.slice(0, 50).map(f => ({ path: f, score: 0, indices: [] as number[] }));
    }
    const matched: { path: string; score: number; indices: number[] }[] = [];
    for (const f of files) {
      const m = fuzzyMatch(query, f);
      if (m) matched.push({ path: f, score: m.score, indices: m.indices });
    }
    matched.sort((a, b) => b.score - a.score);
    return matched.slice(0, 50);
  }, [query, files])();

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        onSelect(joinPath(projectRoot, results[selectedIndex].path));
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="quick-open-backdrop" onMouseDown={onClose}>
      <div className="quick-open" onMouseDown={(e) => e.stopPropagation()}>
        <div className="quick-open-input-row">
          <i className="bi bi-search quick-open-search-icon" />
          <input
            ref={inputRef}
            className="quick-open-input"
            type="text"
            placeholder="Search files..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="quick-open-results" ref={listRef}>
          {results.map((r, i) => (
            <div
              key={r.path}
              className={`quick-open-item ${i === selectedIndex ? 'selected' : ''}`}
              onMouseEnter={() => setSelectedIndex(i)}
              onMouseDown={(e) => { e.preventDefault(); onSelect(joinPath(projectRoot, r.path)); }}
            >
              <span className="quick-open-filename">
                <HighlightedText text={basename(r.path)} indices={r.indices.map(idx => idx - (r.path.length - basename(r.path).length)).filter(idx => idx >= 0)} />
              </span>
              <span className="quick-open-path">
                <HighlightedText text={r.path} indices={r.indices} />
              </span>
            </div>
          ))}
          {results.length === 0 && query && (
            <div className="quick-open-empty">No matching files</div>
          )}
        </div>
      </div>
    </div>
  );
}
