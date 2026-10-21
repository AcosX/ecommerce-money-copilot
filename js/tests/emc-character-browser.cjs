'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const distance=(a,b)=>Math.max(...a.map((p,i)=>Math.hypot(...p.map((x,j)=>x-b[i][j]))));
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+'/tools/character-preview.html');await page.waitForFunction(()=>window.characterPreviewState?.().loaded);await page.locator('#blink').click();
  for(const profile of ['detail','lite']){
   if(profile==='lite'){await page.locator('#lite').click();await page.waitForFunction(()=>characterPreviewState().loaded&&characterPreviewState().profile==='lite');}
   await page.waitForTimeout(150);const state=await page.evaluate(()=>characterPreviewState());assert.equal(state.bones,43);assert.equal(state.morphs.length,23);assert.ok(state.triangles<(profile==='lite'?33000:55000));
   await page.evaluate(()=>characterInspectMorph(null));const before=await page.evaluate(()=>characterPreviewProbe());
   for(const name of state.morphs){await page.evaluate(n=>characterInspectMorph(n),name);const after=await page.evaluate(()=>characterPreviewProbe());assert.ok(distance(before.face,after.face)>.00001,'Visible morph '+name);assert.ok(distance(before.face,after.face)<.06,'Bounded facial deformation '+name);assert.equal(distance(before.body,after.body),0,'Outfit must remain unchanged');}
   await page.locator('#reset').click();await page.waitForTimeout(400);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-face-${profile}-${width}.png`)});
   await page.locator('[data-emotion=happy]').click();await page.waitForTimeout(400);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-happy-${profile}-${width}.png`)});
   await page.locator('[data-viseme=oh]').click();await page.waitForTimeout(400);let s=await page.evaluate(()=>characterPreviewState());assert.equal(s.face.emotion,'happy');assert.ok(s.face.weights.viseme_oh>.95);assert.ok(s.face.weights.mouthSmile>.05&&s.face.weights.mouthSmile<.2);assert.ok(s.face.weights.mouthClose<.01);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-speaking-${profile}-${width}.png`)});
   await page.locator('[data-viseme=mbp]').click();await page.waitForTimeout(400);s=await page.evaluate(()=>characterPreviewState());assert.ok(s.face.weights.viseme_mbp>.95);assert.ok(s.face.weights.viseme_oh<.01);
   await page.locator('#blinkAmount').fill('100');await page.waitForTimeout(400);s=await page.evaluate(()=>characterPreviewState());assert.ok(s.face.weights.eyeBlinkLeft>.95&&s.face.weights.eyeBlinkRight>.95);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-blink-${profile}-${width}.png`)});
   await page.locator('#reset').click();await page.locator('#talk').click();await page.waitForTimeout(600);assert.equal((await page.evaluate(()=>characterPreviewState())).talking,true);await page.locator('#talk').click();await page.waitForTimeout(400);assert.equal((await page.evaluate(()=>characterPreviewState())).face.viseme,'sil');
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();console.log(`PASS ${width}px 双画质、43 骨骼、23 个形态键均驱动真实面部顶点、服装不变、情绪与嘴型独立叠加`);
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
