// Default .gitignore seeded at init. Keeps OS junk, editor caches, and sync-service
// bookkeeping out of the changed-files list, where they would be pure noise to someone
// who just wants to see what changed in their documents.

export const DEFAULT_IGNORE_LINES = [
  '# Added by MDE. Files listed here are left out of version history.',
  '',
  '# Operating system junk',
  '.DS_Store',
  '.DS_Store?',
  '._*',
  '.Spotlight-V100',
  '.Trashes',
  'Thumbs.db',
  'desktop.ini',
  '',
  '# Sync service bookkeeping',
  '.dropbox',
  '.dropbox.attr',
  '.icloud',
  '*.icloud',
  '',
  '# Editor and app caches',
  '.obsidian/',
  '.vscode/',
  '.idea/',
  '*.swp',
  '~$*',
  '',
  '# Temporary files',
  '*.tmp',
  '*.temp',
  '',
  '# Dependency directories',
  'node_modules/',
];

export function defaultIgnoreContent(nestedRepos: string[]): string {
  const lines = [...DEFAULT_IGNORE_LINES];
  if (nestedRepos.length > 0) {
    lines.push(
      '',
      '# Folders that keep their own separate version history',
      ...nestedRepos.map(p => `${p.replace(/\/*$/, '')}/`)
    );
  }
  return lines.join('\n') + '\n';
}
