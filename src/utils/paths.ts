// Separator-agnostic path helpers for the renderer. File paths originate in the main
// process and use the OS separator: '/' on macOS/Linux, '\' on Windows. The renderer has
// no access to Node's `path`, so these handle either separator explicitly.

const SEP = /[\\/]/;

// Last path segment (file or folder name), e.g. "C:\a\b.md" or "/a/b.md" -> "b.md".
export function basename(p: string): string {
  const parts = p.split(SEP);
  return parts[parts.length - 1] || p;
}

// Everything before the last separator, e.g. "C:\a\b.md" -> "C:\a". Returns "" if none.
export function dirname(p: string): string {
  const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return idx === -1 ? '' : p.slice(0, idx);
}

// Join a directory and a name using whichever separator the directory already uses.
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/';
  return dir + sep + name;
}
