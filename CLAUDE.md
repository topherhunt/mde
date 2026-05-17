# MDE -- Markdown Editor

## What this is

A WYSIWYG Markdown editor built with Electron + React + TipTap. See `plan.md` for full design.

## Architecture

- **Main process** (`src/index.ts`): Window management, file I/O, IPC handlers, file watching, menu bar, drag-drop at the OS level. No rendering.
- **Preload** (`src/preload.ts`): Exposes `window.mde` API via contextBridge. All file system access goes through this bridge.
- **Renderer** (`src/renderer.tsx`): React entry point.
- **Components** (`src/components/`): App, Sidebar, TabBar, Toolbar, Editor, FindBar, ConflictBanner.
- **Types** (`src/types.ts`): Shared TypeScript types + `window.mde` declaration.
- **Markdown utils** (`src/utils/markdown.ts`): TipTap <-> Markdown serialization via tiptap-markdown.

## Key decisions

- TipTap (ProseMirror) for the editor, not raw contenteditable.
- `tiptap-markdown` handles MD parse/serialize. The TipTap document model is the source of truth while editing.
- No auto-save. Explicit Cmd+S only.
- File conflict detection: poll mtime, show red banner, disable Save (but not editing).
- State management: React context + useReducer, no external state lib.
- Renderer webpack config does NOT use the `@vercel/webpack-asset-relocator-loader`. That loader breaks ESM imports from TipTap packages. It's only needed for native node modules in the main process.

## Commands

```
cd app
npm start          # Run the app (electron-forge start)
npm test           # Build + run Playwright E2E tests (headless)
npx playwright test tests/app.spec.ts --grep "pattern"  # Run subset
```

## Testing

Playwright in Electron mode. Tests live in `tests/`. Run with `npm test`.

**Tests MUST be headless.** No windows should pop up when tests run. The
main process checks for `--test-headless` in `process.argv` and sets
`show: false` on the BrowserWindow. The test helper passes this flag
automatically via `electron.launch({ args: [mainPath, '--test-headless'] })`.

**When troubleshooting test failures, run one test or one grep pattern
first**, not the full suite. The full suite takes ~16s; a single test
takes <1s. Use `--grep "test name fragment"` to isolate.

All verification goes through E2E tests -- do not start the app
interactively to check behavior.

## CSS conventions

Prefer utility classes over single-purpose component classes. Follow
Bootstrap 5 naming conventions:

- Use utilities for spacing (`mt-3`, `px-2`), display (`d-flex`,
  `d-none`), text (`text-muted`, `fw-bold`, `fs-sm`), colors
  (`bg-danger`, `text-white`), borders (`border`, `rounded`), etc.
- Compose utilities on elements rather than writing a new class for
  every component.
- Only create a component-specific class when it has multi-property +
  state behavior that can't be composed from utilities (e.g. a
  `.toolbar-btn` with hover/active transitions).
- When a pattern recurs (e.g. muted labels, card containers), extract a
  reusable utility rather than N page-specific classes.
- Keep the utility definitions in a shared file so they're available
  everywhere.
