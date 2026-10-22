'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191';
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||'msedge'});try{
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000}});
    const page=await context.newPage(),errors=[],calls=[];
    page.on('pageerror',e=>errors.push(e.message));
    let state={affinity:60,patience:20,version:7,level:'L1',streak:0,perks:[],source:'server',emotion:{mood:'刻薄',example:'这一步都快被你盘出包浆了。先做完眼前这一件。',paused:false}},history=[],fail=false;
    await page.addInitScript(()=>{
      localStorage.setItem('emc-journey-welcome-v1','1');
      localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'云端小店',partner_name:'小商',category:'收纳',platform:'xiaohongshu',agent:'Codex'}));
    });
    await page.route('**/api/**',async route=>{
      const req=route.request(),uri=new URL(req.url()).pathname;let result,status=200;
      if(uri==='/api/me')result={authenticated:true,player:{id:'ply_owner',display_name:'店主'},roles:['player'],csrf_token:'test-csrf'};
      else if(uri==='/api/projects')result={items:[{id:'prj_owner',name:'云端小店',platform:'xiaohongshu',category:'收纳',version:1}],next_cursor:null};
      else if(uri==='/api/artifacts'||uri==='/api/verifications')result={items:[],next_cursor:null};
      else if(uri.endsWith('/state')||uri.endsWith('/activity'))result=state;
      else if(uri.endsWith('/history'))result={items:history,next_before:null};
      else if(uri.endsWith('/messages')){
        const body=req.postDataJSON();calls.push({body,headers:req.headers()});
        if(fail){status=503;result={error:{code:'agent_unavailable',message:'暂时不可用'}};}
        else{
          assert.equal(body.version,state.version);assert.equal(body.system_prompt,undefined);
          state={...state,version:state.version+1,affinity:64,patience:84,streak:1,emotion:{mood:'耐心',example:'别急，我们先理清关键信息。',paused:false}};
          result={text:'先把预算和已有货源列出来，我们一起比较。',source:'ai',state,actions:[{type:'show_task',level:'L1'}],sources:[],skill_ids:['category-business-advisor'],turn_id:'agt_1'};
          history=[{id:'agt_1',sequence:8,message:body.message,reply:result,created_at:new Date().toISOString()}];
        }
      }else{status=404;result={error:{code:'not_found',message:'不存在'}};}
      await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.goto(url);
    await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible&&document.getElementById('socialAffinity').textContent==='60/100');
    if(width===390)await page.locator('#copilotHistory').click();
    if(width===390&&!await page.locator('#companionAvatar').isVisible())await page.locator('#copilotHistory').click();
    await page.locator('#companionAvatar').click();
    assert.match(await page.locator('#panelBody').innerText(),/刻薄/);
    assert.match(await page.locator('#panelBody').innerText(),/盘出包浆/);
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(os.tmpdir(),`emc-emotion-${width}.png`)});
    await page.locator('#closePanel').click();
    await page.locator('#copilotInput').fill('预算2000元，已经对比货源但没确定，想做收纳');
    await page.locator('#copilotSend').click();
    await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&document.getElementById('socialAffinity').textContent==='64/100');
    assert.equal(calls[0].headers['x-csrf-token'],'test-csrf');assert.ok(calls[0].headers['idempotency-key']);
    assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('预算2000元')),false);
    if(width===390&&!await page.locator('#companionAvatar').isVisible())await page.locator('#copilotHistory').click();
    await page.locator('#companionAvatar').click();
    assert.match(await page.locator('#panelBody').innerText(),/伙伴云端存档/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.waitForTimeout(700);
    await page.screenshot({path:path.join(os.tmpdir(),`emc-agent-${width}.png`)});
    fail=true;await page.locator('#closePanel').click();
    if(width===390&&!await page.locator('#copilotInput').isVisible())await page.locator('#copilotHistory').click();
    await page.locator('#copilotInput').fill('模型失败测试');await page.locator('#copilotSend').click();
    await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&document.getElementById('copilotInput').value==='模型失败测试');
    assert.equal(await page.locator('#socialAffinity').innerText(),'64/100');
    await page.reload();await page.waitForFunction(()=>window.render_game_to_text&&document.getElementById('socialAffinity').textContent==='64/100');
    assert.match(await page.locator('#socialMessages').innerText(),/预算2000元/);
    assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px cloud state, typed request, CSRF, failure preservation, reload history, layout`);
  }
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  await page.route('**/api/**',route=>route.fulfill({contentType:'application/json',body:JSON.stringify({authenticated:false})}));
  await page.goto(url);await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible);
  await page.locator('#copilotHistory').click();
  await page.locator('#companionAvatar').click();
  assert.match(await page.locator('#panelBody').innerText(),/伙伴成长试运行/);
  await page.locator('#closePanel').click();
  for(const message of ['我想在小红书做家居收纳，预算2000元，每周10小时，有货源，先选哪个方向？','我想比较拼多多的通勤包，售价59元、成本25元，每周能上架3款，已经比较了两家货源但评价不一致。','我需要优化小红书主图，近7天曝光1000次、点击20次，已经调整过标题但没有改善。']){
    await page.locator('#copilotInput').fill(message);await page.locator('#copilotSend').click();
    await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&document.getElementById('copilotInput').value==='');
  }
  assert.equal(await page.locator('#socialAffinity').innerText(),'32/100');
  assert.equal(await page.evaluate(()=>JSON.parse(render_game_to_text()).chat.reply_source),'local-guide');
  await page.reload();await page.waitForFunction(()=>window.render_game_to_text&&document.getElementById('socialAffinity').textContent==='32/100');
  await context.close();console.log('PASS guest local guide, relationship practice, source label, reload persistence');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
