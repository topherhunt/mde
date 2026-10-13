// Pasted images never enter the document as `data:` URLs: they are saved beside the document
// (PasteImagesDialog asks where), and web images may alternatively stay as links or be dropped.

export type PendingPaste =
  | { kind: 'files'; files: File[] }
  | { kind: 'web'; html: string; embedded: number };

export type WebImageChoice = 'save' | 'links' | 'remove';

const WEB_SRC = /^(https?:|data:)/i;

function webImgs(root: ParentNode): HTMLImageElement[] {
  return Array.from(root.querySelectorAll('img')).filter((img) => WEB_SRC.test(img.getAttribute('src') || ''));
}

// What a paste needs asked about it, or null to paste normally. A copy from inside MDE
// (ProseMirror marks it with data-pm-slice) keeps its references as they are.
export function pasteNeedingImageChoice(cd: DataTransfer): PendingPaste | null {
  const html = cd.getData('text/html');
  if (html) {
    if (html.includes('data-pm-slice')) return null;
    const div = document.createElement('div');
    div.innerHTML = html;
    const imgs = webImgs(div);
    if (!imgs.length) return null;
    return { kind: 'web', html, embedded: imgs.filter((img) => img.getAttribute('src')!.startsWith('data:')).length };
  }
  // Only a bare image (a screenshot): Word and Excel put a picture of the selection beside their HTML.
  const files = Array.from(cd.files).filter((f) => f.type.startsWith('image/'));
  return files.length ? { kind: 'files', files } : null;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `pasted-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '-').replace(/^[-.]+|-+$/g, '');

function nameForUrl(src: string, fallback: string): string {
  if (src.startsWith('data:')) return fallback;
  let last = '';
  try { last = decodeURIComponent(new URL(src).pathname.split('/').pop() || ''); } catch { /* keep fallback */ }
  return safeName(last) || fallback;
}

// Saves each clipboard image and returns the relative paths, in order.
export async function saveClipboardFiles(files: File[], docDir: string, folder: string): Promise<string[]> {
  const base = stamp();
  const paths: string[] = [];
  for (const [i, file] of files.entries()) {
    // A screenshot arrives as "image.png"; anything else keeps its own name.
    const name = /^image\.\w+$/i.test(file.name) || !file.name ? `${base}${i ? `-${i + 1}` : ''}` : safeName(file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    paths.push(await window.mde.saveImage(docDir, folder, name, { bytes, type: file.type }));
  }
  return paths;
}

// Rewrites the pasted HTML's web images per the user's choice. `data:` images are never kept as
// they are. A web image that fails to download stays a link and is counted in `failed`.
export async function resolveWebPaste(html: string, choice: WebImageChoice, docDir: string | null, folder: string): Promise<{ html: string; failed: number }> {
  const div = document.createElement('div');
  div.innerHTML = html;
  const base = stamp();
  let failed = 0;
  for (const [i, img] of webImgs(div).entries()) {
    const src = img.getAttribute('src')!;
    img.removeAttribute('srcset');
    const embedded = src.startsWith('data:');
    if (choice === 'remove' || (choice === 'links' && embedded)) {
      img.remove();
    } else if (choice === 'save') {
      try {
        img.setAttribute('src', await window.mde.saveImage(docDir!, folder, nameForUrl(src, `${base}-${i + 1}`), { url: src }));
      } catch {
        failed++;
        if (embedded) img.remove();
      }
    }
  }
  return { html: div.innerHTML, failed };
}
