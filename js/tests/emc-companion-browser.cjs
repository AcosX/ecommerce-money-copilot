'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191',state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const questions=['我想在小红书做家居收纳，预算2000元，每周10小时，有货源，先选哪个方向？','我想比较拼多多的通勤包，售价59元、成本25元，每周能上架3款，已经比较了两家货源但评价不一致。','我需要优化小红书主图，近7天曝光1000次、点击20次，已经调整过标题但没有改善。'];
async function ready(p){await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible);}
async function send(p,message){await p.locator('#copilotInput').fill(message);await p.locator('#copilotSend').click();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&document.getElementById('copilotInput').value==='');}
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||'msedge'});try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await context.addInitScript(()=>localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,platform:'xiaohongshu',category:'家居收纳',agent:'Codex',shop_name:'小满杂货铺',partner_name:'小商'})));
  await ready(p);await p.locator('#continueButton').click();assert.equal((await state(p)).panel,'journey');await p.locator('[data-j-action=companion]').click();assert.equal((await state(p)).panel,'companion');await p.locator('.companion-portrait').evaluate(img=>img.decode());
  for(const theme of ['Day','Night']){await p.locator('#theme'+theme).click();await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const drawer=await p.locator('#drawer').boundingBox(),input=await p.locator('#copilotForm').boundingBox();assert.ok(drawer.y+drawer.height<input.y);await p.screenshot({path:path.join(os.tmpdir(),`emc-companion-${theme}-${width}.png`)});}
  for(const q of questions)await send(p,q);
  let snapshot=await state(p);assert.equal(snapshot.companion.affinity,32);assert.equal(snapshot.companion.streak,3);assert.deepEqual(snapshot.companion.perks,['L1']);assert.equal(snapshot.xp,0);assert.equal(snapshot.journey.completed,0);assert.equal(snapshot.formal_verification,'not_certified');
  await p.locator('#panelBody [data-companion-action=perk]').click();assert.match(await p.locator('.companion-perk').innerText(),/先验证最关键的假设/);await p.locator('.companion-perk').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(os.tmpdir(),`emc-companion-perk-${width}.png`)});
  await send(p,questions[0]);assert.equal((await state(p)).companion.affinity,32);
  await p.locator('#panelBody [data-companion-action=talk]').click();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);assert.equal((await state(p)).companion.affinity,32);
  await p.locator('#panelBody [data-companion-action=kit]').first().click();assert.equal((await state(p)).panel,'journey');assert.equal(await p.locator('[data-j-action=kit]').getAttribute('aria-expanded'),'true');
  await p.locator('#closePanel').click();await p.locator('#copilotProfile').click();await p.locator('#panelBody [data-companion-action=deliver]').first().click();assert.equal((await state(p)).journey.view,'submit');assert.match(await p.locator('#panelBody').innerText(),/登录后提交成果/);assert.equal((await state(p)).xp,0);
  await p.reload();await p.waitForFunction(()=>window.render_game_to_text);assert.equal((await state(p)).companion.affinity,32);assert.deepEqual((await state(p)).companion.perks,['L1']);assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px 对话式主线、日夜伙伴面板、三问福利、持久化、快捷和重复问题不刷分、锦囊与交成果、无正式进度伪造`);
 }
 const context=await browser.newContext(),p=await context.newPage();await context.addInitScript(()=>window.EmcCopilotTransport=async()=>{throw Error('offline');});await ready(p);await p.locator('#copilotInput').fill('测试失败');await p.locator('#copilotSend').click();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&JSON.parse(render_game_to_text()).chat.history_count===1);assert.equal((await state(p)).companion.affinity,20);assert.equal((await state(p)).companion.patience,80);assert.equal(await p.locator('#copilotInput').inputValue(),'测试失败');await context.close();console.log('PASS 失败对话不计分，保留原问题');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
