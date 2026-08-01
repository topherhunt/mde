// Reading history: the checkpoint list, per-checkpoint file lists, and file content at a
// point in time (which is what both the diff view and restore are built on).

import * as fs from 'fs';
import * as path from 'path';
import git from 'isomorphic-git';
import { VcCheckpoint, VcChangedFile, VcDiff } from '../types';
import { TRAILER_KIND, TRAILER_RESTORE } from './checkpoint';

function parseTrailer(message: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = message.match(re);
  return match ? match[1].trim() : undefined;
}

function toCheckpoint(sha: string, message: string, timestampSec: number): VcCheckpoint {
  const subject = message.split('\n')[0].trim();
  const rawKind = parseTrailer(message, TRAILER_KIND);
  const restoreOf = parseTrailer(message, TRAILER_RESTORE);
  const kind: VcCheckpoint['kind'] =
    restoreOf ? 'restore' : rawKind === 'manual' ? 'manual' : rawKind === 'auto' ? 'auto' : 'auto';
  return {
    sha,
    subject,
    timestamp: timestampSec * 1000,
    kind,
    restoreOf,
    // Commits with no trailer were not made by MDE. Only reachable in an adopted repo.
    foreign: rawKind === undefined && restoreOf === undefined,
  };
}

/**
 * Paginated from the start: an adopted repo can have tens of thousands of commits, and the
 * panel must not try to render them all.
 */
export async function listCheckpoints(
  root: string,
  opts: { limit?: number; before?: string } = {}
): Promise<VcCheckpoint[]> {
  const limit = opts.limit ?? 50;
  try {
    // `before` is a sha to continue from; fetch one extra and drop it.
    const entries = await git.log({
      fs,
      dir: root,
      depth: limit + (opts.before ? 1 : 0),
      ref: opts.before || undefined,
    });
    const sliced = opts.before ? entries.slice(1) : entries;
    return sliced.map(e =>
      toCheckpoint(e.oid, e.commit.message, e.commit.author.timestamp)
    );
  } catch {
    // No commits yet (unborn HEAD) is normal for a freshly created repo.
    return [];
  }
}

export async function hasCommits(root: string): Promise<boolean> {
  try {
    const log = await git.log({ fs, dir: root, depth: 1 });
    return log.length > 0;
  } catch {
    return false;
  }
}

/** Read one file as it was at a commit. Returns null when it did not exist there. */
export async function readFileAt(
  root: string,
  sha: string,
  filepath: string
): Promise<string | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir: root, oid: sha, filepath });
    return Buffer.from(blob).toString('utf8');
  } catch {
    return null;
  }
}

async function parentOf(root: string, sha: string): Promise<string | null> {
  const { commit } = await git.readCommit({ fs, dir: root, oid: sha });
  return commit.parent.length > 0 ? commit.parent[0] : null;
}

/**
 * Which files a checkpoint changed, by diffing its tree against its parent's.
 * A root commit (no parent) reports every file as added.
 */
export async function checkpointFiles(root: string, sha: string): Promise<VcChangedFile[]> {
  const parent = await parentOf(root, sha);
  const trees = parent
    ? [git.TREE({ ref: sha }), git.TREE({ ref: parent })]
    : [git.TREE({ ref: sha })];

  const results = await git.walk({
    fs,
    dir: root,
    trees,
    // NEVER return null from this map. isomorphic-git's walker treats null as "prune":
    // `if (parent !== null) { ...recurse... }`. Returning it for '.' silently prunes the
    // entire walk and every checkpoint reports zero files. `undefined` is the value that
    // means "not a result" -- the default reducer filters those out.
    map: async (filepath, entries) => {
      if (filepath === '.') return undefined;
      const [current, previous] = entries as (typeof entries[number] | null)[];

      const currentType = current ? await current.type() : undefined;
      const previousType = previous ? await previous.type() : undefined;
      // Let the walker recurse into directories; they are not results themselves.
      if (currentType === 'tree' || previousType === 'tree') return undefined;

      const currentOid = current ? await current.oid() : undefined;
      const previousOid = previous ? await previous.oid() : undefined;
      if (currentOid === previousOid) return undefined;

      const kind = !previousOid ? 'added' : !currentOid ? 'deleted' : 'modified';
      return { path: filepath, kind } as VcChangedFile;
    },
  });

  const files = (results as (VcChangedFile | null | undefined)[]).filter(
    (f): f is VcChangedFile => !!f && !!f.path
  );
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tiff', '.svgz',
  '.pdf', '.docx', '.doc', '.xlsx', '.pptx', '.zip', '.gz', '.tar', '.rar', '.7z',
  '.mp3', '.mp4', '.mov', '.avi', '.wav', '.m4a', '.aac', '.flac', '.webm',
  '.ttf', '.otf', '.woff', '.woff2', '.eot', '.dmg', '.exe', '.dll', '.so', '.dylib',
]);

function looksBinary(filepath: string, content: string | null): boolean {
  if (BINARY_EXT.has(path.extname(filepath).toLowerCase())) return true;
  // A NUL byte in the first chunk is the usual cheap heuristic.
  return content !== null && content.slice(0, 8000).indexOf(String.fromCharCode(0)) !== -1;
}

/**
 * Content before and after a change.
 *
 * With `sha`, compares that checkpoint against its parent (what this checkpoint did).
 * Without one, compares HEAD against the working directory (uncommitted changes).
 */
export async function diffFile(
  root: string,
  filepath: string,
  sha?: string
): Promise<VcDiff> {
  let before: string | null;
  let after: string | null;

  if (sha) {
    const parent = await parentOf(root, sha);
    before = parent ? await readFileAt(root, parent, filepath) : null;
    after = await readFileAt(root, sha, filepath);
  } else {
    let head: string | null = null;
    try {
      head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
    } catch {
      head = null;
    }
    before = head ? await readFileAt(root, head, filepath) : null;
    try {
      after = fs.readFileSync(path.join(root, filepath), 'utf8');
    } catch {
      after = null; // deleted in the working tree
    }
  }

  return {
    path: filepath,
    before,
    after,
    binary: looksBinary(filepath, before) || looksBinary(filepath, after),
  };
}
