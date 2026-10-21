'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright'),G=require('../emc-game.js'),S=require('../emc-tutorial-save.js');
const shots=path.join(os.tmpdir(),'emc-backpack-checks');fs.mkdirSync(shots,{recursive:true});
const state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const ready=p=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='ready');
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});
try{
 for(const [stage,count] of [[1,0],[2,2],[3,4],[4,7],[5,12]]){
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const data=S.createDefault(),g=G.create();g.main=G.MAIN.slice(0,count).map(t=>t.id);data.levels.L1.exercise_result.shop_game_v1=g;
  await p.addInitScript(({k,v})=>{if(!sessionStorage.seeded){localStorage.setItem(k,v);sessionStorage.seeded='1';}},{k:S.KEY,v:JSON.stringify(data)});
  await p.goto(process.env.EMC_TEST_URL||'http://127.0.0.1:5173');await ready(p);
  const before=(await state(p)).camera;const r=await p.locator('#homeCanvas canvas').boundingBox();await p.mouse.move(r.x+r.width*.6,r.y+r.height*.6);await p.mouse.down();await p.mouse.move(r.x+r.width*.65,r.y+r.height*.6,{steps:8});await p.mouse.up();await p.waitForTimeout(500);assert.notDeepEqual((await state(p)).camera,before);assert.equal((await state(p)).editing,false);
  await p.reload();await ready(p);let modelRequests=0;p.on('request',r=>{if(r.url().endsWith('.glb'))modelRequests++;});
  const camera=(await state(p)).camera;await p.locator('[data-panel="inventory"]').click();assert.deepEqual((await state(p)).camera,camera);assert.equal(await p.locator('canvas').count(),1);assert.equal(await p.locator('#editorToolbar').count(),0);
  const targets=await p.evaluate(()=>shopPaintTargets());assert.equal(targets.length,3,'All paint targets visible Lv.'+stage);
  async function hold(part,index=2){await p.locator('[data-bag-tab="'+part+'"]').click();const box=await p.locator('[data-paint-part="'+part+'"]').nth(index).boundingBox();const origin={x:box.x+box.width/2,y:box.y+box.height/2};await p.mouse.move(origin.x,origin.y);await p.mouse.down();await p.waitForTimeout(330);return origin;}
  // 轻点、拖错部位、返回背包、场景外松手、Escape 均不修改存档。
  await p.locator('[data-paint-part="wall"]').nth(2).click();assert.equal((await state(p)).wall_color,G.PALETTES.wall[0]);
  let origin=await hold('wall'),wrong=targets.find(t=>t.part==='roof');await p.mouse.move(wrong.x,wrong.y,{steps:8});assert.equal((await state(p)).preview_part,null);await p.mouse.up();assert.equal((await state(p)).wall_color,G.PALETTES.wall[0]);
  origin=await hold('wall');const target=targets.find(t=>t.part==='wall');await p.mouse.move(target.x,target.y,{steps:8});assert.equal((await state(p)).preview_part,'wall');await p.mouse.move(origin.x,origin.y,{steps:8});assert.equal((await state(p)).preview_part,null);await p.mouse.up();assert.equal((await state(p)).wall_color,G.PALETTES.wall[0]);
  await hold('wall');await p.mouse.move(20,80,{steps:8});await p.mouse.up();assert.equal((await state(p)).wall_color,G.PALETTES.wall[0]);
  await hold('wall');await p.mouse.move(target.x,target.y,{steps:8});await p.keyboard.press('Escape');await p.mouse.up();assert.equal((await state(p)).paint_drag,null);assert.equal((await state(p)).wall_color,G.PALETTES.wall[0]);
  for(const part of ['wall','sign','roof']){await hold(part);const t=targets.find(t=>t.part===part);await p.mouse.move(t.x,t.y,{steps:8});assert.equal((await state(p)).preview_part,part);if(stage===1)await p.screenshot({path:path.join(shots,'desktop-preview-'+part+'.png')});await p.mouse.up();assert.equal((await state(p))[part+'_color'],G.PALETTES[part][2]);assert.equal((await state(p)).preview_part,null);}
  await p.screenshot({path:path.join(shots,'level-'+stage+'-painted.png')});await p.locator('#undoPaint').click();assert.equal((await state(p)).roof_color,G.PALETTES.roof[0]);
  await p.reload();await ready(p);assert.equal((await state(p)).wall_color,G.PALETTES.wall[2]);assert.equal((await state(p)).sign_color,G.PALETTES.sign[2]);assert.equal((await state(p)).roof_color,G.PALETTES.roof[0]);assert.equal(modelRequests,2);assert.deepEqual(errors,[]);await context.close();console.log('PASS Lv.'+stage+' 旋转、单场景、拖放/取消/撤销/保存');
 }
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.EMC_TEST_URL||'http://127.0.0.1:5173');await ready(p);await p.locator('[data-panel="inventory"]').click();const cdp=await context.newCDPSession(p);
  const touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(v=>({...v,radiusX:3,radiusY:3,force:1,id:1}))});
  for(const mode of ['day','night']){
   await p.locator('#theme'+(mode==='day'?'Day':'Night')).click();await p.locator('[data-bag-tab="roof"]').click();const box=await p.locator('[data-paint-part="roof"]').nth(mode==='day'?2:3).boundingBox(),start={x:box.x+box.width/2,y:box.y+box.height/2},target=(await p.evaluate(()=>shopPaintTargets())).find(t=>t.part==='roof');
   await touch('touchStart',[start]);await p.waitForTimeout(330);await touch('touchMove',[{x:target.x,y:target.y}]);assert.equal((await state(p)).preview_part,'roof');await p.screenshot({path:path.join(shots,width+'-'+mode+'-touch-preview.png')});await touch('touchEnd',[]);assert.equal((await state(p)).roof_color,G.PALETTES.roof[mode==='day'?2:3]);assert.equal((await state(p)).paint_drag,null);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(shots,width+'-'+mode+'-bag.png')});
  }
  // 触摸系统取消不落盘。
  const box=await p.locator('[data-paint-part="roof"]').nth(1).boundingBox();await touch('touchStart',[{x:box.x+box.width/2,y:box.y+box.height/2}]);await p.waitForTimeout(330);await touch('touchCancel',[]);assert.equal((await state(p)).roof_color,G.PALETTES.roof[3]);assert.equal((await state(p)).paint_drag,null);assert.deepEqual(errors,[]);await context.close();console.log('PASS '+width+'px 真实触摸长按、日夜与取消');
 }
}finally{await browser.close();}console.log('Backpack interaction checks passed. Screenshots: '+shots);
})().catch(e=>{console.error(e);process.exitCode=1;});
