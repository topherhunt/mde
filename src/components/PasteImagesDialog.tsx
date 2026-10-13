import React, { useEffect, useState } from 'react';
import type { PendingPaste, WebImageChoice } from '../utils/pasteImages';

// Asks where pasted, dropped, or picked images go. Image files can only be saved (or cancelled); images
// in pasted web content can also stay as links or be dropped. `canSave` is false for a document
// that has never been saved, since there is no folder to save beside.
export default function PasteImagesDialog({ pending, canSave, onChoose, onCancel }: {
  pending: PendingPaste;
  canSave: boolean;
  onChoose: (choice: WebImageChoice, folder: string) => void;
  onCancel: () => void;
}) {
  const [folder, setFolder] = useState('images');
  const web = pending.kind === 'web';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onCancel(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const save = () => { if (canSave) onChoose('save', folder.trim()); };

  return (
    <div className="modal-backdrop qa-paste-images" onClick={onCancel}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="fw-bold">{web ? 'The pasted content has images' : pending.files.length > 1 ? `Add ${pending.files.length} images` : 'Add image'}</span>
        </div>
        <div className="modal-body">
          {canSave ? (
            <>
              <label className="small fw-bold" htmlFor="paste-images-folder">Save {web || pending.files.length > 1 ? 'images' : 'the image'} to this folder, next to the document</label>
              <input
                id="paste-images-folder"
                className="form-control mt-1 qa-paste-images-folder"
                value={folder}
                autoFocus
                onChange={(e) => setFolder(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } }}
              />
            </>
          ) : (
            <p className="small text-muted">Save the document first, so there is a folder to keep {web ? 'images' : 'the image'} in.</p>
          )}
          {web && pending.embedded > 0 && (
            <p className="small text-muted mt-2">Images embedded in the copied page can only be saved or removed, not kept as links.</p>
          )}
          <div className="d-flex justify-content-end gap-2 mt-3">
            <button className="btn qa-paste-images-cancel" onClick={onCancel}>Cancel</button>
            {web && <button className="btn qa-paste-images-remove" onClick={() => onChoose('remove', folder)}>Remove Images</button>}
            {web && <button className="btn qa-paste-images-links" onClick={() => onChoose('links', folder)}>Keep as Links</button>}
            <button className="btn btn-primary qa-paste-images-save" disabled={!canSave || !folder.trim()} onClick={save}>Save to Folder</button>
          </div>
        </div>
      </div>
    </div>
  );
}
