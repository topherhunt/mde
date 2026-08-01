// Restore, phrased for a human. Shared by the sidebar panel and the full-page history tab.
//
// The wording is the point of this module existing. "Restored 3 files" on an operation that
// changed nothing was a real, reported bug -- it made a no-op look like a rewrite, right after
// a genuine restore had corrupted a PDF, so the user could not tell which had just happened.
// Two callers phrasing that independently is exactly how one of them ends up lying again.

import { VcRestoreResult } from '../types';

export interface RestoreOutcome {
  message: string;
  variant?: string;
  // False for an error OR a no-op: nothing on disk moved, so there is nothing to refresh.
  changed: boolean;
}

function failure(result: VcRestoreResult, fallback: string): RestoreOutcome {
  return { message: result.error || fallback, variant: 'danger', changed: false };
}

export async function restoreOneFile(
  root: string,
  sha: string,
  filePath: string
): Promise<RestoreOutcome> {
  const result = await window.mde.vcRestoreFile(root, sha, filePath);
  if (!result.ok) return failure(result, 'Could not restore that file.');

  if (!result.filesWritten && !result.filesDeleted) {
    // "that version", not "that checkpoint": the caller may have restored to the checkpoint's
    // PARENT (the "undo this change" direction), and naming the wrong one of the two is exactly
    // the ambiguity the restore dialog exists to remove.
    return { message: `${filePath} already matches that version.`, variant: 'info', changed: false };
  }
  return {
    message: result.filesDeleted
      ? `${filePath} did not exist at that point, so it was removed. The version you had is still in your history.`
      : `Restored ${filePath}. The version you had is still in your history.`,
    changed: true,
  };
}

export async function restoreEverything(root: string, sha: string): Promise<RestoreOutcome> {
  const result = await window.mde.vcRestoreAll(root, sha);
  if (!result.ok) return failure(result, 'Could not restore this folder.');

  if (!result.filesWritten && !result.filesDeleted) {
    return {
      message: 'This folder already matches that checkpoint -- nothing needed restoring.',
      variant: 'info',
      changed: false,
    };
  }
  const parts = [`Restored ${result.filesWritten} file${result.filesWritten === 1 ? '' : 's'}`];
  if (result.filesDeleted) parts.push(`removed ${result.filesDeleted} added since then`);
  return {
    message: `${parts.join(' and ')}. Everything you had before is still in your history.`,
    changed: true,
  };
}
