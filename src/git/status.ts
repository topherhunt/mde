// What has changed since the last checkpoint, and the quiet-detection signature.
// See CHECKPOINTS.md "Detection: poll status, gate on the watcher".

import * as fs from 'fs';
import * as path from 'path';
import git from 'isomorphic-git';
import { VcChangedFile, VcChangeKind } from '../types';

// statusMatrix row shape: [filepath, HEAD, WORKDIR, STAGE]
//   HEAD:    0 absent, 1 present
//   WORKDIR: 0 absent, 1 identical to HEAD, 2 different from HEAD
// We never leave the index dirty (see "the index is transient"), so STAGE is ignored here.
const FILE = 0;
const HEAD = 1;
const WORKDIR = 2;

export interface StatusResult {
  files: VcChangedFile[];
  durationMs: number;
}

function classify(head: number, workdir: number): VcChangeKind | null {
  if (head === 0 && workdir !== 0) return 'added';
  if (head === 1 && workdir === 0) return 'deleted';
  if (head === 1 && workdir === 2) return 'modified';
  return null; // unchanged
}

/**
 * Authoritative "what differs from HEAD". Gitignored files never appear in the result --
 * verified empirically, and the whole detection design rests on it.
 *
 * Measured at ~52-74ms on a repo with 33k gitignored entries. isomorphic-git descends into
 * ignored directories rather than pruning them, but only enumerates (no stat, no hash), so
 * the marginal cost is ~0.8us per ignored file. The self-calibrating poll interval in
 * checkpointer.ts covers whatever pathological folder shows up in the wild.
 */
export async function computeStatus(root: string): Promise<StatusResult> {
  const t0 = Date.now();
  // `refresh: false` keeps this call READ-ONLY with respect to the index.
  //
  // With the default (true), statusMatrix writes fresh file stats into the index for every
  // file it hashes. Those cached stats are trusted by the next status (see the racy-clean
  // note in checkpoint.ts) and mtime granularity is one second -- so a status that happens
  // to run in the same second as an agent's write would cache stats that make a LATER
  // same-second, same-size write invisible, with nothing following it to undo the damage.
  // Only `createCheckpoint` is allowed to populate the stat cache, because it is the one
  // place that can immediately re-check what it recorded.
  const matrix = await git.statusMatrix({ fs, dir: root, refresh: false });
  const files: VcChangedFile[] = [];
  for (const row of matrix) {
    const kind = classify(row[HEAD] as number, row[WORKDIR] as number);
    if (kind) files.push({ path: row[FILE] as string, kind });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, durationMs: Date.now() - t0 };
}

/**
 * Quiet-detection signature. Two identical signatures 60s apart means nothing is in flight.
 *
 * THE TRAP THIS EXISTS TO CLOSE: statusMatrix's WORKDIR field is a coarse enum (absent /
 * same / different), NOT a content hash. Writing different content to the same file twice
 * produces the identical row both times, so a signature built from the matrix alone reports
 * "quiet" mid-burst and commits a half-finished agent operation -- precisely what the settle
 * window exists to prevent. Folding in mtime and size fixes it. Only the changed files are
 * stat'ed, and there are usually few, so the fast path is preserved.
 */
export function statusSignature(root: string, files: VcChangedFile[]): string {
  const parts: string[] = [];
  for (const f of files) {
    if (f.kind === 'deleted') {
      parts.push(`${f.path}:deleted`);
      continue;
    }
    try {
      const st = fs.statSync(path.join(root, f.path));
      parts.push(`${f.path}:${f.kind}:${st.mtimeMs}:${st.size}`);
    } catch {
      // Vanished between the status walk and now -- that is itself a change, so make the
      // signature differ from any previous one rather than silently matching.
      parts.push(`${f.path}:gone`);
    }
  }
  return parts.join('\n');
}
