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

async function prepare(page,{advanced=true,history=true,welcomeFlag=false}={}) {
  const calls = [];
  const project = {id:'prj_composer',name:'聊天回归小店',platform:'xiaohongshu',category:'服装',version:1};
  const artifacts = advanced ? J.LEVELS.slice(0,2).map((level,i) => ({id:'art_composer'+i,project_id:project.id,level_id:level.id,artifact_type:level.type,origin:'formal',title:level.deliverable,status:'submitted',revision:1,version:1,content:{notes:'真实成果记录与来源待审核'}})) : [];
  const verifications = artifacts.map((a,i) => ({id:'ver_composer'+i,project_id:project.id,artifact_id:a.id,level_id:a.level_id,status:'pending',created_at:'2026-10-23T01:00:00Z'}));
  const recent = history ? Array.from({length:3},(_,i) => ({session_id:project.id,user_message:`之前的经营问题 ${i+1}`,reply:`之前已讨论过的经营建议 ${i+1}。`,provider:'ai_gateway_live',occurred_at:`2026-10-23T01:0${i}:00Z`})) : [];
  await page.addInitScript(({welcomeFlag}) => {
    if (welcomeFlag) localStorage.setItem('emc-journey-welcome-v1','1');
    localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'聊天回归小店',partner_name:'小商',platform:'xiaohongshu',category:'服装',agent:'Codex'}));
    window.sdkCalls = {created:0,destroyed:0,volumes:[],speeches:[],subtitleAttempts:0,subtitleIntercepted:0,subtitleOff:0,options:[]};
    // Mimic the SDK's default subtitle renderer. With no proxy handler this fixture
    // really inserts an overlay, making subtitle suppression a behavioral assertion.
    window.XmovAvatar = class {
      constructor(options) {
        this.options = options;
        window.sdkCalls.created++;
        window.sdkCalls.options.push({subtitleOn:typeof options.proxyWidget?.subtitle_on,subtitleOff:typeof options.proxyWidget?.subtitle_off});
      }
      async init({onDownloadProgress}) {
        await fetch(this.options.gatewayServer,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
        const canvas = document.createElement('canvas'); canvas.width=76; canvas.height=100;
        canvas.style.cssText='width:100%;height:100%';
        document.querySelector(this.options.containerId).append(canvas);
        onDownloadProgress(100); this.options.onStatusChange(0);
      }
      setVolume(value) { window.sdkCalls.volumes.push(value); }
      speak(text) {
        window.sdkCalls.speeches.push(text); window.sdkCalls.subtitleAttempts++;
        this.options.onStateChange('speak');
        if (typeof this.options.proxyWidget?.subtitle_on === 'function') {
          window.sdkCalls.subtitleIntercepted++; this.options.proxyWidget.subtitle_on({type:'subtitle_on',text});
        } else {
          const caption=document.createElement('div');caption.className='fake-sdk-subtitle';caption.textContent=text;
          caption.style.cssText='position:absolute;inset:0;background:#111;color:white';
          document.querySelector(this.options.containerId).append(caption);
        }
      }
      interrupt() {
        if (typeof this.options.proxyWidget?.subtitle_off === 'function') { window.sdkCalls.subtitleOff++; this.options.proxyWidget.subtitle_off({type:'subtitle_off'}); }
        else document.querySelector('.fake-sdk-subtitle')?.remove();
      }
      think() {} listen() {} idle() {}
      async destroy() { this.interrupt(); window.sdkCalls.destroyed++; }
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
    else if (uri==='/api/agent/xingyun/session') result={error_code:0,data:{session_id:'fixture-avatar-session'}};
    else if (uri==='/api/agent/chat') {
      const turn=calls.filter(c=>c.uri==='/api/agent/chat').length;
      result={reply:`第 ${turn} 轮：先确认这款裤子的颜色。\n\n`+Array.from({length:8},(_,i)=>`- 拍摄检查 ${i+1}：使用自然光，背景保持干净，主体占画面三分之二。`).join('\n')+'\n\n你先告诉我裤子是什么颜色，我们再只做下一步。',provider:'ai_gateway_live'};
    }
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.goto(base);
  await page.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);
  // Invoke the existing skip control after data readiness: this exercises chat,
  // while the independent 3D loading/intro suite owns scene readiness.
  await page.evaluate(()=>document.getElementById('bootSkip')?.click());
  await page.locator('#opening').waitFor({state:'hidden',timeout:45000});
  if(history) await page.waitForFunction(()=>document.querySelectorAll('#socialMessages .social-message.mine').length>=3);
  return {calls};
}

async function openChat(page,width) {
  await page.locator(width<=700?'#copilotHistory':'#expandCompanionChat').click();
  await page.locator('#copilotSuggestions').waitFor({state:'visible'});
}
async function send(page,fixture,text) {
  const count=fixture.calls.filter(c=>c.uri==='/api/agent/chat').length;
  await page.locator('#copilotInput').fill(text);
  await page.locator('#copilotSend').click();
  await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);
  assert.equal(fixture.calls.filter(c=>c.uri==='/api/agent/chat').length,count+1);
  await page.waitForFunction(()=>EmcAvatarAgent._state.mode==='rtc' && sdkCalls.speeches.length>0);
}
async function boxes(page) {
  const entries=await Promise.all(['.copilot-dock','.social-heading','#socialMessages','.copilot-compose','#copilotSuggestions','#emcAvatarStage','#copilotForm','.copilot-compose-toolbar'].map(async s=>[s,await page.locator(s).boundingBox()]));
  return Object.fromEntries(entries);
}
async function compactGeometry(page,width,height,{scroll=false}={}) {
  const b=await boxes(page),dock=b['.copilot-dock'],head=b['.social-heading'],messages=b['#socialMessages'],composer=b['.copilot-compose'],suggestions=b['#copilotSuggestions'],avatar=b['#emcAvatarStage'],form=b['#copilotForm'],toolbar=b['.copilot-compose-toolbar'];
  for(const [name,box] of Object.entries(b)) inside(box,width,height,name);
  assert.ok(bottom(head)<=messages.y+2,'Identity precedes transcript');
  assert.ok(bottom(messages)<=composer.y+2,'Transcript precedes composer');
  assert.ok(composer.height<=230,`Composer consumes ${composer.height}px`);
  assert.ok(messages.height>=100,`Transcript retained ${messages.height}px`);
  assert.ok(avatar.height<=102 && avatar.width<=78,'Avatar remains a small companion');
  assert.ok(right(suggestions)<=avatar.x+2,'Suggestions and avatar are side by side');
  assert.ok(suggestions.y<bottom(avatar) && avatar.y<bottom(suggestions),'Suggestions and avatar share a row');
  const toolsBottom=Math.max(bottom(suggestions),bottom(avatar));
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

(async()=>{
  const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    for(const [width,height] of [[1440,900],[790,700],[390,844],[320,568]]) {
      const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      const fixture=await prepare(page); // Deliberately no welcome flag: existing L3 player.
      if(width<=700) {
        inside(await page.locator('#copilotForm').boundingBox(),width,height,'Collapsed input');
        inside(await page.locator('#copilotHistory').boundingBox(),width,height,'Collapsed history entry');
        for(const s of ['#socialMessages','#copilotSuggestions','.copilot-compose-toolbar','#emcAvatarStage'])assert.equal(await page.locator(s).isVisible(),false,s+' hidden while collapsed');
        assert.ok((await page.locator('.copilot-dock').boundingBox()).height<=100,'Mobile dock remains compact');
      }
      await openChat(page,width);
      const suggestions=page.locator('#copilotSuggestions');
      assert.doesNotMatch(await suggestions.innerText(),/先认识一下小店|还没方向/,'Existing L3 users get current task guidance');
      assert.match(await suggestions.innerText(),/L3/);
      const count=fixture.calls.filter(c=>c.uri==='/api/agent/chat').length;
      await suggestions.getByRole('button').first().click();
      const prompt=await page.locator('#copilotInput').inputValue(); assert.match(prompt,/L3/);
      assert.equal(fixture.calls.filter(c=>c.uri==='/api/agent/chat').length,count,'Suggestion only fills editable input');
      await send(page,fixture,prompt+' 我补充：裤子是黑色。');
      if(width>700)for(let i=2;i<=3;i++)await send(page,fixture,`第 ${i} 个问题：我现在只需要做什么？`);
      const posted=fixture.calls.filter(c=>c.uri==='/api/agent/chat');
      assert.equal(posted[0].body.level_id,'L3');assert.match(posted[0].body.message,/我补充：裤子是黑色/);
      assert.doesNotMatch(await suggestions.innerText(),/先认识一下小店/);
      await compactGeometry(page,width,height,{scroll:true});
      assert.equal(await page.locator('#copilotFinish').isVisible(),true,'Report entry appears after enough conversation');
      assert.equal(await page.locator('.copilot-compose-toolbar #copilotFinish').count(),1);
      assert.equal(await page.locator('#socialMessages [data-companion-action=report],#socialMessages .coach-finish').count(),0,'Report never floats in transcript');
      const sdk=await page.evaluate(()=>({...sdkCalls,mode:EmcAvatarAgent._state.mode,pose:EmcAvatarAgent._state.pose}));
      assert.equal(sdk.mode,'rtc');assert.equal(sdk.pose,'speak');assert.ok(sdk.speeches.length>0);
      assert.ok(sdk.options.every(o=>o.subtitleOn==='function'&&o.subtitleOff==='function'),'SDK receives both subtitle proxies');
      assert.ok(sdk.subtitleAttempts>0);assert.equal(sdk.subtitleIntercepted,sdk.subtitleAttempts);
      assert.equal(await page.locator('.fake-sdk-subtitle').count(),0,'Speaking does not create duplicate subtitles');
      await page.locator('#emcAvatarMuteBtn').click();assert.equal(await page.locator('#emcAvatarMuteBtn').getAttribute('aria-pressed'),'true');assert.equal(await page.evaluate(()=>sdkCalls.volumes.at(-1)),0);
      await page.locator('#emcAvatarMuteBtn').click();assert.equal(await page.evaluate(()=>sdkCalls.volumes.at(-1)),1);
      await settingsPopover(page,width,height);
      assert.ok(await page.evaluate(()=>sdkCalls.subtitleOff>0),'SDK subtitle-off handler survives disconnect');
      await compactGeometry(page,width,height);
      await page.screenshot({path:path.join(shots,`expanded-${width}x${height}.png`)});
      if(width<=700) {
        await page.locator('#closeMobileChat').click();
        await page.locator('#copilotInput').fill('键盘打开时保留的可编辑内容');
        await page.evaluate(()=>{document.body.classList.add('keyboard-open');document.documentElement.style.setProperty('--keyboard-offset','200px');});
        inside(await page.locator('#copilotForm').boundingBox(),width,height-200,'Keyboard input');
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        assert.equal(await page.locator('#copilotSuggestions').isVisible(),false);
        await page.screenshot({path:path.join(shots,`keyboard-${width}x${height}.png`)});
        await page.evaluate(()=>{document.body.classList.remove('keyboard-open');document.documentElement.style.setProperty('--keyboard-offset','0px');});
        await page.locator('#copilotHistory').click();
        assert.match(await page.locator('#copilotInput').inputValue(),/保留的可编辑内容/);
      }
      assert.deepEqual(errors,[]);await page.close();
      console.log(`PASS ${width}x${height}: compact geometry, scoped editable prompts, scrolling, subtitle interception, voice/avatar controls, popover and mobile keyboard`);
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
