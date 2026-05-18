import React from 'react';

interface ConflictBannerProps {
  onReload: () => void;
  onSaveAs: () => void;
}

export default function ConflictBanner({ onReload, onSaveAs }: ConflictBannerProps) {
  return (
    <div className="conflict-banner">
      <span className="conflict-banner-text">
        This file was modified on disk. Your unsaved changes may conflict.
        Copy your work before reloading.
      </span>
      <div className="conflict-banner-actions">
        <button className="conflict-btn conflict-btn-saveas" onClick={onSaveAs}>
          Save As...
        </button>
        <button className="conflict-btn conflict-btn-reload" onClick={onReload}>
          Reload from Disk
        </button>
      </div>
    </div>
  );
}
