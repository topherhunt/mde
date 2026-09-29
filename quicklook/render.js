// Markdown -> an HTML page for the spacebar preview (renderMarkdown) and plain-text
// blocks for the Finder thumbnail (thumbnailBlocks). Evaluated in JavaScriptCore by
// Shared.swift after markdown-it's UMD build has defined the global `markdownit`.
// Plain ES5-style script with no module syntax, so the tests can run it under JXA.

// Same options as the editor's tiptap-markdown (Editor.tsx), so a file previews the
// way it opens: raw HTML is literal text, single newlines are line breaks.
var md = markdownit({ html: false, breaks: true, linkify: false });

// A relative image path cannot load from a data-based preview (there is no base URL
// to resolve it against), so show the reference instead of a broken-image icon.
md.renderer.rules.image = function (tokens, idx) {
  var alt = md.utils.escapeHtml(tokens[idx].content || 'image');
  return '<span class="image-ref">[' + alt + ']</span>';
};

var CSS = [
  ':root { --bg: #ffffff; --text: #1a1a1a; --text-muted: #666666; --border: #d4d4d4; --bg-secondary: #f5f5f5; --accent: #2563eb; --code-bg: #1e1e1e; --code-text: #d4d4d4; }',
  '@media (prefers-color-scheme: dark) { :root { --bg: #1e1e1e; --text: #ffffff; --text-muted: #888888; --border: #444444; --bg-secondary: #2a2a2a; --accent: #5b9bf5; --code-bg: #141414; } }',
  'body { margin: 0; padding: 1.5rem 2rem; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, sans-serif; font-size: 15px; line-height: 1.5; }',
  'h1 { font-size: 2em; font-weight: 700; line-height: 1.2; margin: 1.5em 0 0.5em; }',
  'h2 { font-size: 1.5em; font-weight: 600; line-height: 1.3; margin: 1.4em 0 0.4em; }',
  'h3 { font-size: 1.25em; font-weight: 600; margin: 1.3em 0 0.3em; }',
  'h4, h5, h6 { font-size: 1em; font-weight: 600; margin: 1.1em 0 0.3em; }',
  'body > :first-child { margin-top: 0; }',
  'p { margin: 0.8em 0 0.4em; }',
  'a { color: var(--accent); }',
  'code { background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 3px; padding: 0.1em 0.3em; font-family: "SF Mono", Menlo, monospace; font-size: 0.9em; }',
  'pre { background: var(--code-bg); color: var(--code-text); border-radius: 6px; padding: 0.75em 1em; overflow-x: auto; }',
  'pre code { background: none; border: none; padding: 0; color: inherit; }',
  'blockquote { margin: 0.8em 0; padding-left: 1em; border-left: 3px solid var(--border); color: var(--text-muted); }',
  'table { border-collapse: collapse; margin: 0.8em 0; }',
  'th, td { border: 1px solid var(--border); padding: 0.3em 0.6em; }',
  'th { background: var(--bg-secondary); }',
  'hr { border: none; border-top: 1px solid var(--border); margin: 1.5em 0; }',
  'li.task { list-style: none; position: relative; }',
  'li.task::before { content: ""; position: absolute; left: -1.4em; top: 0.3em; width: 0.9em; height: 0.9em; border: 1.5px solid var(--text-muted); border-radius: 3px; box-sizing: border-box; }',
  'li.task[data-checked="true"]::before { background: var(--accent) center / 100% no-repeat url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 14 14\'%3E%3Cpath d=\'M3.5 7.5L6 10l4.5-5\' stroke=\'white\' stroke-width=\'2\' fill=\'none\' stroke-linecap=\'round\' stroke-linejoin=\'round\'/%3E%3C/svg%3E"); border-color: var(--accent); }',
  'li.task > p { margin: 0; }',
  'li.task[data-checked="true"] > p { color: var(--text-muted); text-decoration: line-through; }',
  '.image-ref { color: var(--text-muted); font-style: italic; }',
].join('\n');

// `- [ ] x` / `- [x] x` are MDE task items: strip the marker and tag the <li>. The
// item's paragraph is un-hidden (tight lists hide it) so the text sits in a <p>, the
// same shape the editor has, and the strike-through can skip nested lists.
md.core.ruler.push('mde_tasks', function (state) {
  var t = state.tokens;
  for (var i = 2; i < t.length; i++) {
    if (t[i].type !== 'inline' || t[i - 1].type !== 'paragraph_open' || t[i - 2].type !== 'list_item_open') continue;
    var first = t[i].children[0];
    var m = first && first.type === 'text' && /^\[([ xX])\](?: |$)/.exec(first.content);
    if (!m) continue;
    first.content = first.content.slice(m[0].length);
    t[i - 2].attrSet('class', 'task');
    t[i - 2].attrSet('data-checked', m[1] === ' ' ? 'false' : 'true');
    t[i - 1].hidden = false;
    t[i + 1].hidden = false;
  }
});

// Plain text of an inline token: syntax gone, breaks as spaces, images as alt text.
function inlineText(token) {
  return token.children.map(function (c) {
    if (c.type === 'softbreak' || c.type === 'hardbreak') return ' ';
    return c.type === 'text' || c.type === 'code_inline' || c.type === 'image' ? c.content : '';
  }).join('');
}

// The first `max` blocks as JSON [{kind, text, checked?, n?}] for the Finder thumbnail
// (ThumbnailProvider.swift), where kind is h1..h6 | p | bullet | ordered | task |
// quote | code.
function thumbnailBlocks(src, max) {
  var t = md.parse(src, {});
  var blocks = [];
  var lists = [];
  var quoteDepth = 0;
  for (var i = 0; i < t.length && blocks.length < (max || 40); i++) {
    var tok = t[i];
    if (tok.type === 'bullet_list_open' || tok.type === 'ordered_list_open') lists.push(tok.type);
    else if (tok.type === 'bullet_list_close' || tok.type === 'ordered_list_close') lists.pop();
    else if (tok.type === 'blockquote_open') quoteDepth++;
    else if (tok.type === 'blockquote_close') quoteDepth--;
    else if (tok.type === 'fence' || tok.type === 'code_block') {
      blocks.push({ kind: 'code', text: tok.content.replace(/\n$/, '') });
    } else if (tok.type === 'inline' && t[i - 1]) {
      var text = inlineText(tok);
      var open = t[i - 1];
      if (open.type === 'heading_open') blocks.push({ kind: open.tag, text: text });
      else if (t[i - 2] && t[i - 2].type === 'list_item_open') {
        var checked = t[i - 2].attrGet('data-checked');
        if (checked !== null) blocks.push({ kind: 'task', text: text, checked: checked === 'true' });
        else if (lists[lists.length - 1] === 'ordered_list_open') blocks.push({ kind: 'ordered', text: text, n: t[i - 2].info });
        else blocks.push({ kind: 'bullet', text: text });
      } else if (open.type === 'paragraph_open') blocks.push({ kind: quoteDepth ? 'quote' : 'p', text: text });
      // Table cells are inline tokens too; skipped, a thumbnail has no room for a grid.
    }
  }
  return JSON.stringify(blocks);
}

function renderMarkdown(src) {
  return '<!doctype html><html><head><meta charset="utf-8"><style>' + CSS + '</style></head><body>'
    + md.render(src) + '</body></html>';
}
