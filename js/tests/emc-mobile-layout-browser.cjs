'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const root=process.env.EMC_TEST_URL||'http://127.0.0.1:5173',out=process.env.EMC_MOBILE_SHOTS||path.join(os.tmpdir(),'emc-mobile-layout');fs.mkdirSync(out,{recursive:true});
const rect=(p,s)=>p.locator(s).boundingBox();
const inside=(r,w,h)=>assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=w+1&&r.y+r.height<=h+1,JSON.stringify(r));
const separated=(a,b)=>assert.ok(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,'Controls overlap: '+JSON.stringify([a,b]));
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||'msedge'});try{
 for(const [width,height] of [[320,568],[390,844],[640,930],[700,700],[1440,1000]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/me',r=>r.fulfill({contentType:'application/json',body:'{"authenticated":false}'}));await page.goto(root+'/?demo=1#view=island');await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible);await page.locator('#opening').waitFor({state:'hidden'});await page.waitForTimeout(300);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width<=700){
   const selectors=['.topbar','.player-card','.shop-journal','.shortcuts','.quest-peek','.main-actions','.copilot-dock'];const boxes=[];for(const s of selectors){const r=await rect(page,s);inside(r,width,height);boxes.push(r);}for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)separated(boxes[i],boxes[j]);
   const play=await rect(page,'.scene-framing');assert.ok(play.height>200,'Island has a reserved playfield');assert.ok(await page.locator('.quest-peek .peek-icon').isVisible());assert.ok(await page.locator('#questHint').isVisible());assert.ok(boxes[4].height>=80,'Task navigation retains its card');assert.ok(play.y+play.height<=boxes[5].y,'Island ends above the standalone letter');
   const envelope=await rect(page,'.mail-envelope');assert.ok(envelope.width>=78&&envelope.height>=50,'Letter remains prominent');assert.ok(Math.abs(boxes[5].x+boxes[5].width/2-width/2)<2,'Letter is centered independently');assert.ok(boxes[4].y<height/2&&Math.abs(boxes[4].x+boxes[4].width-(width-12))<2,'Task navigation sits at the upper right');assert.equal(await page.locator('#continueButton').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
   const bubble=await rect(page,'#npcBubble');if(bubble){inside(bubble,width,height);assert.ok(bubble.y>=boxes[1].y+boxes[1].height,'Cloud cannot cover the shop status');}
  }
  await page.screenshot({path:path.join(out,width+'-day.png')});await page.locator('#themeNight').click();await page.waitForTimeout(150);await page.screenshot({path:path.join(out,width+'-night.png')});await page.locator('#themeDay').click();
  await page.locator('[data-panel=inventory]').click();await page.waitForTimeout(350);inside(await rect(page,'#drawer'),width,height);assert.equal(await page.locator('canvas').count(),1);
  if(width<=700){assert.equal(await page.locator('.copilot-dock').isVisible(),false);const play=await rect(page,'.scene-framing'),bag=await rect(page,'#drawer');assert.ok(play.height>200&&play.y+play.height<=bag.y+2,'Backpack leaves a usable model area');}
  if(width<=700){
   await page.locator('[data-bag-tab=roof]').click();const sample=page.locator('[data-paint-part=roof]').nth(2),color=await sample.getAttribute('data-color'),r=await sample.boundingBox(),target=await page.evaluate(()=>shopPaintTargets().find(t=>t.part==='roof'));assert.ok(target&&target.y<(await rect(page,'#drawer')).y,'Roof stays above the backpack and remains touchable');
   const cdp=await page.context().newCDPSession(page),touch=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,id:1,radiusX:3,radiusY:3,force:1}))});
   await touch('touchStart',[{x:r.x+r.width/2,y:r.y+r.height/2}]);await page.waitForTimeout(340);await touch('touchMove',[{x:target.x,y:target.y}]);assert.equal(await page.evaluate(()=>JSON.parse(render_game_to_text()).preview_part),'roof');await touch('touchEnd',[]);assert.equal(await page.evaluate(()=>JSON.parse(render_game_to_text()).roof_color),color);await cdp.detach();
  }
  await page.screenshot({path:path.join(out,width+'-backpack.png')});await page.locator('#closePanel').click();await page.waitForTimeout(150);
  await page.locator('[data-panel=settings]').click();await page.waitForTimeout(250);inside(await rect(page,'#drawer'),width,height);await page.screenshot({path:path.join(out,width+'-settings.png')});await page.locator('#closePanel').click();
  if(width<=700){
   await page.locator('#copilotHistory').click();await page.waitForTimeout(200);inside(await rect(page,'.copilot-dock'),width,height);await page.screenshot({path:path.join(out,width+'-chat.png')});
   await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>innerHeight-240});visualViewport.dispatchEvent(new Event('resize'));});await page.waitForTimeout(150);inside(await rect(page,'.copilot-dock'),width,height-240);await page.screenshot({path:path.join(out,width+'-keyboard.png')});await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});await page.locator('#closeMobileChat').click();
   await page.locator('#continueButton').click();await page.locator('#drawer[aria-modal=true]').waitFor();await page.waitForTimeout(600);inside(await rect(page,'#drawer'),width,height);await page.screenshot({path:path.join(out,width+'-task.png')});await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+'x'+height+': 布局无重叠/日夜/背包/设置/聊天与键盘/任务弹窗');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
