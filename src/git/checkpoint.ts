// Creating checkpoints. See CHECKPOINTS.md.
//
// Everything goes in, always. There is no subset and no selection, ever -- that is what
// buys the whole "no staged vs unstaged" simplification.

import * as fs from 'fs';
import * as path from 'path';
import git from 'isomorphic-git';
import { VcChangedFile } from '../types';
import { DEFAULT_AUTHOR } from './repo';
import { computeStatus } from './status';

export type CheckpointKind = 'auto' | 'manual' | 'restore';

export const TRAILER_KIND = 'MDE-Checkpoint';
export const TRAILER_RESTORE = 'MDE-Restore';

export interface CheckpointResult {
  sha: string;
  filesChanged: number;
  subject: string;
}

/**
 * Deterministic, local, instant, offline, private. No network call is ever on this path.
 *
 * Line counts are deliberately NOT computed here: they would cost a blob read and a diff
 * per file, and the changed-files panel already computes them on demand for the handful of
 * files it actually displays. Don't compute what you might not show.
 */
export function describeChanges(files: VcChangedFile[]): string {
  if (files.length === 0) return 'No changes';

  const added = files.filter(f => f.kind === 'added');
  const modified = files.filter(f => f.kind === 'modified');
  const deleted = files.filter(f => f.kind === 'deleted');

  if (files.length === 1) {
    const f = files[0];
    const verb = f.kind === 'added' ? 'Added' : f.kind === 'deleted' ? 'Deleted' : 'Updated';
    return `${verb} ${f.path}`;
  }

  const kinds = [added, modified, deleted].filter(g => g.length > 0);
  if (kinds.length === 1) {
    const verb = added.length ? 'Added' : deleted.length ? 'Deleted' : 'Updated';
    return `${verb} ${files.length} files`;
  }

  return `${files.length} files changed`;
}

function buildMessage(
  files: VcChangedFile[],
  kind: CheckpointKind,
  opts: { message?: string; restoreOf?: string }
): { subject: string; full: string } {
  const subject = (opts.message || '').trim() || describeChanges(files);
  const lines: string[] = [subject, ''];

  for (const f of files.slice(0, 100)) {
    const flag = f.kind === 'added' ? 'A' : f.kind === 'deleted' ? 'D' : 'M';
    lines.push(`${flag} ${f.path}`);
  }
  if (files.length > 100) lines.push(`... and ${files.length - 100} more`);

  // Trailers. These let the history list render restores as first-class entries and let
  // MDE tell its own commits apart from any others in an adopted repo.
  lines.push('', `${TRAILER_KIND}: ${kind}`);
  if (opts.restoreOf) lines.push(`${TRAILER_RESTORE}: ${opts.restoreOf}`);

  return { subject, full: lines.join('\n') + '\n' };
}

/**
 * Close isomorphic-git's racy-clean window on the files we just committed.
 *
 * `statusMatrix` trusts the stats cached in the index: if a file's mtime SECOND, size, mode,
 * and inode still match what was recorded when it was added, it reuses the cached hash
 * instead of reading the file. mtime granularity is one second, so a write that lands in the
 * same second as the `git.add` below, with the same byte count, is invisible -- and STAYS
 * invisible until something else touches that file. For a feature whose whole promise is
 * "nothing is ever lost", a file that is silently missing from the changes list is the worst
 * failure available: the user is told everything is saved when it is not.
 *
 * Real git handles this with the racy-clean rule (re-check any entry whose mtime is not
 * strictly older than the index itself). isomorphic-git does not implement it, so we do the
 * equivalent: any file whose last write is still inside the CURRENT second gets its index
 * entry rewritten with zeroed stats, which `updateIndex` does when handed an explicit oid.
 * Zeroed stats can never compare equal to a real file, so the next status hashes it for real.
 *
 * Only files whose mtime second equals right now are at risk -- once the clock ticks over,
 * any further write necessarily lands in a later second and is detected normally. So this
 * touches a handful of entries per checkpoint at most, and nothing at all the rest of the
 * time. Combined with `refresh: false` in computeStatus, `git.add` becomes the ONLY thing
 * that ever writes stats into the index, and every one of those writes is immediately
 * re-checked here.
 */
async function deraceIndex(root: string, sha: string, files: VcChangedFile[]): Promise<void> {
  const second = Math.floor(Date.now() / 1000);
  for (const f of files) {
    if (f.kind === 'deleted') continue;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(path.join(root, f.path));
    } catch {
      continue;
    }
    if (Math.floor(stat.mtimeMs / 1000) !== second) continue;
    try {
      const { oid } = await git.readBlob({ fs, dir: root, oid: sha, filepath: f.path });
      await git.updateIndex({
        fs,
        dir: root,
        filepath: f.path,
        oid,
        mode: stat.mode & 0o111 ? 0o100755 : 0o100644,
        add: true,
      });
    } catch {
      // Best effort. Failing here leaves the entry racily clean -- exactly the state
      // isomorphic-git would have left it in anyway -- so it degrades, it does not break.
    }
  }
}

/**
 * Stage everything that differs, commit, done -- all inside this one call.
 *
 * THE INDEX IS TRANSIENT. It is never left dirty between operations. Anything else creates
 * a third state alongside the working tree and HEAD (the exact concept this feature exists
 * to hide), produces content that survives a crash while being invisible to the UI, and
 * breaks Claude Code if it runs `git status` in the same folder.
 *
 * Returns null when there is nothing to commit, so callers never create empty checkpoints.
 */
export async function createCheckpoint(
  root: string,
  kind: CheckpointKind,
  opts: { message?: string; restoreOf?: string } = {}
): Promise<CheckpointResult | null> {
  const { files } = await computeStatus(root);
  if (files.length === 0) return null;

  // isomorphic-git has no `add -A`. Walking the status ourselves is the ONLY way, and
  // forgetting the `remove` half is the classic way to silently drop deletions.
  for (const f of files) {
    if (f.kind === 'deleted') {
      await git.remove({ fs, dir: root, filepath: f.path });
    } else {
      await git.add({ fs, dir: root, filepath: f.path });
    }
  }

  const { subject, full } = buildMessage(files, kind, opts);
  const sha = await git.commit({
    fs,
    dir: root,
    message: full,
    author: DEFAULT_AUTHOR,
    committer: DEFAULT_AUTHOR,
  });

  await deraceIndex(root, sha, files);

  return { sha, filesChanged: files.length, subject };
}
