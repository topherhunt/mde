# Checkpoints: version history for MDE

Status: **proposal**. Nothing here is built yet.

## What this is

An undo history for AI-driven document edits, stored in Git but never described as Git to the user.

The target user works with Claude Code or Claude co-work over a folder of Markdown. Claude reads, rewrites, and reorganizes dozens of files across a session. Today that user has no way to see what changed, no way to review it before it compounds, and no way to undo it. They are not a programmer, they will not install a Git GUI, and if they did, they would be looking at a wall of unfamiliar nouns (staged, branch, origin, HEAD, fetch).

MDE is already the place they read those files. It already has the file tree, the directory watcher, and hash-based conflict detection. Adding a history layer there is a short walk; building it as a separate app is just building another Git GUI.

Git is an implementation detail. The word "Git" appears in this document constantly and should appear in the UI never.

## Non-goals

Explicitly out of scope, and staying out of scope:

- **Staging.** Every checkpoint is all-or-nothing over the whole folder.
- **Branches.** One branch, always. Its name is an implementation detail.
- **Remotes, push, pull, clone, fetch.** No network. This also means **no merge conflicts, ever**, which removes the single biggest failure mode for a non-technical user.
- **History rewriting.** No amend, no rebase, no `reset --hard`, no force. See "append-only" below.
- **Large binary assets.** We warn and degrade rather than reaching for LFS.
- **Multi-user collaboration.** One person, one machine.

A later "Back up to GitHub" button is imaginable, but it drags in auth, conflicts, and merges, and it is a separate project.

## Core principles

These four decide almost everything downstream. Violating any of them reintroduces the complexity the feature exists to avoid.

### 1. History is append-only. Every undo moves forward.

There is no operation that destroys or rewrites a commit. "Restore to this checkpoint" reads the old content and writes it as a **new** checkpoint on top of history, the same shape as `git revert`. The old state remains reachable.

Consequences, all good: detached HEAD is unreachable, the reflog is never needed, "I lost my work" is structurally impossible, and there is no destructive action that needs a scary confirmation dialog.

### 2. No staging, no branches, no remotes.

One button: **Save checkpoint**. It always captures everything.

### 3. Never require the user to write a message.

Requiring a message turns a zero-second action into a thirty-second one, and the result is a history of "asdf" or, more often, no history at all. Messages are auto-generated and optionally editable.

### 4. The marker grants write mode. Nothing else does.

MDE writes to a repo only if MDE marked that repo as its own (see "Repo identity"). Every other repo is read-only history browsing plus an explicit adopt button.

This inverts the risk correctly. A false negative costs the user one click. A false positive means MDE silently commits into a developer's real project.

## Repo identity

### The marker

At init, write into `.git/config`:

```
[mde]
	managed = true
	initializedAt = 2026-07-31T15:14:22Z
	schemaVersion = 1
```

`.git/config` is the right home. It lives inside `.git/`, so it never appears in the working tree, never shows in a diff, and never gets committed. It travels with the folder when it is moved, renamed, copied, or zipped. Since there are no remotes, there is no clone path that could drop it.

Do **not** key managed-ness off the folder path in `mde-state.json`. That breaks on rename, on move, and on a new machine, which is exactly the "after a restart, does it still recognise this folder" case we care about. A path-keyed entry is fine as a cache and never as the source of truth.

### The four attach states

Evaluated when a project root is opened, and re-evaluated whenever the panel gains focus:

| State | Condition | Tab appearance | Panel |
|---|---|---|---|
| **No repo** | no `.git` at root | gray, no badge | "Turn on version history for this folder" + init flow |
| **Managed** | `.git` + `mde.managed=true` + no remotes + single branch | normal, red badge with change count | full UI |
| **Foreign** | `.git`, no marker | gray | read-only history, plus "Let MDE manage version history here" |
| **Stepped back** | `mde.managed=true` but a remote or extra branch appeared | gray | read-only, with an explanation |

The stepped-back state matters more than it looks. Someone gets curious and runs `git remote add`, or Claude Code does it for them. On the next attach MDE notices, drops to read-only, and says why: *"This folder now syncs to GitHub, so MDE has stepped back to read-only to avoid interfering with it."* The marker alone can never override live evidence.

For **foreign** repos, heuristics (has a remote, several branches, has a `package.json`, has a `.gitignore` full of build directories) change only the **wording** of the warning next to the adopt button. They never change the read-only decision.

### Marking the commits

Every MDE commit carries trailers:

```
Checkpoint: 14 files changed

MDE-Checkpoint: auto
MDE-Restore: a3f9c21
```

`MDE-Checkpoint: auto|manual` drives how the entry renders in the history list. `MDE-Restore: <sha>` lets the list show "Restored to the Jul 28 checkpoint" as a first-class entry instead of an opaque commit, and lets MDE distinguish its own commits from other commits in an adopted repo.

## Checkpoint triggers

Automatic, with manual available, and never a required message.

The feature exists for people who will not remember to checkpoint. If it is manual-only, the moment it matters most (Claude just rewrote thirty files) is precisely the moment nobody was thinking about version control.

But not on a timer either. A history of identical ten-minute snapshots gives you nothing to aim a rollback at. Checkpoint on **meaningful boundaries**:

1. **External changes settle.** MDE already watches the project root recursively and debounces to 2s (`watch-project` in `src/index.ts:1061`). Extend that: after a burst of external writes goes quiet for ~30s, checkpoint. This is the "Claude just finished doing a thing" signal, and it is most of the feature's value on its own.
2. **Immediately before any restore.** Restore then becomes structurally lossless.
3. **On folder close or app quit**, if anything is uncommitted.
4. **Slow heartbeat** (30-60 min, only when something changed) as a backstop for edits made inside MDE.

Manual **Save checkpoint** stays for the "I am about to try something risky" moment, which is exactly when a person actually wants to name something.

Render manual checkpoints in bold with their title, auto ones muted. Collapse runs of consecutive auto checkpoints in the list.

### Message generation

Deterministic, local, instant, offline, private:

```
chapter-4.md +212/-40, outline.md +3/-3, and 2 new files
```

**No LLM in v1.** The plan considered a free OpenRouter endpoint and it does not survive contact:

- A shipped desktop binary containing an API key is publishing that key. Anyone can unzip the app and burn the quota.
- Free tiers commonly log or train on submitted data, are aggressively rate-limited, and can disappear without notice.
- The payload is diffs of someone's unpublished novel or private journal. For this audience, silently shipping that to a third party is a trust breach regardless of provider.

If it is added later, the architecture that keeps it from becoming a liability: **commit immediately with the deterministic message and treat the nice title as a lazily-filled decoration.** Never block a checkpoint on a network call. Never amend, which would rewrite history. Store generated titles in a local sidecar keyed by SHA, and have the history list show the title if present and the commit message otherwise. Then a timeout, a rate limit, or being offline degrades to exactly v1 behavior. Cap the payload at file names plus truncated hunks. Prefer bring-your-own-key in Settings over a bundled one.

## UI

### The tab

A third tab in `src/components/Sidebar.tsx:86-101`, after File Explorer and Document Outline. `title="Version History"`, which is also the E2E selector per the convention in CLAUDE.md.

Icon: `bi-clock-history`. Not `bi-git` and not a branch icon. A branch icon says "this is for programmers" to exactly the person we are trying not to scare.

States: gray when there is no repo or the repo is read-only; normal with a red badge showing the changed-file count when there are uncommitted changes; normal and unbadged when everything is checkpointed.

The badge needs the change count even when the panel is closed, so status runs in the main process on the debounced watcher event and is cached.

### The panel

Two views, toggled at the top.

**Changes** (default when there is anything uncommitted):

```
┌─────────────────────────────┐
│ [ Changes ] [ History ]     │
│ ┌─────────────────────────┐ │
│ │  Save checkpoint        │ │   <- primary button
│ └─────────────────────────┘ │
│ 14 files changed            │
│                             │
│  M  chapter-4.md   +212 -40 │   <- click opens diff
│  M  outline.md       +3  -3 │
│  +  notes/scene-9.md   new  │
│  -  drafts/old.md  deleted  │
└─────────────────────────────┘
```

No checkboxes. Everything is included, always.

**History**:

```
│  ● Before restructuring ch4 │   <- manual, bold
│    Today 3:14pm, 6 files    │
│  ○ 14 files changed         │   <- auto, muted
│    Today 2:51pm             │
│  ↺ Restored to Jul 28       │   <- restore commit
│    Yesterday 9:02am         │
```

Clicking a checkpoint opens its detail: the file list at that point, each file clickable to a diff, plus two restore actions.

### The diff view

**This is where the real work is, and it is the part no Git GUI will ever build.**

A unified diff with `+`/`-` gutters and `@@` hunk headers is exactly the thing that makes a non-programmer bounce. Render prose changes as prose:

- Paragraphs, headings, and lists rendered in MDE's normal document styling.
- Deleted words struck through in red, inserted words underlined in green, at **word** granularity within a changed paragraph.
- Unchanged runs collapsed to "… 34 unchanged paragraphs …", expandable.
- Code fences and tables fall back to line-level diffing, which is the correct read for them anyway.

Opens in the main editor area rather than the sidebar, since it needs the width. Read-only, reusing the existing read-only-tab machinery (`initialContent` and `readOnly` tab properties, already used by the Keyboard Shortcuts page).

Ship a line-level diff first (phase 5) and the prose renderer after (phase 7). The line-level version is genuinely useful and unblocks restore.

### Restore

Two granularities, both append-only:

- **Restore this file** to how it was at this checkpoint. This is what people want roughly 90% of the time and it is the easy sell.
- **Restore everything** to this checkpoint. The panic button.

Both auto-checkpoint the current state first, then write, then checkpoint the result with an `MDE-Restore` trailer. Nothing is ever lost, so neither needs a frightening confirmation. A plain "Restore" with a one-line "your current version is saved first" is enough.

Restore writes files directly from the main process. It deliberately does **not** go through `write-file-if-unchanged`, which is the guard for renderer buffers. The existing conflict machinery then does the right thing for free: the directory watchers fire, the renderer recomputes hashes, clean tabs silently reload with the blue proof banner, and dirty tabs raise the red conflict banner. That is exactly the desired behavior and it is already built.

### Init flow

Triggered from the gray tab. Runs the guardrail checks below, shows what it found, seeds `.gitignore`, inits, writes the marker, and makes an initial checkpoint of everything present.

## Guardrails

Run at init, results shown before the user commits to anything.

**Parent repo: refuse.** Walk up from the project root to the home directory and the filesystem root looking for `.git`. If found, block with an explanation. Nesting a repo inside a repo is a mess that a non-technical user cannot debug.

**Child repos: warn and ignore.** Scan down (bounded depth, say 4 levels) for `.git` directories. Add each to `.gitignore` explicitly. Git natively refuses to recurse into a nested repo and would otherwise record it as a gitlink, which is confusing and useless here. Verify isomorphic-git's behavior matches.

**Size check.** A book author's folder may hold two gigabytes of scans, audio, and video. Before init, walk the tree (bounded at ~20k files) and total it up. Warn if the total exceeds ~500MB, or any single file exceeds ~50MB, or the file count exceeds ~10,000. The wording is honest rather than blocking: *"This folder contains 1.8GB, mostly images. Version history is designed for documents and will be slow here. You can continue, or exclude the large files."* Offer to add the offending directories to `.gitignore`.

**Seed `.gitignore`** at init if absent, appending if present:

```
.DS_Store
Thumbs.db
desktop.ini
.obsidian/
node_modules/
*.tmp
~$*
```

Plus any nested repos found.

**Author identity.** Git requires an author on every commit and a non-technical user has none configured. Default to `MDE <mde@localhost>`, overridable in Settings. isomorphic-git's `commit` throws without it, so this is not optional.

**Unsaved buffers.** A checkpoint captures what is on disk, not what is on screen. For a manual checkpoint with dirty tabs open, the button becomes "Save 2 documents and checkpoint", which is the honest thing. Auto-checkpoints just capture disk state and leave dirty buffers alone.

## Architecture

### Library: isomorphic-git

Not a bundled Git binary, and not shelling out to the system Git.

Bundling Git binaries per platform (what GitHub Desktop does via dugite) adds tens of megabytes and three platform packaging problems. Shelling out to system Git means "is Git installed" support tickets from exactly the audience least able to answer that.

**isomorphic-git** is pure JavaScript, MIT, zero native dependencies, and behaves identically on all three platforms. Its API surface covers this entire feature: `init`, `setConfig`/`getConfig`, `statusMatrix`, `add`, `remove`, `commit`, `log`, `readBlob`, `walk`, `listRemotes`, `listBranches`, `isIgnored`.

The tradeoff is speed. It is slower than native Git on large trees, which is fine for folders of Markdown and not fine for the 2GB case, which is what the size guardrail is for.

Also add **`diff`** (jsdiff, BSD, tiny) for `diffWordsWithSpace` and `diffLines`.

**Both should bundle normally with webpack.** They are pure JS with no native dependencies, unlike `pdfjs-dist` and `mammoth`. Try bundling first. Only if webpack chokes should they be added to `externals` **and** `externalPackages` in `webpack.main.config.ts:25`, and skipping that second step is the documented way to reintroduce the `Cannot find module` bug in the packaged app.

### Where the code lives

Everything Git-touching runs in the **main process**. The renderer never sees a repo object.

```
src/git/
  repo.ts        detect, init, marker read/write, attach-state resolution
  status.ts      statusMatrix -> ChangedFile[], badge count, caching
  checkpoint.ts  add/remove walk, commit, message generation
  history.ts     log, per-commit file lists, readBlob
  restore.ts     single-file and whole-tree restore
  guards.ts      parent/child repo scan, size check, gitignore seeding
  ignore.ts      default .gitignore content
src/components/
  VersionPanel.tsx     the sidebar panel (Changes + History views)
  CheckpointButton.tsx
  DiffView.tsx         the read-only diff tab
  InitRepoDialog.tsx   guardrail results and confirmation
src/utils/
  prosediff.ts   markdown-aware word-level diff (phase 7)
```

### IPC surface

Following the existing conventions in `src/index.ts` and `src/preload.ts`:

| Channel | Signature |
|---|---|
| `vc-get-state` | `(root) => { attach: 'none'\|'managed'\|'foreign'\|'steppedBack', reason?, branch?, hasRemote? }` |
| `vc-get-status` | `(root) => { files: ChangedFile[], count: number }` |
| `vc-preflight-init` | `(root) => { parentRepo?, childRepos: string[], totalBytes, fileCount, largeFiles: [] }` |
| `vc-init` | `(root, opts) => { ok } \| { error }` |
| `vc-adopt` | `(root) => { ok }` |
| `vc-checkpoint` | `(root, { message?, kind: 'auto'\|'manual' }) => { sha, filesChanged }` |
| `vc-history` | `(root, { limit, before? }) => Checkpoint[]` |
| `vc-commit-files` | `(root, sha) => ChangedFile[]` |
| `vc-diff` | `(root, { sha, filepath, against? }) => { before: string, after: string }` |
| `vc-restore-file` | `(root, sha, filepath) => { ok, newSha }` |
| `vc-restore-all` | `(root, sha) => { ok, newSha, filesWritten }` |

Push events to the renderer: `vc-status-changed` (badge refresh) and `vc-checkpoint-created` (history refresh, and a toast for auto-checkpoints).

Types go in `src/types.ts` alongside the existing shared types, and the bridge methods in `src/preload.ts` follow the existing camelCase pattern (`vcGetStatus`, `vcCheckpoint`, ...).

### Implementation notes worth writing down now

**isomorphic-git has no `add -A`.** You must walk `statusMatrix` yourself and call `add` for modified and new files and `remove` for deleted ones. This is the single most likely place to silently drop deletions from a checkpoint.

**Verify `statusMatrix` honors `.gitignore`.** It should apply ignore rules to untracked files, but confirm it, and if ignored files leak through, filter with `isIgnored`.

**The recursive watcher will see `.git/` writes.** `watch-project` (`src/index.ts:1064`) currently discards the changed filename entirely and notifies on any event. Committing writes to `.git/`, which fires the watcher, which could trigger another checkpoint: an infinite loop. Filter changed paths under `.git/` out of the trigger before any of this ships. This is a prerequisite, not a detail.

**Whole-tree restore is the fiddliest operation.** Walk the tree at the target commit, write every blob to the working directory, and then delete files that exist now but did not exist then. Forgetting the deletion half yields a union of both states, which is worse than either.

**Status must never run on the render path.** Main process, debounced, cached, pushed to the renderer as an event. If it turns out slow on real folders, move it to a `utilityProcess` rather than optimizing in place.

## Testing

Playwright in Electron, headless, in `tests/`, following the existing conventions. Add `qa-*` classes as stable selectors, and use `[title="Version History"]` for the tab.

Tests must not depend on the system Git being installed or configured, which isomorphic-git gives us for free.

Coverage to write alongside each phase:

- Detect all four attach states, including a repo that grows a remote and steps back.
- The marker survives a folder rename (init, rename the temp dir, re-attach, still managed).
- Init refuses inside a parent repo; init ignores a child repo; init seeds `.gitignore`.
- Badge count matches files changed externally, including deletions.
- A checkpoint captures new, modified, **and deleted** files.
- Restore-file writes old content and leaves a new checkpoint on top.
- Restore-all deletes files that did not exist at the target commit.
- Restore into a dirty open tab raises the existing red conflict banner.
- Auto-checkpoint fires after external changes settle, and does **not** fire in a loop from its own `.git` writes.
- Diff output for an added paragraph, a deleted paragraph, and a word-level edit.

## Build order

Each phase ends somewhere shippable.

**Phase 0: watcher fix.** Filter `.git/` out of `watch-project`. Prerequisite for everything else.

**Phase 1: read-only plumbing.** `src/git/repo.ts` and `status.ts`, the four attach states, the tab with its badge, and the changed-files list. No writes at all. Already useful: the user can see what Claude touched. ~400 lines.

**Phase 2: init.** Guardrails, preflight dialog, `.gitignore` seeding, `git init`, marker, initial checkpoint. Plus adopt for foreign repos. ~350 lines.

**Phase 3: manual checkpoints and history.** The button, deterministic message generation, the history list, per-commit file lists. This is the first genuinely complete slice. ~350 lines.

**Phase 4: auto-checkpoints.** The settle-detector on the existing watcher, quit and close triggers, the heartbeat, and the auto/manual distinction in the list. Small and high-value. ~150 lines.

**Phase 5: diff view, line-level.** The read-only diff tab, jsdiff line diffing, wired from both the changed-files list and commit details. ~300 lines.

**Phase 6: restore.** Single file first, then whole tree. Pre-checkpoint, restore trailers, restore entries in the history list. ~300 lines.

**Phase 7: prose diff.** Markdown-aware word-level rendering, collapsed unchanged runs, code and table fallbacks. The polish that makes the feature feel like it belongs in a writing app. ~400 lines.

Roughly 2,200 lines plus tests. Phase 7 is close to half the perceived quality of the feature and none of its function, so it is correctly last but should not be dropped.

## Deferred

- LLM-written checkpoint titles, on the lazily-filled-decoration architecture above, opt-in, bring-your-own-key.
- "Back up to GitHub" as a single button. Separate project, drags in auth.
- Search across history ("when did this paragraph change?").
- Restoring a single file from a diff view hunk rather than whole-file.

## Open questions

- Should the diff view be a tab or an overlay? Tab reuses existing machinery; overlay is easier to dismiss.
- Does an auto-checkpoint deserve a toast, or is that noise? Leaning toward a toast for the first one in a session only.
- What does the panel show for a foreign repo with 40,000 commits? Needs pagination in `vc-history` from the start, hence the `before` parameter.
- Is a 30s settle window right for the auto-trigger? Probably needs tuning against a real Claude Code session.
