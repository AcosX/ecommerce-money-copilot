import {mountShowcaseNav} from './model-showcase.js?v=1';
import {createPlaybackClock} from '../js/emc-playback-clock.js';
const clock=createPlaybackClock();
const showcase=mountShowcaseNav('evolution'),initialLevel=showcase.state.level;
import {ShopScene} from '../js/emc-shop-scene.js?v=20261024-evolution-clock';
import {loadSceneManifest} from '../js/emc-model-loader.js?v=20261022-terrain10';

const names=['地摊起步','复古商车','日式精品店','工业旗舰店','未来商业街','未来百货地标'];
const descriptions=['第一块摊布，也是第一步。','带着生意，驶向新的机会。','从一位顾客，到自己的小店。','好商品，值得更大的舞台。','一间小店，长成一条商业街。','把第一步，变成自己的地标。'];
const $=id=>document.getElementById(id),audio=window.EmcAudio.create({persist:false});
const quality=showcase.state.quality;
const state={phase:'loading',level:0,target:0,paused:false,sound:true,elapsed:0,history:[initialLevel],prepared:0};
let shop,frame,disposed=false,preparing;
let warmup=new AbortController(),prepareEpoch=0;
audio.set('music',false);
audio.set('musicVolume',.32);
audio.set('sfxVolume',.7);
$('timeline').innerHTML=names.map((name,i)=>`<li data-state="${i===0?'current':'upcoming'}"><small>LV.0${i}</small>${name}</li>`).join('');

function sound(){audio.set('music',state.sound&&state.phase==='playing');audio.set('sfx',state.sound&&!state.paused);$('sound').setAttribute('aria-pressed',String(state.sound));$('sound').setAttribute('aria-label',state.sound?'关闭演示声音':'开启演示声音');$('sound').disabled=!audio.state().available;$('sound').textContent=!audio.state().available?'声音不可用':state.sound?'♪ 声音开':'♪ 声音关';}
function phase(value){state.phase=value;clock.setRunning(value==='playing'&&!document.hidden);document.body.dataset.phase=value;sound();$('pause').hidden=!['playing','paused'].includes(value);$('pause').disabled=!['playing','paused'].includes(value);$('pause').textContent=state.paused?'继续':'暂停';$('play').disabled=['loading','playing','paused'].includes(value);$('play').textContent=value==='loading'?'正在准备…':value==='error'?'重试完整演示':value==='complete'?'↻ 再看一遍':value==='ready'?'▶ 播放完整演示':'演示进行中';}
function chapter(level){
 const changed=state.level!==level;state.level=level;showcase.setLevel(level);$('level').innerHTML=`LV.0${level} <span>/ 05</span>`;$('name').textContent=names[level];$('description').textContent=descriptions[level];$('inspect').href=showcase.href('single');
 document.querySelectorAll('#timeline li').forEach((li,i)=>{li.dataset.state=i===level?'current':i<level?'passed':'upcoming';if(i===level)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 if(!changed)return;const el=document.querySelector('.chapter');el.classList.remove('is-new');requestAnimationFrame(()=>el.classList.add('is-new'));
}
function camera(){
 if(!shop||!shop.presentable)return;
 const moving=state.phase==='playing',angle=.88+(moving?Math.sin(state.elapsed/6000)*.055:0),aspect=shop.camera.aspect;
 const half=Math.min(Math.PI*shop.camera.fov/360,Math.atan(Math.tan(Math.PI*shop.camera.fov/360)*aspect));
 const distance=6.5/Math.sin(half)*1.02,vertical=.47;
 shop.controls.target.set(0,.6,0);shop.camera.position.set(Math.cos(angle)*distance*Math.cos(vertical),.6+distance*Math.sin(vertical),Math.sin(angle)*distance*Math.cos(vertical));shop.camera.lookAt(shop.controls.target);shop.render();
}
async function scene(level=0){
 shop?.dispose();
 const instance=shop=new ShopScene($('scene'),{stage:Math.max(1,level),modelLevel:level,quality,readOnly:true,shopName:'我的小店',night:false,draft:{wall_color:'#eee0c5',sign_color:'#9c531e',roof_color:'#bd3f23',placements:[]}});
 // The movie owns its wide camera; the game keeps its normal upgrade focus.
 instance.focusUpgrade=async()=>{};
 window.evolutionScene=shop;
 await instance.ready;if(disposed||instance!==shop)return;await instance.prepareFrame();if(disposed||instance!==shop)return;instance.controls.enabled=true;camera();
}
async function prepare(){
 const epoch=++prepareEpoch;warmup.abort();warmup=new AbortController();const signal=warmup.signal;
 phase('loading');$('loading').hidden=false;$('status').textContent='正在准备完整演示';state.prepared=0;
 try{
  const models=loadSceneManifest(signal).then(async manifest=>{
   // Warm the versioned HTTP cache without retaining six decoded GPU scenes.
   const entries=Object.values(manifest.buildings).filter(e=>e.level>0);
   await Promise.all(entries.map(async entry=>{
    const url=new URL('../'+(shop?.quality.lite&&entry.lite?.model_url||entry.model_url),import.meta.url);if(entry.revision)url.searchParams.set('v',entry.revision);
    const response=await fetch(url,{cache:'force-cache',signal});if(!response.ok)throw Error('店铺资源暂时不可用，请重试');await response.arrayBuffer();
    if(disposed||epoch!==prepareEpoch)return;state.prepared++;$('loading-text').textContent=`正在准备店铺 · ${state.prepared+1} / 6`;
   }));
  });
  await Promise.all([scene(initialLevel),models]);if(disposed||epoch!==prepareEpoch)return;chapter(initialLevel);phase('ready');$('loading').hidden=true;$('status').textContent='六级店铺 · 五次升级 · 一镜到底';
 }catch(error){if(disposed||epoch!==prepareEpoch)return;warmup.abort();phase('error');$('loading').hidden=true;$('status').textContent=error.message;}
}
function hold(milliseconds){return new Promise(resolve=>{const until=clock.now()+milliseconds;function tick(){if(disposed||clock.now()>=until)resolve();else requestAnimationFrame(tick);}requestAnimationFrame(tick);});}
async function play(){
 if(['playing','paused','loading'].includes(state.phase))return;
 if(state.phase==='error'){await prepare();if(state.phase!=='ready')return;}
 if(state.phase==='complete'||state.level!==0){
  phase('loading');$('loading').hidden=false;$('loading-text').textContent='回到第一块摊布…';
  try{await scene();}catch(error){phase('error');$('loading').hidden=true;$('status').textContent=error.message;return;}
  if(disposed)return;$('loading').hidden=true;
 }
 state.paused=false;clock.reset();state.elapsed=0;state.target=0;state.history=[0];chapter(0);shop.controls.enabled=false;phase('playing');$('status').textContent='从地摊开始，向下一步出发';
 try{
  await hold(1500);
  for(let level=1;level<=5&&!disposed;level++){
   state.target=level;$('status').textContent=`LV.0${level-1} → LV.0${level} · 店铺升级中`;
   const done=await shop.upgradeTo(level,{
    animationTime:clock.now,
    onReveal:()=>{chapter(level);state.history.push(level);audio.play('upgrade');}
   });
   if(!done||disposed)return;
   $('status').textContent=level===5?'这一回，小店有了新的模样。':`${names[level]} · 下一次蜕变即将开始`;
   await hold(level===5?2600:1600);
  }
  if(disposed)return;phase('complete');shop.controls.enabled=true;$('status').textContent='六级蜕变完成 · 拖动查看最终店铺';
 }catch(error){if(disposed)return;state.paused=false;phase('error');shop.controls.enabled=true;$('status').textContent=`演示暂时中断：${error.message}`;}
}
$('play').addEventListener('click',()=>void play());
$('pause').addEventListener('click',()=>{state.paused=!state.paused;phase(state.paused?'paused':'playing');$('status').textContent=state.paused?'演示已暂停':'继续店铺蜕变';});
$('sound').addEventListener('click',()=>{state.sound=!state.sound;sound();});
window.addEventListener('resize',()=>{if(state.phase!=='complete')camera();});
document.addEventListener('visibilitychange',()=>clock.setRunning(state.phase==='playing'&&!document.hidden));
function loop(){if(disposed)return;if(!document.hidden){state.elapsed=clock.now();if(state.phase==='playing')camera();else if(state.phase==='ready'||state.phase==='complete')shop?.controls.update();const effect=shop?.upgradeEffect?.state();const progress=effect?((state.target-1)+effect.progress)/5:state.level/5;document.documentElement.style.setProperty('--fill',(Math.max(0,progress)*100)+'%');}frame=requestAnimationFrame(loop);}
window.render_game_to_text=()=>JSON.stringify({...state,elapsed:clock.now(),upgrade:shop?.upgradeEffect?.state()||null,canvasCount:document.querySelectorAll('#scene canvas').length,audio:audio.state()});
window.evolutionReady=()=>preparing;
window.addEventListener('pagehide',()=>{disposed=true;warmup.abort();cancelAnimationFrame(frame);shop?.dispose();audio.dispose();},{once:true});
window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
frame=requestAnimationFrame(loop);preparing=prepare();
