import { Extension } from '@tiptap/core';
import { Plugin, Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { displaySrc, resolveImageSrc } from './imageNode';

export const IMAGE_DELETE_EVENT = 'mde-image-delete';
// `tr` is the held-back edit; `files` are the image files it would leave unreferenced.
export type ImageDeleteRequest = { tr: Transaction; files: { path: string; shown: string }[] };
// Set on a held-back edit once the user has answered, so it passes the guard.
export const IMAGE_DELETE_ANSWERED = 'imageDeleteAnswered';

function stepsTouchAnImage(tr: Transaction): boolean {
  return tr.steps.some((step, i) => {
    let hit = false;
    step.getMap().forEach((from, to) => {
      if (from < to) tr.docs[i].nodesBetween(from, to, (n) => { if (n.type.name === 'image') hit = true; return !hit; });
    });
    return hit;
  });
}

function localImages(doc: PMNode, baseDir: string | null): Map<string, string> {
  const files = new Map<string, string>();
  doc.descendants((n) => {
    if (n.type.name !== 'image') return;
    const path = resolveImageSrc(n.attrs.src, baseDir)?.localPath;
    if (path && !files.has(path)) files.set(path, displaySrc(n.attrs.src));
  });
  return files;
}

// Holds back an edit that removes the document's last reference to an image file that displayed,
// and asks (via IMAGE_DELETE_EVENT, answered in Editor) whether to trash the file too. Loads,
// reloads, folds, undo/redo, and cut (the image is on its way to a paste) are never held.
export const ImageDeleteGuard = Extension.create({
  name: 'imageDeleteGuard',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [new Plugin({
      filterTransaction(tr, state) {
        if (!tr.docChanged || tr.getMeta(IMAGE_DELETE_ANSWERED) || tr.getMeta('addToHistory') === false
          || tr.getMeta('uiEvent') === 'cut' || isHistoryTransaction(tr) || !stepsTouchAnImage(tr)) return true;
        const { baseDir, shownFiles } = (editor.storage as any).image as { baseDir: string | null; shownFiles: Set<string> };
        const after = localImages(tr.doc, baseDir);
        const files = [...localImages(state.doc, baseDir)]
          .filter(([path]) => !after.has(path) && shownFiles.has(path))
          .map(([path, shown]) => ({ path, shown }));
        if (!files.length) return true;
        const detail: ImageDeleteRequest = { tr, files };
        editor.view.dom.dispatchEvent(new CustomEvent(IMAGE_DELETE_EVENT, { detail }));
        return false;
      },
    })];
  },
});
