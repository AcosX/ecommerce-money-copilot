'use strict';
const assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const movement=(a,b)=>Math.max(...a.map((p,i)=>Math.hypot(...p.map((v,j)=>v-b[i][j]))));
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+'/tools/character-preview.html?motion=1');await page.waitForFunction(()=>window.characterPreviewState?.().loaded);await page.locator('#blink').click();
  for(const profile of ['detail','lite']){
   if(profile==='lite'){await page.locator('#lite').click();await page.waitForFunction(()=>characterPreviewState().loaded&&characterPreviewState().profile==='lite');}
   const initial=await page.evaluate(()=>characterPreviewState());assert.equal(initial.bones,46);assert.equal(initial.morphs.length,26);assert.equal(initial.motion.clips.length,9);
   await page.evaluate(()=>characterInspectMotion('idle',.4));const shoulder=await page.evaluate(()=>characterShoulderProbe());assert.ok(shoulder.width>.35&&shoulder.width<.43,'Shoulder width cannot collapse: '+JSON.stringify(shoulder));assert.ok(shoulder.heights.every(h=>h>1.25&&h<1.34),'Clavicles cannot fold down like upper arms: '+JSON.stringify(shoulder));
   for(const clip of initial.motion.clips){
    await page.evaluate(n=>characterInspectMotion(n,.12),clip);const before=await page.evaluate(()=>characterPreviewProbe());
    await page.evaluate(n=>characterInspectMotion(n,.55),clip);const after=await page.evaluate(()=>characterPreviewProbe());
    assert.ok(Math.max(movement(before.face,after.face),movement(before.body,after.body))>.002,'Actual skinned motion '+clip);
    const bounds=await page.evaluate(()=>characterMotionProbe());assert.ok(bounds.minY>-.02&&bounds.minY<.035,'Ground contact '+clip+' '+JSON.stringify(bounds));assert.ok(bounds.maxY>1.4&&bounds.maxY<2.1,'Bounded character '+clip);
   }
   await page.locator('aside').evaluate(o=>o.scrollTop=0);
   for(const clip of ['idle','walk','wave','lookout','inspect']){await page.evaluate(n=>characterInspectMotion(n,.4),clip);await page.waitForTimeout(150);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-motion-${profile}-${width}-${clip}.png`)});}
   await page.getByRole('button',{name:'手部近景',exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-motion-${profile}-${width}-hand.png`)});await page.getByRole('button',{name:'全身动作',exact:true}).click();
   await page.locator('[data-emotion=happy]').click();await page.locator('[data-viseme=oh]').click();await page.evaluate(()=>characterInspectMotion('walk',.4));const state=await page.evaluate(()=>characterPreviewState());assert.equal(state.face.emotion,'happy');assert.ok(state.face.weights.viseme_oh>.99,'Face works during body action');
   const transition=await page.evaluate(()=>{characterInspectMotion('idle',.4);document.querySelector('[data-motion=walk]').click();const samples=[];for(let i=0;i<18;i++){characterMotionStep(1/30);samples.push({state:characterPreviewState().motion,body:characterPreviewProbe().body});}return samples;});
   for(let i=0;i<transition.length;i++){assert.ok(Math.abs(Object.values(transition[i].state.weights).reduce((a,b)=>a+b,0)-1)<.00001,'No bind-pose exposure during blend');if(i)assert.ok(movement(transition[i-1].body,transition[i].body)<.12,'No pose teleport between blended frames');}assert.equal(transition.at(-1).state.transitioning,false);
   await page.locator('[data-motion=wave]').click();const waveDuration=(await page.evaluate(()=>characterPreviewState())).motion.duration;await page.waitForTimeout(waveDuration*1000+600);assert.equal((await page.evaluate(()=>characterPreviewState())).motion.name,'idle','One-shot returns smoothly to idle');
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();console.log('PASS '+width+'px 两档画质、9 动作真实网格位移、脚底接地、46 骨骼、26 嘴型表情保留');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
