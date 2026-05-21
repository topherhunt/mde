import React, { useEffect, useRef, useState } from 'react';
import { Tab } from '../types';

interface TabBarProps {
  tabs: Tab[];
  activeIndex: number;
  onSelect: (index: number) => void;
  onClose: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onPinTab: (tabId: string) => void;
}

export default function TabBar({ tabs, activeIndex, onSelect, onClose, onReorder, onPinTab }: TabBarProps) {
  const activeTabRef = useRef<HTMLDivElement>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [activeIndex, tabs.length]);

  if (tabs.length === 0) return null;

  const handleDragStart = (e: React.DragEvent, i: number) => {
    setDragIndex(i);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));
  };

  const handleDragOver = (e: React.DragEvent, i: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragIndex === null) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const midX = rect.left + rect.width / 2;
    const target = e.clientX < midX ? i : i + 1;
    if (target !== dragIndex && target !== dragIndex + 1) {
      setDropIndex(target);
    } else {
      setDropIndex(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (dragIndex !== null && dropIndex !== null) {
      const to = dropIndex > dragIndex ? dropIndex - 1 : dropIndex;
      if (to !== dragIndex) {
        onReorder(dragIndex, to);
      }
    }
    setDragIndex(null);
    setDropIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDropIndex(null);
  };

  return (
    <div className="tab-bar" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
      {tabs.map((tab, i) => (
        <React.Fragment key={tab.id}>
          {dropIndex === i && <div className="tab-drop-indicator" />}
          <div
            ref={i === activeIndex ? activeTabRef : undefined}
            className={`tab ${i === activeIndex ? 'active' : ''} ${tab.conflict ? 'conflict' : ''} ${tab.tentative ? 'tentative' : ''} ${dragIndex === i ? 'dragging' : ''}`}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={handleDragEnd}
            onClick={() => onSelect(i)}
            onDoubleClick={() => { if (tab.tentative) onPinTab(tab.id); }}
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
        </React.Fragment>
      ))}
      {dropIndex === tabs.length && <div className="tab-drop-indicator" />}
    </div>
  );
}
