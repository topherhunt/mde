import React from 'react';
import { Tab } from '../types';

interface TabBarProps {
  tabs: Tab[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
}

export default function TabBar({ tabs, activeIndex, onSelect, onClose }: TabBarProps) {
  if (tabs.length === 0) return null;

  return (
    <div className="tab-bar">
      {tabs.map((tab, i) => (
        <div
          key={tab.id}
          className={`tab ${i === activeIndex ? 'active' : ''} ${tab.conflict ? 'conflict' : ''}`}
          onClick={() => onSelect(i)}
          onAuxClick={(e) => {
            if (e.button === 1) onClose(i);
          }}
        >
          <span className="tab-name">
            {tab.dirty && <span className="tab-dirty-dot" title="Unsaved changes" />}
            {tab.fileName}
          </span>
          <button
            className="tab-close"
            onClick={(e) => {
              e.stopPropagation();
              onClose(i);
            }}
            title="Close tab"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
