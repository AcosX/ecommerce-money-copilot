/* Actual HTML/CSS regression for the compact companion composer.
 * API and avatar fixtures isolate network/state only; no layout or product methods are mocked.
 * EMC_TEST_URL must serve the UI under review. Screenshots are untracked artifacts.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.EMC_PLAYWRIGHT_MODULE || 'playwright');
const J = require('../emc-journey.js');
const base = process.env.EMC_TEST_URL || 'http://127.0.0.1:5173/';
const shots = process.env.EMC_SCREENSHOTS || '/tmp/emc-chat-composer';
fs.mkdirSync(shots, {recursive:true});
const bottom = r => r.y + r.height;
const right = r => r.x + r.width;
const inside = (r,w,h,label) => assert.ok(r && r.x >= -1 && r.y >= -1 && right(r) <= w+1 && bottom(r) <= h+1, `${label}: ${JSON.stringify(r)} outside ${w}x${h}`);
const near = (a,b,label) => assert.ok(Math.abs(a-b) <= 2, `${label}: ${a} vs ${b}`);

async function prepare(page,{advanced=true,history=true,welcomeFlag=false,completed=0,native=true}={}) {
  const calls = [], turns = new Map();
  const project = {id:'prj_composer',name:'聊天回归小店',platform:'xiaohongshu',category:'服装',version:1};
  const artifacts = advanced || completed ? J.LEVELS.slice(0,completed||2).map((level,i) => ({id:'art_composer'+i,project_id:project.id,level_id:level.id,artifact_type:level.type,origin:'formal',title:level.deliverable,status:completed?'approved':'submitted',revision:1,version:1,content:{notes:'真实成果记录与来源待审核'}})) : [];
  const verifications = artifacts.map((a,i) => ({id:'ver_composer'+i,project_id:project.id,artifact_id:a.id,level_id:a.level_id,status:completed?'approved':'pending',created_at:'2026-10-23T01:00:00Z'}));
  const recent = history ? Array.from({length:3},(_,i) => ({session_id:project.id,user_message:`之前的经营问题 ${i+1}`,reply:`之前已讨论过的经营建议 ${i+1}。`,provider:'ai_gateway_live',occurred_at:`2026-10-23T01:0${i}:00Z`})) : [];
  await page.addInitScript(({welcomeFlag}) => {
    if (welcomeFlag) localStorage.setItem('emc-journey-welcome-v1','1');
    localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'聊天回归小店',partner_name:'小商',platform:'xiaohongshu',category:'服装',agent:'Codex'}));
    window.sdkCalls = {created:0,destroyed:0,volumes:[],asks:[],manualSpeeches:[],subtitleAttempts:0,interrupts:0,replyEvents:[]};
    addEventListener("emc:companion-reply",event=>window.sdkCalls.replyEvents.push(Boolean(event.detail?.avatar_spoken)));
    // Leave the SDK subtitle widget in the real DOM: product CSS must hide it.
    window.XingyunAvatarAgent = class {
      constructor(options) {
        this.options = options;
        this.state = "initializing";
        window.sdkCalls.created++;
      }
      async init() {
        await fetch(this.options.gatewayServer,{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"});
        const canvas = document.createElement("canvas"); canvas.width=76; canvas.height=100;
        canvas.style.cssText="width:100%;height:100%";
        this.options.container.append(canvas);
        this.state = "running";
        this.options.agentCallbacks.onAgentStateChange("running");
      }
      getAgentState() { return this.state; }
      setVolume(value) { window.sdkCalls.volumes.push(value); }
      async ask(text) {
        window.sdkCalls.asks.push(text);
        if (!/\n\[EMC:fixture-turn-\d+\]$/.test(text)) throw new Error("Native ask must use a prepared turn ticket");
        const widget=document.createElement("div");widget.className="avatar-sdk-widget-container";
        const caption=document.createElement("div");caption.className="fake-sdk-subtitle";caption.textContent=text;
        caption.style.cssText="position:absolute;inset:0;background:#111;color:white";
        widget.append(caption);this.options.container.append(widget);window.sdkCalls.subtitleAttempts++;
        this.options.agentCallbacks.onLLMResponse({event:"done"});
        this.options.agentCallbacks.onSpeakStateChange({state:"speak_start"});
      }
      speak(text) { window.sdkCalls.manualSpeeches.push(text); }
      interrupt() { window.sdkCalls.interrupts++; }
      think() {} listen() {} idle() {}
      async stopASR() {}
      async destroy() { this.interrupt(); this.state="closed"; window.sdkCalls.destroyed++; }
    };
  },{welcomeFlag});
  await page.route('**/api/**',async route => {
    const req=route.request(),uri=new URL(req.url()).pathname;
    const body=req.method()==='GET'?null:req.postDataJSON();
    calls.push({uri,method:req.method(),body});
    let result={items:[],next_cursor:null};
    if (uri==='/api/me') result={authenticated:true,player:{id:'ply_composer',display_name:'聊天玩家'},roles:['player'],csrf_token:'composer-csrf'};
    else if (uri==='/api/projects') result={items:[project],next_cursor:null};
    else if (uri==='/api/artifacts') result={items:artifacts,next_cursor:null};
    else if (uri==='/api/verifications') result={items:verifications,next_cursor:null};
    else if (uri==='/api/agent/memory') result={memory:{intimacy_score:88,patience_score:96,interactions_count:recent.length,current_focus_level:advanced?'L3':'L1'},recent_conversation:recent};
    else if (uri==='/api/agent/config') result={xingyun:{app_id:'fixture-avatar',default_preset:'yingyi'}};
    else if (uri==='/api/agent/xingyun/web-sessions' && req.method()==='POST') result={id:'fixture-grant-'+calls.length,expires_in:900};
    else if (uri==='/api/agent/xingyun/e2e-session') result={error_code:0,data:{session_id:'fixture-native-session'}};
    else if (/^\/api\/agent\/xingyun\/web-sessions\/[^/]+\/turns$/.test(uri) && req.method()==='POST') {
      const id='fixture-turn-'+(turns.size+1);
      turns.set(id,{body,polls:0});
      result={id,ticket:'EMC:'+id};
    }
    else if (/^\/api\/agent\/xingyun\/web-sessions\/[^/]+\/turns\/[^/]+$/.test(uri) && req.method()==='GET') {
      const turn=turns.get(uri.split('/').at(-1));assert.ok(turn,'Poll refers to a prepared question');
      turn.polls++;
      result=turn.polls===1?{state:'pending'}:{state:'done',result:{reply:`第 ${turns.size} 轮：先确认这款裤子的颜色。\n\n`+Array.from({length:8},(_,i)=>`- 拍摄检查 ${i+1}：使用自然光，背景保持干净，主体占画面三分之二。`).join('\n')+'\n\n你先告诉我裤子是什么颜色，我们再只做下一步。',provider:'ai_gateway_live'}};
    }
    else if (uri==='/api/agent/chat') throw new Error('A native question must never also use ordinary chat');
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);
  // Invoke the existing skip control after data readiness: this exercises chat,
  // while the independent 3D loading/intro suite owns scene readiness.
  await page.evaluate(()=>document.getElementById('bootSkip')?.click());
  await page.locator('#opening').waitFor({state:'hidden',timeout:45000});
  if(history) await page.waitForFunction(()=>document.querySelectorAll('#socialMessages .social-message.mine').length>=3);
  if(native)await page.evaluate(()=>EmcAvatarAgent.connectXingyunSession());
  return {calls,turns};
}

async function openChat(page,width) {
  await page.locator(width<=700?'#copilotHistory':'#expandCompanionChat').click();
  await page.locator('#copilotSuggestions').waitFor({state:'visible'});
}
const nativePosts = fixture => fixture.calls.filter(c=>c.method==='POST' && /^\/api\/agent\/xingyun\/web-sessions\/[^/]+\/turns$/.test(c.uri));
async function send(page,fixture,text) {
  const count=nativePosts(fixture).length;
  await page.locator('#copilotInput').fill(text);
  await page.locator('#copilotSend').click();
  await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);
  assert.equal(nativePosts(fixture).length,count+1);
  assert.equal(fixture.calls.filter(c=>c.uri==='/api/agent/chat').length,0,'Native transport never repeats a question through ordinary chat');
  await page.waitForFunction(n=>EmcAvatarAgent._state.mode==='rtc' && sdkCalls.asks.length===n && sdkCalls.replyEvents.length===n,count+1);
  const native=await page.evaluate(()=>({...sdkCalls}));
  assert.equal(native.manualSpeeches.length,0,'Native answers are already spoken by the SDK');
  assert.ok(native.replyEvents.every(Boolean),'Replies preserve avatar_spoken');
  assert.ok([...fixture.turns.values()].every(turn=>turn.polls>=2),'Prepared turns exercise pending and completed polling');
}
async function boxes(page) {
  const entries=await Promise.all(['.copilot-dock','.social-heading','#socialMessages','.copilot-compose','#copilotSuggestions','#emcAvatarStage','#copilotForm','.copilot-compose-toolbar'].map(async s=>[s,await page.locator(s).boundingBox()]));
  return Object.fromEntries(entries);
}
async function identityGeometry(page) {
  const name=await page.locator('#socialName').boundingBox(),portrait=await page.locator('#companionAvatar').boundingBox(),stats=await page.locator('.social-stats').boundingBox(),close=await page.locator('#closeMobileChat').boundingBox();
  assert.ok(name.width>=26&&name.height<=24,'Companion name stays on one line');
  assert.ok(name.x>=right(portrait)+4&&stats.x>=right(portrait)+4,'Identity stays beside portrait');
  assert.ok(stats.y>=bottom(name)-1,'Stats stay below name');
  if(close)assert.ok(close.x>=right(stats)+4,'Close stays to the right of stats');
  if(await page.locator('#expandCompanionChat').isVisible()){const expand=await page.locator('#expandCompanionChat').boundingBox(),dock=await page.locator('#companionChat').boundingBox();assert.ok(expand.x<dock.x,'Desktop reading handle stays at the panel edge');assert.equal(close,null,'Desktop chat remains docked without a close button');}
}
async function compactGeometry(page,width,height,{scroll=false}={}) {
  await identityGeometry(page);
  const question=await page.locator('[data-chat-suggestion]').last().boundingBox(),image=await page.locator('#chatPickImage').boundingBox();
  assert.ok(image.x>=right(question)+4,'Image button follows the second suggestion');
  assert.ok(Math.abs(image.y+image.height/2-question.y-question.height/2)<=2,'Image and second suggestion share a row');
  const b=await boxes(page),dock=b['.copilot-dock'],head=b['.social-heading'],messages=b['#socialMessages'],composer=b['.copilot-compose'],suggestions=b['#copilotSuggestions'],avatar=b['#emcAvatarStage'],form=b['#copilotForm'],toolbar=b['.copilot-compose-toolbar'];
  for(const [name,box] of Object.entries(b)) inside(box,width,height,name);
  assert.ok(bottom(head)<=messages.y+2,'Identity precedes transcript');
  assert.ok(bottom(messages)<=composer.y+2,'Transcript precedes composer');
  assert.ok(composer.height<=300,`Composer consumes ${composer.height}px`);
  assert.ok(messages.height>=100,`Transcript retained ${messages.height}px`);
  assert.ok(avatar.height<=102 && avatar.width<=78,'Avatar remains a small companion');
  assert.ok(right(suggestions)<=avatar.x+2,'Suggestions and avatar are side by side');
  assert.ok(suggestions.y<bottom(avatar) && avatar.y<bottom(suggestions),'Suggestions and avatar share a row');
  const toolsBottom=bottom(await page.locator('.copilot-companion-tools').boundingBox());
  assert.ok(form.y-toolsBottom>=-2 && form.y-toolsBottom<=12,`Input gap is ${form.y-toolsBottom}px`);
  assert.ok(toolbar.y-bottom(form)>=-2 && toolbar.y-bottom(form)<=12,'Toolbar stays next to input');
  assert.ok(bottom(dock)-bottom(toolbar)<=28,'No blank area beneath composer toolbar');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');
  if(scroll) {
    const extent=await page.locator('#socialMessages').evaluate(e=>({scroll:e.scrollHeight,client:e.clientHeight}));
    assert.ok(extent.scroll>extent.client+30,'Long conversations scroll inside transcript');
    await page.locator('#socialMessages').evaluate(e=>{e.scrollTop=0;});
    await page.locator('#socialMessages').hover(); await page.mouse.wheel(0,250);
    await page.waitForFunction(()=>document.getElementById('socialMessages').scrollTop>0);
  }
}
async function settingsPopover(page,width,height) {
  const summary=page.locator('.avatar-settings summary'),panel=page.locator('.avatar-settings-panel');
  const before=await boxes(page);
  await summary.click(); await panel.waitFor({state:'visible'});
  inside(await panel.boundingBox(),width,height,'Settings popover');
  assert.equal(await panel.evaluate(e=>getComputedStyle(e).position),'absolute');
  for(const selector of ['#socialMessages','#copilotForm']) {
    const now=await page.locator(selector).boundingBox(); near(now.y,before[selector].y,selector+' y while settings open');near(now.height,before[selector].height,selector+' height while settings open');
  }
  await page.locator('#emcAvatarPresetSelect').selectOption('xingya');
  await page.waitForFunction(()=>EmcAvatarAgent._state.mode==='rtc' && EmcAvatarAgent._state.presetId==='xingya');
  const disconnected=await page.evaluate(()=>sdkCalls.destroyed);
  await page.locator('#emcAvatarConnect3dBtn').click();
  await page.waitForFunction(()=>EmcAvatarAgent._state.mode==='island');
  assert.ok(await page.evaluate(n=>sdkCalls.destroyed>n,disconnected),'Disconnect destroys SDK');
  assert.equal(await page.locator('#emcAvatarStage').isVisible(),false);
  await page.locator('#emcAvatarConnect3dBtn').click();
  await page.waitForFunction(()=>EmcAvatarAgent._state.mode==='rtc');
  await page.locator('#emcAvatarPresetSelect').focus();await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(),false,'Escape closes settings');
  assert.equal(await page.locator('#copilotSuggestions').isVisible(),true,'Escape preserves open chat');
  await summary.click(); await panel.waitFor({state:'visible'});
  await page.locator('#socialName').click();assert.equal(await panel.isVisible(),false,'Outside click closes settings');
  const after=await boxes(page);for(const selector of ['#socialMessages','#copilotForm'])near(after[selector].y,before[selector].y,selector+' restored after popover');
}

module.exports={prepare,openChat,send,nativePosts};
if(require.main===module)(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    for(const [width,height] of [[1440,900],[790,700],[390,844],[320,568]].filter(([width])=>!process.env.EMC_TEST_WIDTH||Number(process.env.EMC_TEST_WIDTH)===width)) {
      const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const fixture=await prepare(page); // Deliberately no welcome flag: existing L3 player.
      if(width<=700) {
        inside(await page.locator('#copilotForm').boundingBox(),width,height,'Collapsed input');
        inside(await page.locator('#copilotHistory').boundingBox(),width,height,'Collapsed history entry');
        for(const s of ['#socialMessages','#copilotSuggestions','.copilot-compose-toolbar','#emcAvatarStage'])assert.equal(await page.locator(s).isVisible(),false,s+' hidden while collapsed');
        assert.ok((await page.locator('.copilot-dock').boundingBox()).height<=100,'Mobile dock remains compact');
      }
      if(width>700)await identityGeometry(page);
      await openChat(page,width);
      const suggestions=page.locator('#copilotSuggestions');
      assert.doesNotMatch(await suggestions.innerText(),/先认识一下小店|还没方向/,'Existing L3 users get current task guidance');
      assert.match(await suggestions.innerText(),/L3/);
      const count=nativePosts(fixture).length;
      await suggestions.getByRole('button').first().click();
      const prompt=await page.locator('#copilotInput').inputValue(); assert.match(prompt,/L3/);
      assert.equal(nativePosts(fixture).length,count,'Suggestion only fills editable input');
      await send(page,fixture,prompt+' 我补充：裤子是黑色。');
      if(width>700)for(let i=2;i<=3;i++)await send(page,fixture,`第 ${i} 个问题：我现在只需要做什么？`);
      const posted=nativePosts(fixture);
      assert.equal(posted[0].body.level_id,'L3');assert.match(posted[0].body.message,/我补充：裤子是黑色/);
      assert.doesNotMatch(await suggestions.innerText(),/先认识一下小店/);
      await compactGeometry(page,width,height,{scroll:true});
      assert.equal(await page.locator('#copilotFinish').isVisible(),true,'Report entry appears after enough conversation');
      assert.equal(await page.locator('.copilot-compose-toolbar #copilotFinish').count(),1);
      assert.equal(await page.locator('#socialMessages [data-companion-action=report],#socialMessages .coach-finish').count(),0,'Report never floats in transcript');
      const sdk=await page.evaluate(()=>({...sdkCalls,mode:EmcAvatarAgent._state.mode,pose:EmcAvatarAgent._state.pose}));
      assert.equal(sdk.mode,'rtc');assert.equal(sdk.pose,'speak');assert.ok(sdk.asks.length>0);
      assert.equal(sdk.manualSpeeches.length,0,'Native speech is not repeated manually');
      assert.ok(sdk.subtitleAttempts>0);
      assert.ok(await page.locator('.fake-sdk-subtitle').count()>0,'Native SDK attempted to render its own subtitles');
      assert.equal(await page.locator('.avatar-sdk-widget-container:visible,.fake-sdk-subtitle:visible').count(),0,'Native duplicate subtitles stay hidden by product CSS');
      await page.locator('#emcAvatarMuteBtn').click();assert.equal(await page.locator('#emcAvatarMuteBtn').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>sdkCalls.volumes.at(-1)),0);
      await page.locator('#emcAvatarMuteBtn').click();assert.equal(await page.evaluate(()=>sdkCalls.volumes.at(-1)),1);
      await settingsPopover(page,width,height);
      assert.ok(await page.evaluate(()=>sdkCalls.interrupts>0),'Native interruption survives disconnect');
      await compactGeometry(page,width,height);
      await page.screenshot({path:path.join(shots,`expanded-${width}x${height}.png`)});
      if(width<=700) {
        await page.locator('#closeMobileChat').click();
        await page.locator('#copilotHistory').click();
        await page.locator('#copilotInput').fill('键盘打开时保留的可编辑内容');
        await page.evaluate(()=>{document.body.classList.add('keyboard-open');document.documentElement.style.setProperty('--keyboard-offset','200px');});
        inside(await page.locator('#copilotForm').boundingBox(),width,height-200,'Keyboard input');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.equal(await page.locator('#copilotSuggestions').isVisible(),false);
        await page.screenshot({path:path.join(shots,`keyboard-${width}x${height}.png`)});
        await page.evaluate(()=>{document.body.classList.remove('keyboard-open');document.documentElement.style.setProperty('--keyboard-offset','0px');});
        await page.locator('#closeMobileChat').click();
        await page.locator('#copilotHistory').click();
        assert.match(await page.locator('#copilotInput').inputValue(),/保留的可编辑内容/);
      }
      assert.deepEqual(errors,[]);await page.close();
      console.log(`PASS ${width}x${height}: compact geometry, scoped editable prompts, scrolling, native asks without duplicate transport or speech, hidden subtitles, avatar controls, popover and mobile keyboard`);
    }
    // A player with L1 history and no welcome flag must also avoid stale onboarding.
    const old=await browser.newPage({viewport:{width:790,height:700}});
    await prepare(old,{advanced:false,history:true});await openChat(old,790);
    assert.doesNotMatch(await old.locator('#copilotSuggestions').innerText(),/先认识一下小店/);
    await old.close();console.log('PASS L1 historical player without welcome flag');
    // A truly new player gets introductory prompts, then advances after one real reply.
    const fresh=await browser.newPage({viewport:{width:790,height:700}}),fixture=await prepare(fresh,{advanced:false,history:false});
    await openChat(fresh,790);assert.match(await fresh.locator('#copilotSuggestions').innerText(),/先认识一下小店/);
    await send(fresh,fixture,'我想先了解这间小店。');
    assert.doesNotMatch(await fresh.locator('#copilotSuggestions').innerText(),/先认识一下小店/);
    await fresh.close();console.log('PASS fresh onboarding advances into task guidance after conversation');
  } finally {await browser.close();}
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
