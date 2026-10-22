/* Render assistant Markdown through a strict HTML sanitizer. User input stays text. */
(function (g) {
  'use strict';
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function render(text) {
    if (!g.marked || !g.DOMPurify) return escape(text).replaceAll('\n', '<br>');
    return g.DOMPurify.sanitize(g.marked.parse(String(text || ''), {gfm:true, breaks:true}), {
      ALLOWED_TAGS: ['p','br','strong','em','del','h1','h2','h3','h4','h5','h6','ul','ol','li','blockquote','pre','code','a','hr','table','thead','tbody','tr','th','td'],
      ALLOWED_ATTR: ['href','title','start'], ALLOW_DATA_ATTR:false
    });
  }
  g.EmcMarkdown = {render, escape, plain: text => {
    const node = document.createElement('div'); node.innerHTML = render(text); return node.textContent || '';
  }};
})(window);
