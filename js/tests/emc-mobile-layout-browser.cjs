'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const J=require('../emc-journey.js');
const root=(process.env.EMC_TEST_URL||'http://127.0.0.1:5173').replace(/\/+$/,''),out=process.env.EMC_MOBILE_SHOTS||path.join(os.tmpdir(),'emc-mobile-layout');fs.mkdirSync(out,{recursive:true});
const rect=(p,s)=>p.locator(s).boundingBox();
const inside=(r,w,h)=>assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=w+1&&r.y+r.height<=h+1,JSON.stringify(r));
const separated=(a,b)=>assert.ok(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,'Controls overlap: '+JSON.stringify([a,b]));
async function settlePanel(page){
 await page.locator('#drawer').waitFor();
 // Software rendering can delay the first animation frame beyond a fixed sleep.
 await page.locator('#drawer').evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished)));
}
async function checkTouchPaint(browser,width,height){
 // The initial level-0 tent intentionally cannot be painted. Use API data for
 // an upgraded shop so the touch assertion cannot silently skip a missing roof.
 const page=await browser.newPage({viewport:{width,height}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const project={id:'prj_mobile',name:'移动布局小店',platform:'xiaohongshu',category:'服装',version:1};
 const artifacts=J.LEVELS.slice(0,2).map((level,i)=>({id:'art_mobile'+i,project_id:project.id,artifact_type:level.type,origin:'formal',title:level.deliverable,status:'approved',revision:1,version:1,content:{}}));
 await page.addInitScript(()=>{localStorage.setItem('emc-journey-welcome-v1','1');localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'移动布局小店',partner_name:'小商',platform:'xiaohongshu',category:'服装',agent:'Codex'}));});
 await page.route('**/api/**',route=>{const uri=new URL(route.request().url()).pathname;const result=uri==='/api/me'?{authenticated:true,player:{id:'ply_mobile',display_name:'移动玩家'},roles:['player'],csrf_token:'mobile-csrf'}:uri==='/api/projects'?{items:[project]}:uri==='/api/artifacts'?{items:artifacts}:{items:[],next_cursor:null};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});});
 await page.goto(root+'/');await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='ready'&&JSON.parse(render_game_to_text()).building_level>0,null,{timeout:45000});await page.locator('#opening').waitFor({state:'hidden'});
 await page.locator('[data-panel=inventory]').click();await settlePanel(page);
 const bag=await rect(page,'#drawer'),play=await rect(page,'.scene-framing');inside(bag,width,height);assert.ok(play.height>200&&play.y+play.height<=bag.y+2,'Upgraded shop stays usable above backpack');assert.equal(await page.locator('canvas').count(),1);
 await page.locator('[data-bag-tab=roof]').click();const sample=page.locator('[data-paint-part=roof]').nth(2),color=await sample.getAttribute('data-color'),r=await sample.boundingBox(),target=await page.evaluate(()=>shopPaintTargets().find(t=>t.part==='roof'));assert.ok(target,'Roof paint target must be available');assert.ok(target.y<bag.y,'Roof stays above the backpack and remains touchable');
 const cdp=await page.context().newCDPSession(page),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,id:1,radiusX:3,radiusY:3,force:1}))});
 await touch('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await page.waitForTimeout(340);await touch('touchMove',[{x:target.x,y:target.y}]);assert.equal(await page.evaluate(()=>JSON.parse(render_game_to_text()).preview_part),'roof');await touch('touchEnd',[]);assert.equal(await page.evaluate(()=>JSON.parse(render_game_to_text()).roof_color),color);await cdp.detach();
 await page.screenshot({path:path.join(out,width+'-touch-paint.png')});assert.deepEqual(errors,[]);await page.close();
}
(async()=>{const browser=await chromium.launch({headless:true,...(process.env.EMC_CHROMIUM?{executablePath:process.env.EMC_CHROMIUM}:{channel:process.env.EMC_BROWSER_CHANNEL||undefined}),args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 for(const [width,height] of [[320,568],[390,844],[640,930],[700,700],[1440,1000]].filter(([width])=>!process.env.EMC_TEST_WIDTH||Number(process.env.EMC_TEST_WIDTH)===width)){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>localStorage.setItem('emc-journey-welcome-v1','1'));await page.goto(root+'/#view=island');await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible,null,{timeout:120000});await page.locator('#opening').waitFor({state:'hidden'});await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width<=700){
   const selectors=['.topbar','.player-card','.shop-journal','.shortcuts','.quest-peek','.main-actions','.copilot-dock'];const boxes=[];for(const s of selectors){const r=await rect(page,s);inside(r,width,height);boxes.push(r);}for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)separated(boxes[i],boxes[j]);
   const play=await rect(page,'.scene-framing');assert.ok(play.height>180,'Island has a reserved playfield');assert.ok(await page.locator('#questHint').isVisible());assert.ok(boxes[4].height>=80,'Task navigation retains its card');assert.ok(await page.locator('.journal-heading').isVisible());assert.ok(await page.locator('.journal-counts').isVisible());assert.ok(play.y+play.height<=boxes[5].y,'Island ends above the standalone letter');
   const envelope=await rect(page,'.mail-envelope');assert.ok(envelope.width>=78&&envelope.height>=50,'Letter remains prominent');assert.ok(Math.abs(boxes[5].x+boxes[5].width/2-width*.8)<2,'Letter has its own lower-right space');assert.ok(boxes[4].y<height/2&&Math.abs(boxes[4].x+boxes[4].width-(width-(width<=370?10:12)))<2,'Task navigation sits at the upper right');assert.equal(await page.locator('#continueButton').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
   const bubble=await rect(page,'#npcBubble');if(bubble){inside(bubble,width,height);assert.ok(bubble.y>=boxes[1].y+boxes[1].height,'Cloud cannot cover the shop status');for(const i of [0,1,3,4])separated(bubble,boxes[i]);}
  }
  await page.screenshot({path:path.join(out,width+'-day.png')});await page.locator('#themeNight').click();await page.waitForTimeout(150);await page.screenshot({path:path.join(out,width+'-night.png')});await page.locator('#themeDay').click();
  await page.locator('[data-panel=inventory]').click();await settlePanel(page);inside(await rect(page,'#drawer'),width,height);assert.equal(await page.locator('canvas').count(),1);
  if(width<=700){assert.equal(await page.locator('.copilot-dock').isVisible(),false);const play=await rect(page,'.scene-framing'),bag=await rect(page,'#drawer');assert.ok(play.height>200&&play.y+play.height<=bag.y+2,'Backpack leaves a usable model area');}
  await page.screenshot({path:path.join(out,width+'-backpack.png')});await page.locator('#closePanel').click();await page.waitForTimeout(150);
  await page.locator('[data-panel=settings]').click();await settlePanel(page);inside(await rect(page,'#drawer'),width,height);await page.screenshot({path:path.join(out,width+'-settings.png')});await page.locator('#closePanel').click();
  if(width<=700){
   await page.locator('#copilotHistory').click();await page.waitForTimeout(200);inside(await rect(page,'.copilot-dock'),width,height);await page.screenshot({path:path.join(out,width+'-chat.png')});
   await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>innerHeight-240});visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(150);inside(await rect(page,'.copilot-dock'),width,height-240);await page.screenshot({path:path.join(out,width+'-keyboard.png')});await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});await page.locator('#closeMobileChat').click();
   await page.locator('#continueButton').click();await page.locator('#drawer[aria-modal=true]').waitFor();await settlePanel(page);inside(await rect(page,'#drawer'),width,height);await page.screenshot({path:path.join(out,width+'-task.png')});await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);await page.close();if(width<=700)await checkTouchPaint(browser,width,height);console.log('PASS '+width+'x'+height+': 布局无重叠/日夜/背包/设置/聊天与键盘/任务弹窗'+(width<=700?'/升级店铺触屏涂色':''));
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
