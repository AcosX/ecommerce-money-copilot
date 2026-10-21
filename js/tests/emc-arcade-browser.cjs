'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191';
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390]){
  const c=await browser.newContext({viewport:{width,height:width===390?844:1000}}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='ready');
  for(const theme of ['day','night']){
   await p.locator(theme==='day'?'#themeDay':'#themeNight').click();await p.waitForTimeout(400);
   assert.equal(await p.locator('html').getAttribute('data-theme'),theme);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const cta=await p.locator('#continueButton').boundingBox(),input=await p.locator('#copilotForm').boundingBox();assert.ok(cta.y+cta.height<input.y);assert.ok(cta.x>=0&&cta.x+cta.width<=width);
   await p.screenshot({path:path.join(os.tmpdir(),`emc-arcade-${theme}-${width}.png`)});
  }
  await p.locator('#continueButton').click();assert.equal(await p.evaluate(()=>JSON.parse(render_game_to_text()).audio.last_effect),'start');
  await p.waitForTimeout(450);await p.screenshot({path:path.join(os.tmpdir(),`emc-arcade-task-${width}.png`)});
  assert.equal(await p.locator('.arcade-effects').evaluate(e=>getComputedStyle(e).pointerEvents),'none');
  assert.deepEqual(errors,[]);await c.close();console.log(`PASS ${width}px 日夜配色、主线出发音、输入框与 CTA 无重叠、无横向溢出`);
 }
 const c=await browser.newContext({reducedMotion:'reduce'}),p=await c.newPage();await p.goto(url);await p.waitForFunction(()=>window.EmcJuice);await p.evaluate(()=>{window.testJuice=EmcJuice.create();testJuice.burst();});assert.equal(await p.locator('.arcade-particle').count(),0);assert.equal(await p.locator('#continueButton').evaluate(e=>getComputedStyle(e,'::before').animationName),'none');await p.evaluate(()=>testJuice.dispose());await c.close();console.log('PASS 减少动态效果偏好：关闭闪动、彩屑与 CTA 循环');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
