(function(g){
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function welcome(name,action){const info=g.EmcJourneyStory.welcome;return `<article class="mail-letter-sheet mail-welcome"><header class="mail-correspondence"><span>${esc(name)}的第一封信<b>先认识这间小店</b></span></header><h3 class="j-task-title">${esc(info.title)}</h3><div class="mail-story-copy">${info.paragraphs.map(p=>`<p>${esc(p.replaceAll('{name}',name))}</p>`).join('')}</div><p class="mail-welcome-note">不用现在就准备齐所有东西。<br>眼前这一步，我们一起做。</p><footer class="mail-signature">很高兴认识你。<b>${esc(name)}</b></footer></article><section class="mail-enclosures"><div class="mail-attachment-grid"><button class="mail-attachment primary" ${action}><i aria-hidden="true">↗</i><span><b>一起开始</b><small>先认识你，不用提交成果</small><em>${esc(info.button)}</em></span></button></div></section>`;}
  g.EmcJourneyGuidance={welcome};
})(window);
