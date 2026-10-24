(function(){
'use strict';
const overlay=document.getElementById('opening'),loader=document.getElementById('sceneLoader'),status=document.getElementById('bootStatus'),retry=document.getElementById('bootRetry'),skip=document.getElementById('bootSkip');
if(!overlay||!loader)return;
let elapsed=false,finished=false;
function leave(){
 if(finished)return;
 finished=true;observer.disconnect();overlay.classList.add('leaving');
 overlay.addEventListener('animationend',event=>{if(event.target===overlay&&event.animationName==='boot-exit')overlay.remove();});
 setTimeout(()=>overlay.remove(),matchMedia('(prefers-reduced-motion: reduce)').matches?120:1100);
}
function update(){
 if(finished)return;
 const error=loader.dataset.state==='error'&&!loader.hidden;
 overlay.classList.toggle('failed',error);retry.hidden=!error;skip.hidden=!error;
 if(error){status.textContent='小店暂时没能打开。可以重试，也可以先进行经营任务。';return;}
 const ready=loader.hidden;
 overlay.dataset.ready=String(ready);
 overlay.classList.toggle('waiting',elapsed&&!ready);
 status.textContent=elapsed&&!ready?'正在准备场景资源，请稍候…':elapsed&&ready?'准备好了，开张！':'正在为你的小店开张…';
 if(elapsed&&ready)leave();
}
retry.onclick=()=>{document.getElementById('retryScene')?.click();update();};
skip.onclick=()=>{document.dispatchEvent(new Event('emc:scene-skip'));leave();};
const observer=new MutationObserver(update);observer.observe(loader,{attributes:true,attributeFilter:['hidden','data-state']});
// Count actual foreground time; capping each frame delta made the 6s intro last much longer on slow GPUs.
let played=0,last=null;
document.addEventListener('visibilitychange',()=>{last=null;overlay.classList.toggle('intro-paused',document.hidden);});
function tick(now){
 if(finished)return;
 if(!document.hidden){if(last!==null)played+=Math.max(0,now-last);last=now;}else last=null;
 overlay.dataset.playedMs=String(Math.floor(played));
 if(played>=6000){elapsed=true;update();return;}
 requestAnimationFrame(tick);
}
requestAnimationFrame(()=>requestAnimationFrame(()=>{overlay.classList.add('intro-playing');overlay.classList.toggle('intro-paused',document.hidden);requestAnimationFrame(tick);}));
update();
})();
