import React, { useEffect } from 'react';

export type DeleteImageChoice = 'trash' | 'keep';

// Asked when an edit removes the document's last reference to an image file on disk.
export default function DeleteImageDialog({ files, onChoose, onCancel }: {
  files: string[];
  onChoose: (choice: DeleteImageChoice) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const many = files.length > 1;
  return (
    <div className="modal-backdrop qa-delete-image" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">{many ? `Delete ${files.length} image files too?` : 'Delete the image file too?'}</span>
        </div>
        <div className="modal-body">
          <p className="small">{many ? 'These files are' : 'This file is'} no longer shown in this document:</p>
          <ul className="small mt-1">
            {files.map((f) => <li key={f}><code>{f}</code></li>)}
          </ul>
          <p className="small text-muted mt-2">Deleting moves {many ? 'them' : 'it'} to the Trash. Other documents that show {many ? 'them' : 'it'} will find {many ? 'them' : 'it'} missing.</p>
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn qa-delete-image-cancel" onClick={onCancel}>Cancel</button>
            <button className="btn btn-danger qa-delete-image-trash" onClick={() => onChoose('trash')}>Delete {many ? 'Files' : 'File'}</button>
            <button className="btn btn-primary qa-delete-image-keep" autoFocus onClick={() => onChoose('keep')}>Keep {many ? 'Files' : 'File'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
