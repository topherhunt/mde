// The sidebar panel: the GLANCE, and nothing else.
//
// It answers one question -- what has moved since the last checkpoint -- and offers the one
// action that answers it (save a checkpoint). Every other checkpoint screen lives in the
// history tab. There is deliberately no checkpoint list here any more: it was a worse copy of
// the tab's list, with no counts, no rename, and no restore, over exactly the same data.
//
// The division of labour is now clean:
//   - This panel is the PRESENT. Live, glanceable, visible while you work.
//   - The history tab is the PAST. Every checkpoint, every diff, every restore.
//   - "Browse all checkpoints" is the bridge, and clicking any changed file crosses it too.
//
// Turning checkpoints on, and choosing whether they save themselves, live in Settings
// (`CheckpointSettings`, at the bottom of this file). Both are per-FOLDER settings sitting in
// an otherwise app-global dialog, which is why that section names the folder in its header.

import React, { useCallback, useEffect, useState } from 'react';
import { HistoryTarget, VcChangedFile, VcPreflight, VcState } from '../types';
import { basename } from '../utils/paths';

// --- Shared state -----------------------------------------------------------------
//
// Lifted out of the panel so the sidebar TAB can show the changed-file badge without the
// panel being mounted -- the badge is the whole point of the feature for someone who has
// just let an agent loose on their folder and wants to know whether anything moved.

export interface VersionControl {
  state: VcState;
  files: VcChangedFile[];
  // Why the last status check failed; `files` is empty and means nothing while this is set.
  // Cleared by the next successful status.
  error: string | null;
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
  const [error, setError] = useState<string | null>(null);
  const [historyKey, setHistoryKey] = useState(0);

  const refresh = useCallback(async () => {
    if (!projectRoot) {
      setState({ attach: 'none' });
      setFiles([]);
      setError(null);
      return;
    }
    const resolved = await window.mde.vcGetState(projectRoot);
    setState(resolved);
    if (resolved.attach === 'none' || resolved.attach === 'off') {
      setFiles([]);
      setError(null);
      return;
    }
    const status = await window.mde.vcGetStatus(projectRoot);
    setFiles(status.files);
    setError(status.error ?? null);
  }, [projectRoot]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The poller publishes status on every tick, which keeps the badge live on its own -- in
  // manual mode too, where the poller no longer commits but still walks the status.
  // The project watcher (2s debounce in the main process) is what makes it feel immediate.
  useEffect(() => {
    const offStatus = window.mde.onVcStatus(payload => {
      if (payload.root !== projectRoot) return;
      setFiles(payload.files);
      setError(null);
    });
    const offStatusError = window.mde.onVcStatusError(payload => {
      if (payload.root === projectRoot) setError(payload.error);
    });
    const offCheckpoint = window.mde.onVcCheckpoint(payload => {
      if (payload.root === projectRoot) setHistoryKey(k => k + 1);
    });
    const offFiles = window.mde.onProjectFilesChanged(() => { void refresh(); });
    return () => { offStatus(); offStatusError(); offCheckpoint(); offFiles(); };
  }, [projectRoot, refresh]);

  const bumpHistory = useCallback(() => setHistoryKey(k => k + 1), []);

  return { state, files, error, historyKey, refresh, bumpHistory };
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
  onOpenSettings: () => void;
}

export default function VersionPanel({
  projectRoot, vc, onToast, onOpenHistory, onOpenSettings,
}: VersionPanelProps) {
  const { state, files } = vc;
  const [showHelp, setShowHelp] = useState(false);

  if (!projectRoot) {
    return <div className="sidebar-empty qa-vc-no-folder">Open a folder to start saving checkpoints.</div>;
  }

  const writable = state.attach === 'managed';

  return (
    <div className="vc-panel qa-vc-panel">
      <div className="vc-header">
        <span className="vc-header-title">Checkpoints</span>
        <button
          className="btn-plain qa-vc-help-toggle"
          data-tooltip="How checkpoints work"
          aria-label="How checkpoints work"
          onClick={() => setShowHelp(true)}
        >
          <i className="bi bi-question-circle" />
        </button>
      </div>

      {showHelp && <CheckpointHelpDialog writable={writable} onClose={() => setShowHelp(false)} />}

      {/* Turning it on lives in Settings, so this is a signpost rather than a control. The
          explanation stays HERE rather than moving with the button: nobody browses Settings,
          and a bare "Open Settings" button would make the feature vanish for the people it
          was built for. */}
      {state.attach === 'none' && (
        <div className="vc-intro qa-vc-intro">
          <p>Checkpoints are off for this folder.</p>
          <p className="text-muted small">
            Turn them on and MDE can save a snapshot of everything here as you work --
            including changes made by Claude or any other program. You can look back at what
            changed and put any file (or the whole folder) back the way it was.
          </p>
          <button className="btn btn-primary mt-2 qa-vc-open-settings" onClick={onOpenSettings}>
            Open Settings to turn them on
          </button>
        </div>
      )}

      {state.attach === 'off' && (
        <div className="vc-notice qa-vc-off">
          <div className="small">
            Checkpoints are turned off for this folder, so MDE is not watching it for changes.
          </div>
          <button className="btn btn-sm mt-2 qa-vc-open-settings" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}

      {(state.attach === 'foreign' || state.attach === 'steppedBack') && (
        <div className="vc-notice qa-vc-readonly">
          <div className="small">{state.reason}</div>
          <button className="btn btn-sm mt-2 qa-vc-open-settings" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}

      {/* In place of the changes list, whose emptiness would otherwise read as "nothing changed". */}
      {vc.error && (
        <div className="vc-notice vc-notice-danger qa-vc-status-error">
          <div className="small fw-bold">Could not check this folder for changes.</div>
          <div className="small">{vc.error}</div>
        </div>
      )}

      {writable && !vc.error && (
        <ChangesSection
          projectRoot={projectRoot}
          files={files}
          onToast={onToast}
          onSaved={vc.refresh}
          onOpenDiff={path => onOpenHistory({ kind: 'working', path })}
        />
      )}

      {state.attach !== 'none' && state.attach !== 'off' && (
        <div className="vc-section">
          <button
            className="btn btn-sm vc-browse-btn qa-vc-browse"
            onClick={() => onOpenHistory({ kind: 'all' })}
          >
            <i className="bi bi-clock-history" /> Browse all checkpoints
          </button>
        </div>
      )}
    </div>
  );
}

// --- Help ---------------------------------------------------------------------------

/**
 * The how-it-works recap. A dialog rather than an inline card in the sidebar, because it is
 * nine paragraphs of explanation and the sidebar is 250px wide.
 *
 * Reachable from two places -- the "?" in the panel header and the same "?" in Settings --
 * so someone deciding whether to turn the feature on can read what it does first.
 */
export function CheckpointHelpDialog({ writable, onClose }: { writable: boolean; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Both entry points can sit ON TOP of the Settings dialog, which has its own Escape
      // handler on `window`. Document listeners run first, so stopping here is what makes
      // Escape close the thing you are looking at instead of both at once.
      e.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop qa-vc-help" onMouseDown={onClose}>
      <div className="modal-dialog modal-dialog-wide" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">How checkpoints work</span>
          <button className="btn-plain qa-vc-help-close" aria-label="Close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="modal-body">
          <ul className="vc-help-list small">
            {/* The one place "Git" is named. Everywhere else in the UI it stays invisible on
                purpose -- but the credit belongs here, and knowing the history is kept in a
                standard, portable format is reassurance rather than jargon. */}
            <li className="qa-vc-help-git">
              Turn this on and MDE keeps a history of everything that changes in this folder. It
              is a simplified front end to <strong>Git</strong>, the version-control system
              programmers rely on -- you never have to touch Git itself.
            </li>
            <li>
              A <strong>checkpoint</strong> is a snapshot of every file in this folder at one
              moment.
            </li>
            <li>
              You decide when they happen. Out of the box you save them yourself, with the{' '}
              <em>Save checkpoint</em> button. Turn on{' '}
              <strong>Save checkpoints automatically</strong> in Settings and MDE also saves one
              on its own, at most about once every ten minutes, once things have been quiet for
              a moment.
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
          </ul>
        </div>
      </div>
    </div>
  );
}

// --- Changes ------------------------------------------------------------------------

interface ChangesSectionProps {
  projectRoot: string;
  files: VcChangedFile[];
  onToast: (msg: string, variant?: string) => void;
  onSaved: () => Promise<void> | void;
  onOpenDiff: (path: string) => void;
}

/**
 * What has moved since the last checkpoint, and the button that captures it.
 *
 * Mounted in TWO places -- the sidebar panel and the history tab's "Unsaved changes" level --
 * and exported rather than duplicated for the same reason restore goes through vcRestore.ts:
 * two implementations of one list is how the sidebar and the tab ended up wording the same
 * outcome differently. The message box and the save call live in here, so both mounts get the
 * same behaviour by construction; the only difference between them is the width they get.
 */
export function ChangesSection({
  projectRoot, files, onToast, onSaved, onOpenDiff,
}: ChangesSectionProps) {
  const [counts, setCounts] = useState<Record<string, { added?: number; removed?: number }>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const onSave = useCallback(async () => {
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
      await onSaved();
    } finally {
      setBusy(false);
    }
  }, [projectRoot, message, onToast, onSaved]);

  // Fetched separately from the list, and re-fetched on every status update rather than only
  // when the SET of paths changes -- editing the same file again moves its numbers without
  // changing the list. `files` is a fresh array on every poll broadcast, which is exactly the
  // cadence we want: the counts can never be stale, and the cost is bounded by the poll
  // interval, not by typing speed.
  useEffect(() => {
    if (files.length === 0) {
      setCounts({});
      return;
    }
    let cancelled = false;
    window.mde.vcStatusCounts(projectRoot, files.map(f => f.path)).then(result => {
      if (!cancelled) setCounts(result);
    });
    return () => { cancelled = true; };
  }, [projectRoot, files]);

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
              <ChangeCounts count={counts[file.path]} />
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
          onChange={e => setMessage(e.target.value)}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter' && files.length > 0) void onSave();
          }}
        />
        <button
          className="btn btn-sm btn-primary qa-vc-save"
          disabled={busy || files.length === 0}
          onClick={() => void onSave()}
        >
          Save checkpoint
        </button>
      </div>
    </div>
  );
}

/**
 * How far one uncommitted file has moved. Formatted exactly as the counts inside a checkpoint
 * (`FileCounts` in HistoryView), so the same numbers never appear in two different shapes.
 *
 * An unmeasured file renders NOTHING rather than "+0 -0" -- absent means binary or oversized,
 * and a zero would read as "this file did not really change", which is a lie.
 */
function ChangeCounts({ count }: { count: { added?: number; removed?: number } | undefined }) {
  if (!count || (!count.added && !count.removed)) return null;
  return (
    <span className="vc-file-counts small qa-vc-change-counts">
      {count.added ? <span className="text-success">+{count.added}</span> : null}
      {count.removed ? <span className="text-danger">&minus;{count.removed}</span> : null}
    </span>
  );
}

// --- Settings -------------------------------------------------------------------------

interface CheckpointSettingsProps {
  projectRoot: string | null;
  vc: VersionControl;
  onToast: (msg: string, variant?: string) => void;
}

/**
 * The Checkpoints section of the Settings dialog: turn the feature on for this folder, and
 * decide whether MDE saves checkpoints by itself.
 *
 * Every other row in Settings is an app-wide preference in mde-state.json; these two live in
 * this folder's .git/config and travel with the folder. That mismatch is real, so the header
 * names the folder rather than pretending the setting is global.
 *
 * There is no "turn checkpoints off" button, and that is not an omission. Manual mode already
 * means MDE writes nothing to the folder unless asked -- an extra off switch would be a second
 * control for the same idea, and the only thing it could add is deleting the history, which
 * this feature never does.
 */
export function CheckpointSettings({ projectRoot, vc, onToast }: CheckpointSettingsProps) {
  const { state, refresh } = vc;
  const [showHelp, setShowHelp] = useState(false);
  const [initPreflight, setInitPreflight] = useState<VcPreflight | null>(null);
  const [busy, setBusy] = useState(false);

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

  const setAuto = useCallback(async (auto: boolean) => {
    if (!projectRoot) return;
    const result = await window.mde.vcSetAuto(projectRoot, auto);
    if (!result.ok) {
      onToast(result.error || 'Could not change that setting.', 'danger');
      return;
    }
    await refresh();
  }, [projectRoot, onToast, refresh]);

  const setOff = useCallback(async (off: boolean) => {
    if (!projectRoot) return;
    await window.mde.vcSetOff(projectRoot, off);
    await refresh();
  }, [projectRoot, refresh]);

  const canAdopt =
    state.attach === 'foreign' && !state.hasRemote && (state.branchCount ?? 1) <= 1;

  return (
    <div className="qa-settings-vc">
      <div className="settings-row">
        <div>
          <div className="fw-bold">
            Checkpoints
            {projectRoot && <> for <code>{basename(projectRoot) || projectRoot}</code></>}
          </div>
          <div className="small text-muted">
            {/* Named per folder because it IS per folder. Someone who sets this on one project
                and opens another would otherwise expect it to have carried. */}
            An undo history for this whole folder. This setting applies to this folder only.
          </div>
        </div>
        <button
          className="btn-plain qa-settings-vc-help"
          data-tooltip="How checkpoints work"
          aria-label="How checkpoints work"
          onClick={() => setShowHelp(true)}
        >
          <i className="bi bi-question-circle" />
        </button>
      </div>

      {!projectRoot && (
        <div className="small text-muted mt-2 qa-settings-vc-no-folder">
          Open a folder to use checkpoints.
        </div>
      )}

      {projectRoot && state.attach === 'none' && (
        <div className="settings-row mt-2">
          <div className="small text-muted">
            MDE will start keeping a history of everything that changes here, including changes
            made by Claude or any other program.
          </div>
          <button className="settings-btn qa-settings-vc-enable" disabled={busy} onClick={startInit}>
            Turn on checkpoints
          </button>
        </div>
      )}

      {projectRoot && (state.attach === 'foreign' || state.attach === 'steppedBack') && (
        <div className="settings-row mt-2">
          <div className="small text-muted qa-settings-vc-readonly">{state.reason}</div>
          {canAdopt && (
            <button className="settings-btn qa-settings-vc-adopt" disabled={busy} onClick={adopt}>
              Let MDE save checkpoints here
            </button>
          )}
        </div>
      )}

      {projectRoot && state.attach === 'managed' && (
        <div className="settings-row mt-2">
          <div>
            <div className="fw-bold qa-settings-vc-on">Save checkpoints automatically</div>
            <div className="small text-muted">
              {/* Says what the cadence rule actually does. "Every 10-15 minutes" would promise a
                  checkpoint on an idle folder, where the answer is zero. */}
              Roughly every ten minutes, when something has changed and things have gone quiet.
              With this off, checkpoints are saved only when you press <em>Save checkpoint</em>.
            </div>
          </div>
          {/* The qa hook is on the LABEL, not the input: the input is opacity-0 and zero-sized,
              so it is the label a person (or a test) actually clicks. */}
          <label className="settings-toggle qa-settings-vc-auto">
            <input
              type="checkbox"
              checked={state.auto === true}
              onChange={e => void setAuto(e.target.checked)}
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
      )}

      {/* The off switch. Hidden on a folder with no history, where there is nothing to watch.
          Turning it off deletes nothing, which is why it can be a toggle at all. */}
      {projectRoot && state.attach !== 'none' && (
        <div className="settings-row mt-2">
          <div>
            <div className="fw-bold">Watch this folder for changes</div>
            <div className="small text-muted">
              Turn this off if this folder&apos;s history is so large that it slows MDE down.
              Nothing is deleted, and you can turn it back on at any time.
            </div>
          </div>
          <label className="settings-toggle qa-settings-vc-watch">
            <input
              type="checkbox"
              checked={state.attach !== 'off'}
              onChange={e => void setOff(!e.target.checked)}
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
      )}

      {showHelp && (
        <CheckpointHelpDialog
          writable={state.attach === 'managed'}
          onClose={() => setShowHelp(false)}
        />
      )}

      {initPreflight && projectRoot && (
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
      if (e.key !== 'Escape') return;
      e.preventDefault();
      // Sits on top of the Settings dialog -- see the same note in CheckpointHelpDialog.
      e.stopPropagation();
      onCancel();
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
          <p className="small text-muted">
            You save them yourself to begin with. If you would rather MDE did it for you, turn on{' '}
            <strong>Save checkpoints automatically</strong> afterwards.
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
  checkpoint: { subject: string; timestamp: number; parent?: string };
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RestoreAllDialog({ checkpoint, busy, onConfirm, onCancel }: RestoreAllDialogProps) {
  const confirmRef = React.useRef<HTMLButtonElement>(null);

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
