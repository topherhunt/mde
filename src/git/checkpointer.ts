// The auto-checkpoint poller. See CHECKPOINTS.md "Checkpoint triggers".
//
// THE CADENCE RULE, in full:
//   If it has been more than 10 minutes since the last checkpoint, and there are
//   uncommitted changes, wait for a quiet period, then checkpoint everything.
//
// That yields exactly two guarantees:
//   - Checkpoint rate is bounded at roughly one per 10 minutes, no matter who is writing.
//   - Every boundary is a quiet moment, so a checkpoint never captures a half-finished
//     agent operation.
//
// The rule is deliberately source-agnostic. An earlier design used a short settle window
// for external writes and a longer one for MDE's own edits; it collapses on the mixed case
// (you edit a file in MDE, save, and Claude then rewrites the same file -- which window
// applies?). Answering that needs a conditional inside the rule, and a rule with a
// conditional inside it is one nobody can predict. Uniform beats locally optimal.

import { VcChangedFile } from '../types';
import { computeStatus, statusSignature } from './status';
import { createCheckpoint } from './checkpoint';
import { resolveState } from './repo';

const DEFAULT_ELIGIBILITY_MS = 10 * 60 * 1000; // 10 minutes since the last checkpoint
const DEFAULT_POLL_MS = 60 * 1000; // doubles as the settle window
const MAX_POLL_MS = 15 * 60 * 1000;

// Keep the status walk under ~1% duty cycle whatever the folder turns out to be.
const DUTY_CYCLE_DIVISOR = 100;

let ELIGIBILITY_MS = DEFAULT_ELIGIBILITY_MS;
let POLL_MS = DEFAULT_POLL_MS;

/**
 * Tests cannot wait ten minutes. The harness overrides both constants via CLI flags
 * (see parseCheckpointerArgs in index.ts) so the whole cadence runs in milliseconds.
 */
export function configureCheckpointer(opts: { eligibilityMs?: number; pollMs?: number }): void {
  if (opts.eligibilityMs !== undefined) ELIGIBILITY_MS = opts.eligibilityMs;
  if (opts.pollMs !== undefined) POLL_MS = opts.pollMs;
}

export function checkpointerConfig(): { eligibilityMs: number; pollMs: number } {
  return { eligibilityMs: ELIGIBILITY_MS, pollMs: POLL_MS };
}

export interface CheckpointerEvents {
  onStatus: (root: string, files: VcChangedFile[]) => void;
  onCheckpoint: (root: string, sha: string, subject: string) => void;
}

interface RootState {
  root: string;
  lastCommitAt: number;
  // Set by the file watcher. Its ENTIRE job. No filtering, no debounce, no null-filename
  // handling: a false positive costs exactly one wasted status call, which is the failure
  // mode we can afford. The authoritative answer always comes from statusMatrix.
  sawChange: boolean;
  lastSignature: string | null;
  lastStatusMs: number;
  timer: ReturnType<typeof setTimeout> | null;
  running: boolean;
  stopped: boolean;
}

const roots = new Map<string, RootState>();
let events: CheckpointerEvents | null = null;

export function initCheckpointer(handlers: CheckpointerEvents): void {
  events = handlers;
}

/**
 * Measure what the status walk actually costs on THIS folder and pace off that, rather
 * than guessing a safe interval in advance. A 100ms folder polls every 60s; a 3-second
 * folder polls every 5 minutes; a pathological one backs itself off. No advance knowledge
 * of the user's disk, sync setup, or file count is required, and there is no tuning
 * constant to get wrong.
 */
function pollDelay(state: RootState): number {
  return Math.min(MAX_POLL_MS, Math.max(POLL_MS, state.lastStatusMs * DUTY_CYCLE_DIVISOR));
}

function schedule(state: RootState, delay: number): void {
  if (state.stopped) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    void tick(state);
  }, delay);
}

async function tick(state: RootState): Promise<void> {
  if (state.stopped || state.running) return;
  state.running = true;
  try {
    // The gate. Zero status calls when the folder is quiet AND fully checkpointed, which is
    // most of the time.
    //
    // `lastSignature !== null` means the previous tick found uncommitted changes, and we
    // MUST keep polling until they are committed. Gating on the watcher alone deadlocks the
    // common case: one burst of edits, then silence. The burst sets sawChange, the first tick
    // consumes it and records a signature, and with no further filesystem events no later
    // tick ever runs -- so the settle window never completes and the 10-minute rule never
    // fires. Changes would sit uncommitted until the next unrelated edit or app quit.
    //
    // Caveat: constant sync traffic keeps sawChange permanently true, so on a Dropbox folder
    // we poll every tick regardless. That is where gitignore-filtering the watcher would earn
    // its keep -- it is not needed for correctness, only for that case.
    if (!state.sawChange && state.lastSignature === null) return;
    state.sawChange = false;

    // Writes are only ever made to a repo MDE marked as its own.
    const vcState = await resolveState(state.root);
    if (vcState.attach !== 'managed') return;

    const { files, durationMs } = await computeStatus(state.root);
    state.lastStatusMs = durationMs;
    events?.onStatus(state.root, files);

    // Guard: never commit nothing. Also resets the settle so a later change starts fresh.
    if (files.length === 0) {
      state.lastSignature = null;
      return;
    }

    const signature = statusSignature(state.root, files);
    const eligible = Date.now() - state.lastCommitAt >= ELIGIBILITY_MS;

    if (eligible && signature === state.lastSignature) {
      const result = await createCheckpoint(state.root, 'auto');
      state.lastCommitAt = Date.now();
      state.lastSignature = null;
      if (result) {
        events?.onStatus(state.root, []);
        events?.onCheckpoint(state.root, result.sha, result.subject);
      }
      return;
    }

    state.lastSignature = signature;
  } catch {
    // A transient failure (mid-write file, locked index) must not kill the poller.
  } finally {
    state.running = false;
    if (!state.stopped) schedule(state, pollDelay(state));
  }
}

export function watchRoot(root: string): void {
  if (roots.has(root)) return;
  const state: RootState = {
    root,
    // Start the clock now rather than at 0: opening a folder should not immediately
    // commit whatever happens to be uncommitted in it.
    lastCommitAt: Date.now(),
    sawChange: true, // do one pass on attach so the badge is correct straight away
    lastSignature: null,
    lastStatusMs: 0,
    timer: null,
    running: false,
    stopped: false,
  };
  roots.set(root, state);
  schedule(state, 0);
}

export function unwatchRoot(root: string): void {
  const state = roots.get(root);
  if (!state) return;
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  roots.delete(root);
}

/** Called by the file watcher for any event, unfiltered. */
export function markChange(root: string): void {
  const state = roots.get(root);
  if (state) state.sawChange = true;
}

/** Called after MDE itself commits, so the next window starts from the right moment. */
export function noteCheckpoint(root: string): void {
  const state = roots.get(root);
  if (!state) return;
  state.lastCommitAt = Date.now();
  state.lastSignature = null;
}

/**
 * Capture the tail on folder close and app quit.
 *
 * This matters MORE under the 10-minute rule, not less, because that rule can legitimately
 * leave up to ten minutes of work uncaptured. Bypasses both the eligibility gate and the
 * settle window: we are shutting down, so there is no later opportunity.
 */
export async function flushRoot(root: string): Promise<void> {
  const state = roots.get(root);
  if (!state) return;
  try {
    if ((await resolveState(root)).attach !== 'managed') return;
    const result = await createCheckpoint(root, 'auto');
    if (result) {
      state.lastCommitAt = Date.now();
      state.lastSignature = null;
    }
  } catch {
    // Never block shutdown on a checkpoint failure.
  }
}

export async function flushAll(): Promise<void> {
  await Promise.all([...roots.keys()].map(flushRoot));
}
