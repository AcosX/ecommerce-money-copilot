/* Fixed companion identity and login without a naming detour. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const G=require('../emc-game.js'),S=require('../emc-tutorial-save.js');
const shots=process.env.EMC_SCREENSHOTS||'/tmp/emc-fixed-name';
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173/';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{for(const width of [1440,390])for(const legacy of [false,true]){
  const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),p=await context.newPage(),errors=[];let logins=0;
  p.on('pageerror',e=>errors.push(e.message));
  if(legacy){
   const save=S.createDefault();save.levels.L1.exercise_result.shop_game_v1={...G.create(),companion_name:'旧伙伴',companion_named:true,shop_name:'原来的小店',side:['light'],npc_chat:[{role:'assistant',text:'旧对话内容',time:1}]};
   await p.addInitScript(save=>{if(!localStorage.getItem('emc.tutorial.guest'))localStorage.setItem('emc.tutorial.guest',JSON.stringify(save));if(!localStorage.getItem('emc-journey-entry-v1'))localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:false,partner_name:'旧伙伴',shop_name:'原来的小店',platform:'xiaohongshu',agent:'Codex',category:'收纳'}));},save);
  }
  await p.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false,items:[],next_cursor:null})}));
  await p.route('**/auth/login?**',r=>{logins++;return r.fulfill({contentType:'text/html',body:'<h1>认证服务测试入口</h1>'});});
  async function ready(){await p.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);await p.locator('#opening').waitFor({state:'hidden',timeout:45000});}
  await p.goto(url);await ready();
  assert.equal(await p.locator('#socialName').innerText(),'小商');
  let state=await p.evaluate(()=>JSON.parse(render_game_to_text()));assert.equal(state.companion_name,'小商');assert.equal(state.journey.profile.partner_name,'小商');
  if(legacy)assert.equal(state.shop_name,'原来的小店');
  await p.locator('[data-panel=settings]').click();assert.equal(await p.locator('#partnerNameInput,#savePartnerName').count(),0);assert.equal(await p.locator('#shopNameInput').count(),1);await p.locator('#closePanel').click();
  await p.locator('#continueButton').click();await p.locator('[data-j-action=begin]').click();
  await p.locator('#journeySetup').waitFor();assert.equal(await p.locator('[name=partner_name],#partnerNameInput').count(),0);
  await p.locator('#journeySetup button[type=submit]').click();
  await p.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.profile.saved);
  assert.equal(await p.evaluate(()=>JSON.parse(localStorage.getItem('emc-journey-entry-v1')).partner_name),'小商');
  await p.keyboard.press('Escape');await p.reload();await ready();assert.equal(await p.locator('#socialName').innerText(),'小商');
  fs.mkdirSync(shots,{recursive:true});await p.screenshot({path:path.join(shots,`fixed-name-${width}-${legacy?'legacy':'new'}.png`)});
  await p.locator('#emcLoginBtn').click();await p.waitForURL('**/auth/login?**');assert.equal(logins,1);assert.equal(await p.locator('#partnerNameInput,#confirmPartnerName').count(),0);
  assert.deepEqual(errors,[]);await context.close();console.log('PASS',width,legacy?'legacy':'new','fixed identity, setup/settings without naming, refresh, direct login');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
