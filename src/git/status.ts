// What has changed since the last checkpoint, and the quiet-detection signature.
// See CHECKPOINTS.md "Detection: poll status, gate on the watcher".

import * as fs from 'fs';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { VcChangedFile } from '../types';
import type { StatusWorkerReply, StatusWorkerRequest } from './statusWorker';

export interface StatusResult {
  files: VcChangedFile[];
  durationMs: number;
}

// --- The worker ---------------------------------------------------------------------------
// One per process, started on first use, replaced if it dies, and stopped after a quiet spell
// (an idle worker is ~20MB; its packs go cold after the same 5 minutes anyway). It holds the
// packfile cache.

interface WorkerHandle {
  worker: Worker;
  pending: Map<number, { resolve: (files: VcChangedFile[]) => void; reject: (err: Error) => void }>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

// Beside index.cjs in the bundle (`node.__dirname: false`). Tests importing this file from
// src/ point it at the built bundle.
let workerPath = path.join(__dirname, 'statusWorker.cjs');
let idleStopMs = 5 * 60 * 1000;
let handle: WorkerHandle | null = null;
let nextRequestId = 1;

export function configureStatusWorker(opts: { path?: string; idleStopMs?: number }): void {
  if (opts.path !== undefined) workerPath = opts.path;
  if (opts.idleStopMs !== undefined) idleStopMs = opts.idleStopMs;
}

/** Every walk still in flight fails with `err`; the next request starts a fresh worker. */
function failWorker(h: WorkerHandle, err: Error): void {
  if (handle === h) handle = null;
  if (h.idleTimer) clearTimeout(h.idleTimer);
  for (const p of h.pending.values()) p.reject(err);
  h.pending.clear();
}

function workerHandle(): WorkerHandle {
  if (handle) return handle;
  const h: WorkerHandle = { worker: new Worker(workerPath), pending: new Map(), idleTimer: null };
  // Never the reason the process stays alive.
  h.worker.unref();
  h.worker.on('message', (reply: StatusWorkerReply) => {
    const p = h.pending.get(reply.id);
    if (!p) return;
    h.pending.delete(reply.id);
    if ('error' in reply) p.reject(new Error(reply.error));
    else p.resolve(reply.files);
    if (h.idleTimer) clearTimeout(h.idleTimer);
    h.idleTimer = setTimeout(() => {
      if (h.pending.size === 0) void stopWorker(h);
    }, idleStopMs);
    h.idleTimer.unref();
  });
  h.worker.on('error', err => failWorker(h, err instanceof Error ? err : new Error(String(err))));
  h.worker.on('exit', code => failWorker(h, new Error(`Status worker exited (code ${code})`)));
  handle = h;
  return h;
}

async function stopWorker(h: WorkerHandle): Promise<void> {
  failWorker(h, new Error('Status worker stopped'));
  await h.worker.terminate();
}

/** Quit, or a test killing the worker mid-walk. Pending walks reject rather than hang. */
export async function stopStatusWorker(): Promise<void> {
  if (handle) await stopWorker(handle);
}

/** Drop a folder's cached packs (closing the folder). The worker also drops them when idle. */
export function releaseStatusCache(root: string): void {
  if (!handle) return; // nothing cached
  handle.worker.postMessage({ type: 'release', root } satisfies StatusWorkerRequest);
}

// --- The index lock ---------------------------------------------------------------------
// isomorphic-git writes `.git/index` IN PLACE and its lock is per thread, so a walk in the
// worker that reads the index while `createCheckpoint` rewrites it on the main thread can see
// a torn file (checksum failure, or worse, a short read that parses). Per root, every walk and
// every checkpoint runs under this lock, one at a time.

const indexLocks = new Map<string, Promise<unknown>>();

export function withIndexLock<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const prev = indexLocks.get(root) || Promise.resolve();
  const run = prev.then(fn);
  const settled = run.catch(() => undefined);
  indexLocks.set(root, settled);
  void settled.then(() => {
    if (indexLocks.get(root) === settled) indexLocks.delete(root);
  });
  return run;
}

// --- Pacing ---------------------------------------------------------------------------------

// Walks are spaced so the worker spends at most 1 / (PACE_FACTOR + 1) of its time on them,
// whatever the repo's size: off the main thread they no longer stall the UI, but they still
// burn a core and battery.
const PACE_FACTOR = 9;

// A folder whose walks keep taking this long is costing a core most of the time; the app offers
// to turn checkpoints off for it. A streak, not one walk: a single walk can stall behind a busy
// machine.
let slowWalkMs = 1000;
const SLOW_STREAK = 3;
let onSlowWalks: ((root: string) => void) | null = null;

export function watchForSlowWalks(opts: { thresholdMs?: number; onSlow: (root: string) => void }): void {
  if (opts.thresholdMs !== undefined) slowWalkMs = opts.thresholdMs;
  onSlowWalks = opts.onSlow;
}

interface RootStatusState {
  lastEndMs: number;
  lastDurationMs: number;
  slowStreak: number;
  // A requested walk that has not started yet. Every caller joins it, so a burst of
  // requests costs one walk, and each caller still gets a walk that began after it asked.
  queued: Promise<StatusResult> | null;
  running: Promise<StatusResult> | null;
}

const rootStates = new Map<string, RootStatusState>();

function rootState(root: string): RootStatusState {
  let s = rootStates.get(root);
  if (!s) {
    s = { lastEndMs: 0, lastDurationMs: 0, slowStreak: 0, queued: null, running: null };
    rootStates.set(root, s);
  }
  return s;
}

/**
 * Authoritative "what differs from HEAD", run immediately, on the worker. Gitignored files
 * never appear in the result -- verified empirically, and the whole detection design rests
 * on it.
 *
 * Only `createCheckpoint` should call this directly, already holding the index lock: it must
 * see the tree as it is at the moment of the commit. Anything that merely OBSERVES status
 * goes through `observeStatus`.
 */
export async function computeStatus(root: string): Promise<StatusResult> {
  const s = rootState(root);
  const run = walkOnWorker(root, s);
  s.running = run;
  try {
    const result = await run;
    s.slowStreak = result.durationMs >= slowWalkMs ? s.slowStreak + 1 : 0;
    if (s.slowStreak === SLOW_STREAK) onSlowWalks?.(root);
    return result;
  } finally {
    if (s.running === run) s.running = null;
  }
}

/**
 * Status for the panel, the badge, and the poller: coalesced, paced (see PACE_FACTOR), and
 * never overlapping a checkpoint. Callers may wait up to PACE_FACTOR x the last walk's cost.
 */
export function observeStatus(root: string): Promise<StatusResult> {
  const s = rootState(root);
  if (s.queued) return s.queued;
  // `.then`, not an async IIFE: the body must run AFTER `s.queued` is assigned below, or a
  // walk that started immediately would leave itself registered as not-yet-started.
  const queued = Promise.resolve().then(async () => {
    if (s.running) await s.running.catch(() => undefined);
    const wait = s.lastEndMs + s.lastDurationMs * PACE_FACTOR - Date.now();
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    return withIndexLock(root, () => {
      // From here on the walk has started, so a new request needs another one.
      s.queued = null;
      return computeStatus(root);
    });
  });
  s.queued = queued;
  return queued;
}

async function walkOnWorker(root: string, s: RootStatusState): Promise<StatusResult> {
  const t0 = Date.now();
  try {
    const h = workerHandle();
    const id = nextRequestId++;
    const files = await new Promise<VcChangedFile[]>((resolve, reject) => {
      h.pending.set(id, { resolve, reject });
      h.worker.postMessage({ type: 'status', id, root } satisfies StatusWorkerRequest);
    });
    return { files, durationMs: Date.now() - t0 };
  } finally {
    s.lastEndMs = Date.now();
    s.lastDurationMs = s.lastEndMs - t0;
  }
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
