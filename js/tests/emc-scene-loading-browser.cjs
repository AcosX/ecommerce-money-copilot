'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const shots=path.join(os.tmpdir(),'emc-loading-checks');fs.mkdirSync(shots,{recursive:true});
const state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const ready=p=>p.waitForFunction(()=>JSON.parse(render_game_to_text()).scene_status==='ready');
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
async function watchFrames(page){await page.addInitScript(()=>{window.sceneLeaks=[];const check=()=>{const scene=document.getElementById('scene'),poster=document.getElementById('modelComposite');if(poster&&!poster.hidden)window.sceneLeaks.push('poster');if(scene?.getAttribute('aria-busy')==='true')for(const id of ['homeCanvas','editorCanvas']){const element=document.getElementById(id);if(element&&!element.hidden&&getComputedStyle(element).visibility!=='hidden')window.sceneLeaks.push(id);}requestAnimationFrame(check);};requestAnimationFrame(check);});}
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});
 try{
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),p=await context.newPage(),barrier=gate(),errors=[];p.on('pageerror',e=>errors.push(e.message));await watchFrames(p);
   await p.route('**/*.glb',async route=>{await barrier.promise;await route.continue();});
   await p.goto(url,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>!!window.render_game_to_text);
   assert.equal((await state(p)).scene_status,'loading');assert.ok(await p.locator('#sceneLoader').isVisible());assert.equal(await p.locator('#modelComposite').count(),0);
   for(const mode of ['Day','Night']){await p.locator('#theme'+mode).click();await p.screenshot({path:path.join(shots,width+'-loading-'+mode+'.png')});}
   await p.locator('#continueButton').click();assert.ok(await p.locator('#panelBody .quest-option').count());await p.locator('#closePanel').click();
   barrier.release();await ready(p);assert.equal((await state(p)).model_source,'tripo_model');assert.equal(await p.locator('#sceneLoader').isVisible(),false);assert.deepEqual(await p.locator('#homeCanvas canvas').boundingBox(),{x:0,y:0,width,height:width===390?844:1000},'3D 画布应覆盖整屏，放大后没有内部矩形截断');
   await p.screenshot({path:path.join(shots,width+'-ready.png')});assert.deepEqual(await p.evaluate(()=>window.sceneLeaks),[]);assert.deepEqual(errors,[]);
   await p.unroute('**/*.glb');let requests=0;p.on('request',r=>{if(r.url().endsWith('.glb'))requests++;});
   await p.locator('[data-panel="inventory"]').click();assert.equal((await state(p)).scene_status,'ready');assert.equal((await state(p)).panel,'inventory');assert.equal(await p.locator('#homeCanvas canvas').count(),1);assert.equal(await p.locator('#editorCanvas').count(),0);await p.locator('#closePanel').click();assert.equal(requests,0);assert.deepEqual(await p.evaluate(()=>window.sceneLeaks),[]);assert.deepEqual(errors,[]);
   await context.close();console.log('PASS '+width+'px 首帧/慢速加载/日夜/背包复用模型');
  }
  const context=await browser.newContext(),p=await context.newPage();await watchFrames(p);
  await p.route('**/assets/models/manifest.json',route=>route.fulfill({contentType:'application/json',body:'{"shops":{}}'}));await p.goto(url);await p.waitForFunction(()=>JSON.parse(render_game_to_text()).scene_status==='error');assert.ok(await p.locator('#retryScene').isVisible());assert.equal(await p.locator('#scene').getAttribute('aria-busy'),'false');await p.screenshot({path:path.join(shots,'load-error.png')});
  await p.unroute('**/assets/models/manifest.json');await p.locator('#retryScene').click();await ready(p);assert.equal((await state(p)).model_source,'tripo_model');
  assert.deepEqual(await p.evaluate(()=>window.sceneLeaks),[]);await context.close();console.log('PASS 首次失败可重试');
 }finally{await browser.close();}
 console.log('Loading transition checks passed. Screenshots: '+shots);
})().catch(error=>{console.error(error);process.exitCode=1;});
