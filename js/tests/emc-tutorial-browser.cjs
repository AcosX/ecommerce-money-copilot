'use strict';
// 可指定 EMC_PLAYWRIGHT_MODULE、EMC_BROWSER_CHANNEL、EMC_TEST_URL 与 EMC_SCREENSHOT_DIR。
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const G=require('../emc-game.js'),S=require('../emc-tutorial-save.js');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const shots=process.env.EMC_SCREENSHOT_DIR||path.join(os.tmpdir(),'emc-shop-checks');fs.mkdirSync(shots,{recursive:true});
const state=p=>p.evaluate(()=>JSON.parse(window.render_game_to_text()));
const stored=p=>p.evaluate(k=>JSON.parse(localStorage.getItem(k)),S.KEY);
const seed=data=>`if(!sessionStorage.seeded){localStorage.setItem(${JSON.stringify(S.KEY)},${JSON.stringify(typeof data==='string'?data:JSON.stringify(data))});sessionStorage.seeded='1';}`;
const answer=async(p,t)=>{await p.locator('[data-answer="'+t.answer+'"]').click();await p.locator('#submitAnswer').click();};
const place=async(p,id)=>{const targets=await p.evaluate(id=>shopDecorTargets(id),id),target=targets.find(t=>t.anchor===(['ufo','telescope','windmill'].includes(id)?'roof':'ground'))||targets[0];assert.ok(target);const r=await p.locator('[data-decor-id="'+id+'"]').boundingBox();await p.mouse.move(r.x+r.width/2,r.y+r.height/2);await p.mouse.down();await p.waitForTimeout(330);await p.mouse.move(target.x,target.y,{steps:8});await p.mouse.up();};
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});let passed=0;
 async function scenario(name,run,init,viewport={width:1440,height:1000}){
  const context=await browser.newContext({viewport}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(r.status()+' '+r.url());});if(init)await page.addInitScript(init);
  try{await page.goto(url);await page.waitForFunction(()=>!!window.render_game_to_text);await page.waitForFunction(()=>JSON.parse(render_game_to_text()).model_source==='tripo_model');await run(page);assert.deepEqual(errors,[]);passed++;console.log('PASS',name);}finally{await context.close();}
 }
 try{
  for(const [stage,count] of [[1,0],[2,2],[3,4],[4,7],[5,12]]){
   const data=S.createDefault(),game=G.create();game.main=G.MAIN.slice(0,count).map(t=>t.id);game.shop_name='晨光杂货铺';data.levels.L1.exercise_result.shop_game_v1=game;
   await scenario('Lv.'+stage+' 地基贴合实际岛面，首页与装修采用同一高度',async p=>{
    const ground=(await state(p)).grounding;assert.ok(ground.samples>=9);assert.ok(ground.max_clearance<=0);assert.ok(ground.min_clearance>-.35);assert.equal((await state(p)).sign_text,'晨光杂货铺');
    await p.locator('[data-panel="inventory"]').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).panel==='inventory');assert.deepEqual((await state(p)).grounding,ground);assert.equal((await state(p)).sign_text,'晨光杂货铺');
   },seed(data));
  }
  await scenario('改店名立即更新实体招牌、长文字适配、刷新恢复并传入装修',async p=>{
   let modelRequests=0;p.on('request',r=>{if(r.url().endsWith('.glb'))modelRequests++;});
   await p.locator('[data-panel="settings"]').click();await p.locator('#shopNameInput').fill('一二三四五六七八九十百货');await p.locator('#saveName').click();let s=await state(p);assert.equal(s.sign_text,'一二三四五六七八九十百货');assert.equal(s.sign_fits,true);assert.equal(modelRequests,0);
   await p.locator('#closePanel').click();await p.reload();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).scene_status==='ready');assert.equal((await state(p)).sign_text,'一二三四五六七八九十百货');
   await p.locator('[data-panel="settings"]').click();await p.locator('#shopNameInput').fill('<img>猫猫铺');await p.locator('#saveName').click();assert.equal((await state(p)).sign_text,'<img>猫猫铺');assert.equal(await p.locator('#shopOwner img').count(),0);await p.locator('#closePanel').click();
   await p.locator('[data-panel="inventory"]').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).panel==='inventory');assert.equal((await state(p)).sign_text,'<img>猫猫铺');await p.locator('#closePanel').click();
   await p.locator('[data-panel="settings"]').click();await p.locator('#shopNameInput').fill('');await p.locator('#saveName').click();assert.equal((await state(p)).sign_text,'我的小店');
  });
  await scenario('错误答案、连续升级、刷新恢复以及日夜一致布局',async p=>{
   await p.locator('#themeDay').click();await p.waitForTimeout(350);await p.screenshot({path:path.join(shots,'desktop-day.png')});
   const day=await p.locator('#continueButton').boundingBox();await p.locator('#themeNight').click();assert.deepEqual(await p.locator('#continueButton').boundingBox(),day);await p.waitForTimeout(350);await p.screenshot({path:path.join(shots,'desktop-night.png')});
   await p.locator('#continueButton').click();await p.locator('[data-answer="0"]').click();await p.locator('#submitAnswer').click();assert.equal((await state(p)).xp,0);
   await answer(p,G.MAIN[0]);await p.locator('#closePanel').click();await p.reload();assert.equal((await state(p)).theme,'night');assert.equal((await state(p)).xp,80);
   for(const t of G.MAIN.slice(1)){await p.locator('#continueButton').click();await answer(p,t);await p.locator('#closePanel').click();}
   assert.equal((await state(p)).stage,5);assert.equal((await state(p)).xp,960);const data=await stored(p);assert.ok(S.LEVEL_IDS.every(id=>data.levels[id].completed));assert.equal(data.verified,undefined);
   await p.screenshot({path:path.join(shots,'desktop-level5.png')});await p.locator('[data-panel="inventory"]').click();await p.waitForSelector('#homeCanvas canvas');await p.waitForFunction(()=>JSON.parse(render_game_to_text()).model_source==='tripo_model');await p.waitForTimeout(500);await p.screenshot({path:path.join(shots,'desktop-level5-edit.png')});await p.locator('#closePanel').click();
  });
  await scenario('支线奖励在主场景放置、真实拖动与自动保存',async p=>{
   await p.locator('#sideButton').click();await p.locator('[data-task="side-demand"]').click();await answer(p,G.SIDE[0]);await p.locator('#closePanel').click();assert.equal((await state(p)).xp,20);
   await p.locator('[data-panel="inventory"]').click();await p.locator('[data-bag-tab="decor"]').click();await place(p,'ufo');assert.equal((await state(p)).placements[0].anchor,'roof');
   const target=(await state(p)).decoration_targets[0];await p.mouse.move(target.x,target.y);await p.mouse.down();await p.waitForTimeout(330);await p.mouse.move(target.x+42,target.y+10,{steps:8});await p.mouse.up();const x=(await state(p)).placements[0].x;assert.ok(Number.isFinite(x));
   await p.screenshot({path:path.join(shots,'desktop-decoration-bag.png')});await p.reload();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).scene_status==='ready');assert.equal((await state(p)).placements[0].x,x);
  });
  await scenario('手机六件奖励、去重、装修后升级保留屋顶锚点',async p=>{
   await p.locator('#themeDay').click();
   for(const t of G.SIDE){await p.locator('#sideButton').click();await p.locator('[data-task="'+t.id+'"]').click();await answer(p,t);await p.locator('#closePanel').click();}
   assert.equal((await state(p)).xp,120);assert.equal((await state(p)).stage,1);
   await p.locator('[data-panel="inventory"]').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).panel==='inventory');await p.locator('[data-bag-tab="decor"]').click();
   for(const d of G.DECOR)await place(p,d.id);
   await place(p,'ufo');assert.equal((await state(p)).placements.length,6);
   assert.equal(await p.evaluate(()=>scrollX),0);assert.ok((await p.locator('.topbar').boundingBox()).x>=0);await p.screenshot({path:path.join(shots,'mobile-decorations.png')});await p.locator('#closePanel').click();
   for(const t of G.MAIN.slice(0,2)){await p.locator('#continueButton').click();await answer(p,t);await p.locator('#closePanel').click();}
   await p.reload();assert.equal((await state(p)).stage,2);assert.equal((await state(p)).placements.length,6);assert.equal((await state(p)).placements.find(p=>p.id==='ufo').anchor,'roof');
  },undefined,{width:390,height:844});
  await scenario('损坏存档保存前保留原文',async p=>{assert.match((await state(p)).save_status,/损坏/);await p.locator('#themeDay').click();assert.equal(await p.evaluate(k=>localStorage.getItem(k+'.recovery'),S.KEY),'{broken');await p.reload();assert.equal((await state(p)).theme,'day');},seed('{broken'));
  const future=S.createDefault();future.schema_version=999;await scenario('新版存档不可被旧页面覆盖',async p=>{const before=await stored(p);await p.locator('#themeDay').click();assert.deepEqual(await stored(p),before);assert.match((await state(p)).save_status,/更新版本/);},seed(future));
  const nested=S.createDefault();nested.levels.L1.exercise_result.shop_game_v1={schema_version:999,custom:'future'};await scenario('新版装修存档受保护',async p=>{const before=await stored(p);await p.locator('#themeDay').click();assert.deepEqual(await stored(p),before);},seed(nested));
  await scenario('配额失败不误报已保存，允许重试',async p=>{await p.locator('#themeDay').click();assert.match((await state(p)).save_status,/保存失败/);await p.evaluate(()=>window.failWrites=false);await p.locator('#saveRetry').click();assert.match((await state(p)).save_status,/已保存/);},`window.failWrites=true;const original=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(window.failWrites)throw new DOMException('Quota exceeded','QuotaExceededError');return original.call(this,k,v);};`);
  for(const width of [320,390])await scenario('手机 '+width+'px 日夜、任务和装修布局',async p=>{
   for(const mode of ['day','night']){await p.locator(mode==='day'?'#themeDay':'#themeNight').click();await p.waitForTimeout(400);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:path.join(shots,'mobile-'+width+'-'+mode+'.png')});}
   await p.locator('#continueButton').click();await p.waitForTimeout(350);await p.screenshot({path:path.join(shots,'mobile-'+width+'-quest.png')});await answer(p,G.MAIN[0]);await p.locator('#closePanel').click();await p.locator('[data-panel="inventory"]').click();await p.waitForSelector('#homeCanvas canvas');await p.waitForFunction(()=>JSON.parse(render_game_to_text()).model_source==='tripo_model');await p.waitForTimeout(400);await p.screenshot({path:path.join(shots,'mobile-'+width+'-edit.png')});assert.ok(await p.locator('#drawer.backpack').isVisible());await p.locator('#closePanel').click();assert.equal((await state(p)).editing,false);
  },undefined,{width,height:844});
 }finally{await browser.close();}console.log(passed+' browser scenarios passed. Screenshots: '+shots);
})().catch(e=>{console.error(e);process.exitCode=1;});
