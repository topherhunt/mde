// Pre-init safety checks. See CHECKPOINTS.md "Guardrails".
//
// Only ONE of these blocks (a parent repo). The rest inform the user and let them decide --
// the point is that nobody is surprised later, not that MDE second-guesses them.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { VcPreflight, VcLargeFile } from '../types';
import { findParentRepo, hasRepo } from './repo';
import { defaultIgnoreContent } from './ignore';

// Bounded so a user who points MDE at their entire home directory still gets an answer.
const MAX_WALK_FILES = 20000;
const MAX_CHILD_REPO_DEPTH = 4;

export const LARGE_FILE_BYTES = 50 * 1024 * 1024; // 50MB
export const LARGE_TOTAL_BYTES = 500 * 1024 * 1024; // 500MB
export const LARGE_FILE_COUNT = 10000;

// Directories never worth walking during preflight. Not a correctness filter -- just keeps
// the size estimate about the user's documents rather than their toolchain.
const SKIP_DIRS = new Set(['.git', 'node_modules', '.obsidian', '.vscode', '.idea']);

/**
 * Path-based detection is enough here, and it is the check most likely to matter in
 * practice: a novelist keeping her book folder in Dropbox or iCloud is the default case,
 * not an edge case. Under storage optimization, reading every file to detect changes can
 * pull content back down from the cloud, which is actively harmful rather than merely slow.
 */
export function detectCloudSync(root: string): string | null {
  const resolved = path.resolve(root);
  const home = os.homedir();
  const rel = path.relative(home, resolved);
  const inHome = rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
  const segments = resolved.split(path.sep);

  if (resolved.includes(path.join('Library', 'Mobile Documents'))) return 'iCloud Drive';
  if (segments.some(s => s === 'com~apple~CloudDocs')) return 'iCloud Drive';
  if (inHome && /^Dropbox( |$)/.test(rel.split(path.sep)[0] ?? '')) return 'Dropbox';
  if (inHome && /^OneDrive( |-|$)/.test(rel.split(path.sep)[0] ?? '')) return 'OneDrive';
  if (inHome && /^Google ?Drive/i.test(rel.split(path.sep)[0] ?? '')) return 'Google Drive';
  if (segments.some(s => s === 'CloudStorage')) return 'a cloud storage folder';
  return null;
}

interface WalkResult {
  totalBytes: number;
  fileCount: number;
  largeFiles: VcLargeFile[];
  childRepos: string[];
  truncated: boolean;
}

function walk(root: string): WalkResult {
  const result: WalkResult = {
    totalBytes: 0,
    fileCount: 0,
    largeFiles: [],
    childRepos: [],
    truncated: false,
  };

  const visit = (dir: string, depth: number) => {
    if (result.truncated) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (result.truncated) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.git') {
          // A .git directly at the root is this repo, not a child.
          if (dir !== root) result.childRepos.push(path.relative(root, dir));
          continue;
        }
        if (SKIP_DIRS.has(entry.name)) continue;
        if (depth < MAX_CHILD_REPO_DEPTH) visit(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      result.fileCount++;
      if (result.fileCount > MAX_WALK_FILES) {
        result.truncated = true;
        return;
      }
      let size = 0;
      try {
        size = fs.statSync(full).size;
      } catch {
        continue;
      }
      result.totalBytes += size;
      if (size >= LARGE_FILE_BYTES) {
        result.largeFiles.push({ path: path.relative(root, full), bytes: size });
      }
    }
  };

  visit(root, 0);
  result.largeFiles.sort((a, b) => b.bytes - a.bytes);
  result.largeFiles = result.largeFiles.slice(0, 10);
  return result;
}

export function preflight(root: string): VcPreflight {
  const parentRepo = findParentRepo(root);
  // If a parent repo blocks init anyway, skip the expensive walk.
  if (parentRepo) {
    return {
      parentRepo,
      childRepos: [],
      totalBytes: 0,
      fileCount: 0,
      largeFiles: [],
      cloudSync: detectCloudSync(root),
      truncated: false,
    };
  }
  const w = walk(root);
  return {
    parentRepo: null,
    childRepos: w.childRepos,
    totalBytes: w.totalBytes,
    fileCount: w.fileCount,
    largeFiles: w.largeFiles,
    cloudSync: detectCloudSync(root),
    truncated: w.truncated,
  };
}

export function isLarge(p: VcPreflight): boolean {
  return (
    p.totalBytes >= LARGE_TOTAL_BYTES ||
    p.fileCount >= LARGE_FILE_COUNT ||
    p.largeFiles.length > 0
  );
}

/**
 * Seed .gitignore, appending rather than replacing if one already exists. Nested repos are
 * listed explicitly: Git refuses to recurse into them and would otherwise record each as a
 * gitlink, which is both confusing and useless here.
 */
export function seedIgnoreFile(root: string, nestedRepos: string[]): void {
  const target = path.join(root, '.gitignore');
  const content = defaultIgnoreContent(nestedRepos);
  let existing = '';
  try {
    existing = fs.readFileSync(target, 'utf8');
  } catch {
    fs.writeFileSync(target, content, 'utf8');
    return;
  }
  if (existing.includes('# Added by MDE')) return; // already seeded
  const separator = existing.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(target, existing + separator + content, 'utf8');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
