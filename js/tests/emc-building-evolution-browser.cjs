const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const{chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const shots=process.env.EMC_SCREENSHOTS||os.tmpdir();require('node:fs').mkdirSync(shots,{recursive:true});
const base=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const read=page=>page.evaluate(()=>JSON.parse(render_game_to_text()));
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.EMC_CHROMIUM?{executablePath:process.env.EMC_CHROMIUM}:{channel:process.env.EMC_BROWSER_CHANNEL||'msedge'})});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:width===1440?900:844}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>localStorage.setItem('emc-island-audio-v1',JSON.stringify({music:false,sfx:true,musicVolume:.1,sfxVolume:.2})));
   await page.goto(base+'/tools/building-evolution.html');
   await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).phase==='ready');
   assert.equal((await read(page)).audio.context,'locked');
   assert.equal((await read(page)).prepared,5);
   const terrain=await page.evaluate(()=>evolutionScene.terrain.uuid);
   await page.waitForTimeout(500);
   await page.screenshot({path:path.join(shots,`evolution-ready-${width}.png`)});
   if(width===390)await page.locator('#sound').click();
   await page.locator('#play').click();
   if(width===1440){
    await page.waitForFunction(()=>{const s=JSON.parse(render_game_to_text());return s.upgrade&&s.upgrade.progress>.1&&s.upgrade.progress<.5;});
    await page.locator('#pause').click();
    const paused=await read(page);await page.waitForTimeout(700);const frozen=await read(page);
    assert.equal(frozen.phase,'paused');assert.equal(frozen.elapsed,paused.elapsed);
    assert.equal(frozen.upgrade.progress,paused.upgrade.progress,'暂停必须冻结真正的升级动画');
    assert.equal(frozen.audio.playing,false);
    await page.screenshot({path:path.join(shots,'evolution-paused.png')});
    await page.locator('#pause').click();
   }
   await page.waitForFunction(()=>JSON.parse(render_game_to_text()).phase==='complete',null,{timeout:60000});
   const complete=await read(page);assert.deepEqual(complete.history,[0,1,2,3,4,5]);
   assert.equal(complete.canvasCount,1);assert.equal(complete.audio.effect_count,width===1440?5:0);
   assert.equal(complete.upgrade,null);assert.equal(complete.audio.playing,false);
   assert.equal(await page.evaluate(()=>evolutionScene.terrain.uuid),terrain,'整段五次升级保留同一个岛');
   assert.equal(await page.evaluate(()=>evolutionScene.controls.enabled),true);
   assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('emc-island-audio-v1'))),{music:false,sfx:true,musicVolume:.1,sfxVolume:.2},'演示不能改变游戏音量偏好');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(shots,`evolution-complete-${width}.png`)});
   await page.locator('#play').click();
   await page.waitForFunction(()=>{const s=JSON.parse(render_game_to_text());return s.phase==='playing'&&s.history.length===1;});
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
