import { Node } from '@tiptap/core';
import { resolvePath } from './paths';

// Images read from disk go through this scheme (registered in index.ts), because the renderer's
// own origin is http://localhost in dev and Chromium refuses file:// from there. The fixed
// `local` host matters: under a standard scheme `mde-file:///Users/x` would parse `Users` as the
// host and lowercase it.
export const LOCAL_IMAGE_SCHEME = 'mde-file';

export function localImageUrl(filePath: string): string {
  const p = filePath.replace(/\\/g, '/');
  return `${LOCAL_IMAGE_SCHEME}://local${p.startsWith('/') ? '' : '/'}${p.split('/').map(encodeURIComponent).join('/')}`;
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

// What an image's `src` points at. Relative paths resolve against the document's own folder,
// the same rule links follow. `null` means there is nothing to load (a relative path in a file
// that has never been saved, or a scheme we don't fetch).
export type ImageSource = { url: string; localPath: string | null } | null;

export function resolveImageSrc(src: string, baseDir: string | null): ImageSource {
  if (/^(https?:|data:)/i.test(src)) return { url: src, localPath: null };
  if (src.startsWith('//')) return { url: `https:${src}`, localPath: null };
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null;
  // markdown-it percent-encodes the destination (`<my cat.png>` -> `my%20cat.png`).
  const rel = safeDecode(src.replace(/[?#].*$/, ''));
  const localPath = rel.startsWith('/') ? rel : baseDir ? resolvePath(baseDir, rel) : null;
  return localPath ? { url: localImageUrl(localPath), localPath } : null;
}

// The src as the user would recognise it from their file, for messages.
export const displaySrc = (src: string) => safeDecode(src);

// markdown-it normalizes an image's destination (percent-encoding, entity decoding) and
// flattens its alt to plain text, so rebuilding `![alt](src)` from the attrs would rewrite the
// user's reference on every save. The inline rule is wrapped to keep each image's exact source
// text, and that is what gets serialized. tiptap-markdown calls setup on EVERY parse.
const installed = new WeakSet<object>();

function captureSource(markdownit: any) {
  if (installed.has(markdownit)) return;
  installed.add(markdownit);
  const original = markdownit.inline.ruler.__rules__.find((r: any) => r.name === 'image').fn;
  markdownit.inline.ruler.at('image', (state: any, silent: boolean) => {
    const start = state.pos;
    if (!original(state, silent)) return false;
    const source = state.src.slice(start, state.pos);
    // Only the inline form `![alt](src)` is kept verbatim. A reference-style `![alt][ref]` needs
    // its `[ref]: url` definition, which markdown-it consumes and the document does not hold, so
    // it is saved in the resolved inline form rather than as a dangling reference.
    if (!silent && source.endsWith(')')) state.tokens[state.tokens.length - 1].attrSet('data-markdown', source);
    return true;
  });
}

function missingPlaceholder(message: string): HTMLElement {
  const wrap = document.createElement('span');
  wrap.className = 'image-missing qa-image-missing';
  const box = document.createElement('span');
  box.className = 'image-missing-box';
  box.innerHTML = '<i class="bi bi-image"></i>';
  const text = document.createElement('span');
  text.className = 'image-missing-text small text-danger';
  text.textContent = message;
  wrap.append(box, text);
  return wrap;
}

// Inline, like Markdown's own image: `see ![x](a.png) here` stays one paragraph.
export const ImageNode = Node.create({
  name: 'image',
  inline: true,
  group: 'inline',
  atom: true,
  draggable: false,

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      markdown: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-markdown'),
        renderHTML: (attrs: Record<string, any>) => (attrs.markdown ? { 'data-markdown': attrs.markdown } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'img[src]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', HTMLAttributes];
  },

  addStorage() {
    return {
      // The open document's folder, set by Editor before it loads content.
      baseDir: null as string | null,
      markdown: {
        serialize(state: any, node: any) {
          // text() rather than write(): it re-prefixes continuation lines inside quotes/lists.
          if (node.attrs.markdown) return state.text(node.attrs.markdown, false);
          const src: string = node.attrs.src.replace(/[()]/g, '\\$&');
          const title = node.attrs.title ? ` "${node.attrs.title.replace(/"/g, '\\"')}"` : '';
          state.write(`![${state.esc(node.attrs.alt || '')}](${/\s/.test(src) ? `<${src}>` : src}${title})`);
        },
        parse: { setup: captureSource },
      },
    };
  },

  addNodeView() {
    return ({ node, editor }) => {
      const dom = document.createElement('span');
      dom.className = 'image-node';
      const src: string = node.attrs.src;
      const source = resolveImageSrc(src, (editor.storage as any).image.baseDir);
      const shown = displaySrc(src);
      if (!source) {
        dom.append(missingPlaceholder(`${shown} can't be found`));
        return { dom };
      }
      const img = document.createElement('img');
      img.alt = node.attrs.alt ?? '';
      if (node.attrs.title) img.title = node.attrs.title;
      img.addEventListener('error', async () => {
        let message = `${shown} can't be loaded`;
        if (source.localPath) {
          const stats = await window.mde.getFileStats(source.localPath);
          message = stats && !stats.isDirectory ? `${shown} can't be displayed` : `${shown} can't be found`;
        }
        img.replaceWith(missingPlaceholder(message));
      }, { once: true });
      img.src = source.url;
      dom.append(img);
      return { dom };
    };
  },
});
