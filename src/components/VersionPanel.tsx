// The sidebar panel: the GLANCE. What has moved since the last checkpoint, and a button to save
// one. It deliberately does NOT drill into checkpoints -- clicking one routes to the history
// tab, which is the only thing in the app that renders a checkpoint's files, a diff of one, or
// a restore of either. Two drill-downs over the same data is how the two views ended up
// describing the same restore differently; there is now exactly one.
//
// The one diff this panel still opens is for the CHANGES list, which is uncommitted work with
// no checkpoint to route to -- and is genuinely a glance-and-dismiss modal.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { HistoryTarget, VcChangedFile, VcCheckpoint, VcPreflight, VcState } from '../types';
import DiffView from './DiffView';
import { basename } from '../utils/paths';

// --- Shared state -----------------------------------------------------------------
//
// Lifted out of the panel so the sidebar TAB can show the changed-file badge without the
// panel being mounted -- the badge is the whole point of the feature for someone who has
// just let an agent loose on their folder and wants to know whether anything moved.

export interface VersionControl {
  state: VcState;
  files: VcChangedFile[];
  // Bumped on every checkpoint so the history list refetches.
  historyKey: number;
  refresh: () => Promise<void>;
  // For changes that alter what history READS return without creating a checkpoint -- a
  // retitle is the only one. Shared so the sidebar list and the history tab can't show two
  // different names for the same moment.
  bumpHistory: () => void;
}

export function useVersionControl(projectRoot: string | null): VersionControl {
  const [state, setState] = useState<VcState>({ attach: 'none' });
  const [files, setFiles] = useState<VcChangedFile[]>([]);
  const [historyKey, setHistoryKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!projectRoot) {
      setState({ attach: 'none' });
      setFiles([]);
      return;
    }
    const resolved = await window.mde.vcGetState(projectRoot);
    setState(resolved);
    if (resolved.attach === 'none') {
      setFiles([]);
      return;
    }
    const status = await window.mde.vcGetStatus(projectRoot);
    setFiles(status.files);
  }, [projectRoot]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The poller publishes status on every tick, which keeps the badge live on its own.
  // The project watcher (2s debounce in the main process) is what makes it feel immediate.
  useEffect(() => {
    const offStatus = window.mde.onVcStatus(payload => {
      if (payload.root === projectRoot) setFiles(payload.files);
    });
    const offCheckpoint = window.mde.onVcCheckpoint(payload => {
      if (payload.root === projectRoot) setHistoryKey(k => k + 1);
    });
    const offFiles = window.mde.onProjectFilesChanged(() => { void refresh(); });
    return () => { offStatus(); offCheckpoint(); offFiles(); };
  }, [projectRoot, refresh]);

  const bumpHistory = useCallback(() => setHistoryKey(k => k + 1), []);

  return { state, files, historyKey, refresh, bumpHistory };
}

// --- Formatting -------------------------------------------------------------------

export function formatRelativeTime(timestamp: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

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

// --- Panel ------------------------------------------------------------------------

interface VersionPanelProps {
  projectRoot: string | null;
  vc: VersionControl;
  onToast: (msg: string, variant?: string) => void;
  // Opens the full-page history tab, pointed at whatever was clicked. The sidebar stays the
  // glance; that tab is where browsing, diffing, renaming, and restoring actually happen.
  onOpenHistory: (target: HistoryTarget) => void;
}

export default function VersionPanel({ projectRoot, vc, onToast, onOpenHistory }: VersionPanelProps) {
  const { state, files, historyKey, refresh } = vc;
  const [showHelp, setShowHelp] = useState(false);
  const [initPreflight, setInitPreflight] = useState<VcPreflight | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  // Uncommitted changes only -- always working-copy-vs-last-checkpoint, never restorable.
  const [diffPath, setDiffPath] = useState<string | null>(null);

  const startInit = useCallback(async () => {
    if (!projectRoot) return;
    setBusy(true);
    try {
      setInitPreflight(await window.mde.vcPreflight(projectRoot));
    } finally {
      setBusy(false);
    }
  }, [projectRoot]);

  const confirmInit = useCallback(async () => {
    if (!projectRoot) return;
    setBusy(true);
    try {
      const result = await window.mde.vcInit(projectRoot);
      if (!result.ok) {
        onToast(result.error || 'Could not turn on checkpoints.', 'danger');
        return;
      }
      setInitPreflight(null);
      // First run: the recap is the whole reason someone can use this without a manual.
      setShowHelp(true);
      onToast('Checkpoints are on. Your folder was saved to history.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [projectRoot, onToast, refresh]);

  const adopt = useCallback(async () => {
    if (!projectRoot) return;
    setBusy(true);
    try {
      const result = await window.mde.vcAdopt(projectRoot);
      if (!result.ok) {
        onToast(result.error || 'Could not turn on checkpoints.', 'danger');
        return;
      }
      await refresh();
      const resolved = await window.mde.vcGetState(projectRoot);
      if (resolved.attach === 'managed') onToast('MDE is now saving checkpoints for this folder.');
      else onToast(resolved.reason || 'This folder stays read-only.', 'info');
    } finally {
      setBusy(false);
    }
  }, [projectRoot, onToast, refresh]);

  const saveCheckpoint = useCallback(async () => {
    if (!projectRoot) return;
    setBusy(true);
    try {
      const result = await window.mde.vcCheckpoint(projectRoot, message.trim() || undefined);
      if (!result.ok) {
        onToast(result.error || 'Could not save a checkpoint.', 'danger');
        return;
      }
      if (!result.sha) {
        onToast('Nothing has changed since the last checkpoint.', 'info');
        return;
      }
      setMessage('');
      onToast('Checkpoint saved.');
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [projectRoot, message, onToast, refresh]);

  if (!projectRoot) {
    return <div className="sidebar-empty qa-vc-no-folder">Open a folder to start saving checkpoints.</div>;
  }

  const writable = state.attach === 'managed';
  const canAdopt =
    state.attach === 'foreign' && !state.hasRemote && (state.branchCount ?? 1) <= 1;

  return (
    <div className="vc-panel qa-vc-panel">
      <div className="vc-header">
        <span className="vc-header-title">Checkpoints</span>
        <button
          className="btn-plain qa-vc-help-toggle"
          data-tooltip="How checkpoints work"
          aria-label="How checkpoints work"
          onClick={() => setShowHelp(v => !v)}
        >
          <i className={showHelp ? 'bi bi-question-circle-fill' : 'bi bi-question-circle'} />
        </button>
      </div>

      {showHelp && <HelpCard writable={writable} onClose={() => setShowHelp(false)} />}

      {state.attach === 'none' && (
        <div className="vc-intro qa-vc-intro">
          <p>
            Checkpoints are off for this folder.
          </p>
          <p className="text-muted small">
            Turn them on and MDE quietly saves a snapshot of everything here as you work --
            including changes made by Claude or any other program. You can look back at what
            changed and put any file (or the whole folder) back the way it was.
          </p>
          <button className="btn btn-primary mt-2 qa-vc-enable" disabled={busy} onClick={startInit}>
            Turn on checkpoints
          </button>
        </div>
      )}

      {(state.attach === 'foreign' || state.attach === 'steppedBack') && (
        <div className="vc-notice qa-vc-readonly">
          <div className="small">{state.reason}</div>
          {canAdopt && (
            <button className="btn btn-sm mt-2 qa-vc-adopt" disabled={busy} onClick={adopt}>
              Let MDE save checkpoints here
            </button>
          )}
        </div>
      )}

      {writable && (
        <ChangesSection
          files={files}
          message={message}
          busy={busy}
          onMessageChange={setMessage}
          onSave={saveCheckpoint}
          onOpenDiff={setDiffPath}
        />
      )}

      {state.attach !== 'none' && (
        <HistorySection
          projectRoot={projectRoot}
          historyKey={historyKey}
          onOpenHistory={onOpenHistory}
        />
      )}

      {diffPath && (
        <DiffView
          projectRoot={projectRoot}
          filePath={diffPath}
          subtitle="Compared with the last checkpoint"
          onClose={() => setDiffPath(null)}
          onViewFileHistory={() => {
            setDiffPath(null);
            onOpenHistory({ kind: 'file', path: diffPath });
          }}
        />
      )}

      {initPreflight && (
        <InitDialog
          projectRoot={projectRoot}
          preflight={initPreflight}
          busy={busy}
          onConfirm={confirmInit}
          onCancel={() => setInitPreflight(null)}
        />
      )}
    </div>
  );
}

// --- Help ---------------------------------------------------------------------------

function HelpCard({ writable, onClose }: { writable: boolean; onClose: () => void }) {
  return (
    <div className="vc-help qa-vc-help">
      <div className="d-flex justify-content-between align-items-center">
        <span className="fw-semibold">How checkpoints work</span>
        <button className="btn-plain" aria-label="Close" onClick={onClose}>
          <i className="bi bi-x-lg" />
        </button>
      </div>
      <ul className="vc-help-list small">
        {/* The one place "Git" is named. Everywhere else in the UI it stays invisible on purpose
            -- but the credit belongs here, and knowing the history is kept in a standard,
            portable format is reassurance rather than jargon. */}
        <li className="qa-vc-help-git">
          Turn this on and MDE saves a checkpoint of everything you change in this folder, every
          ten to thirty minutes, without being asked. It is a simplified, automatic front end to{' '}
          <strong>Git</strong>, the version-control system programmers rely on -- you never have
          to touch Git itself.
        </li>
        <li>
          A <strong>checkpoint</strong> is a snapshot of every file in this folder at one
          moment. MDE saves one automatically after things have been quiet for a bit, and
          at most about once every ten minutes.
        </li>
        <li>
          <strong>Changes</strong> lists everything that has moved since the last
          checkpoint -- yours and anything Claude or another program did. The number on the
          tab is that same count.
        </li>
        <li>
          Click any file to see <strong>exactly what changed</strong>. Added words are
          green, removed words are red.
        </li>
        <li>
          <strong>Browse all checkpoints</strong> opens the full history in a tab, where you
          can work back through every checkpoint, see how much each file changed, and give a
          checkpoint a clearer description with the pencil.
        </li>
        {writable && (
          <li>
            Don't like a change? In that tab, find the file inside a checkpoint and press{' '}
            <em>Restore</em>. MDE then asks which version you want: the way it was{' '}
            <em>before</em> that change, or the way it came out <em>after</em> it. You can also
            restore the whole folder to that point.
          </li>
        )}
        <li>
          To follow just one file, right-click it in the file list (or its tab) and choose{' '}
          <strong>View change history</strong>.
        </li>
        <li>
          Nothing is ever thrown away. Restoring adds a new checkpoint on top, so the
          version you had a moment ago is still there to go back to.
        </li>
        {writable && (
          <li>
            Want to mark a moment yourself? Type a short note and press{' '}
            <em>Save checkpoint</em>.
          </li>
        )}
      </ul>
    </div>
  );
}

// --- Changes ------------------------------------------------------------------------

interface ChangesSectionProps {
  files: VcChangedFile[];
  message: string;
  busy: boolean;
  onMessageChange: (value: string) => void;
  onSave: () => void;
  onOpenDiff: (path: string) => void;
}

function ChangesSection({ files, message, busy, onMessageChange, onSave, onOpenDiff }: ChangesSectionProps) {
  return (
    <div className="vc-section qa-vc-changes">
      <div className="vc-section-title">
        Changes{files.length > 0 ? ` (${files.length})` : ''}
      </div>

      {files.length === 0 ? (
        <div className="vc-empty small text-muted qa-vc-changes-empty">
          <i className="bi bi-check-circle text-success" /> Everything here is saved to history.
        </div>
      ) : (
        <div className="vc-file-list">
          {files.map(file => (
            <button
              key={file.path}
              className="vc-file-row qa-vc-change-row"
              title={file.path}
              onClick={() => onOpenDiff(file.path)}
            >
              <i className={`bi ${KIND_ICON[file.kind]} ${KIND_CLASS[file.kind]}`} />
              <span className="vc-file-name text-truncate">{basename(file.path) || file.path}</span>
            </button>
          ))}
        </div>
      )}

      <div className="vc-save-row">
        <input
          className="vc-message-input qa-vc-message"
          placeholder="What changed? (optional)"
          value={message}
          disabled={busy}
          onChange={e => onMessageChange(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter' && files.length > 0) onSave();
          }}
        />
        <button
          className="btn btn-sm btn-primary qa-vc-save"
          disabled={busy || files.length === 0}
          onClick={onSave}
        >
          Save checkpoint
        </button>
      </div>
    </div>
  );
}

// --- History ------------------------------------------------------------------------

const PAGE_SIZE = 30;

interface HistorySectionProps {
  projectRoot: string;
  historyKey: number;
  onOpenHistory: (target: HistoryTarget) => void;
}

function HistorySection({ projectRoot, historyKey, onOpenHistory }: HistorySectionProps) {
  const [checkpoints, setCheckpoints] = useState<VcCheckpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.mde.vcHistory(projectRoot, { limit: PAGE_SIZE }).then(result => {
      if (cancelled) return;
      setCheckpoints(result);
      setExhausted(result.length < PAGE_SIZE);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [projectRoot, historyKey]);

  const loadMore = useCallback(async () => {
    const last = checkpoints[checkpoints.length - 1];
    if (!last) return;
    const more = await window.mde.vcHistory(projectRoot, { limit: PAGE_SIZE, before: last.sha });
    setCheckpoints(prev => [...prev, ...more]);
    if (more.length < PAGE_SIZE) setExhausted(true);
  }, [projectRoot, checkpoints]);

  return (
    <div className="vc-section qa-vc-history">
      <div className="vc-section-title">History</div>

      <button
        className="btn btn-sm vc-browse-btn qa-vc-browse"
        onClick={() => onOpenHistory({ kind: 'all' })}
      >
        <i className="bi bi-clock-history" /> Browse all checkpoints
      </button>

      {loading && <div className="vc-empty small text-muted">Loading...</div>}

      {!loading && checkpoints.length === 0 && (
        <div className="vc-empty small text-muted qa-vc-history-empty">
          No checkpoints yet.
        </div>
      )}

      {checkpoints.map(checkpoint => (
        <CheckpointRow
          key={checkpoint.sha}
          checkpoint={checkpoint}
          onOpen={() => onOpenHistory({ kind: 'checkpoint', checkpoint })}
        />
      ))}

      {!loading && !exhausted && (
        <button className="btn btn-sm mt-2 qa-vc-more" onClick={loadMore}>
          Show older checkpoints
        </button>
      )}
    </div>
  );
}

const CHECKPOINT_ICON: Record<VcCheckpoint['kind'], string> = {
  auto: 'bi-clock',
  manual: 'bi-bookmark-fill',
  restore: 'bi-arrow-counterclockwise',
};

/** A one-line summary that opens the history tab at this checkpoint. No expansion, by design. */
function CheckpointRow({ checkpoint, onOpen }: { checkpoint: VcCheckpoint; onOpen: () => void }) {
  return (
    <div className="vc-checkpoint">
      <button className="vc-checkpoint-row qa-vc-checkpoint" onClick={onOpen}>
        <i className={`bi ${CHECKPOINT_ICON[checkpoint.kind]} vc-checkpoint-icon`} />
        <span className="vc-checkpoint-text">
          <span className="vc-checkpoint-subject text-truncate">{checkpoint.subject}</span>
          <span className="small text-muted">{formatRelativeTime(checkpoint.timestamp)}</span>
        </span>
        <i className="bi bi-chevron-right vc-checkpoint-chevron" />
      </button>
    </div>
  );
}

// --- Dialogs ------------------------------------------------------------------------

interface InitDialogProps {
  projectRoot: string;
  preflight: VcPreflight;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function InitDialog({ projectRoot, preflight, busy, onConfirm, onCancel }: InitDialogProps) {
  const blocked = preflight.parentRepo !== null;
  const large =
    preflight.totalBytes >= 500 * 1024 * 1024 ||
    preflight.fileCount >= 10000 ||
    preflight.largeFiles.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop qa-vc-init-dialog" onMouseDown={onCancel}>
      <div className="modal-dialog" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">Turn on checkpoints</span>
          <button className="btn-plain" aria-label="Close" onClick={onCancel}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="modal-body">
          <p className="small">
            MDE will start saving snapshots of <strong>{basename(projectRoot) || projectRoot}</strong>{' '}
            so you can see what changed and go back if you need to.
          </p>

          {blocked && (
            <div className="vc-warning vc-warning-danger mt-3 qa-vc-blocked">
              <div className="fw-semibold small">This folder can't be tracked on its own.</div>
              <div className="small">
                It sits inside <code>{preflight.parentRepo}</code>, which already has version
                history. Tracking it separately would tangle the two. Open a folder that
                isn't inside another tracked folder.
              </div>
            </div>
          )}

          {!blocked && preflight.childRepos.length > 0 && (
            <div className="vc-warning mt-3 qa-vc-warning-child">
              <div className="fw-semibold small">Some folders inside will be skipped.</div>
              <div className="small">
                {preflight.childRepos.slice(0, 5).map(r => <div key={r}><code>{r}</code></div>)}
                {preflight.childRepos.length > 5 && <div>...and {preflight.childRepos.length - 5} more</div>}
                These already keep their own history, so MDE will leave them alone.
              </div>
            </div>
          )}

          {!blocked && large && (
            <div className="vc-warning mt-3 qa-vc-warning-large">
              <div className="fw-semibold small">This is a big folder.</div>
              <div className="small">
                {preflight.fileCount.toLocaleString()}
                {preflight.truncated ? '+' : ''} files, about {formatBytes(preflight.totalBytes)}.
                {preflight.largeFiles.length > 0 && (
                  <> The largest is <code>{preflight.largeFiles[0].path}</code> at{' '}
                  {formatBytes(preflight.largeFiles[0].bytes)}.</>
                )}{' '}
                Checkpoints are built for folders of documents, not big media libraries --
                it will still work, but your mileage may vary on speed and disk use.
              </div>
            </div>
          )}

          {!blocked && preflight.cloudSync && (
            <div className="vc-warning mt-3 qa-vc-warning-cloud">
              <div className="fw-semibold small">This folder is in {preflight.cloudSync}.</div>
              <div className="small">
                That works, but if you have storage optimization turned on, checking for
                changes may pull files back down from the cloud.
              </div>
            </div>
          )}

          <div className="d-flex gap-2 justify-content-between mt-3">
            <button className="btn qa-vc-init-cancel" onClick={onCancel}>Cancel</button>
            {!blocked && (
              <button className="btn btn-primary qa-vc-init-confirm" disabled={busy} onClick={onConfirm}>
                Turn on checkpoints
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface RestoreAllDialogProps {
  checkpoint: VcCheckpoint;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreAllDialog({ checkpoint, busy, onConfirm, onCancel }: RestoreAllDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop qa-vc-restore-dialog" onMouseDown={onCancel}>
      <div className="modal-dialog" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">Restore the whole folder</span>
          <button className="btn-plain" aria-label="Close" onClick={onCancel}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="modal-body">
          {/* Says WHICH SIDE of the checkpoint you land on, because that is the same question the
              one-file dialog answers with two cards. It cannot be answered the same way here: for
              a whole folder, "before this checkpoint" IS the next checkpoint down the list, so a
              second button would just duplicate the neighbouring row inside every dialog. It is
              answered in words instead, and the alternative is named and pointed at. */}
          <p className="small">
            A checkpoint is a snapshot of the whole folder, saved <em>after</em> a batch of
            changes was finished. So this puts every file back to how it stood at the end of{' '}
            <strong>{checkpoint.subject}</strong> ({formatRelativeTime(checkpoint.timestamp)}) --
            that checkpoint's changes included.
          </p>
          {checkpoint.parent && (
            <p className="small text-muted mt-2 qa-vc-restore-before-hint">
              Want the folder the way it was <em>before</em> those changes? Cancel, and restore to
              the checkpoint just below this one instead -- that is the snapshot taken before it.
            </p>
          )}
          <p className="small text-muted mt-2">
            Files you have made since then will be removed from the folder. Nothing is lost:
            MDE saves a checkpoint of how things are right now first, so you can come
            straight back to it.
          </p>
          <div className="d-flex gap-2 justify-content-between mt-3">
            <button className="btn qa-vc-restore-cancel" onClick={onCancel}>Cancel</button>
            <button
              ref={confirmRef}
              className="btn btn-primary qa-vc-restore-confirm"
              disabled={busy}
              onClick={onConfirm}
            >
              Restore everything
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
