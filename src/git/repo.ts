// Repo identity and attach-state resolution. See CHECKPOINTS.md.
//
// THE CENTRAL RULE: the marker in .git/config grants write mode, and nothing else does.
// Every repo MDE did not create is read-only browsing plus an explicit adopt button.
// A false negative costs the user one click; a false positive means MDE silently commits
// into a developer's real project. Never infer managed-ness from heuristics.

import * as fs from 'fs';
import * as path from 'path';
import git from 'isomorphic-git';
import { VcState } from '../types';

// Lives in .git/config: never in the working tree, never committed, never in a diff,
// and it travels with the folder when it is moved, renamed, copied, or zipped. Since
// there are no remotes there is no clone path that could drop it.
const KEY_MANAGED = 'mde.managed';
const KEY_INITIALIZED = 'mde.initializedAt';
const KEY_SCHEMA = 'mde.schemaVersion';
const SCHEMA_VERSION = '1';

export const DEFAULT_AUTHOR = { name: 'MDE', email: 'mde@localhost' };

export function gitDirOf(root: string): string {
  return path.join(root, '.git');
}

export function hasRepo(root: string): boolean {
  try {
    return fs.statSync(gitDirOf(root)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walk up from `root`'s parent looking for an enclosing repo. Init must refuse when this
 * returns non-null: a repo nested inside a repo is a mess this user cannot debug.
 */
export function findParentRepo(root: string): string | null {
  let dir = path.dirname(path.resolve(root));
  let prev = '';
  while (dir && dir !== prev) {
    if (hasRepo(dir)) return dir;
    prev = dir;
    dir = path.dirname(dir);
  }
  return null;
}

async function getConfig(root: string, key: string): Promise<string | undefined> {
  try {
    const value = await git.getConfig({ fs, dir: root, path: key });
    return value ?? undefined;
  } catch {
    return undefined;
  }
}

export async function isManaged(root: string): Promise<boolean> {
  return (await getConfig(root, KEY_MANAGED)) === 'true';
}

export async function writeMarker(root: string): Promise<void> {
  await git.setConfig({ fs, dir: root, path: KEY_MANAGED, value: 'true' });
  await git.setConfig({ fs, dir: root, path: KEY_INITIALIZED, value: new Date().toISOString() });
  await git.setConfig({ fs, dir: root, path: KEY_SCHEMA, value: SCHEMA_VERSION });
}

/**
 * Resolve which of the four attach states this folder is in.
 *
 * Re-run this on attach AND whenever the panel regains focus. A marked repo that later
 * grows a remote or a second branch (someone got curious, or Claude Code did it) must
 * drop to read-only: the marker alone can never override live evidence.
 */
export async function resolveState(root: string): Promise<VcState> {
  if (!root || !hasRepo(root)) return { attach: 'none' };

  let branches: string[] = [];
  let remotes: { remote: string; url: string }[] = [];
  try {
    branches = await git.listBranches({ fs, dir: root });
    remotes = await git.listRemotes({ fs, dir: root });
  } catch {
    // A .git that exists but cannot be read is not something we should touch.
    return { attach: 'foreign', reason: 'This folder has version history MDE could not read.' };
  }

  let branch: string | null = null;
  try {
    branch = (await git.currentBranch({ fs, dir: root, fullname: false })) || null;
  } catch {
    branch = null;
  }

  const managed = await isManaged(root);
  const hasRemote = remotes.length > 0;

  if (!managed) {
    // Heuristics change only the WORDING here, never the read-only decision.
    const reason = hasRemote
      ? 'This folder is already set up for version control and syncs to another location, so it looks like a developer project. MDE is showing its history without making any changes.'
      : 'This folder already has version history that MDE did not create. MDE is showing it without making any changes.';
    return { attach: 'foreign', reason, branch, hasRemote, branchCount: branches.length };
  }

  if (hasRemote) {
    return {
      attach: 'steppedBack',
      reason: 'This folder now syncs to another location, so MDE has stepped back to read-only to avoid interfering with it.',
      branch,
      hasRemote,
    };
  }

  if (branches.length > 1) {
    return {
      attach: 'steppedBack',
      reason: 'This folder now has more than one line of history, so MDE has stepped back to read-only to avoid interfering with it.',
      branch,
      hasRemote,
    };
  }

  return { attach: 'managed', branch, hasRemote: false };
}

export async function canWrite(root: string): Promise<boolean> {
  return (await resolveState(root)).attach === 'managed';
}

/** Create the repo and mark it as ours. Callers must run the guards first. */
export async function initRepo(root: string): Promise<void> {
  await git.init({ fs, dir: root, defaultBranch: 'main' });
  await writeMarker(root);
}

/** Take over an existing repo the user explicitly opted into. */
export async function adoptRepo(root: string): Promise<void> {
  await writeMarker(root);
}
