const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const{chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const shots=process.env.EMC_SCREENSHOTS||os.tmpdir();require('node:fs').mkdirSync(shots,{recursive:true});
const base=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const read=page=>page.evaluate(()=>window.render_game_to_text?JSON.parse(render_game_to_text()):{phase:'loading'});
// Advance sparse browser frames while real fetch/decode/GPU preparation still completes.
// Sparse 1000ms jumps expose discarded frame time. Real loading/compilation
// still runs, with small clock steps to service its timer and frame callbacks.
async function advanceFrames(page,milliseconds){await page.clock.fastForward(milliseconds);await page.clock.runFor(32);}
async function advanceUntil(page,accept,label){
 const deadline=Date.now()+60000;let state;
 while(Date.now()<deadline){
  state=await read(page);if(accept(state))return state;
  if(state.phase==='error')throw Error(label+': '+JSON.stringify(state));
  if(state.phase==='loading'||state.phase==='playing'&&state.target>state.level&&!state.upgrade){await page.clock.fastForward(16);await new Promise(resolve=>setTimeout(resolve,25));}
  else await advanceFrames(page,1000);
 }
 throw Error(label+' timed out: '+JSON.stringify(state));
}
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.EMC_CHROMIUM?{executablePath:process.env.EMC_CHROMIUM}:{channel:process.env.EMC_BROWSER_CHANNEL||undefined}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:width===1440?900:844},deviceScaleFactor:.5}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   // Freeze before navigation: pausing a loaded 3D page can move performance.now
   // backwards on Playwright 1.56 and strand the scene's previous frame timestamp.
   await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
   await page.clock.pauseAt(new Date('2026-01-01T00:01:00Z'));
   await page.addInitScript(()=>localStorage.setItem('emc-island-audio-v1',JSON.stringify({music:false,sfx:true,musicVolume:.1,sfxVolume:.2})));
   await page.goto(base+'/tools/building-evolution.html');
   await advanceUntil(page,s=>s.phase==='ready','initial scene preparation');
   assert.equal((await read(page)).audio.context,'locked');
   assert.equal((await read(page)).prepared,5);
   if(width===1440){
    const timing=await page.evaluate(async()=>{
     const T=await import('three'),{startShopUpgrade}=await import('../js/emc-shop-upgrade.js?v=upgrade4-clock');
     const root=new T.Group(),old=new T.Mesh(new T.BoxGeometry(),new T.MeshStandardMaterial());root.add(old);
     const owner={root,quality:{lite:true},controls:{enabled:true},renderer:{shadowMap:{}},render(){}};
     const normal=startShopUpgrade(owner,[old],()=>[],{reduced:false});normal.update(1);
     const defaultProgress=normal.state().progress;normal.cancel();
     let time=0,reveals=0,swaps=0;
     const timed=startShopUpgrade(owner,[old],()=>{swaps++;return [];},{animationTime:()=>time,reduced:false,onReveal:()=>reveals++});
     time=5000;timed.update(0);await timed.promise;
     old.geometry.dispose();old.material.dispose();
     return {defaultProgress,progress:timed.state().progress,reveals,swaps,controls:owner.controls.enabled};
    });
    assert.ok(timing.defaultProgress<.03,'game upgrades retain their existing frame cap');
    assert.deepEqual({...timing,defaultProgress:0},{defaultProgress:0,progress:1,reveals:1,swaps:1,controls:true},'a long demo frame still swaps/reveals exactly once and releases controls');
   }
   const terrain=await page.evaluate(()=>evolutionScene.terrain.uuid);
   await page.clock.fastForward(500);
   await page.screenshot({path:path.join(shots,`evolution-ready-${width}.png`)});
   if(width===390)await page.locator('#sound').click();
   await page.locator('#play').click();
   if(width===1440){
    await advanceUntil(page,s=>!!s.upgrade,'first upgrade');
    const before=await read(page);await advanceFrames(page,400);const after=await read(page);
    assert.ok(after.upgrade.progress-before.upgrade.progress>=.20,'400ms sparse frame must advance the real 1.8s animation, not a capped 50ms step: '+JSON.stringify({before,after}));
    assert.ok(after.upgrade.progress<.5,'pause before the first model reveal');
    await page.locator('#pause').click();
    const paused=await read(page);await advanceFrames(page,60000);const frozen=await read(page);
    assert.equal(frozen.phase,'paused');assert.equal(frozen.elapsed,paused.elapsed);
    assert.equal(frozen.upgrade.progress,paused.upgrade.progress,'暂停必须冻结真正的升级动画');
    assert.equal(frozen.audio.playing,false);
    await page.screenshot({path:path.join(shots,'evolution-paused.png')});
    await page.locator('#pause').click();
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    const hidden=await read(page);await advanceFrames(page,60000);const background=await read(page);
    assert.equal(background.elapsed,hidden.elapsed,'hidden time is excluded');
    assert.equal(background.upgrade.progress,hidden.upgrade.progress,'hidden frames cannot advance the upgrade');
    await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
   }
   try{
    await advanceUntil(page,s=>s.phase==='complete','five upgrades');
   }catch(error){console.error('Evolution playback did not complete',{width,state:await read(page),errors});throw error;}
   const complete=await read(page);assert.deepEqual(complete.history,[0,1,2,3,4,5]);
   assert.equal(complete.canvasCount,1);assert.equal(complete.audio.effect_count,width===1440?5:0);
   assert.equal(complete.upgrade,null);assert.equal(complete.audio.playing,false);
   assert.equal(await page.evaluate(()=>evolutionScene.terrain.uuid),terrain,'整段五次升级保留同一个岛');
   assert.equal(await page.evaluate(()=>evolutionScene.controls.enabled),true);
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('emc-island-audio-v1'))),{music:false,sfx:true,musicVolume:.1,sfxVolume:.2},'演示不能改变游戏音量偏好');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(shots,`evolution-complete-${width}.png`)});
   await page.locator('#play').click();
   await advanceUntil(page,s=>s.phase==='playing'&&s.history.length===1,'replay reset');
   assert.equal((await read(page)).level,0);assert.equal((await read(page)).canvasCount,1);
   assert.deepEqual(errors,[]);await page.close();console.log('PASS 六级连播、暂停/恢复、同岛同画布、五次音效/静音、重播与偏好隔离',width);
  }
  const page=await browser.newPage({viewport:{width:320,height:568},reducedMotion:'reduce'});
  await page.route('**/buildings/level-4-*.glb*',r=>r.fulfill({status:503,body:'unavailable'}));
  await page.goto(base+'/tools/building-evolution.html');await page.waitForFunction(()=>JSON.parse(render_game_to_text()).phase==='error');
  assert.equal(await page.locator('#play').isEnabled(),true);
  await page.unroute('**/buildings/level-4-*.glb*');await page.locator('#play').click();
  await page.waitForFunction(()=>JSON.parse(render_game_to_text()).phase==='playing');
  assert.equal((await read(page)).canvasCount,1);assert.equal((await read(page)).prepared,5);await page.screenshot({path:path.join(shots,'evolution-retry-320.png')});
  await page.close();console.log('PASS 资源失败可重试、320px 与减少动态效果');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
