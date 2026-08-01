import React, { useEffect, useState } from 'react';
import { VcDiff } from '../types';
import { buildDiff, BuiltDiff } from '../utils/prosediff';

interface DiffViewProps {
  projectRoot: string;
  filePath: string; // repo-relative
  // Omit to compare the working copy against the last checkpoint (uncommitted changes).
  sha?: string;
  // Shown above the diff, e.g. "Compared with the checkpoint before it".
  subtitle?: string;
  onClose: () => void;
  // Absent when the folder is read-only, which removes the restore button entirely.
  onRestore?: (filePath: string) => void;
  restoreLabel?: string;
}

export default function DiffView({
  projectRoot,
  filePath,
  sha,
  subtitle,
  onClose,
  onRestore,
  restoreLabel,
}: DiffViewProps) {
  const [diff, setDiff] = useState<VcDiff | null>(null);
  const [built, setBuilt] = useState<BuiltDiff | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.mde.vcDiff(projectRoot, filePath, sha).then(result => {
      if (cancelled) return;
      setDiff(result);
      setBuilt(result.binary ? null : buildDiff(result.before, result.after));
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectRoot, filePath, sha]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop qa-diff-view" onMouseDown={onClose}>
      <div className="diff-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="diff-header">
          <div className="diff-header-text">
            <div className="diff-title qa-diff-path">{filePath}</div>
            {subtitle && <div className="small text-muted">{subtitle}</div>}
          </div>
          <div className="d-flex gap-2 align-items-center">
            {onRestore && (
              <button className="btn btn-primary btn-sm qa-diff-restore" onClick={() => onRestore(filePath)}>
                {restoreLabel || 'Restore this version'}
              </button>
            )}
            <button className="btn-plain" onClick={onClose} aria-label="Close">
              <i className="bi bi-x-lg" />
            </button>
          </div>
        </div>

        <div className="diff-body">
          {loading && <div className="diff-empty text-muted">Loading...</div>}

          {!loading && diff?.binary && (
            <div className="diff-empty text-muted qa-diff-binary">
              This is not a text file, so there is nothing to compare.
            </div>
          )}

          {!loading && !diff?.binary && built?.identical && (
            <div className="diff-empty text-muted qa-diff-identical">
              No changes in this file.
            </div>
          )}

          {!loading && !diff?.binary && built && !built.identical && (
            <div className="diff-rows">
              {built.rows.map((row, i) => {
                if (row.type === 'gap') {
                  return (
                    <div key={i} className="diff-row diff-gap">
                      <span className="diff-gutter" />
                      <span className="diff-text">
                        {row.hiddenCount} unchanged {row.hiddenCount === 1 ? 'line' : 'lines'}
                      </span>
                    </div>
                  );
                }
                const mark = row.type === 'added' ? '+' : row.type === 'removed' ? '−' : '';
                return (
                  <div key={i} className={`diff-row diff-${row.type}`}>
                    <span className="diff-gutter">{mark}</span>
                    <span className="diff-text">
                      {row.segments.map((seg, j) =>
                        seg.changed ? (
                          <mark key={j} className="diff-word">{seg.text}</mark>
                        ) : (
                          <span key={j}>{seg.text}</span>
                        )
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {built && !built.identical && (
          <div className="diff-footer small text-muted qa-diff-summary">
            {built.added} {built.added === 1 ? 'line' : 'lines'} added,{' '}
            {built.removed} {built.removed === 1 ? 'line' : 'lines'} removed
          </div>
        )}
      </div>
    </div>
  );
}
