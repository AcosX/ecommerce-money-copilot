(function(g){
  'use strict';
  const base='assets/game/mail/',sources=['envelope-back-v1.webp','envelope-pocket-v1.webp','letter-paper-v1.webp'];
  const cache=sources.map(src=>{const image=new Image();image.src=base+src;image.decode?.().catch(()=>{});return image;});
  cache[2].addEventListener('load',()=>document.querySelectorAll('.mail-art-content').forEach(host=>host.classList.add('mail-paper-ready')));
  let transition=null;const animations=new Set();
  function track(animation){animations.add(animation);animation.finished.catch(()=>{}).finally(()=>animations.delete(animation));return animation;}
  function cancel(){transition=null;for(const animation of animations)animation.cancel();animations.clear();document.querySelectorAll('.mail-transition-ghost').forEach(n=>n.remove());}
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
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
