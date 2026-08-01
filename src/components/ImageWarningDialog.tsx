import React, { useEffect, useRef } from 'react';

/**
 * The warning shown when a file you just opened contains images MDE cannot hold.
 *
 * There is no image node in the editor's schema, so an `![alt](path)` reference is dropped the
 * moment the document loads and is simply absent when it is serialized back -- open, type one
 * character, save, and the image line is gone from the file with nothing said. Until the editor
 * grows a real image node (see TASKS.md), the honest thing is to say so up front rather than let
 * someone discover it from a diff weeks later.
 *
 * It is deliberately a blocking modal and not a toast. A toast is the right weight for "this
 * happened"; this is "your file is about to lose content", it is the only warning there will be,
 * and it has to survive not being looked at for ten seconds.
 */
const MAX_LISTED = 8;

interface ImageWarningDialogProps {
  fileName: string;
  // The image syntax found in the file, verbatim, so it is recognisable in the file itself.
  refs: string[];
  onDismiss: () => void;
}

export default function ImageWarningDialog({ fileName, refs, onDismiss }: ImageWarningDialogProps) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dismissRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onDismiss(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const listed = refs.slice(0, MAX_LISTED);
  const rest = refs.length - listed.length;

  return (
    <div className="modal-backdrop qa-image-warning" onMouseDown={onDismiss}>
      <div className="modal-dialog modal-dialog-wide" onMouseDown={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold text-danger">
            <i className="bi bi-exclamation-triangle-fill" /> MDE cannot edit this file safely
          </span>
          <button className="btn-plain" aria-label="Close" onClick={onDismiss}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <div className="modal-body">
          <p>
            <strong>{fileName}</strong> contains{' '}
            {refs.length === 1 ? 'an image' : `${refs.length} images`}, and MDE does not support
            images yet. {refs.length === 1 ? 'It has' : 'They have'} already been dropped from the
            editor below -- <strong>saving this file will remove {refs.length === 1 ? 'it' : 'them'} from
            the file on disk.</strong>
          </p>

          <div className="image-warning-refs qa-image-warning-refs">
            {listed.map((ref, i) => <div key={i}><code>{ref}</code></div>)}
            {rest > 0 && <div className="text-muted">and {rest} more</div>}
          </div>

          <p className="small text-muted mt-3">
            To keep {refs.length === 1 ? 'it' : 'them'}: close this file without saving, and edit it
            somewhere else for now. If you have already saved, the previous version is in this
            folder's checkpoint history, provided checkpoints are turned on.
          </p>

          <div className="d-flex justify-content-end mt-3">
            <button
              ref={dismissRef}
              className="btn btn-primary qa-image-warning-dismiss"
              onClick={onDismiss}
            >
              I understand
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
