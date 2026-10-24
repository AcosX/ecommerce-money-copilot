/* Render the actual page/CSS; API fixtures isolate account state and delayed replies.
 * Run with EMC_TEST_URL pointing at a dev/static server. Never uses demo progress.
 */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const J=require('../emc-journey.js');
const base=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
const shots=process.env.EMC_SCREENSHOTS||'/tmp/emc-journal-prompts';fs.mkdirSync(shots,{recursive:true});
const inside=(r,w,h)=>assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.width<=w+1&&r.y+r.height<=h+1,JSON.stringify(r));
const separate=(a,b)=>assert.ok(a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1,'Overlap: '+JSON.stringify([a,b]));
async function prepare(page,{welcome=false}={}){
 const calls=[],project={id:'prj_ui',name:'手帐回归小店',platform:'xiaohongshu',category:'家居收纳',version:1};
 // Both submitted levels can be revisited even while zero levels have been approved.
 const artifacts=J.LEVELS.slice(0,2).map((l,i)=>({id:'art_ui'+i,project_id:project.id,level_id:l.id,artifact_type:l.type,origin:'formal',title:l.deliverable,status:'submitted',revision:1,version:1,content:{notes:'真实成果记录与来源待审核'}}));
 const verifications=artifacts.map((a,i)=>({id:'ver_ui'+i,project_id:project.id,artifact_id:a.id,level_id:a.level_id,status:'pending',created_at:'2026-10-23T01:00:00Z'}));
 let releaseReply;const gate=new Promise(resolve=>{releaseReply=resolve;});
 await page.addInitScript(({welcome})=>{
  if(!welcome)localStorage.setItem('emc-journey-welcome-v1','1');
  localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'手帐回归小店',partner_name:'小商',platform:'xiaohongshu',category:'家居收纳',agent:'Codex'}));
 },{welcome});
 await page.route('**/api/**',async route=>{
  const req=route.request(),uri=new URL(req.url()).pathname;calls.push({uri,method:req.method(),body:req.method()==='GET'?null:req.postDataJSON()});
  let result={items:[],next_cursor:null};
  if(uri==='/api/me')result=welcome?{authenticated:false}:{authenticated:true,player:{id:'ply_ui',display_name:'手帐玩家'},roles:['player'],csrf_token:'ui-csrf'};
  else if(uri==='/api/projects')result={items:welcome?[]:[project],next_cursor:null};
  else if(uri==='/api/artifacts')result={items:artifacts,next_cursor:null};
  else if(uri==='/api/verifications')result={items:verifications,next_cursor:null};
  else if(uri==='/api/agent/memory')result={memory:{intimacy_score:30,patience_score:80,interactions_count:2,current_focus_level:'L3'},recent_conversation:[]};
  else if(uri==='/api/agent/chat'){await gate;result={reply:'先确认这张商品图最需要让顾客看清的一个信息。',provider:'ai_gateway_live'};}
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
 });
 await page.goto(base);await page.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);
 await page.evaluate(()=>{EmcAvatarAgent._state.autoAttempted=true;});
 await page.locator('#opening').waitFor({state:'hidden',timeout:45000});
 return {calls,releaseReply};
}
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});try{
 for(const [width,height] of [[1440,900],[1024,768],[700,700],[390,844],[320,568]]){
  const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const fixture=await prepare(page);const journal=page.locator('#shopJournal');
  const look=await journal.evaluate(e=>{const s=getComputedStyle(e);return {position:s.position,border:parseFloat(s.borderLeftWidth),bg:s.backgroundColor,shadow:s.boxShadow,before:getComputedStyle(e,'::before').content};});
  assert.equal(look.position,'absolute');assert.ok(look.border>=4);assert.notEqual(look.bg,'rgba(0, 0, 0, 0)');assert.notEqual(look.shadow,'none');
  assert.equal(await journal.locator('.journal-heading').isVisible(),true);assert.equal(await journal.locator('.journal-counts').isVisible(),true);
  assert.match(await journal.innerText(),/2份成果/);assert.equal(await journal.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  const card=await journal.boundingBox();inside(card,width,height);
  if(width>700){
    // Reserve both the journal's tape/rotation and readable space under tool labels.
    const labels=await page.locator('.shortcuts .shortcut>span').evaluateAll(nodes=>nodes.map(e=>({text:e.textContent,bottom:e.getBoundingClientRect().bottom})));
    for(const label of labels)assert.ok(card.y-label.bottom>=24,`${label.text} is too close to the journal decoration: ${card.y-label.bottom}px`);
  }
  const selectors=width<=700?['.player-card','.shortcuts','.quest-peek','.main-actions','.copilot-dock']:['.player-card','.shortcuts','.quest-peek','.copilot-dock'];
  for(const selector of selectors)separate(card,await page.locator(selector).boundingBox());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:path.join(shots,`island-${width}.png`)});
  await page.getByRole('button',{name:'打开经营手帐',exact:true}).click();
  const drawer=page.locator('#drawer.centered-panel');await drawer.waitFor();inside(await drawer.boundingBox(),width,height);
  assert.equal(await page.locator('.journal-record').count(),2);assert.equal(await page.locator('.journal-section').count(),3);
  assert.ok(await page.locator('.journal-paper').evaluate(e=>parseFloat(getComputedStyle(e).lineHeight)>=20));
  assert.ok(await page.locator('.journal-section').first().evaluate(e=>parseFloat(getComputedStyle(e).borderTopWidth)>0));
  assert.equal(await page.locator('.journal-record').first().evaluate(e=>getComputedStyle(e).display),'flex');
  assert.ok(await page.locator('#panelBody').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
  await page.screenshot({path:path.join(shots,`journal-${width}.png`)});
  await page.locator('[data-mail-level=L2]').click();await page.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.active==='L2');
  await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).mail.opening);
  await page.keyboard.press('Escape');
  if(width<=700){assert.equal(await page.locator('#copilotSuggestions').isVisible(),false);await page.locator('#copilotHistory').click();}
  const suggestions=page.locator('#copilotSuggestions');assert.equal(await suggestions.getByRole('button').count(),2);assert.match(await suggestions.innerText(),/确认进度/);
  await suggestions.getByRole('button').first().click();assert.match(await page.locator('#copilotInput').inputValue(),/L2/);
  assert.equal(fixture.calls.filter(c=>c.uri==='/api/agent/chat').length,0,'Suggestions fill the input without sending');
  await page.locator('#copilotInput').fill('');
  // Select a different task through the same journal and check prompt context updates.
  if(width<=700)await page.locator('#closeMobileChat').click();
  await page.getByRole('button',{name:'打开经营手帐',exact:true}).click();await page.locator('[data-mail-level=L1]').click();await page.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.active==='L1');await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).mail.opening);await page.keyboard.press('Escape');
  if(width<=700)await page.locator('#openCompanionChat').click();
  await suggestions.getByRole('button').first().click();assert.match(await page.locator('#copilotInput').inputValue(),/L1/);assert.doesNotMatch(await page.locator('#copilotInput').inputValue(),/L2/);
  const input=page.locator('#copilotInput');const original=await input.inputValue();await input.fill(original+' 我补充的情况。');
  const submitted=page.waitForRequest(r=>r.url().endsWith('/api/agent/chat'));
  await page.locator('#copilotSend').click();await submitted;
  assert.equal(await suggestions.getByRole('button').first().isDisabled(),true);
  fixture.releaseReply();await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);
  assert.equal(await suggestions.getByRole('button').first().isEnabled(),true);
  const posted=fixture.calls.filter(c=>c.uri==='/api/agent/chat');assert.equal(posted.length,1);assert.equal(posted[0].body.level_id,'L1');assert.match(posted[0].body.message,/我补充的情况/);
  inside(await suggestions.boundingBox(),width,height);inside(await page.locator('#copilotForm').boundingBox(),width,height);
  assert.ok((await page.locator('#socialMessages').boundingBox()).height>=100);
  assert.equal(await suggestions.evaluate(e=>e.scrollWidth<=e.clientWidth+1),true);
  await page.screenshot({path:path.join(shots,`chat-${width}.png`)});
  await page.locator('#copilotInput').fill('暂时保留的输入');await suggestions.getByRole('button').last().focus();await page.keyboard.press('Enter');assert.match(await input.inputValue(),/L1/);
  if(width<=700){
    await page.evaluate(()=>{document.body.classList.add('keyboard-open');document.documentElement.style.setProperty('--keyboard-offset','200px');});
    assert.equal(await suggestions.isVisible(),false);inside(await page.locator('#copilotForm').boundingBox(),width,height-200);
    await page.evaluate(()=>{document.body.classList.remove('keyboard-open');document.documentElement.style.setProperty('--keyboard-offset','0px');});
    assert.equal(await suggestions.isVisible(),true);
  }
  // Existing settings, inventory and task navigation remain usable.
  if(width<=700)await page.locator('#closeMobileChat').click();
  for(const selector of ['[data-panel=settings]','[data-panel=inventory]','.quest-peek']){await page.locator(selector).click();await page.locator('#drawer').waitFor();inside(await page.locator('#drawer').boundingBox(),width,height);await page.keyboard.press('Escape');}
  await page.reload();await page.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);await page.locator('#opening').waitFor({state:'hidden',timeout:45000});
  assert.equal(await journal.evaluate(e=>getComputedStyle(e).position),'absolute');if(width<=700)await page.locator('#copilotHistory').click();assert.equal(await suggestions.getByRole('button').count(),2);
  assert.deepEqual(errors,[]);await page.close();console.log('PASS',width+'x'+height,'journal card/panel/records, scoped editable suggestions, waiting/reply/reload, existing navigation');
 }
 const page=await browser.newPage({viewport:{width:390,height:844}});await prepare(page,{welcome:true});await page.locator('#copilotHistory').click();
 assert.match(await page.locator('#copilotSuggestions').innerText(),/先认识一下小店/);await page.locator('#copilotSuggestions button').first().click();assert.match(await page.locator('#copilotInput').inputValue(),/介绍这间小店/);
 await page.close();console.log('PASS guest welcome suggestions');
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
