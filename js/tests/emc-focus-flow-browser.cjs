/* Integration against an isolated real backend. No API route mocks. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const J=require('../emc-journey.js');
const session=JSON.parse(fs.readFileSync(process.env.EMC_TEST_SESSION_FILE,'utf8'));
const url=session.url,shots=process.env.EMC_SCREENSHOTS||'/tmp/emc-focus-shots';fs.mkdirSync(shots,{recursive:true});
const state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 for(const [index,width] of [1440,390].entries()){
  const who=session.players[index],context=await browser.newContext({viewport:{width,height:900}});
  await context.addCookies([{name:'emc_session',value:who.cookie,url}]);
  const created=await context.request.post(url+'/api/projects',{headers:{'Origin':url,'X-CSRF-Token':who.csrf},data:{name:'本轮体验小店',platform:'xiaohongshu',category:'家居收纳'}});assert.equal(created.status(),201);
  await context.addInitScript(()=>{localStorage.setItem('emc-journey-welcome-v1','1');});
  const p=await context.newPage(),errors=[],requests=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/api/agent/chat'))requests.push(r.postDataJSON());});
  await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&window.EmcAvatarAgent&&!JSON.parse(render_game_to_text()).journey.loading,{},{timeout:45000});
  await p.evaluate(()=>{EmcAvatarAgent._state.autoAttempted=true;});
  await p.locator('#opening').waitFor({state:'hidden',timeout:45000});
  await p.locator('#continueButton').click();await p.locator('.j-focus-card').waitFor();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).mail.opening);await p.waitForTimeout(500);
  assert.equal(await p.locator('.j-focus-card .primary:visible').count(),1);
  assert.equal(await p.locator('.practice-workspace:visible,[data-j-action=kit]:visible').count(),0);
  assert.match(await p.locator('.j-deliverable').innerText(),/生意规划报告/);
  await p.screenshot({path:path.join(shots,'task-'+width+'.png')});
  const started=p.waitForRequest(r=>r.url().endsWith('/api/agent/chat'));await p.locator('[data-j-action=ask]').click();await started;
  await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending,{},{timeout:60000});
  assert.equal(requests.length,1);assert.equal(requests[0].level_id,'L1');assert.equal(requests[0].client_context.coaching_mode,true);
  assert.equal((await state(p)).chat.reply_source,'ai');
  assert.equal(await p.locator('.practice-workspace:visible').count(),0);
  assert.equal(await p.locator('.avatar-actions:visible').count(),0);assert.equal(await p.locator('#npcBubble:visible').count(),0);
  await p.locator('#copilotInput').fill('我想在小红书给租房上班族做桌面收纳，预算两千元，每周十小时，家人有收纳盒货源。先用小批量方式验证，先不囤货。');
  await p.locator('#copilotSend').click();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending,{},{timeout:60000});
  assert.equal((await state(p)).chat.reply_source,'ai');
  await p.screenshot({path:path.join(shots,'chat-'+width+'.png')});
  await p.locator('#copilotInput').fill('请整理本关成果报告。已知目标顾客是租房上班族，竞争情况和实际需求尚待验证；我的优势是家人的收纳盒货源和熟悉租房场景。下一步访谈三位朋友，记录他们的桌面尺寸和痛点，再比较两家供应商。不要编造市场数据。');
  await p.locator('#copilotSend').click();
  await p.locator('#journeyDelivery').waitFor({timeout:60000});
  assert.equal((await state(p)).journey.active,'L1');assert.equal(await p.locator('.practice-workspace').count(),0);
  const report=await p.locator('[name=notes]').inputValue();assert.ok(report.length>=40);assert.match(report,/租房|收纳/);
  await p.locator('[name=confirm]').check();await p.locator('#journeyDelivery button[type=submit]').click();
  await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).journey.busy&&JSON.parse(render_game_to_text()).journey.status==='pending',{},{timeout:30000});
  await p.screenshot({path:path.join(shots,'receipt-'+width+'.png')});
  await p.locator('[data-j-action=next]').click();
  assert.equal((await state(p)).journey.active,'L2');assert.equal(await p.locator('.j-focus-card .primary:visible').count(),1);
  await Promise.all([p.waitForRequest(r=>r.url().endsWith('/api/agent/chat')),p.locator('[data-j-action=ask]').click()]);await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending,{},{timeout:60000});
  assert.equal(requests.at(-1).level_id,'L2');assert.equal((await state(p)).chat.reply_source,'ai');
  await p.locator('#copilotInput').fill('请打开本关锦囊');await p.locator('#copilotSend').click();await p.locator('a[download][href$="xhs-product-scout.zip"]').waitFor({timeout:60000});
  assert.equal((await state(p)).journey.active,'L2');
  await p.screenshot({path:path.join(shots,'method-'+width+'.png')});
  assert.deepEqual(errors,[]);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.evaluate(()=>EmcAvatarAgent.disconnect());await context.close();console.log('PASS real backend + live Agent '+width+'px: task -> one chat -> report -> frozen submission -> L2 -> requested method');
 }
 // Guest onboarding and old demo flag cannot unlock or approve anything.
 const context=await browser.newContext({viewport:{width:390,height:844}}),p=await context.newPage();
 await p.goto(url+'/?demo=1');await p.waitForFunction(()=>window.render_game_to_text);await p.locator('#opening').waitFor({state:'hidden',timeout:45000});await p.locator('#continueButton').click();await p.locator('[data-j-action=begin]').click();
 assert.equal(await p.locator('#journeySetup input:not([type=hidden]):not([type=radio])').count(),0);
 assert.equal(await p.locator('#journeySetup select').count(),0);
 await p.locator('#journeySetup button[type=submit]').click();await p.locator('.j-focus-card').waitFor();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).mail.opening);await p.waitForTimeout(500);
 assert.equal((await state(p)).journey.completed,0);assert.equal(await p.locator('.practice-workspace,[data-demo-toggle]').count(),0);
 await p.screenshot({path:path.join(shots,'guest-'+390+'.png')});await context.close();
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
