// How MDE opens a file, decided by its name alone. Shared by the main process and the renderer.
// 'markdown' opens in the WYSIWYG editor, 'plaintext' in the literal text editor, 'importable'
// in a read-only preview; 'other' does not open.
export type FileKind = 'markdown' | 'plaintext' | 'importable' | 'other';

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const IMPORTABLE_EXTENSIONS = new Set(['pdf', 'docx']);
const PLAINTEXT_EXTENSIONS = new Set([
  'txt', 'json', 'jsonc', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'log', 'ini', 'conf', 'env',
  'xml', 'html', 'css', 'js', 'ts', 'sh', 'py', 'rb', 'sql',
]);
// Exact names, lowercased. The dotfiles here are the only ones the file explorer can list.
const PLAINTEXT_NAMES = new Set(['.gitignore', '.editorconfig', '.env', 'makefile', 'dockerfile', 'license']);

function lowerBasename(nameOrPath: string): string {
  return nameOrPath.slice(Math.max(nameOrPath.lastIndexOf('/'), nameOrPath.lastIndexOf('\\')) + 1).toLowerCase();
}

export function fileKind(nameOrPath: string): FileKind {
  const name = lowerBasename(nameOrPath);
  if (PLAINTEXT_NAMES.has(name)) return 'plaintext';
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot + 1) : '';
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown';
  if (PLAINTEXT_EXTENSIONS.has(ext)) return 'plaintext';
  if (IMPORTABLE_EXTENSIONS.has(ext)) return 'importable';
  return 'other';
}

// Whether a file is left out of the file explorer, Quick Open, and project-wide Find. Every
// dotfile is, unless the "Show hidden files" setting is on and MDE can open it.
export function isHiddenName(name: string, showHidden: boolean): boolean {
  return name.startsWith('.') && !(showHidden && PLAINTEXT_NAMES.has(name.toLowerCase()));
}
