// Restore. Every path here is append-only: nothing is ever destroyed or rewritten.
//
// "Restore to this checkpoint" reads old content and writes it as a NEW checkpoint on top
// of history, the same shape as `git revert`. The old state stays reachable. That is what
// makes detached HEAD unreachable, the reflog unnecessary, and "I lost my work" structurally
// impossible -- and it is why neither of these operations needs a frightening dialog.
//
// NOTE ON THE SINGLE-WRITE-PATH INVARIANT: these are main-process direct writes, like the
// state JSON and import output. The invariant covers the RENDERER's document buffers, which
// must go through `write-file-if-unchanged` so a stale buffer cannot clobber a newer file.
// Restore is the opposite case: it deliberately overwrites the working tree from history,
// having first captured that working tree in a checkpoint. Afterwards the directory watchers
// fire, the renderer recomputes hashes, clean tabs silently reload with the blue proof
// banner, and dirty tabs raise the red conflict banner. That existing machinery is exactly
// the desired behavior, so restore does not reach into it.

import * as fs from 'fs';
import * as path from 'path';
import git from 'isomorphic-git';
import { createCheckpoint } from './checkpoint';
import { readBlobAt } from './history';
import { VcRestoreResult } from '../types';

export type RestoreResult = VcRestoreResult;

/** Collect every blob path in a commit's tree. */
async function treeFiles(root: string, sha: string): Promise<Set<string>> {
  const out = new Set<string>();
  await git.walk({
    fs,
    dir: root,
    trees: [git.TREE({ ref: sha })],
    map: async (filepath, [entry]) => {
      if (filepath === '.' || !entry) return undefined;
      if ((await entry.type()) === 'tree') return undefined;
      out.add(filepath);
      return undefined;
    },
  });
  return out;
}

/**
 * Write bytes verbatim, and DON'T WRITE AT ALL if the file already holds exactly these bytes.
 *
 * The skip is not an optimization, it is correctness at the UI level. A whole-folder restore
 * walks the entire tree, so without it every untouched file gets rewritten with identical
 * content -- new mtime, watcher event, and (before the byte fix above) a corrupted binary.
 * Restoring the checkpoint that matches the current state reported "Restored 3 files" when the
 * honest answer was "nothing needed restoring".
 *
 * Returns true only when something actually changed on disk.
 */
function writeIfDifferent(target: string, content: Buffer): boolean {
  try {
    if (fs.readFileSync(target).equals(content)) return false;
  } catch {
    // Missing or unreadable: fall through and write it.
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return true;
}

/** Remove now-empty directories left behind by deletions, stopping at the repo root. */
function pruneEmptyDirs(root: string, startDir: string): void {
  let dir = startDir;
  const stop = path.resolve(root);
  while (path.resolve(dir) !== stop && path.resolve(dir).startsWith(stop)) {
    try {
      if (fs.readdirSync(dir).length > 0) return;
      fs.rmdirSync(dir);
    } catch {
      return;
    }
    dir = path.dirname(dir);
  }
}

/**
 * Restore ONE file to its content at `sha`. This is what people want roughly 90% of the
 * time. If the file did not exist at that checkpoint, restoring means removing it -- the
 * caller is responsible for saying so plainly in the UI.
 */
export async function restoreFile(
  root: string,
  sha: string,
  filepath: string
): Promise<RestoreResult> {
  const safety = await createCheckpoint(root, 'auto', {
    message: 'Before restoring ' + filepath,
  });

  const content = await readBlobAt(root, sha, filepath);
  const target = path.join(root, filepath);
  let written = 0;
  let deleted = 0;

  if (content === null) {
    try {
      fs.unlinkSync(target);
      deleted = 1;
      pruneEmptyDirs(root, path.dirname(target));
    } catch {
      // Already absent: the working tree already matches the checkpoint.
    }
  } else if (writeIfDifferent(target, content)) {
    written = 1;
  }

  const result = await createCheckpoint(root, 'restore', {
    message: `Restored ${filepath}`,
    restoreOf: sha,
  });

  return {
    ok: true,
    newSha: result?.sha ?? null,
    filesWritten: written,
    filesDeleted: deleted,
    safetySha: safety?.sha ?? null,
  };
}

/**
 * Restore the WHOLE folder to its state at `sha`. The panic button.
 *
 * The safety checkpoint runs first and is load-bearing rather than merely polite: it puts
 * every untracked file into history, which is what makes the deletion half of this
 * operation safe. Without it, deleting a file that never existed in any commit would be
 * genuinely unrecoverable.
 *
 * Forgetting that deletion half yields a UNION of both states, which is worse than either.
 */
export async function restoreAll(root: string, sha: string): Promise<RestoreResult> {
  const safety = await createCheckpoint(root, 'auto', {
    message: 'Before restoring everything',
  });

  let head: string | null = null;
  try {
    head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
  } catch {
    return {
      ok: false,
      newSha: null,
      filesWritten: 0,
      filesDeleted: 0,
      safetySha: safety?.sha ?? null,
      error: 'This folder has no history to restore from yet.',
    };
  }

  const target = await treeFiles(root, sha);
  // After the safety checkpoint, HEAD contains everything that was in the folder.
  const current = await treeFiles(root, head);

  let written = 0;
  for (const filepath of target) {
    const content = await readBlobAt(root, sha, filepath);
    if (content === null) continue;
    if (writeIfDifferent(path.join(root, filepath), content)) written++;
  }

  let deleted = 0;
  for (const filepath of current) {
    if (target.has(filepath)) continue;
    const full = path.join(root, filepath);
    try {
      fs.unlinkSync(full);
      deleted++;
      pruneEmptyDirs(root, path.dirname(full));
    } catch {
      // Already gone.
    }
  }

  const result = await createCheckpoint(root, 'restore', {
    message: 'Restored everything to an earlier checkpoint',
    restoreOf: sha,
  });

  return {
    ok: true,
    newSha: result?.sha ?? null,
    filesWritten: written,
    filesDeleted: deleted,
    safetySha: safety?.sha ?? null,
  };
}
