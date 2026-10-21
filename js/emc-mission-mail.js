(function(g){
  'use strict';
  function create(o){
    const flight=document.getElementById('missionFlight'),mask=document.getElementById('missionBackdrop'),button=document.getElementById('continueButton');
    let epoch=0,opening=false,lastFocus=null;
    const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    function cancel(){g.EmcLetterArt?.cancel();++epoch;opening=false;flight.getAnimations().forEach(a=>a.cancel());flight.hidden=true;flight.classList.remove('unsealing');mask.hidden=true;mask.classList.remove('paper-visible');button.disabled=false;o.hold(false);}
    async function open(show){
      if(opening)return;opening=true;const token=++epoch;lastFocus=document.activeElement;button.disabled=true;
      mask.hidden=false;flight.hidden=false;flight.classList.remove('unsealing');flight.style.opacity='1';
      const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
      const held=o.hold(true),r=button.getBoundingClientRect(),point=held||{x:r.left+r.width/2,y:r.top+r.height/2};
      const x=point.x-innerWidth/2,y=point.y-innerHeight/2;
      try{
        flight.style.transform=`translate(${x}px,${y}px) scale(.24)`;
        if(!reduced)await pause(420);if(token!==epoch)return;
        o.sound('kit');
        await flight.animate([{transform:`translate(${x}px,${y}px) scale(.24) rotate(-12deg)`},{transform:'translate(0,-22px) scale(1.12) rotate(3deg)',offset:.8},{transform:'translate(0,0) scale(1) rotate(0deg)'}],{duration:reduced?1:650,easing:'cubic-bezier(.18,.8,.25,1)',fill:'forwards'}).finished;
        if(token!==epoch)return;flight.classList.add('unsealing');if(!reduced)await pause(420);if(token!==epoch)return;
        mask.classList.add('paper-visible');show();const drawer=document.getElementById('drawer');drawer.animate([{opacity:0,transform:'translate(-50%,-40%) scale(.5,.28)'},{opacity:1,transform:'translate(-50%,-50%) scale(1)'}],{duration:reduced?1:480,easing:'cubic-bezier(.2,.75,.2,1)'});
        flight.hidden=true;o.hold(false);opening=false;button.disabled=false;
      }catch(_){if(token===epoch){cancel();}}
    }
    function close(){cancel();if(lastFocus?.isConnected)(lastFocus.closest('#drawer')?button:lastFocus).focus({preventScroll:true});}
    return {open,close,cancel,state:()=>({opening,visible:!mask.hidden})};
  }
  g.EmcMissionMail={create};
})(window);
