/* Shared companion visibility, image attachments and public web search controls. */
(function(g){
  'use strict';
  const $=id=>document.getElementById(id),dock=$('companionChat'),form=$('copilotForm');
  let pending=[],processing=false,previousMute=false,epoch=0,busy=false;
  const sent=new Map(),owner=()=>g.EmcSession?.current()?.player?.id||'guest';
  let currentOwner=owner();
  const tools=document.createElement('div');tools.className='chat-media-tools';
  tools.innerHTML='<button id="chatPickImage" type="button">＋ 图片</button><input id="chatImageFiles" type="file" accept="image/png,image/jpeg,image/webp" multiple hidden><small id="chatImageStatus" role="status"></small>';
  const previews=document.createElement('div');previews.className='chat-image-previews';
  form.before(tools,previews);
  function update(){
    previews.replaceChildren();
    pending.forEach((url,index)=>{
      const box=document.createElement('span'),image=new Image(),remove=document.createElement('button');
      image.src=url;image.alt='待发送图片 '+(index+1);remove.type='button';remove.textContent='×';
      remove.setAttribute('aria-label','移除图片 '+(index+1));remove.disabled=busy;
      remove.onclick=()=>{pending.splice(index,1);update();};box.append(image,remove);previews.append(box);
    });
    $('copilotInput').dispatchEvent(new Event('input',{bubbles:true}));
  }
  function hide(){
    if(innerWidth>700){
      dock.classList.remove('companion-hidden','mobile-chat-open','chat-expanded','chat-collapsed');
      $('expandCompanionChat').setAttribute('aria-expanded','false');
      $('expandCompanionChat').setAttribute('aria-label','展开到中央阅读');
      $('expandCompanionChat').focus();return;
    }
    previousMute=g.EmcAvatarAgent?._state?.muted||false;
    g.EmcAvatarAgent?.setMuted(true);void g.EmcAvatarAgent?.stopVoice();g.EmcAvatarAgent?.interrupt();
    dock.classList.remove('companion-hidden','mobile-chat-open','chat-expanded');dock.classList.add('chat-collapsed');
    $('expandCompanionChat').textContent='展开';$('expandCompanionChat').setAttribute('aria-expanded','false');$('expandCompanionChat').setAttribute('aria-label','展开对话阅读');
    $('copilotInput').blur();$('copilotHistory').setAttribute('aria-expanded','false');$('copilotHistory').focus();
  }
  function show(){
    const wasHidden=dock.classList.contains('chat-collapsed');dock.classList.remove('companion-hidden','chat-collapsed');
    if(wasHidden)g.EmcAvatarAgent?.setMuted(previousMute);
    if(innerWidth<=700){dock.classList.add('mobile-chat-open');$('copilotHistory').setAttribute('aria-expanded','true');}
  }
  $('copilotInput').addEventListener('focus',()=>{if(dock.classList.contains('chat-collapsed'))show();});
  matchMedia('(min-width:701px)').addEventListener('change',event=>{
    if(event.matches)hide();
    else{dock.classList.remove('chat-expanded');$('expandCompanionChat').setAttribute('aria-expanded','false');}
  });
  $('chatPickImage').onclick=()=>$('chatImageFiles').click();
  async function compress(file){
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)
      throw Error('请选择不超过 10 MB 的 PNG、JPG 或 WebP 图片');
    const bitmap=await createImageBitmap(file);
    try{
      const canvas=document.createElement('canvas'),ratio=Math.min(1,1280/Math.max(bitmap.width,bitmap.height));
      canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(bitmap,0,0,canvas.width,canvas.height);
      let quality=.88,url=canvas.toDataURL('image/jpeg',quality);
      while(url.length>270000&&quality>.3){quality-=.1;url=canvas.toDataURL('image/jpeg',quality);}
      if(url.length>270000)throw Error('图片细节过多，请裁剪后重试');return url;
    }finally{bitmap.close();}
  }
  $('chatImageFiles').onchange=async e=>{
    if(processing||busy)return;const batch=Array.from(e.target.files),version=epoch;e.target.value='';
    if(pending.length+batch.length>3){$('chatImageStatus').textContent='每次最多发送 3 张图片';return;}
    processing=true;$('copilotSend').disabled=true;$('chatPickImage').disabled=true;
    $('chatImageStatus').textContent='正在准备图片…';
    try{const images=await Promise.all(batch.map(compress));if(version===epoch)pending.push(...images);$('chatImageStatus').textContent='';}
    catch(error){$('chatImageStatus').textContent=error instanceof DOMException?'图片读取失败，请换一张图片重试':error.message;}
    finally{processing=false;$('chatPickImage').disabled=busy;update();}
  };
  form.addEventListener('submit',e=>{if(processing){e.preventDefault();e.stopImmediatePropagation();}},true);
  g.EmcSession?.onChange?.(()=>{if(owner()!==currentOwner){currentOwner=owner();epoch++;pending=[];sent.clear();update();}});
  g.EmcChatMedia={
    hide,show,images:()=>pending.slice(),sent:text=>sent.get(text)||[],
    clear:()=>{epoch++;pending=[];update();},
    busy:value=>{busy=value;$('chatPickImage').disabled=value;update();},
    remember:(text,images)=>{if(images.length){sent.set(text,images);while(sent.size>30)sent.delete(sent.keys().next().value);}}
  };
})(window);
