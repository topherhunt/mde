import { Mark, markInputRule } from '@tiptap/core';
import Highlight from '@tiptap/extension-highlight';

// Markdown syntax (an MDE extension, not CommonMark):
//   ==text==          yellow highlight (the common `==` convention)
//   =={blue}text==    named highlight color
//   [text]{red}       text color
// Only these names are colors; anything else stays literal text. Files store the NAME, and
// CSS maps it to a light- or dark-theme shade (--highlight-<name> / --text-color-<name>).
export const PALETTE = ['gray', 'brown', 'red', 'orange', 'yellow', 'lime', 'green', 'blue', 'purple', 'pink'] as const;
export type PaletteColor = typeof PALETTE[number];

const isPaletteColor = (name: string | null): name is PaletteColor => (PALETTE as readonly string[]).includes(name ?? '');
const COLOR_TAG = /^\{([a-z]+)\}/;

function paletteTag(src: string, pos: number): { color: PaletteColor; length: number } | null {
  const m = COLOR_TAG.exec(src.slice(pos));
  return m && isPaletteColor(m[1]) ? { color: m[1], length: m[0].length } : null;
}

// --- `==` highlight: markdown-it's own strikethrough rule with `=` as the marker, plus an
// optional {color} right after an opener. The tag is pushed as its own text token so an
// unmatched or closing `==` leaves it as literal text.
function highlightTokenize(state: any, silent: boolean): boolean {
  if (silent || state.src.charCodeAt(state.pos) !== 0x3D /* = */) return false;
  const scanned = state.scanDelims(state.pos, true);
  let len = scanned.length;
  if (len < 2) return false;

  if (len % 2) {
    state.push('text', '', 0).content = '=';
    len--;
  }
  for (let i = 0; i < len; i += 2) {
    state.push('text', '', 0).content = '==';
    state.delimiters.push({ marker: 0x3D, length: 0, token: state.tokens.length - 1, end: -1, open: scanned.can_open, close: scanned.can_close });
  }
  state.pos += scanned.length;

  const tag = scanned.can_open ? paletteTag(state.src, state.pos) : null;
  if (tag) {
    state.delimiters[state.delimiters.length - 1].color = tag.color;
    state.push('text', '', 0).content = state.src.slice(state.pos, state.pos + tag.length);
    state.pos += tag.length;
  }
  return true;
}

function highlightPostProcessList(state: any, delimiters: any[]) {
  const loneMarkers: number[] = [];
  for (const start of delimiters) {
    if (start.marker !== 0x3D || start.end === -1) continue;
    const end = delimiters[start.end];

    const open = state.tokens[start.token];
    Object.assign(open, { type: 'mark_open', tag: 'mark', nesting: 1, markup: '==', content: '' });
    if (start.color) {
      open.attrs = [['data-color', start.color]];
      state.tokens[start.token + 1].content = '';
    }
    Object.assign(state.tokens[end.token], { type: 'mark_close', tag: 'mark', nesting: -1, markup: '==', content: '' });

    const prev = state.tokens[end.token - 1];
    if (prev.type === 'text' && prev.content === '=') loneMarkers.push(end.token - 1);
  }
  // An odd run like `===` splits as `=` + `==`; move the lone `=` after the close tag.
  while (loneMarkers.length) {
    const i = loneMarkers.pop()!;
    let j = i + 1;
    while (j < state.tokens.length && state.tokens[j].type === 'mark_close') j++;
    j--;
    if (i !== j) [state.tokens[i], state.tokens[j]] = [state.tokens[j], state.tokens[i]];
  }
}

function highlightPostProcess(state: any) {
  highlightPostProcessList(state, state.delimiters);
  for (const meta of state.tokens_meta) {
    if (meta?.delimiters) highlightPostProcessList(state, meta.delimiters);
  }
}

// --- [text]{color} text color.
function textColorRule(state: any, silent: boolean): boolean {
  // Declining in validation mode is what keeps `[read the [docs]{red}](a.md)` a link: the link
  // rule rejects a label containing any complete bracketed token, and validation mode is
  // exactly how it asks. Declining makes the inner brackets plain nesting, which it allows.
  if (silent || state.src.charCodeAt(state.pos) !== 0x5B /* [ */) return false;
  const labelEnd = state.md.helpers.parseLinkLabel(state, state.pos, false);
  if (labelEnd < 0) return false;
  const tag = paletteTag(state.src, labelEnd + 1);
  if (!tag) return false;

  const oldMax = state.posMax;
  state.pos += 1;
  state.posMax = labelEnd;
  state.push('text_color_open', 'span', 1).attrs = [['data-text-color', tag.color]];
  state.md.inline.tokenize(state);
  state.push('text_color_close', 'span', -1);
  state.pos = labelEnd + 1 + tag.length;
  state.posMax = oldMax;
  return true;
}

// tiptap-markdown calls parse.setup on EVERY parse, against the same markdown-it instance.
const highlightInstalled = new WeakSet<object>();
const textColorInstalled = new WeakSet<object>();

// Priorities put both marks OUTSIDE links (Link is 1000) in the DOM, so a highlight stays one
// continuous <mark> around a link instead of three padded pieces, and a link inside colored
// text keeps its own color and underline.
export const ColorHighlight = Highlight.extend({
  priority: 1200,

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const name = el.getAttribute('data-color');
          return isPaletteColor(name) ? name : null;
        },
        renderHTML: (attrs: { color: string | null }) => (attrs.color ? { 'data-color': attrs.color } : {}),
      },
    };
  },

  // The stock rules turn a typed `=={blue}x==` into a yellow highlight of "{blue}x".
  addInputRules() {
    return [markInputRule({ find: /(?:^|\s)(==(?!\s+==)(?!\{)([^=]+)==(?!\s+==))$/, type: this.type })];
  },
  addPasteRules() {
    return [];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: (_state: any, mark: any) => (mark.attrs.color ? `=={${mark.attrs.color}}` : '=='),
          close: '==',
          mixable: true,
          // A `==` with a space just inside it cannot open or close, so it would reload as text.
          expelEnclosingWhitespace: true,
        },
        parse: {
          setup(markdownit: any) {
            if (highlightInstalled.has(markdownit)) return;
            highlightInstalled.add(markdownit);
            markdownit.inline.ruler.before('emphasis', 'mark', highlightTokenize);
            markdownit.inline.ruler2.before('emphasis', 'mark', highlightPostProcess);
          },
        },
      },
    };
  },
});

export const TextColor = Mark.create({
  name: 'textColor',
  priority: 1100,

  addAttributes() {
    return { color: { default: null, rendered: false, parseHTML: (el: HTMLElement) => el.getAttribute('data-text-color') } };
  },

  parseHTML() {
    return [{ tag: 'span[data-text-color]', getAttrs: (el: HTMLElement) => (isPaletteColor(el.getAttribute('data-text-color')) ? null : false) }];
  },

  renderHTML({ mark }) {
    return ['span', { 'data-text-color': mark.attrs.color }, 0];
  },

  addStorage() {
    return {
      markdown: {
        serialize: {
          open: '[',
          close: (_state: any, mark: any) => `]{${mark.attrs.color}}`,
          mixable: true,
        },
        parse: {
          setup(markdownit: any) {
            if (textColorInstalled.has(markdownit)) return;
            textColorInstalled.add(markdownit);
            markdownit.inline.ruler.before('link', 'text_color', textColorRule);
          },
        },
      },
    };
  },
});

// Text that would re-parse as color syntax on the next load, escaped for saving:
// - a `==` run that is not spaced on both sides (a text-node edge counts as unspaced, since
//   whatever is serialized next to it is unknown here). `a == b` is left alone.
// - a `{name}` at the very start of a text node, which could land right after a `==` opener.
// `[`/`]` need nothing here: prosemirror-markdown's esc() already escapes both.
export function escapeColorSyntax(out: string): string {
  return out
    .replace(/={2,}/g, (run, i: number, s: string) =>
      (/\s/.test(s[i - 1] ?? '') && /\s/.test(s[i + run.length] ?? '')) ? run : run.replace(/=/g, '\\='))
    .replace(/^\{([a-z]+)\}/, (m, name: string) => (isPaletteColor(name) ? `\\${m}` : m));
}
