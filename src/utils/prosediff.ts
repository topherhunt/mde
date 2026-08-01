// Turning two versions of a file into something a novelist can read.
//
// A unified diff is a programmer's format: it thinks in lines, and a paragraph of prose is
// ONE line. Change three words in a 400-word paragraph and `git diff` shows the whole
// paragraph deleted and the whole paragraph re-added, which tells the reader nothing.
//
// So: line diff for structure (which paragraphs moved, appeared, vanished), then a WORD
// diff inside each replaced block to highlight what actually changed within it. That second
// pass is the entire point -- without it this feature would be useless for the audience it
// exists for.

import { diffLines, diffWordsWithSpace, Change } from 'diff';

export type RowType = 'context' | 'added' | 'removed' | 'gap';

export interface DiffSegment {
  text: string;
  // True for the words that actually differ, within an otherwise-similar line.
  changed: boolean;
}

export interface DiffRow {
  type: RowType;
  segments: DiffSegment[];
  beforeLine: number | null;
  afterLine: number | null;
  // Only on gap rows: how many unchanged lines were collapsed away.
  hiddenCount?: number;
}

const CONTEXT_LINES = 3;
// Below this many context lines a gap marker costs more than it saves.
const MIN_COLLAPSE = CONTEXT_LINES * 2 + 2;

/** Split a diff chunk into lines without inventing a trailing empty one. */
function toLines(value: string): string[] {
  const lines = value.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Re-assemble one side of a word diff into rows.
 *
 * Word-diff output is a flat stream of fragments that may each span several lines, so this
 * has to re-split on newlines while carrying the changed flag across the split -- the
 * fiddly part, and the reason this is a named function rather than inline.
 */
function rowsFromWordDiff(
  changes: Change[],
  side: 'before' | 'after',
  startLine: number
): DiffRow[] {
  const type: RowType = side === 'before' ? 'removed' : 'added';
  const rows: DiffRow[] = [];
  let segments: DiffSegment[] = [];
  let line = startLine;

  const pushRow = () => {
    rows.push({
      type,
      segments: segments.length ? segments : [{ text: '', changed: false }],
      beforeLine: side === 'before' ? line : null,
      afterLine: side === 'after' ? line : null,
    });
    line++;
    segments = [];
  };

  for (const change of changes) {
    // Each side only shows the fragments that exist on it.
    if (side === 'before' && change.added) continue;
    if (side === 'after' && change.removed) continue;
    const changed = side === 'before' ? !!change.removed : !!change.added;

    const pieces = change.value.split('\n');
    pieces.forEach((piece, i) => {
      if (i > 0) pushRow();
      if (piece) segments.push({ text: piece, changed });
    });
  }
  // A trailing newline in the source leaves an empty final row; drop it.
  if (segments.length > 0) pushRow();
  else if (rows.length === 0) pushRow();

  return rows;
}

function contextRow(text: string, beforeLine: number, afterLine: number): DiffRow {
  return {
    type: 'context',
    segments: [{ text, changed: false }],
    beforeLine,
    afterLine,
  };
}

/**
 * Collapse long stretches of unchanged text into a single "N unchanged lines" marker,
 * keeping a few lines of context on either side of every change.
 */
function collapseContext(rows: DiffRow[]): DiffRow[] {
  const keep = new Array<boolean>(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type === 'context') continue;
    for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(rows.length - 1, i + CONTEXT_LINES); j++) {
      keep[j] = true;
    }
  }

  const out: DiffRow[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push(rows[i]);
      i++;
      continue;
    }
    let end = i;
    while (end < rows.length && !keep[end]) end++;
    const hidden = end - i;
    if (hidden >= MIN_COLLAPSE) {
      out.push({
        type: 'gap',
        segments: [],
        beforeLine: null,
        afterLine: null,
        hiddenCount: hidden,
      });
    } else {
      for (let j = i; j < end; j++) out.push(rows[j]);
    }
    i = end;
  }
  return out;
}

export interface BuiltDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  // True when the two versions are byte-identical.
  identical: boolean;
}

export function buildDiff(before: string | null, after: string | null): BuiltDiff {
  const a = before ?? '';
  const b = after ?? '';
  if (a === b) return { rows: [], added: 0, removed: 0, identical: true };

  const parts = diffLines(a, b);
  const rows: DiffRow[] = [];
  let beforeLine = 1;
  let afterLine = 1;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];

    if (!part.added && !part.removed) {
      for (const text of toLines(part.value)) {
        rows.push(contextRow(text, beforeLine++, afterLine++));
      }
      continue;
    }

    // A removal immediately followed by an addition is a REPLACEMENT -- the case worth
    // spending a word diff on, and the case that makes prose diffs readable.
    const next = parts[i + 1];
    if (part.removed && next && next.added) {
      const wordChanges = diffWordsWithSpace(part.value, next.value);
      const removedRows = rowsFromWordDiff(wordChanges, 'before', beforeLine);
      const addedRows = rowsFromWordDiff(wordChanges, 'after', afterLine);
      rows.push(...removedRows, ...addedRows);
      beforeLine += removedRows.length;
      afterLine += addedRows.length;
      i++; // consumed the addition too
      continue;
    }

    for (const text of toLines(part.value)) {
      rows.push({
        type: part.added ? 'added' : 'removed',
        segments: [{ text, changed: true }],
        beforeLine: part.added ? null : beforeLine++,
        afterLine: part.added ? afterLine++ : null,
      });
    }
  }

  const added = rows.filter(r => r.type === 'added').length;
  const removed = rows.filter(r => r.type === 'removed').length;
  return { rows: collapseContext(rows), added, removed, identical: false };
}
