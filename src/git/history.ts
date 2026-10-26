// Reading history: the checkpoint list, per-checkpoint file lists, and file content at a
// point in time (which is what both the diff view and restore are built on).

import * as fs from 'fs';
import * as path from 'path';
import git from 'isomorphic-git';
import { diffLines } from 'diff';
import { VcCheckpoint, VcChangedFile, VcCheckpointStat, VcDiff } from '../types';
import { TRAILER_KIND, TRAILER_RESTORE } from './checkpoint';
import { readTitles, TitleMap } from './titles';

function parseTrailer(message: string, key: string): string | undefined {
  const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
  const match = message.match(re);
  return match ? match[1].trim() : undefined;
}

function toCheckpoint(
  sha: string,
  message: string,
  timestampSec: number,
  titles: TitleMap,
  parents: string[]
): VcCheckpoint {
  const generated = message.split('\n')[0].trim();
  const rawKind = parseTrailer(message, TRAILER_KIND);
  const restoreOf = parseTrailer(message, TRAILER_RESTORE);
  const kind: VcCheckpoint['kind'] =
    restoreOf ? 'restore' : rawKind === 'manual' ? 'manual' : rawKind === 'auto' ? 'auto' : 'auto';
  // A user-edited title wins wherever a checkpoint is displayed. Applying it HERE, in the one
  // function every history read funnels through, is what keeps the sidecar from becoming a
  // second thing each caller has to remember to consult.
  const custom = titles[sha];
  return {
    sha,
    // A merge is not something MDE ever creates, but an adopted repo can contain one. First
    // parent is the right answer there too: it is the line of history this list is walking.
    parent: parents[0],
    subject: custom ?? generated,
    generatedSubject: generated,
    titleEdited: custom !== undefined,
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
    // Read the sidecar once per page, not once per row.
    const titles = readTitles(root);
    return sliced.map(e =>
      toCheckpoint(e.oid, e.commit.message, e.commit.author.timestamp, titles, e.commit.parent)
    );
  } catch {
    // No commits yet (unborn HEAD) is normal for a freshly created repo.
    return [];
  }
}

/**
 * The checkpoints that touched ONE file, newest first. Same shape and pagination as
 * `listCheckpoints`, so the history view renders either list with the same code.
 *
 * `force: true` matters: without it, `log` THROWS when the file does not exist at the starting
 * ref. That is not an edge case here -- "what happened to this?" is a question people ask about
 * a file precisely when it has just been deleted, and a tab can outlive the file it points at.
 * With it, the walk continues past the gap and still finds the checkpoints that had it.
 *
 * Renames are not followed (`follow` defaults false). isomorphic-git implements it by mutating
 * the filepath mid-walk, and a subtly wrong history is worse here than an obviously short one:
 * this list is what someone decides whether to restore from.
 */
export async function listFileCheckpoints(
  root: string,
  filepath: string,
  opts: { limit?: number; before?: string } = {}
): Promise<VcCheckpoint[]> {
  const limit = opts.limit ?? 50;
  try {
    const entries = await git.log({
      fs,
      dir: root,
      // `depth` counts MATCHING commits, not commits walked, so this really is a page size.
      depth: limit + (opts.before ? 1 : 0),
      ref: opts.before || undefined,
      filepath,
      force: true,
    });
    const sliced = opts.before ? entries.slice(1) : entries;
    const titles = readTitles(root);
    const seen = new Set<string>();
    const out: VcCheckpoint[] = [];
    for (const e of sliced) {
      // Defensive: the filepath walk pushes from two places and a boundary commit can arrive
      // twice. A duplicated row would read as two separate edits at the same moment.
      if (seen.has(e.oid)) continue;
      seen.add(e.oid);
      out.push(
        toCheckpoint(e.oid, e.commit.message, e.commit.author.timestamp, titles, e.commit.parent)
      );
    }
    return out;
  } catch {
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

/**
 * Read one file as it was at a commit, as RAW BYTES. Returns null when it did not exist there.
 *
 * Anything that writes to the working tree must use this, never `readFileAt`. Decoding a blob
 * to a JavaScript string and writing it back is lossy for every byte sequence that is not
 * valid UTF-8: each one becomes U+FFFD and the file is destroyed. Markdown survives the round
 * trip, which is what made this hide -- a PDF sitting untouched next to an edited note came
 * back blank from a whole-folder restore. Bytes in, bytes out.
 */
export async function readBlobAt(
  root: string,
  sha: string,
  filepath: string
): Promise<Buffer | null> {
  try {
    const { blob } = await git.readBlob({ fs, dir: root, oid: sha, filepath });
    return Buffer.from(blob);
  } catch {
    return null;
  }
}

/**
 * Read one file as it was at a commit, decoded as text. Returns null when it did not exist
 * there. For DISPLAY only (the diff view) -- see `readBlobAt` before writing anything to disk.
 */
export async function readFileAt(
  root: string,
  sha: string,
  filepath: string
): Promise<string | null> {
  const blob = await readBlobAt(root, sha, filepath);
  return blob === null ? null : blob.toString('utf8');
}

async function parentOf(root: string, sha: string): Promise<string | null> {
  const { commit } = await git.readCommit({ fs, dir: root, oid: sha });
  return commit.parent.length > 0 ? commit.parent[0] : null;
}

/** Lines added / removed between two versions of one file. Either side may be absent. */
function countLines(before: string | null, after: string | null): { added: number; removed: number } {
  if (before === null && after === null) return { added: 0, removed: 0 };
  if (before === null) return { added: after!.split('\n').length, removed: 0 };
  if (after === null) return { added: 0, removed: before.split('\n').length };

  let added = 0;
  let removed = 0;
  for (const part of diffLines(before, after)) {
    if (part.added) added += part.count ?? 0;
    else if (part.removed) removed += part.count ?? 0;
  }
  return { added, removed };
}

// Counting costs two blob reads plus a diff PER FILE, so it is opt-in and capped. A
// checkpoint listing thousands of files is a folder-wide sweep nobody reads line counts for;
// the ones people actually inspect are a handful of documents.
const COUNT_FILE_LIMIT = 200;
const COUNT_BYTE_LIMIT = 2 * 1024 * 1024;

/**
 * Which files a checkpoint changed, by diffing its tree against its parent's.
 * A root commit (no parent) reports every file as added.
 *
 * With `counts`, each text file also carries how many lines it gained and lost. Binaries and
 * very large files are left without counts rather than being read -- the caller renders the
 * absence as no number, which is honest, instead of a zero, which would read as "no change".
 */
export async function checkpointFiles(
  root: string,
  sha: string,
  opts: { counts?: boolean } = {}
): Promise<VcChangedFile[]> {
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

  if (opts.counts && files.length <= COUNT_FILE_LIMIT) {
    for (const file of files) {
      if (BINARY_EXT.has(path.extname(file.path).toLowerCase())) continue;
      const beforeBytes = parent ? await readBlobAt(root, parent, file.path) : null;
      const afterBytes = await readBlobAt(root, sha, file.path);
      const tooBig =
        (beforeBytes?.length ?? 0) > COUNT_BYTE_LIMIT || (afterBytes?.length ?? 0) > COUNT_BYTE_LIMIT;
      if (tooBig) continue;
      const before = beforeBytes === null ? null : beforeBytes.toString('utf8');
      const after = afterBytes === null ? null : afterBytes.toString('utf8');
      if (looksBinary(file.path, before) || looksBinary(file.path, after)) continue;
      Object.assign(file, countLines(before, after));
    }
  }

  return files;
}

/**
 * File count plus total lines added and removed, for each of several checkpoints. This is what
 * the history list shows on the right of every row.
 *
 * Deliberately a SEPARATE call from `listCheckpoints` rather than a field on it. Listing is a
 * cheap log walk; this is two blob reads plus a diff per changed file, per checkpoint, and
 * folding it into the list would make the whole page wait on the slowest part of it. The list
 * paints immediately and the counts arrive a moment later.
 *
 * The file count is always available; the line counts are omitted when nothing in the
 * checkpoint could be measured (all binary, or past `checkpointFiles`'s caps) -- same rule as
 * the per-file counts, where a zero would read as "nothing really changed" not "nobody counted".
 */
export async function checkpointStats(
  root: string,
  shas: string[]
): Promise<Record<string, VcCheckpointStat>> {
  const out: Record<string, VcCheckpointStat> = {};
  for (const sha of shas) {
    try {
      const files = await checkpointFiles(root, sha, { counts: true });
      let added = 0;
      let removed = 0;
      let measured = false;
      for (const file of files) {
        if (file.added === undefined && file.removed === undefined) continue;
        measured = true;
        added += file.added ?? 0;
        removed += file.removed ?? 0;
      }
      out[sha] = measured
        ? { files: files.length, added, removed }
        : { files: files.length };
    } catch {
      // One unreadable checkpoint must not cost the rest of the page its counts.
    }
  }
  return out;
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
 * How far each UNCOMMITTED file has moved: lines gained and lost against the last checkpoint.
 *
 * A separate call from the status walk for the same reason `checkpointStats` is separate from
 * `listCheckpoints`. The walk is what the poller runs on every tick, on a timer, forever;
 * it is a single status walk and it must stay one. This is two reads and a diff PER FILE, so it
 * is only ever run by a renderer that has already painted the list and wants to fill in numbers.
 *
 * A file that could not be measured -- binary, oversized, unreadable -- is ABSENT from the
 * result rather than present with zeros, so the caller renders nothing instead of claiming the
 * file did not really change.
 */
export async function statusCounts(
  root: string,
  paths: string[]
): Promise<Record<string, { added: number; removed: number }>> {
  const counts: Record<string, { added: number; removed: number }> = {};
  if (paths.length > COUNT_FILE_LIMIT) return counts;

  let head: string | null = null;
  try {
    head = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
  } catch {
    head = null; // no checkpoints yet: everything reads as newly added
  }

  for (const filepath of paths) {
    if (BINARY_EXT.has(path.extname(filepath).toLowerCase())) continue;
    try {
      const beforeBytes = head ? await readBlobAt(root, head, filepath) : null;
      let afterBytes: Buffer | null = null;
      try {
        afterBytes = fs.readFileSync(path.join(root, filepath));
      } catch {
        afterBytes = null; // deleted in the working tree
      }
      const tooBig =
        (beforeBytes?.length ?? 0) > COUNT_BYTE_LIMIT || (afterBytes?.length ?? 0) > COUNT_BYTE_LIMIT;
      if (tooBig) continue;
      const before = beforeBytes === null ? null : beforeBytes.toString('utf8');
      const after = afterBytes === null ? null : afterBytes.toString('utf8');
      if (looksBinary(filepath, before) || looksBinary(filepath, after)) continue;
      counts[filepath] = countLines(before, after);
    } catch {
      // One unreadable file must not cost the rest of the list its counts.
    }
  }

  return counts;
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
