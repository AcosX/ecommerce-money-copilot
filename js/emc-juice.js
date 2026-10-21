(function(){
  'use strict';
  function create(){
    const reduced=window.matchMedia('(prefers-reduced-motion: reduce)'),layer=document.createElement('div');
    layer.className='arcade-effects';layer.setAttribute('aria-hidden','true');document.body.append(layer);
    let timer=null,last=0,bursts=0;
    function clear(){clearTimeout(timer);timer=null;layer.replaceChildren();}
    function burst(target){
      if(reduced.matches||document.hidden||Date.now()-last<650)return;
      last=Date.now();bursts++;clear();
      const rect=(target||document.getElementById('continueButton'))?.getBoundingClientRect();if(!rect)return;
      const x=Math.min(innerWidth-30,Math.max(30,rect.x+rect.width/2)),y=Math.min(innerHeight-30,Math.max(30,rect.y+rect.height/2));
      const count=innerWidth<700||navigator.hardwareConcurrency<=4?12:22,colors=['#ffe340','#f44b3c','#46d8ad','#fffbea'];
      for(let i=0;i<count;i++){
        const p=document.createElement('i'),angle=Math.PI*2*i/count;
        p.className='arcade-particle';p.style.left=x+'px';p.style.top=y+'px';p.style.setProperty('--particle-color',colors[i%4]);
        p.style.setProperty('--dx',Math.cos(angle)*(55+i%5*15)+'px');p.style.setProperty('--dy',Math.sin(angle)*(60+i%4*20)-25+'px');p.style.setProperty('--spin',(i%2?1:-1)*180+'deg');layer.append(p);
      }
      timer=setTimeout(clear,950);
    }
    function press(e){const button=e.target.closest('button');if(!button||button.disabled||reduced.matches)return;button.classList.remove('arcade-press');void button.offsetWidth;button.classList.add('arcade-press');}
    function done(e){if(e.animationName==='arcade-press')e.target.classList?.remove('arcade-press');if(e.animationName==='arcade-launch')e.target.closest('button')?.classList.remove('arcade-launch');}
    function hidden(){if(document.hidden)clear();}
    document.addEventListener('click',press);document.addEventListener('animationend',done);document.addEventListener('visibilitychange',hidden);
    return {burst,launch(){const b=document.getElementById('continueButton');if(!reduced.matches)b?.classList.add('arcade-launch');},state:()=>({bursts,particles:layer.childElementCount,reduced_motion:reduced.matches}),dispose(){clear();layer.remove();document.removeEventListener('click',press);document.removeEventListener('animationend',done);document.removeEventListener('visibilitychange',hidden);}};
  }
  window.EmcJuice={create};
})();
