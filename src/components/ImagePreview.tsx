import React, { useState } from 'react';
import { basename } from '../utils/paths';
import { localImageUrl } from '../utils/imageNode';

// Read-only view of an image file, scaled down to fit the pane and never up past its natural size.
export default function ImagePreview({ filePath }: { filePath: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="editor-wrapper qa-image-preview">
      <div className="image-preview">
        {failed ? (
          <p className="text-danger qa-image-preview-error">Could not show {basename(filePath)}.</p>
        ) : (
          <img src={localImageUrl(filePath)} alt={basename(filePath)} onError={() => setFailed(true)} />
        )}
      </div>
    </div>
  );
}
