// The full-page checkpoint browser. Lives in a TAB, not an app mode -- see the `view` field
// in src/types.ts for why.
//
// Three levels, one at a time, with a breadcrumb back: the list of checkpoints, one
// checkpoint's changed files, and one file's diff. The sidebar panel stays as the glance
// ("what has moved since the last checkpoint, save one now"); everything you'd want a whole
// window for happens here, where a prose diff finally has the width to be readable.
//
// Restore goes through src/components/vcRestore.ts rather than being re-implemented, so this
// view and the sidebar can never disagree about what just happened to the user's files.

import React, { useCallback, useEffect, useState } from 'react';
import { VcChangedFile, VcCheckpoint } from '../types';
import DiffView from './DiffView';
import { VersionControl, formatRelativeTime, RestoreAllDialog } from './VersionPanel';
import { restoreEverything, restoreOneFile } from './vcRestore';

const PAGE_SIZE = 50;

const CHECKPOINT_ICON: Record<VcCheckpoint['kind'], string> = {
  auto: 'bi-clock',
  manual: 'bi-bookmark-fill',
  restore: 'bi-arrow-counterclockwise',
};

const KIND_ICON: Record<VcChangedFile['kind'], string> = {
  added: 'bi-plus-lg',
  modified: 'bi-pencil',
  deleted: 'bi-dash-lg',
};

const KIND_CLASS: Record<VcChangedFile['kind'], string> = {
  added: 'text-success',
  modified: 'text-primary',
  deleted: 'text-danger',
};

const KIND_LABEL: Record<VcCheckpoint['kind'], string> = {
  auto: 'Saved automatically',
  manual: 'Saved by you',
  restore: 'Restored from an earlier checkpoint',
};

function formatAbsoluteTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

type Nav =
  | { level: 'list' }
  | { level: 'checkpoint'; checkpoint: VcCheckpoint }
  | { level: 'file'; checkpoint: VcCheckpoint; path: string };

interface HistoryViewProps {
  projectRoot: string | null;
  vc: VersionControl;
  onToast: (msg: string, variant?: string) => void;
}

export default function HistoryView({ projectRoot, vc, onToast }: HistoryViewProps) {
  const [nav, setNav] = useState<Nav>({ level: 'list' });
  const [checkpoints, setCheckpoints] = useState<VcCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoreAllTarget, setRestoreAllTarget] = useState<VcCheckpoint | null>(null);

  const writable = vc.state.attach === 'managed';

  useEffect(() => {
    if (!projectRoot) return;
    let cancelled = false;
    setLoading(true);
    window.mde.vcHistory(projectRoot, { limit: PAGE_SIZE }).then(result => {
      if (cancelled) return;
      setCheckpoints(result);
      setExhausted(result.length < PAGE_SIZE);
      setLoading(false);
      // A checkpoint being viewed may have just been retitled, so re-read it from the fresh
      // page rather than leaving a stale subject in the breadcrumb and header.
      setNav(prev => {
        if (prev.level === 'list') return prev;
        const fresh = result.find(c => c.sha === prev.checkpoint.sha);
        return fresh ? { ...prev, checkpoint: fresh } : prev;
      });
    });
    return () => { cancelled = true; };
  }, [projectRoot, vc.historyKey]);

  const loadMore = useCallback(async () => {
    if (!projectRoot) return;
    const last = checkpoints[checkpoints.length - 1];
    if (!last) return;
    const more = await window.mde.vcHistory(projectRoot, { limit: PAGE_SIZE, before: last.sha });
    setCheckpoints(prev => [...prev, ...more]);
    if (more.length < PAGE_SIZE) setExhausted(true);
  }, [projectRoot, checkpoints]);

  const runRestoreFile = useCallback(async (sha: string, filePath: string) => {
    if (!projectRoot) return;
    setBusy(true);
    try {
      const outcome = await restoreOneFile(projectRoot, sha, filePath);
      onToast(outcome.message, outcome.variant);
      if (outcome.changed) await vc.refresh();
    } finally {
      setBusy(false);
    }
  }, [projectRoot, onToast, vc]);

  const confirmRestoreAll = useCallback(async () => {
    if (!projectRoot || !restoreAllTarget) return;
    setBusy(true);
    try {
      const outcome = await restoreEverything(projectRoot, restoreAllTarget.sha);
      setRestoreAllTarget(null);
      onToast(outcome.message, outcome.variant);
      if (outcome.changed) await vc.refresh();
    } finally {
      setBusy(false);
    }
  }, [projectRoot, restoreAllTarget, onToast, vc]);

  const saveTitle = useCallback(async (sha: string, title: string) => {
    if (!projectRoot) return;
    const result = await window.mde.vcSetTitle(projectRoot, sha, title);
    if (!result.ok) {
      onToast(result.error || 'Could not rename that checkpoint.', 'danger');
      return;
    }
    // Refetch through the shared key so the sidebar's list picks up the new name too.
    vc.bumpHistory();
  }, [projectRoot, onToast, vc]);

  if (!projectRoot) {
    return <div className="history-view history-empty qa-hist-no-folder">Open a folder to see its checkpoints.</div>;
  }

  if (vc.state.attach === 'none') {
    return (
      <div className="history-view history-empty qa-hist-off">
        <p>Checkpoints are off for this folder.</p>
        <p className="small text-muted">
          Open the Checkpoints tab in the sidebar to turn them on.
        </p>
      </div>
    );
  }

  return (
    <div className="history-view qa-hist-view">
      <div className="history-crumbs qa-hist-crumbs">
        <button
          className="history-crumb qa-hist-crumb-root"
          disabled={nav.level === 'list'}
          onClick={() => setNav({ level: 'list' })}
        >
          Checkpoints
        </button>
        {nav.level !== 'list' && (
          <>
            <i className="bi bi-chevron-right history-crumb-sep" />
            <button
              className="history-crumb qa-hist-crumb-checkpoint"
              disabled={nav.level === 'checkpoint'}
              onClick={() => setNav({ level: 'checkpoint', checkpoint: nav.checkpoint })}
            >
              {nav.checkpoint.subject}
            </button>
          </>
        )}
        {nav.level === 'file' && (
          <>
            <i className="bi bi-chevron-right history-crumb-sep" />
            <span className="history-crumb history-crumb-current qa-hist-crumb-file">{nav.path}</span>
          </>
        )}
      </div>

      <div className="history-body">
        {nav.level === 'list' && (
          <CheckpointList
            checkpoints={checkpoints}
            loading={loading}
            exhausted={exhausted}
            writable={writable}
            onOpen={checkpoint => setNav({ level: 'checkpoint', checkpoint })}
            onLoadMore={loadMore}
            onSaveTitle={saveTitle}
          />
        )}

        {nav.level === 'checkpoint' && (
          <CheckpointDetail
            projectRoot={projectRoot}
            checkpoint={nav.checkpoint}
            writable={writable}
            busy={busy}
            onOpenFile={path => setNav({ level: 'file', checkpoint: nav.checkpoint, path })}
            onRestoreFile={path => runRestoreFile(nav.checkpoint.sha, path)}
            onRestoreAll={() => setRestoreAllTarget(nav.checkpoint)}
            onSaveTitle={saveTitle}
          />
        )}

        {nav.level === 'file' && (
          <DiffView
            variant="inline"
            projectRoot={projectRoot}
            filePath={nav.path}
            sha={nav.checkpoint.sha}
            subtitle={`As it was after "${nav.checkpoint.subject}"`}
            onClose={() => setNav({ level: 'checkpoint', checkpoint: nav.checkpoint })}
            onRestore={writable ? path => runRestoreFile(nav.checkpoint.sha, path) : undefined}
            restoreLabel="Put this version back"
          />
        )}
      </div>

      {restoreAllTarget && (
        <RestoreAllDialog
          checkpoint={restoreAllTarget}
          busy={busy}
          onConfirm={confirmRestoreAll}
          onCancel={() => setRestoreAllTarget(null)}
        />
      )}
    </div>
  );
}

// --- Level 1: the list ----------------------------------------------------------------

interface CheckpointListProps {
  checkpoints: VcCheckpoint[];
  loading: boolean;
  exhausted: boolean;
  writable: boolean;
  onOpen: (checkpoint: VcCheckpoint) => void;
  onLoadMore: () => void;
  onSaveTitle: (sha: string, title: string) => Promise<void>;
}

function CheckpointList({ checkpoints, loading, exhausted, writable, onOpen, onLoadMore, onSaveTitle }: CheckpointListProps) {
  if (loading) return <div className="history-empty text-muted">Loading...</div>;
  if (checkpoints.length === 0) {
    return <div className="history-empty text-muted qa-hist-empty">No checkpoints yet.</div>;
  }

  return (
    <>
      <div className="history-list">
        {checkpoints.map(checkpoint => (
          <div key={checkpoint.sha} className="history-row qa-hist-checkpoint">
            <i className={`bi ${CHECKPOINT_ICON[checkpoint.kind]} history-row-icon`} />
            <div className="history-row-main">
              <EditableTitle
                checkpoint={checkpoint}
                writable={writable}
                className="history-row-subject qa-hist-subject"
                onSave={onSaveTitle}
                onActivate={() => onOpen(checkpoint)}
              />
              <div className="small text-muted">
                {formatAbsoluteTime(checkpoint.timestamp)} &middot;{' '}
                {formatRelativeTime(checkpoint.timestamp)} &middot; {KIND_LABEL[checkpoint.kind]}
              </div>
            </div>
            <button
              className="btn btn-sm qa-hist-open"
              onClick={() => onOpen(checkpoint)}
            >
              See what changed
            </button>
          </div>
        ))}
      </div>
      {!exhausted && (
        <button className="btn btn-sm mt-3 qa-hist-more" onClick={onLoadMore}>
          Show older checkpoints
        </button>
      )}
    </>
  );
}

// --- Level 2: one checkpoint ----------------------------------------------------------

interface CheckpointDetailProps {
  projectRoot: string;
  checkpoint: VcCheckpoint;
  writable: boolean;
  busy: boolean;
  onOpenFile: (path: string) => void;
  onRestoreFile: (path: string) => void;
  onRestoreAll: () => void;
  onSaveTitle: (sha: string, title: string) => Promise<void>;
}

function CheckpointDetail({
  projectRoot, checkpoint, writable, busy, onOpenFile, onRestoreFile, onRestoreAll, onSaveTitle,
}: CheckpointDetailProps) {
  const [files, setFiles] = useState<VcChangedFile[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    window.mde.vcCheckpointFiles(projectRoot, checkpoint.sha, { counts: true }).then(result => {
      if (!cancelled) setFiles(result);
    });
    return () => { cancelled = true; };
  }, [projectRoot, checkpoint.sha]);

  return (
    <div className="qa-hist-detail">
      <div className="history-detail-header">
        <div className="history-detail-title">
          <EditableTitle
            checkpoint={checkpoint}
            writable={writable}
            className="history-detail-subject qa-hist-subject"
            onSave={onSaveTitle}
          />
          <div className="small text-muted">
            {formatAbsoluteTime(checkpoint.timestamp)} &middot;{' '}
            {formatRelativeTime(checkpoint.timestamp)} &middot; {KIND_LABEL[checkpoint.kind]}
          </div>
        </div>
        {writable && (
          <button className="btn btn-sm qa-hist-restore-all" disabled={busy} onClick={onRestoreAll}>
            Restore everything to here
          </button>
        )}
      </div>

      {files === null && <div className="history-empty text-muted">Loading...</div>}

      {files !== null && files.length === 0 && (
        <div className="history-empty text-muted qa-hist-detail-empty">
          No file changes recorded.
        </div>
      )}

      {files !== null && files.length > 0 && (
        <div className="history-file-list">
          {files.map(file => (
            <div key={file.path} className="history-file-row qa-hist-file">
              <button className="history-file-main" title={file.path} onClick={() => onOpenFile(file.path)}>
                <i className={`bi ${KIND_ICON[file.kind]} ${KIND_CLASS[file.kind]}`} />
                <span className="history-file-path text-truncate">{file.path}</span>
                <FileCounts file={file} />
              </button>
              {writable && (
                <button
                  className="btn btn-sm qa-hist-restore-file"
                  disabled={busy}
                  onClick={() => onRestoreFile(file.path)}
                >
                  Put this version back
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Absent counts render as nothing, never as "+0 -0" -- a binary or oversized file was never
 * measured, and a zero would read as "this file did not really change", which is a lie.
 */
function FileCounts({ file }: { file: VcChangedFile }) {
  if (file.added === undefined && file.removed === undefined) return null;
  return (
    <span className="history-file-counts small qa-hist-counts">
      {file.added ? <span className="text-success">+{file.added}</span> : null}
      {file.removed ? <span className="text-danger">&minus;{file.removed}</span> : null}
      {!file.added && !file.removed ? <span className="text-muted">no line changes</span> : null}
    </span>
  );
}

// --- Editable title -------------------------------------------------------------------

interface EditableTitleProps {
  checkpoint: VcCheckpoint;
  writable: boolean;
  className: string;
  onSave: (sha: string, title: string) => Promise<void>;
  // When present, the (non-editing) title itself is clickable and drills in.
  onActivate?: () => void;
}

function EditableTitle({ checkpoint, writable, className, onSave, onActivate }: EditableTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(checkpoint.subject);

  const begin = () => {
    setDraft(checkpoint.subject);
    setEditing(true);
  };

  const commit = async (value: string) => {
    setEditing(false);
    if (value.trim() === checkpoint.subject.trim()) return;
    await onSave(checkpoint.sha, value);
  };

  if (editing) {
    return (
      <div className="history-title-edit">
        <input
          className="history-title-input qa-hist-title-input"
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); void commit(draft); }
            if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
          }}
        />
        <button className="btn btn-sm btn-primary qa-hist-title-save" onClick={() => void commit(draft)}>
          Save
        </button>
        <button className="btn btn-sm qa-hist-title-cancel" onClick={() => setEditing(false)}>
          Cancel
        </button>
        {checkpoint.titleEdited && (
          <button
            className="btn-plain small text-muted qa-hist-title-reset"
            onClick={() => void commit('')}
          >
            Use the automatic description
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="history-title-row">
      {onActivate ? (
        <button className={`${className} history-title-link`} onClick={onActivate}>
          {checkpoint.subject}
        </button>
      ) : (
        <span className={className}>{checkpoint.subject}</span>
      )}
      {writable && (
        <button
          className="btn-plain history-title-pencil qa-hist-title-edit"
          data-tooltip="Change this description"
          aria-label="Change this description"
          onClick={begin}
        >
          <i className="bi bi-pencil" />
        </button>
      )}
    </div>
  );
}
