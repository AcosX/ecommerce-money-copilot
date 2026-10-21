(function(){
'use strict';
const overlay=document.getElementById('opening'),loader=document.getElementById('sceneLoader'),status=document.getElementById('bootStatus'),retry=document.getElementById('bootRetry');
if(!overlay||!loader)return;
let elapsed=false,finished=false;
function update(){
 if(finished)return;
 const error=loader.dataset.state==='error'&&!loader.hidden;
 overlay.classList.toggle('failed',error);retry.hidden=!error;
 if(error){status.textContent='小店暂时没能打开，再试一次。';return;}
 const ready=loader.hidden;
 overlay.dataset.ready=String(ready);
 overlay.classList.toggle('waiting',elapsed&&!ready);
 status.textContent=elapsed&&!ready?'正在准备场景资源，请稍候…':ready?'准备好了，开张！':'正在为你的小店开张…';
 if(elapsed&&ready){finished=true;observer.disconnect();overlay.classList.add('leaving');setTimeout(()=>overlay.remove(),460);}
}
retry.onclick=()=>{document.getElementById('retryScene')?.click();update();};
const observer=new MutationObserver(update);observer.observe(loader,{attributes:true,attributeFilter:['hidden','data-state']});
setTimeout(()=>{elapsed=true;update();},3000);update();
})();
