'use strict';
const assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const movement=(a,b)=>Math.max(...a.map((p,i)=>Math.hypot(...p.map((v,j)=>v-b[i][j]))));
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(root+'/tools/character-preview.html?motion=1');await page.waitForFunction(()=>window.characterPreviewState?.().loaded);await page.locator('#blink').click();await page.locator('#repeatMotion').click();
  for(const profile of ['detail','lite']){
   if(profile==='lite'){await page.locator('#lite').click();await page.waitForFunction(()=>characterPreviewState().loaded&&characterPreviewState().profile==='lite');}
   const initial=await page.evaluate(()=>characterPreviewState());assert.equal(initial.bones,46);assert.equal(initial.morphs.length,26);assert.equal(initial.motion.clips.length,13);
   await page.evaluate(()=>characterInspectMotion('idle',.4));const shoulder=await page.evaluate(()=>characterShoulderProbe());assert.ok(shoulder.width>.35&&shoulder.width<.43,'Shoulder width cannot collapse: '+JSON.stringify(shoulder));assert.ok(shoulder.heights.every(h=>h>1.25&&h<1.34),'Clavicles cannot fold down like upper arms: '+JSON.stringify(shoulder));
   for(const clip of initial.motion.clips){
    await page.evaluate(n=>characterInspectMotion(n,.12),clip);const before=await page.evaluate(()=>characterPreviewProbe());
    await page.evaluate(n=>characterInspectMotion(n,.55),clip);const after=await page.evaluate(()=>characterPreviewProbe());
    assert.ok(Math.max(movement(before.face,after.face),movement(before.body,after.body))>.002,'Actual skinned motion '+clip);
    const bounds=await page.evaluate(()=>characterMotionProbe());if(clip==='sit_cliff'){assert.ok(bounds.minY>-.40&&bounds.minY<-.08,'Legs hang below the edge '+JSON.stringify(bounds));assert.ok(bounds.maxY>.85&&bounds.maxY<1.25,'Seated cliff height');}else if(clip==='sit_cross'){assert.ok(bounds.minY>-.045&&bounds.minY<.07,'Cross-legged floor contact '+JSON.stringify(bounds));assert.ok(bounds.maxY>1&&bounds.maxY<1.3,'Seated cross-legged height');}else{assert.ok(bounds.minY>-.02&&bounds.minY<.035,'Ground contact '+clip+' '+JSON.stringify(bounds));assert.ok(bounds.maxY>1.4&&bounds.maxY<2.1,'Bounded character '+clip);}
   }
   const observation=await page.evaluate(()=>{characterInspectMotion('idle',.4);const standing=characterJointProbe();characterInspectMotion('lookout',.50);return {standing,pose:characterJointProbe()};});
   const bone=(frame,suffix)=>Object.entries(frame).find(([name])=>name.endsWith(suffix))[1];
   for(const wrist of ['0_Right_Limb_2','1_Left_Limb_2']){const hand=bone(observation.pose,wrist),hip=bone(observation.pose,'Xiaoshang_Hips');assert.ok(Math.abs(hand[1]-hip[1]-.19)<.015&&Math.abs(Math.abs(hand[2]-hip[2])-.22)<.015,'Both hands must visibly reach the waist');}
   assert.ok(bone(observation.pose,'Xiaoshang_Head')[0]-bone(observation.standing,'Xiaoshang_Head')[0]>.12,'Lookout needs a readable forward lean');
   const wrists=await page.evaluate(()=>Array.from({length:81},(_,i)=>{characterInspectMotion('letter',i/80);return characterWristProbe();}));assert.ok(Math.max(...wrists.map(s=>s.twistDegrees))<8,'Hand and forearm must not twist against each other and crush the wrist mesh');assert.ok(Math.max(...wrists.map(s=>s.bendDegrees))<8,'The letter wrist must remain aligned with the forearm for the entire action');
   for(let i=1;i<wrists.length;i++){const dot=Math.abs(wrists[i].rotation.reduce((sum,v,j)=>sum+v*wrists[i-1].rotation[j],0));assert.ok(2*Math.acos(Math.min(1,dot))<.50,'No wrist flips between consecutive letter frames');}
   const sittingEntry=await page.evaluate(()=>[.12,.20,.28].map(t=>{characterInspectMotion('sit_cross',t);return characterJointProbe();}));for(const f of sittingEntry){assert.ok(bone(f,'0_Left_Limb_2')[2]<-.12&&bone(f,'1_Right_Limb_2')[2]>.12,'Feet must not cross while descending into the squat');}
   const folds=await page.evaluate(()=>[.38,.50,.63].map(t=>{characterInspectMotion('sit_cross',t);return characterJointProbe();}));assert.ok(bone(folds[0],'1_Right_Limb_2')[2]>.12,'Second leg waits until the first has folded');assert.ok(bone(folds[2],'0_Left_Limb_2')[2]>0&&bone(folds[2],'1_Right_Limb_2')[2]<0,'Both shins cross after sitting down');
   const gait=await page.evaluate(()=>Array.from({length:61},(_,i)=>{characterInspectMotion('walk',i/60);return characterJointProbe();}));
   const joint=(frame,suffix)=>Object.entries(frame).find(([name])=>name.endsWith(suffix))[1];
   const range=values=>Math.max(...values)-Math.min(...values);
   assert.ok(range(gait.map(f=>joint(f,'Xiaoshang_Hips')[1]))<.008,'Walking pelvis bounce under 8 mm');
   assert.ok(range(gait.map(f=>joint(f,'Xiaoshang_Head')[1]))<.018,'Head bounce under 18 mm');
   for(const foot of ['0_Left_Limb_2','1_Right_Limb_2'])assert.ok(range(gait.map(f=>joint(f,foot)[1]))<.026,'Small, low steps');
   await page.evaluate(()=>characterInspectMotion('walk',0));const loopStart=await page.evaluate(()=>characterPreviewProbe());
   await page.evaluate(()=>characterInspectMotion('walk',.99999));const loopEnd=await page.evaluate(()=>characterPreviewProbe());
   assert.ok(movement(loopStart.body,loopEnd.body)<.03,'Walk loop cannot kick at the seam');
   await page.evaluate(()=>characterInspectMotion('letter',.45));assert.equal((await page.evaluate(()=>characterPreviewState())).props.envelopeVisible,true,'Envelope is present while held');
   await page.evaluate(()=>characterInspectMotion('idle',.45));assert.equal((await page.evaluate(()=>characterPreviewState())).props.envelopeVisible,false,'No envelope left floating after action');
   const seated=await page.evaluate(()=>[.35,.45,.55,.65].map(t=>{characterInspectMotion('sit_cliff',t);return characterJointProbe();}));
   for(const wrist of ['0_Right_Limb_2','1_Left_Limb_2']){const points=seated.map(f=>joint(f,wrist));assert.ok(points.every(p=>p[1]<.05&&p[0]<-.20),'Palms must reach the supporting surface behind the body');assert.ok(Math.max(...points.map(p=>Math.hypot(...p.map((v,i)=>v-points[0][i]))))<.012,'Supporting hands stay planted');}
   const legs=seated.map(f=>joint(f,'0_Left_Limb_2'));assert.ok(range(legs.map(p=>p[0]))>.02,'Cliff shins actually swing');
   const exit=await page.evaluate(()=>{characterInspectMotion('sit_cross',.5);document.querySelector('[data-motion=walk]').click();const queued=characterPreviewState().motion;for(let i=0;i<55;i++)characterMotionStep(.1);return {queued,after:characterPreviewState().motion};});assert.equal(exit.queued.name,'sit_cross');assert.equal(exit.queued.pending,'walk');assert.equal(exit.after.name,'walk','Stand up before continuing requested motion');
   const repeated=await page.evaluate(()=>{characterInspectMotion('lookout',0);document.getElementById('repeatMotion').click();document.querySelector('[data-motion=lookout]').click();for(let i=0;i<140;i++)characterMotionStep(.1);const result=characterPreviewState().motion;document.getElementById('repeatMotion').click();return result;});assert.equal(repeated.repeat,true);assert.equal(repeated.name,'lookout','Repeated preview must not end in an uninformative idle pose');
   await page.locator('aside').evaluate(o=>o.scrollTop=0);
   for(const clip of ['idle','walk','wave','lookout','inspect','letter','shop_hips','sit_cross','sit_cliff']){await page.evaluate(n=>characterInspectMotion(n,n==='sit_cross'?.63:.4),clip);await page.waitForTimeout(150);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-motion-${profile}-${width}-${clip}.png`)});}
   await page.getByRole('button',{name:'手部近景',exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:path.join(os.tmpdir(),`emc-xiaoshang-motion-${profile}-${width}-hand.png`)});await page.getByRole('button',{name:'全身动作',exact:true}).click();
   await page.locator('[data-emotion=happy]').click();await page.locator('[data-viseme=oh]').click();await page.evaluate(()=>characterInspectMotion('walk',.4));const state=await page.evaluate(()=>characterPreviewState());assert.equal(state.face.emotion,'happy');assert.ok(state.face.weights.viseme_oh>.99,'Face works during body action');
   const transition=await page.evaluate(()=>{characterInspectMotion('idle',.4);document.querySelector('[data-motion=walk]').click();const samples=[];for(let i=0;i<18;i++){characterMotionStep(1/30);samples.push({state:characterPreviewState().motion,body:characterPreviewProbe().body});}return samples;});
   for(let i=0;i<transition.length;i++){assert.ok(Math.abs(Object.values(transition[i].state.weights).reduce((a,b)=>a+b,0)-1)<.00001,'No bind-pose exposure during blend');if(i)assert.ok(movement(transition[i-1].body,transition[i].body)<.12,'No pose teleport between blended frames');}assert.equal(transition.at(-1).state.transitioning,false);
   await page.locator('[data-motion=wave]').click();const waveDuration=(await page.evaluate(()=>characterPreviewState())).motion.duration;await page.waitForTimeout(waveDuration*1000+600);assert.equal((await page.evaluate(()=>characterPreviewState())).motion.name,'idle','One-shot returns smoothly to idle');
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.close();console.log('PASS '+width+'px 两档画质、13 动作真实网格位移、脚底接地、46 骨骼、26 嘴型表情保留');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
