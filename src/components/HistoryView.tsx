// The full-page checkpoint browser. Lives in a TAB, not an app mode -- see the `view` field
// in src/types.ts for why.
//
// Three levels, one at a time, with a breadcrumb back: the list of checkpoints, one
// checkpoint's changed files, and one file's diff. The list also has a SCOPE (see `Scope`) so
// the same three levels serve "every checkpoint" and "just the ones that touched this file".
//
// Uncommitted work reuses the bottom two levels rather than getting a screen of its own
// (`working` / `workingFile`): it is the checkpoint that has not happened yet, so it sits in
// the checkpoint crumb's slot and drills into a file diff exactly like a real one does.
//
// This is the ONLY checkpoint drill-down in the app. The sidebar panel stays the glance
// ("what has moved since the last checkpoint, save one now") and routes every click here --
// including a click on a changed file, which lands on `workingFile`. Everything you'd want a
// whole window for happens in this view, where a prose diff finally has the width to be
// readable.
//
// Restore goes through src/components/vcRestore.ts rather than being re-implemented, so this
// view and the sidebar can never disagree about what just happened to the user's files.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryTarget, VcChangedFile, VcChangeKind, VcCheckpoint, VcCheckpointStat } from '../types';
import DiffView from './DiffView';
import { VersionControl, formatRelativeTime, RestoreAllDialog, ChangesSection } from './VersionPanel';
import { restoreEverything, restoreOneFile } from './vcRestore';
import RestoreFileDialog from './RestoreFileDialog';
import { basename } from '../utils/paths';

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

/**
 * What the LIST level is showing. Every checkpoint, or only the ones that touched one file.
 *
 * A scope rather than a fourth level, because it only ever filters the list: once you drill
 * into a checkpoint you see everything it changed. The breadcrumb reflects that by wording the
 * scope crumb as a list ("Changes to ch4.md") rather than as a file, so it cannot be confused
 * with the filename crumb that may sit two positions to its right.
 */
type Scope = { kind: 'all' } | { kind: 'file'; path: string };

// `working` and `workingFile` are the checkpoint and file levels for work that has NOT been
// checkpointed yet -- the same two shapes, one step to the left of the first checkpoint. They
// carry no scope: "unsaved changes to this one file" is a diff, which is exactly `workingFile`,
// so a scope would only ever filter a list of one.
type Nav =
  | { level: 'list'; scope: Scope }
  | { level: 'checkpoint'; scope: Scope; checkpoint: VcCheckpoint }
  | { level: 'file'; scope: Scope; checkpoint: VcCheckpoint; path: string }
  | { level: 'working' }
  | { level: 'workingFile'; path: string };

const ALL: Scope = { kind: 'all' };

export interface HistoryNavRequest {
  target: HistoryTarget;
  // Bumped on every request. The target alone is not enough: opening the same file twice, or
  // pressing Browse while already on the list, must still re-navigate, and an unchanged prop
  // fires no effect.
  nonce: number;
}

interface HistoryViewProps {
  projectRoot: string | null;
  vc: VersionControl;
  onToast: (msg: string, variant?: string) => void;
  navRequest: HistoryNavRequest | null;
}

function navFor(target: HistoryTarget | undefined): Nav {
  if (!target || target.kind === 'all') return { level: 'list', scope: ALL };
  if (target.kind === 'file') return { level: 'list', scope: { kind: 'file', path: target.path } };
  if (target.kind === 'working') {
    return target.path ? { level: 'workingFile', path: target.path } : { level: 'working' };
  }
  return { level: 'checkpoint', scope: ALL, checkpoint: target.checkpoint };
}

export default function HistoryView({ projectRoot, vc, onToast, navRequest }: HistoryViewProps) {
  // Seeded from the request rather than defaulting to the unfiltered list and correcting itself
  // in an effect. Correcting it later means the first paint is the WRONG list -- opening one
  // file's history would flash every checkpoint in the folder and fetch a page nobody asked for.
  const [nav, setNav] = useState<Nav>(() => navFor(navRequest?.target));
  const appliedNonce = useRef(navRequest?.nonce ?? 0);
  const [checkpoints, setCheckpoints] = useState<VcCheckpoint[]>([]);
  const [stats, setStats] = useState<Record<string, VcCheckpointStat>>({});
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoreAllTarget, setRestoreAllTarget] = useState<VcCheckpoint | null>(null);
  // The pending one-file restore. Set by either entry point (a file row in a checkpoint, or the
  // diff's own button) and cleared by the dialog; nothing is written until it confirms a
  // DIRECTION, which is the whole point of the dialog existing.
  const [restoreFileTarget, setRestoreFileTarget] =
    useState<{ checkpoint: VcCheckpoint; path: string; kind: VcChangeKind } | null>(null);

  const writable = vc.state.attach === 'managed';
  // The working levels have no scope of their own; they sit under the unfiltered list.
  const scope: Scope = 'scope' in nav ? nav.scope : ALL;
  // A plain string, not the scope object: the load effect depends on it, and a fresh object
  // identity on every render would refetch forever.
  const scopePath = scope.kind === 'file' ? scope.path : '';

  // External navigation: the Browse button, a sidebar checkpoint, or "view change history" on a
  // file. Browse sends `all`, which is also what makes it ZOOM BACK OUT when the tab is already
  // open two levels deep -- that is what someone pressing "Browse all checkpoints" is asking for.
  useEffect(() => {
    if (!navRequest || navRequest.nonce === appliedNonce.current) return;
    appliedNonce.current = navRequest.nonce;
    setNav(navFor(navRequest.target));
  }, [navRequest?.nonce]);

  useEffect(() => {
    if (!projectRoot) return;
    let cancelled = false;
    setLoading(true);
    const page = scopePath
      ? window.mde.vcFileHistory(projectRoot, scopePath, { limit: PAGE_SIZE })
      : window.mde.vcHistory(projectRoot, { limit: PAGE_SIZE });
    page.then(result => {
      if (cancelled) return;
      setCheckpoints(result);
      setExhausted(result.length < PAGE_SIZE);
      setLoading(false);
      // A checkpoint being viewed may have just been retitled, so re-read it from the fresh
      // page rather than leaving a stale subject in the breadcrumb and header.
      setNav(prev => {
        if (prev.level !== 'checkpoint' && prev.level !== 'file') return prev;
        const fresh = result.find(c => c.sha === prev.checkpoint.sha);
        return fresh ? { ...prev, checkpoint: fresh } : prev;
      });
    });
    return () => { cancelled = true; };
  }, [projectRoot, vc.historyKey, scopePath]);

  // The diff-stat bars, fetched after the list rather than with it: measuring a checkpoint costs
  // a diff per file it changed, and the list must not wait on that. Keyed by sha, which is a
  // content address, so the map is a CACHE -- paging in older checkpoints, or the refetch a
  // retitle triggers, never re-measures a checkpoint that has already been measured.
  useEffect(() => {
    if (!projectRoot) return;
    const missing = checkpoints.filter(c => !(c.sha in stats)).map(c => c.sha);
    if (missing.length === 0) return;
    let cancelled = false;
    window.mde.vcCheckpointStats(projectRoot, missing).then(result => {
      if (cancelled) return;
      // A sha the main process could not read at all is recorded as zero files rather than left
      // absent, or every render would ask about it again.
      const merged: Record<string, VcCheckpointStat> = {};
      for (const sha of missing) merged[sha] = result[sha] ?? { files: 0 };
      setStats(prev => ({ ...prev, ...merged }));
    });
    return () => { cancelled = true; };
  }, [projectRoot, checkpoints, stats]);

  const loadMore = useCallback(async () => {
    if (!projectRoot) return;
    const last = checkpoints[checkpoints.length - 1];
    if (!last) return;
    const opts = { limit: PAGE_SIZE, before: last.sha };
    const more = scopePath
      ? await window.mde.vcFileHistory(projectRoot, scopePath, opts)
      : await window.mde.vcHistory(projectRoot, opts);
    setCheckpoints(prev => [...prev, ...more]);
    if (more.length < PAGE_SIZE) setExhausted(true);
  }, [projectRoot, checkpoints, scopePath]);

  // `sha` is the direction the dialog chose: the checkpoint itself, or its parent.
  const confirmRestoreFile = useCallback(async (sha: string) => {
    if (!projectRoot || !restoreFileTarget) return;
    const filePath = restoreFileTarget.path;
    setBusy(true);
    try {
      const outcome = await restoreOneFile(projectRoot, sha, filePath);
      setRestoreFileTarget(null);
      onToast(outcome.message, outcome.variant);
      if (outcome.changed) await vc.refresh();
    } finally {
      setBusy(false);
    }
  }, [projectRoot, restoreFileTarget, onToast, vc]);

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

  if (vc.state.attach === 'none' || vc.state.attach === 'off') {
    return (
      <div className="history-view history-empty qa-hist-off">
        <p>Checkpoints are off for this folder.</p>
        <p className="small text-muted">
          Turn them on in Settings, under Checkpoints.
        </p>
      </div>
    );
  }

  return (
    <div className="history-view qa-hist-view">
      <div className="history-crumbs qa-hist-crumbs">
        <button
          className="history-crumb qa-hist-crumb-root"
          disabled={nav.level === 'list' && nav.scope.kind === 'all'}
          onClick={() => setNav({ level: 'list', scope: ALL })}
        >
          Checkpoints
        </button>
        {scope.kind === 'file' && (
          <>
            <i className="bi bi-chevron-right history-crumb-sep" />
            <button
              className="history-crumb qa-hist-crumb-scope"
              disabled={nav.level === 'list'}
              onClick={() => setNav({ level: 'list', scope })}
            >
              Changes to {basename(scope.path) || scope.path}
            </button>
          </>
        )}
        {(nav.level === 'checkpoint' || nav.level === 'file') && (
          <>
            <i className="bi bi-chevron-right history-crumb-sep" />
            <button
              className="history-crumb qa-hist-crumb-checkpoint"
              disabled={nav.level === 'checkpoint'}
              onClick={() => setNav({ level: 'checkpoint', scope, checkpoint: nav.checkpoint })}
            >
              {nav.checkpoint.subject}
            </button>
          </>
        )}
        {/* Occupies the checkpoint crumb's slot, because that is what it is: the pending
            checkpoint, the one that has not happened yet. */}
        {(nav.level === 'working' || nav.level === 'workingFile') && (
          <>
            <i className="bi bi-chevron-right history-crumb-sep" />
            <button
              className="history-crumb qa-hist-crumb-working"
              disabled={nav.level === 'working'}
              onClick={() => setNav({ level: 'working' })}
            >
              Unsaved changes
            </button>
          </>
        )}
        {(nav.level === 'file' || nav.level === 'workingFile') && (
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
            stats={stats}
            scope={scope}
            loading={loading}
            exhausted={exhausted}
            writable={writable}
            onOpen={checkpoint => setNav({ level: 'checkpoint', scope, checkpoint })}
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
            onOpenFile={path => setNav({ level: 'file', scope, checkpoint: nav.checkpoint, path })}
            onRestoreFile={(path, kind) =>
              setRestoreFileTarget({ checkpoint: nav.checkpoint, path, kind })}
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
            onClose={() => setNav({ level: 'checkpoint', scope, checkpoint: nav.checkpoint })}
            onRestore={
              writable
                ? (path, kind) => setRestoreFileTarget({ checkpoint: nav.checkpoint, path, kind })
                : undefined
            }
            // The one place the file-scoped list is discoverable without a right-click: you are
            // already looking at one file and "what else happened to this?" is the next thought.
            onViewFileHistory={
              scopePath === nav.path
                ? undefined
                : () => setNav({ level: 'list', scope: { kind: 'file', path: nav.path } })
            }
          />
        )}

        {nav.level === 'working' && (
          <div className="qa-hist-working">
            <div className="history-detail-header">
              <div className="history-detail-title">
                <div className="history-detail-subject">Unsaved changes</div>
                <div className="small text-muted">
                  Everything that has moved since the last checkpoint. Save one and this list
                  becomes the next entry in the history.
                </div>
              </div>
            </div>
            {/* The SAME component the sidebar renders, not a wider copy of it. */}
            <ChangesSection
              projectRoot={projectRoot}
              files={vc.files}
              onToast={onToast}
              onSaved={vc.refresh}
              onOpenDiff={path => setNav({ level: 'workingFile', path })}
            />
          </div>
        )}

        {nav.level === 'workingFile' && (
          <DiffView
            variant="inline"
            projectRoot={projectRoot}
            filePath={nav.path}
            // No sha: DiffView compares the working copy against the last checkpoint.
            subtitle="Compared with the last checkpoint -- not saved to history yet"
            onClose={() => setNav({ level: 'working' })}
            // Deliberately no Restore. Every restore in this app puts a file back to a version
            // that IS in the history; throwing away work that was never checkpointed is a
            // different and unrecoverable thing, and it is not what this button means anywhere
            // else.
            onViewFileHistory={() => setNav({ level: 'list', scope: { kind: 'file', path: nav.path } })}
          />
        )}
      </div>

      {restoreFileTarget && (
        <RestoreFileDialog
          projectRoot={projectRoot}
          filePath={restoreFileTarget.path}
          checkpoint={restoreFileTarget.checkpoint}
          kind={restoreFileTarget.kind}
          busy={busy}
          onConfirm={confirmRestoreFile}
          onCancel={() => setRestoreFileTarget(null)}
        />
      )}

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
  stats: Record<string, VcCheckpointStat>;
  scope: Scope;
  loading: boolean;
  exhausted: boolean;
  writable: boolean;
  onOpen: (checkpoint: VcCheckpoint) => void;
  onLoadMore: () => void;
  onSaveTitle: (sha: string, title: string) => Promise<void>;
}

function CheckpointList({ checkpoints, stats, scope, loading, exhausted, writable, onOpen, onLoadMore, onSaveTitle }: CheckpointListProps) {
  if (loading) return <div className="history-empty text-muted">Loading...</div>;
  if (checkpoints.length === 0) {
    return (
      <div className="history-empty text-muted qa-hist-empty">
        {scope.kind === 'file'
          ? `No checkpoint has changed ${basename(scope.path) || scope.path} yet.`
          : 'No checkpoints yet.'}
      </div>
    );
  }

  return (
    <>
      {scope.kind === 'file' && (
        <div className="history-scope-header qa-hist-scope-header">
          <i className="bi bi-file-earmark-text" />
          <div>
            <div className="history-scope-path">{scope.path}</div>
            <div className="small text-muted">
              {checkpoints.length === 1
                ? '1 checkpoint changed this file'
                : `${checkpoints.length} checkpoints changed this file`}
            </div>
          </div>
        </div>
      )}
      <div className="history-list qa-hist-list">
        {checkpoints.map(checkpoint => (
          // The WHOLE row drills in -- there is no "see what changed" button, because a row that
          // is entirely clickable does not need one and the width is better spent on the title.
          // Not a <button>: the pencil is a button too, and nesting them is invalid HTML.
          <div
            key={checkpoint.sha}
            className="history-row qa-hist-checkpoint"
            role="button"
            tabIndex={0}
            onClick={() => onOpen(checkpoint)}
            onKeyDown={e => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onOpen(checkpoint);
            }}
          >
            <i className={`bi ${CHECKPOINT_ICON[checkpoint.kind]} history-row-icon`} />
            <div className="history-row-main">
              <EditableTitle
                checkpoint={checkpoint}
                writable={writable}
                className="history-row-subject qa-hist-subject"
                onSave={onSaveTitle}
              />
              {/* The counts share the timestamp's line rather than sitting beside the title,
                  so a long checkpoint description can run the full width of the row. */}
              <div className="history-row-meta small">
                <span className="text-muted text-truncate">
                  {formatAbsoluteTime(checkpoint.timestamp)} &middot;{' '}
                  {formatRelativeTime(checkpoint.timestamp)} &middot; {KIND_LABEL[checkpoint.kind]}
                </span>
                <CheckpointStat stat={stats[checkpoint.sha]} />
              </div>
            </div>
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

// --- The per-checkpoint counts --------------------------------------------------------

/**
 * How much a checkpoint moved: files touched, then lines added and removed. The two line
 * counts are formatted exactly as they are on the file rows inside a checkpoint (`FileCounts`),
 * so the same numbers never appear in two different shapes.
 *
 * Zeros are dropped rather than printed, and a checkpoint whose lines could not be measured
 * shows only its file count -- see `checkpointStats` for why that is not a zero.
 */
function CheckpointStat({ stat }: { stat: VcCheckpointStat | undefined }) {
  if (!stat) return null;
  return (
    <span
      className="history-stat qa-hist-stat"
      data-files={stat.files}
      data-added={stat.added}
      data-removed={stat.removed}
    >
      <span className="text-warning">{stat.files === 1 ? '1 file' : `${stat.files} files`}</span>
      {stat.added ? <span className="text-success">+{stat.added}</span> : null}
      {stat.removed ? <span className="text-danger">&minus;{stat.removed}</span> : null}
    </span>
  );
}

// --- Level 2: one checkpoint ----------------------------------------------------------

interface CheckpointDetailProps {
  projectRoot: string;
  checkpoint: VcCheckpoint;
  writable: boolean;
  busy: boolean;
  onOpenFile: (path: string) => void;
  onRestoreFile: (path: string, kind: VcChangeKind) => void;
  onRestoreAll: () => void;
  onSaveTitle: (sha: string, title: string) => Promise<void>;
}

function CheckpointDetail({
  projectRoot, checkpoint, writable, busy, onOpenFile, onRestoreFile, onRestoreAll, onSaveTitle,
}: CheckpointDetailProps) {
  const [files, setFiles] = useState<VcChangedFile[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFiles(null);
    setLoadError(null);
    window.mde.vcCheckpointFiles(projectRoot, checkpoint.sha, { counts: true }).then(
      result => { if (!cancelled) setFiles(result); },
      (err: Error) => {
        if (!cancelled) setLoadError(err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
      },
    );
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
        {/* "to here" is dropped from the label for the same reason the one-file button says only
            "Restore": WHICH side of the checkpoint you land on is the ambiguity, and a button
            label is the wrong place to answer it. The dialog has room to. */}
        {writable && (
          <button className="btn btn-sm qa-hist-restore-all" disabled={busy} onClick={onRestoreAll}>
            Restore everything
          </button>
        )}
      </div>

      {loadError !== null && (
        <div className="vc-notice vc-notice-danger qa-hist-detail-error">
          Could not read this checkpoint&apos;s changes. {loadError}
        </div>
      )}

      {files === null && loadError === null && <div className="history-empty text-muted">Loading...</div>}

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
                  onClick={() => onRestoreFile(file.path, file.kind)}
                >
                  Restore
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
}

function EditableTitle({ checkpoint, writable, className, onSave }: EditableTitleProps) {
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
      // In the list, this sits inside a row that drills in on click. Renaming must not also
      // navigate away, so nothing in here is allowed to reach the row.
      <div className="history-title-edit" onClick={e => e.stopPropagation()}>
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
      <span className={className}>{checkpoint.subject}</span>
      {writable && (
        <button
          className="btn-plain history-title-pencil qa-hist-title-edit"
          data-tooltip="Change this description"
          aria-label="Change this description"
          onClick={e => { e.stopPropagation(); begin(); }}
        >
          <i className="bi bi-pencil" />
        </button>
      )}
    </div>
  );
}
