import React, { useEffect, useRef, useState } from 'react';
import { VcChangeKind, VcCheckpoint } from '../types';
import { formatRelativeTime } from './VersionPanel';

/**
 * The confirm step for restoring ONE file, and the answer to the question that made a bare
 * "put this version back" button unsafe: when you are staring at a checkpoint's red-and-green
 * diff, "restore to this checkpoint" is genuinely ambiguous. Do you want the file the way it
 * was BEFORE that change, or the way it came out AFTER it?
 *
 * So the dialog does not ask for a yes/no on one hidden interpretation. It offers BOTH, side by
 * side, tinted with the diff's own red and green so the mapping needs no explaining: the left
 * card is the red side (the checkpoint's parent), the right card is the green side (the
 * checkpoint itself). Cancel is the only way out that changes nothing.
 *
 * Both directions run through the same `restoreFile`, which already handles "the file did not
 * exist at that sha" by deleting it -- so undoing a checkpoint that CREATED the file works with
 * no extra machinery. It just has to be said out loud, which is what `kind` is for.
 */
interface RestoreFileDialogProps {
  projectRoot: string;
  filePath: string; // repo-relative
  checkpoint: VcCheckpoint;
  // What this checkpoint did to this file. 'added' means undoing removes it; 'deleted' means
  // taking the after-version removes it. Either way the dialog says so before you commit to it.
  kind: VcChangeKind;
  busy: boolean;
  // The sha to restore to -- the checkpoint's parent for "undo", its own for "use this version".
  onConfirm: (sha: string) => void;
  onCancel: () => void;
}

export default function RestoreFileDialog({
  projectRoot, filePath, checkpoint, kind, busy, onConfirm, onCancel,
}: RestoreFileDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  // null until counted; -1 when it could not be counted. Never collapsed into a plain 0: "not
  // counted yet" and "nothing came after" have to stay distinguishable, or the warning's
  // ABSENCE is unfalsifiable -- it looks identical either way, which is also what made a test
  // for it pass against a broken build.
  const [later, setLater] = useState<number | null>(null);

  // Restoring ONE file always discards every later change to it, not just this checkpoint's --
  // the file goes back to a point in time, and everything after that point goes with it. That is
  // the one consequence a person cannot infer from the two cards, so it is counted and stated.
  useEffect(() => {
    let cancelled = false;
    window.mde.vcFileHistory(projectRoot, filePath).then(list => {
      if (cancelled) return;
      const index = list.findIndex(c => c.sha === checkpoint.sha);
      // Off the end of the page means the count would be a guess. Say nothing instead: a wrong
      // number here is worse than no number, because this is the line people act on.
      setLater(index < 0 ? -1 : index);
    });
    return () => { cancelled = true; };
  }, [projectRoot, filePath, checkpoint.sha]);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const when = formatRelativeTime(checkpoint.timestamp);
  const parent = checkpoint.parent;

  return (
    // `data-later` appears only once the count has landed. Nothing in the UI reads it; it is
    // there so a test can tell "the warning is absent" from "the warning has not arrived yet".
    <div
      className="modal-backdrop qa-restore-file-dialog"
      data-later={later ?? undefined}
      onMouseDown={onCancel}
    >
      <div className="modal-dialog modal-dialog-wide" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">Restore {filePath}</span>
          <button className="btn-plain" aria-label="Close" onClick={onCancel}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="modal-body">
          <p className="small text-muted">Which version do you want back?</p>

          <div className="restore-choices">
            <div className="restore-choice restore-choice-before">
              <div className="fw-bold">Before this change</div>
              <div className="small text-muted">the red side of the diff</div>
              <p className="small mt-2">
                {parent ? (
                  <>
                    How it was just before <strong>{checkpoint.subject}</strong>, {when}.
                  </>
                ) : (
                  <>This is the very first checkpoint, so there is nothing before it.</>
                )}
              </p>
              {parent && kind === 'added' && (
                <p className="small text-danger qa-restore-before-note">
                  This checkpoint created {filePath}, so this removes the file.
                </p>
              )}
              <button
                className="btn btn-sm qa-restore-before"
                disabled={busy || !parent}
                onClick={() => parent && onConfirm(parent)}
              >
                Undo this change
              </button>
            </div>

            <div className="restore-choice restore-choice-after">
              <div className="fw-bold">After this change</div>
              <div className="small text-muted">the green side of the diff</div>
              <p className="small mt-2">
                How it was at the end of <strong>{checkpoint.subject}</strong>, {when}.
              </p>
              {kind === 'deleted' && (
                <p className="small text-danger qa-restore-after-note">
                  This checkpoint deleted {filePath}, so this removes the file.
                </p>
              )}
              <button
                ref={confirmRef}
                className="btn btn-primary btn-sm qa-restore-after"
                disabled={busy}
                onClick={() => onConfirm(checkpoint.sha)}
              >
                Use this version
              </button>
            </div>
          </div>

          {later !== null && later > 0 && (
            <p className="small restore-later qa-restore-later">
              <i className="bi bi-info-circle" />{' '}
              {later === 1 ? '1 later checkpoint' : `${later} later checkpoints`} also changed this
              file. Either choice undoes {later === 1 ? 'that' : 'those'} too.
            </p>
          )}

          <div className="d-flex gap-2 justify-content-between align-items-center mt-3">
            <span className="small text-muted">
              MDE saves a checkpoint of your current version first, so you can come back.
            </span>
            <button className="btn qa-restore-file-cancel" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
