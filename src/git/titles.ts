// User-edited checkpoint titles, stored BESIDE the history rather than inside it.
//
// WHY NOT REWRITE THE COMMIT MESSAGE. Editing a stored message means writing a new commit
// object for that checkpoint and for every descendant, then moving the branch ref -- the one
// operation in this whole feature that can leave history pointing somewhere wrong, and one
// isomorphic-git gives us no rebase for, so it would be hand-rolled. It would also change the
// SHAs that `MDE-Restore:` trailers already name, turning every restore entry in the list into
// a dangling reference, and it punctures the append-only rule the rest of the design leans on.
// File CONTENT could never be harmed either way -- blobs and trees are content-addressed and
// immutable -- so this is about referential integrity, not corruption. Either way, a cosmetic
// label does not justify any of it.
//
// The sidecar lives in `.git/` for the same reason the managed marker does: it must never
// appear in the working tree, never show up in a diff, and never become one more change the
// user has to think about -- while still travelling with the folder when it is moved, renamed,
// or copied. It is not pushed anywhere, which costs nothing in a feature that has no remotes.
//
// Losing it degrades to the generated title. That is the correct failure mode for a field
// whose only job is to help someone recognise a moment in a list.

import * as fs from 'fs';
import * as path from 'path';

export type TitleMap = Record<string, string>;

function titlesPath(root: string): string {
  return path.join(root, '.git', 'mde-titles.json');
}

/** Never throws. A missing, unreadable, or malformed sidecar simply means "no custom titles". */
export function readTitles(root: string): TitleMap {
  try {
    const parsed = JSON.parse(fs.readFileSync(titlesPath(root), 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: TitleMap = {};
    for (const [sha, title] of Object.entries(parsed)) {
      if (typeof title === 'string' && title.trim()) out[sha] = title;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Set (or, with an empty string, clear) the title for one checkpoint.
 *
 * Written temp-then-rename so a crash mid-write can never leave a half-JSON file that would
 * silently blank every custom title in the folder.
 */
export function setTitle(root: string, sha: string, title: string): void {
  const titles = readTitles(root);
  const trimmed = title.trim();
  if (trimmed) titles[sha] = trimmed;
  else delete titles[sha];

  const target = titlesPath(root);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(titles, null, 2) + '\n');
  fs.renameSync(tmp, target);
}
