// The status walk itself. Runs on the worker thread (statusWorker.ts); status.ts owns pacing,
// coalescing, and the index lock.

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

const PACK_IDLE_RELEASE_MS = 5 * 60 * 1000;

function classify(head: number, workdir: number): VcChangeKind | null {
  if (head === 0 && workdir !== 0) return 'added';
  if (head === 1 && workdir === 0) return 'deleted';
  if (head === 1 && workdir === 2) return 'modified';
  return null; // unchanged
}

// isomorphic-git loads a WHOLE packfile into memory to read any object in it (HEAD's trees),
// so an uncached walk re-reads every pack: 7s and 383MB on a repo with a 360MB pack. Packs
// are immutable per name, so their map is carried across calls. The index is NOT: its
// staleness check is whole-second mtime + size + inode, and checkpoint.ts rewrites it in
// place within the same second -- a cached index would go silently stale.
interface RootPacks {
  packs: { key: symbol; map: Map<string, unknown> } | null;
  releaseTimer: ReturnType<typeof setTimeout> | null;
}

const roots = new Map<string, RootPacks>();

export function releaseRoot(root: string): void {
  const r = roots.get(root);
  if (!r) return;
  if (r.releaseTimer) clearTimeout(r.releaseTimer);
  roots.delete(root);
}

function cacheFor(r: RootPacks): Record<symbol, unknown> {
  const cache: Record<symbol, unknown> = {};
  if (r.packs) {
    // A pack replaced by `git gc` would otherwise stay pinned in memory.
    for (const idxPath of [...r.packs.map.keys()]) {
      if (!fs.existsSync(idxPath)) r.packs.map.delete(idxPath);
    }
    cache[r.packs.key] = r.packs.map;
  }
  return cache;
}

function keepPacks(root: string, r: RootPacks, cache: Record<symbol, unknown>): void {
  const key = Object.getOwnPropertySymbols(cache).find(k => k.description === 'PackfileCache');
  // Absent when the repo has no packs yet (all loose objects).
  if (key) r.packs = { key, map: cache[key] as Map<string, unknown> };
  if (r.releaseTimer) clearTimeout(r.releaseTimer);
  r.releaseTimer = setTimeout(() => releaseRoot(root), PACK_IDLE_RELEASE_MS);
  r.releaseTimer.unref();
}

/** The first object id listed in a pack's .idx (v1 or v2), or null for an empty pack. */
function firstOidInIdx(idxPath: string): string | null {
  const head = Buffer.alloc(1052);
  const fd = fs.openSync(idxPath, 'r');
  try {
    fs.readSync(fd, head, 0, head.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  const v2 = head.readUInt32BE(0) === 0xff744f63;
  const fanout = v2 ? 8 : 0;
  if (head.readUInt32BE(fanout + 255 * 4) === 0) return null;
  // v2 lists the ids straight after the fanout; v1 prefixes each with a 4-byte offset.
  const at = v2 ? fanout + 1024 : 1028;
  return head.subarray(at, at + 20).toString('hex');
}

// isomorphic-git SHA-1s a whole pack the first time it reads from it, but not under a lock:
// every read already waiting on the pack's load hashes it AGAIN. A walk whose root tree is
// loose fires its subtree reads at once, so a 279MB pack was hashed ~90 times per cold walk
// (6.4s of CPU). Reading one object from each pack first, one at a time, leaves every pack
// loaded and verified before the walk's reads pile up.
async function loadPacksOneAtATime(root: string, cache: Record<symbol, unknown>): Promise<void> {
  const packDir = path.join(root, '.git', 'objects', 'pack');
  if (!fs.existsSync(packDir)) return; // a young repo, all loose objects
  for (const name of fs.readdirSync(packDir)) {
    if (!name.endsWith('.idx')) continue;
    const oid = firstOidInIdx(path.join(packDir, name));
    if (oid) await git.readObject({ fs, dir: root, oid, format: 'content', cache });
  }
}

export async function walkStatus(root: string): Promise<VcChangedFile[]> {
  let r = roots.get(root);
  if (!r) {
    r = { packs: null, releaseTimer: null };
    roots.set(root, r);
  }
  const cache = cacheFor(r);
  await loadPacksOneAtATime(root, cache);
  // `refresh: false` keeps this call READ-ONLY with respect to the index.
  //
  // With the default (true), statusMatrix writes fresh file stats into the index for every
  // file it hashes. Those cached stats are trusted by the next status (see the racy-clean
  // note in checkpoint.ts) and mtime granularity is one second -- so a status that happens
  // to run in the same second as an agent's write would cache stats that make a LATER
  // same-second, same-size write invisible, with nothing following it to undo the damage.
  // Only `createCheckpoint` is allowed to populate the stat cache, because it is the one
  // place that can immediately re-check what it recorded.
  const matrix = await git.statusMatrix({ fs, dir: root, refresh: false, cache });
  keepPacks(root, r, cache);
  const files: VcChangedFile[] = [];
  for (const row of matrix) {
    const kind = classify(row[HEAD] as number, row[WORKDIR] as number);
    if (kind) files.push({ path: row[FILE] as string, kind });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}
