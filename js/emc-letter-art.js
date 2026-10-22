(function(g){
  'use strict';
  const base='assets/game/mail/',sources=['envelope-back-v1.webp','envelope-pocket-v1.webp','letter-paper-v1.webp'];
  const cache=sources.map(src=>{const image=new Image();image.src=base+src;image.decode?.().catch(()=>{});return image;});
  cache[2].addEventListener('load',()=>document.querySelectorAll('.mail-art-content').forEach(host=>host.classList.add('mail-paper-ready')));
  let transition=null;const animations=new Set();
  function track(animation){animations.add(animation);animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));return animation;}
  function cancel(){transition=null;for(const animation of animations)animation.cancel();animations.clear();document.querySelectorAll('.mail-transition-ghost').forEach(n=>n.remove());}
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
  const pages=new Map();
  function paginate(letter){
    let body=letter.querySelector('.mail-page-body'),nav=letter.querySelector('.mail-reader-nav');
    if(!body){
      body=document.createElement('div');body.className='mail-page-body';
      for(const block of Array.from(letter.children)){
        if(block.matches('.mail-story-copy,.mail-welcome-copy')){for(const p of Array.from(block.children)){const wrap=document.createElement('div');wrap.className=block.className;wrap.append(p);body.append(wrap);}block.remove();}
        else body.append(block);
      }
      nav=document.createElement('nav');nav.className='mail-reader-nav';nav.setAttribute('aria-label','信纸翻页');
      nav.innerHTML='<button type="button" data-letter-page="-1" aria-label="上一页信纸">← 上一页</button><span role="status"></span><button type="button" data-letter-page="1" aria-label="下一页信纸">下一页 →</button>';
      letter.append(body,nav);
    }
    const key=(letter.closest('[data-j-view]')?.dataset.jView||'')+':'+(letter.dataset.story||letter.querySelector('h3')?.textContent||'letter');
    const blocks=Array.from(body.querySelectorAll(':scope > .mail-page')).flatMap(p=>Array.from(p.children));
    if(!blocks.length)blocks.push(...Array.from(body.children));
    body.replaceChildren();const groups=[];let page;
    const fresh=()=>{page=document.createElement('div');page.className='mail-page';body.append(page);groups.push(page);};fresh();
    for(const block of blocks){page.append(block);if(page.scrollHeight>body.clientHeight+1&&page.children.length>1){block.remove();fresh();page.append(block);}}
    const show=index=>{index=Math.max(0,Math.min(groups.length-1,index));pages.set(key,index);groups.forEach((p,i)=>p.hidden=i!==index);nav.querySelector('span').textContent=(index+1)+' / '+groups.length;nav.firstElementChild.disabled=index===0;nav.lastElementChild.disabled=index===groups.length-1;};
    nav.onclick=e=>{const button=e.target.closest('[data-letter-page]');if(button){show((pages.get(key)||0)+Number(button.dataset.letterPage));if(!reduced())track(body.animate([{opacity:.45,transform:'translateX(6px)'},{opacity:1,transform:'none'}],{duration:180,easing:'ease-out'}));}};
    show(pages.get(key)||0);
  }
  function frame(host){
    host.classList.toggle('mail-has-letter',Boolean(host.querySelector('.mail-envelope-stage')));
    host.classList.toggle('mail-has-sheet',Boolean(host.querySelector('.mail-extracted-stage')));
    const letter=host.querySelector('.mail-letter-sheet');if(letter)paginate(letter);
  }
  function capture(host,target,returning=false){
    transition=null;if(reduced())return;
    const source=returning?host.querySelector('.mail-attachment-sheet'):target;
    if(!source)return;
    const rect=source.getBoundingClientRect();if(!rect.width||!rect.height)return;
    const ghost=returning?source.cloneNode(true):null;
    if(ghost){ghost.querySelectorAll('input,textarea,select,button,a').forEach(node=>{const text=document.createElement('div');text.className=node.className;text.textContent=node.value||node.textContent;node.replaceWith(text);});ghost.querySelectorAll('*').forEach(node=>{for(const name of node.getAttributeNames())if(name==='id'||name==='name'||name==='for'||name.startsWith('data-'))node.removeAttribute(name);});ghost.removeAttribute('id');ghost.inert=true;ghost.setAttribute('aria-hidden','true');}
    transition={rect,returning,ghost};
  }
  function image(name,cls){const el=document.createElement('img');el.src=base+name;el.alt='';el.onerror=()=>{el.hidden=true;};el.draggable=false;el.className=cls;el.setAttribute('aria-hidden','true');return el;}
  function decorate(host){
    const move=transition;transition=null;if(move)host.scrollTop=0;host.classList.add('mail-art-content');host.classList.toggle('mail-paper-ready',cache[2].complete&&cache[2].naturalWidth>0);
    const letter=host.querySelector('.mail-letter-sheet');
    if(letter&&!letter.closest('.mail-envelope-stage')){
      const stage=document.createElement('section');stage.className='mail-envelope-stage';
      const existing=letter.nextElementSibling?.classList.contains('mail-enclosures')?letter.nextElementSibling:null;
      letter.before(stage);const title=letter.querySelector('.j-task-title'),salute=letter.querySelector('.mail-salutation');if(title&&salute)title.after(salute);stage.append(image(sources[0],'mail-art-back'),letter);
      let enclosures=existing;
      if(!enclosures){
        const practice=letter.querySelector('[data-j-action=deliver]'),kit=letter.querySelector('.j-kit');
        if(practice||kit){enclosures=document.createElement('section');enclosures.className='mail-enclosures';const grid=document.createElement('div');grid.className='mail-attachment-grid';if(practice)grid.append(practice);if(kit)grid.append(kit);enclosures.append(grid);letter.querySelector('.mail-enclosure-label')?.remove();}
      }
      if(enclosures){enclosures.dataset.count=enclosures.querySelector('.mail-attachment-grid')?.children.length||0;stage.append(enclosures);}
      stage.append(image(sources[1],'mail-art-pocket'));
    }
    const sheet=host.querySelector('.mail-attachment-sheet');
    if(sheet&&!sheet.closest('.mail-extracted-stage')){const stage=document.createElement('section');stage.className='mail-extracted-stage';sheet.before(stage);stage.append(sheet);}
    // The envelope stays still; only an extracted attachment has its own reading area.
    const kit=host.querySelector('.j-kit-content,.mail-enclosures>.j-goal');
    if(kit){const stage=document.createElement('section');stage.className='mail-extracted-stage mail-kit-stage';const paper=document.createElement('article');paper.className='mail-attachment-sheet';const heading=document.createElement('header');heading.className='mail-attachment-heading';heading.innerHTML='<span>随信方法附件</span><button type="button" '+(host.dataset.jView==='demo'?'data-demo="kit"':'data-j-action="kit"')+'>← 放回信封</button>';paper.append(heading,kit);stage.append(paper);host.append(stage);host.querySelector('.mail-envelope-stage').hidden=true;}
    frame(host);
    if(!host._mailResize){host._mailResize=new ResizeObserver(()=>{cancelAnimationFrame(host._mailResizeFrame);host._mailResizeFrame=requestAnimationFrame(()=>frame(host));});host._mailResize.observe(host);}
    host.scrollTop=0;
    if(!move||reduced())return;
    if(move.returning&&move.ghost){
      const target=host.querySelector('.mail-attachment.primary'),dest=target?.getBoundingClientRect();if(!dest)return;
      const ghost=move.ghost,r=move.rect;ghost.classList.add('mail-transition-ghost');Object.assign(ghost.style,{position:'fixed',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px',margin:'0',boxSizing:'border-box',overflow:'hidden',zIndex:24,pointerEvents:'none',transformOrigin:'center'});document.body.append(ghost);
      const dx=dest.x+dest.width/2-r.x-r.width/2,dy=dest.y+dest.height/2-r.y-r.height/2;
      track(ghost.animate([{transform:'none',opacity:1},{transform:`translate(${dx}px,${dy}px) scale(${dest.width/r.width},${dest.height/r.height}) rotate(-4deg)`,opacity:0}],{duration:330,easing:'cubic-bezier(.3,0,.3,1)'})).finished.catch(()=>{}).finally(()=>ghost.remove());
    }else if(sheet){
      const dest=sheet.getBoundingClientRect(),r=move.rect,dx=r.x+r.width/2-dest.x-dest.width/2,dy=r.y+r.height/2-dest.y-dest.height/2;
      track(sheet.animate([{transform:`translate(${dx}px,${dy}px) scale(${r.width/dest.width},${r.height/dest.height}) rotate(-4deg)`,opacity:.55},{transform:'none',opacity:1}],{duration:450,easing:'cubic-bezier(.18,.8,.2,1)'}));
    }
  }
  g.EmcLetterArt={cancel,capture,decorate,assets:()=>cache.map(i=>({src:i.src,ready:i.complete&&i.naturalWidth>0}))};
})(window);
