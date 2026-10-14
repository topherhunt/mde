import React, { useCallback, useEffect, useRef, useState } from 'react';
import { basename } from '../utils/paths';
import { localImageUrl } from '../utils/imageNode';
import type { PreviewOutlineItem } from '../types';

type OnOutline = (tabId: string, items: PreviewOutlineItem[]) => void;
type OnOutlineActive = (tabId: string, active: number) => void;
interface OutlineProps { tabId: string; filePath: string; onOutline: OnOutline; onOutlineActive: OnOutlineActive }

// Read-only view of a .pdf/.docx, with a bar offering to convert it. A PDF shows in Chromium's
// built-in viewer, which only needs `mde-file:` to serve it as application/pdf; a DOCX shows as
// mammoth's HTML, sanitized. Each reports its outline, and which entry to highlight, to the sidebar.
export default function ImportPreview({ tabId, filePath, onConvert, onOpenFile, onOutline, onOutlineActive }: {
  tabId: string;
  filePath: string;
  onConvert: (filePath: string, opts?: { newCopy?: boolean }) => Promise<void>;
  onOpenFile: (filePath: string) => void;
  onOutline: OnOutline;
  onOutlineActive: OnOutlineActive;
}) {
  const isPdf = /\.pdf$/i.test(filePath);
  return (
    <div className="editor-wrapper qa-import-preview">
      <ImportBar filePath={filePath} onConvert={onConvert} onOpenFile={onOpenFile} />
      {isPdf
        ? <PdfPreview tabId={tabId} filePath={filePath} onOutline={onOutline} onOutlineActive={onOutlineActive} />
        : <DocxPreview tabId={tabId} filePath={filePath} onOutline={onOutline} onOutlineActive={onOutlineActive} />}
    </div>
  );
}

// The viewer ignores a `#page=N` hash change on a loaded document, so a jump remounts the frame.
// `toolbar=0&navpanes=0` drops the viewer's own toolbar and thumbnail pane; the sidebar is the outline.
// The viewer's scroll position is out of reach inside its own frame, so the highlight is the last jump.
function PdfPreview({ tabId, filePath, onOutline, onOutlineActive }: OutlineProps) {
  const [jump, setJump] = useState({ page: 0, nonce: 0 });

  useEffect(() => {
    window.mde.previewPdfOutline(filePath).then((entries) => onOutline(tabId, entries.map((e, i) => ({
      level: Math.min(e.level, 6),
      text: e.title,
      select: () => {
        setJump((j) => ({ page: e.page, nonce: j.nonce + 1 }));
        onOutlineActive(tabId, i);
      },
    }))));
  }, [tabId, filePath, onOutline, onOutlineActive]);

  const hash = `#toolbar=0&navpanes=0${jump.page ? `&page=${jump.page}` : ''}`;
  return <iframe key={jump.nonce} className="pdf-preview qa-pdf-preview" src={localImageUrl(filePath) + hash} title={basename(filePath)} />;
}

// Sits where the toolbar would. Carries the caveats the old confirm dialog showed, and once a
// Markdown exists beside the source, offers to open it rather than convert again.
function ImportBar({ filePath, onConvert, onOpenFile }: {
  filePath: string;
  onConvert: (filePath: string, opts?: { newCopy?: boolean }) => Promise<void>;
  onOpenFile: (filePath: string) => void;
}) {
  const [target, setTarget] = useState<{ mdPath: string; exists: boolean } | null>(null);
  const [converting, setConverting] = useState(false);
  const fileName = basename(filePath);

  const refresh = useCallback(() => {
    window.mde.getImportTarget(filePath).then(setTarget);
  }, [filePath]);
  useEffect(refresh, [refresh]);

  const convert = async (opts?: { newCopy?: boolean }) => {
    setConverting(true);
    try {
      await onConvert(filePath, opts);
    } finally {
      setConverting(false);
      refresh();
    }
  };

  const mdName = target ? basename(target.mdPath) : '';
  return (
    <div className="import-bar d-flex align-items-center gap-3 qa-import-bar">
      <i className="bi bi-eye text-muted" />
      <div className="flex-grow-1">
        {target?.exists ? (
          <>
            <div className="fw-semibold">Already converted to <code>{mdName}</code></div>
            <div className="small text-muted">Converting again writes a new numbered copy; it never overwrites <code>{mdName}</code>.</div>
          </>
        ) : (
          <>
            <div className="fw-semibold">Previewing <code>{fileName}</code> -- convert it to Markdown to edit it</div>
            <div className="small text-muted">Creates <code>{mdName || `${fileName}.md`}</code> beside it. <code>{fileName}</code> is left untouched, and some formatting may be simplified.</div>
          </>
        )}
      </div>
      {target && (target.exists ? (
        <>
          <button className="btn qa-reconvert" disabled={converting} onClick={() => convert({ newCopy: true })}>
            {converting ? 'Converting...' : 'Convert again'}
          </button>
          <button className="btn btn-primary qa-open-existing" disabled={converting} onClick={() => onOpenFile(target.mdPath)}>
            Open {mdName}
          </button>
        </>
      ) : (
        <button className="btn btn-primary qa-convert" disabled={converting} onClick={() => convert()}>
          {converting ? 'Converting...' : 'Convert to Markdown'}
        </button>
      ))}
    </div>
  );
}

function DocxPreview({ tabId, filePath, onOutline, onOutlineActive }: OutlineProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHtml(null);
    setError(null);
    window.mde.previewDocx(filePath).then(
      (raw) => setHtml(sanitizeDocxHtml(raw)),
      (err) => setError(String(err?.message || err)),
    );
  }, [filePath]);

  useEffect(() => {
    if (error !== null) { onOutline(tabId, []); return; }
    if (html === null) return;
    // React re-applies the innerHTML after this runs, detaching any element captured now, so each
    // entry finds its heading again by index when clicked.
    const headings = () => Array.from(contentRef.current!.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6'));
    onOutline(tabId, headings().map((el, i) => ({
      level: Number(el.tagName[1]),
      text: el.textContent || '',
      select: () => headings()[i].scrollIntoView({ block: 'start' }),
    })));

    // Highlight the heading the reader is under, by the same reading line as the Markdown outline:
    // the last heading whose top has reached the scroller's top padding.
    const scroller = scrollerRef.current!;
    const padTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    let raf = 0;
    const recompute = () => {
      raf = 0;
      const line = scroller.getBoundingClientRect().top + padTop + 4;
      const list = headings();
      let active = -1;
      while (active + 1 < list.length && list[active + 1].getBoundingClientRect().top <= line + 8) active++;
      onOutlineActive(tabId, active);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(recompute); };
    recompute();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [tabId, html, error, onOutline, onOutlineActive]);

  // Links never navigate the app window: `#id` jumps within the preview (mammoth's footnotes and
  // bookmarks), anything else goes to the browser (main only honours http/https).
  const handleClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#')) {
      contentRef.current?.querySelector(`[id="${CSS.escape(href.slice(1))}"]`)?.scrollIntoView({ behavior: 'smooth' });
    } else if (href) {
      window.mde.openExternal(href);
    }
  };

  return (
    <div ref={scrollerRef} className="editor-content editor-readonly">
      {error ? (
        <p className="text-danger qa-docx-preview-error">Could not preview this file: {error}</p>
      ) : html === null ? (
        <p className="text-muted">Loading preview...</p>
      ) : (
        // `.tiptap` borrows the editor's typography, so the preview reads like the converted file will.
        <div ref={contentRef} className="tiptap qa-docx-preview" onClick={handleClick} dangerouslySetInnerHTML={{ __html: html }} />
      )}
    </div>
  );
}

// mammoth emits a small, fixed vocabulary, but attribute VALUES come from the document -- a
// `javascript:` href would run with the preload bridge in reach. Keep only known tags and safe values.
const ALLOWED_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'SUP', 'SUB', 'BR',
  'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG', 'BLOCKQUOTE', 'PRE', 'CODE']);
const ALLOWED_ATTRS: Record<string, (value: string) => boolean> = {
  href: (v) => /^(https?:|mailto:|#)/i.test(v),
  src: (v) => /^data:image\//i.test(v),
  alt: () => true,
  id: () => true,
  colspan: (v) => /^\d+$/.test(v),
  rowspan: (v) => /^\d+$/.test(v),
};

export function sanitizeDocxHtml(raw: string): string {
  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html');
  const clean = (el: Element) => {
    for (const child of Array.from(el.children)) {
      if (!ALLOWED_TAGS.has(child.tagName)) {
        // Unwrap rather than drop, so no text disappears with an unexpected wrapper.
        clean(child);
        child.replaceWith(...Array.from(child.childNodes));
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const ok = ALLOWED_ATTRS[attr.name];
        if (!ok || !ok(attr.value.trim())) child.removeAttribute(attr.name);
      }
      clean(child);
    }
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
