'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191';
const limit=Number(process.env.EMC_TEST_WIDTH);
const widths=limit?[limit]:[1440,390];
(async()=>{
 const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});
 try{
  for(const width of widths){
   const context=await browser.newContext({viewport:{width,height:width<=700?844:1000}});
   const page=await context.newPage(),errors=[],posts=[];
   page.on('pageerror',e=>errors.push(e.message));
   let score=60,history=[],fail=false,provider='ai_gateway_live';
   await page.addInitScript(()=>{
     localStorage.setItem('emc-journey-welcome-v1','1');
     localStorage.setItem('emc-journey-entry-v1',JSON.stringify({
       saved:true,shop_name:'云端小店',partner_name:'小商',
       category:'收纳',platform:'xiaohongshu',agent:'Codex'
     }));
   });
   await page.route('**/api/**',async route=>{
     const req=route.request(),uri=new URL(req.url()).pathname;let result,status=200;
     if(uri==='/api/me')result={
       authenticated:true,player:{id:'ply_owner',display_name:'店主'},roles:['player'],csrf_token:'test-csrf'
     };
     else if(uri==='/api/projects')result={
       items:[{id:'prj_owner',name:'云端小店',platform:'xiaohongshu',category:'收纳',version:1,status:'active'}],
       next_cursor:null
     };
     else if(uri==='/api/artifacts'||uri==='/api/verifications')result={items:[],next_cursor:null};
     else if(uri==='/api/agent/memory')result={
       memory:{intimacy_score:score,interactions_count:history.length+7,current_focus_level:'L1'},
       recent_conversation:[
         {session_id:'prj_another_player',user_message:'不能泄露',reply:'另外的项目'},
         ...history
       ]
     };
     else if(uri==='/api/agent/chat'){
       const body=req.postDataJSON();posts.push({body,headers:req.headers()});
       if(fail){status=503;result={error:{code:'agent_unavailable',message:'暂时不可用'}};}
       else{
         score+=3;
         result={reply:'先把预算和已有货源列出来，我们一起比较。',provider};
         history.push({session_id:'prj_owner',user_message:body.message,reply:result.reply});
       }
     }else {status=404;result={error:{code:'not_found',message:'不存在'}};}
     await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
   });
   await page.goto(url);
   await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible&&document.getElementById('socialAffinity').textContent==='60/100');
   if(width<=700)await page.locator('#copilotHistory').click();
   await page.locator('#companionAvatar').click();
   assert.match(await page.locator('#panelBody').innerText(),/云端/);
   await page.locator('#closePanel').click();
   if(width<=700&&!await page.locator('#copilotInput').isVisible())await page.locator('#copilotHistory').click();
   await page.locator('#copilotInput').fill('预算2000元，已经对比货源但没确定，想做收纳');
   await page.locator('#copilotSend').click();
   await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&document.getElementById('socialAffinity').textContent==='63/100');
   assert.equal(posts.length,1);
   assert.equal(posts[0].headers['x-csrf-token'],'test-csrf');
   assert.equal(posts[0].body.level_id,'L1');
   assert.equal(posts[0].body.session_id,'prj_owner');
   assert.equal(posts[0].body.client_context.source,'island-companion');
   assert.equal(posts[0].body.system_prompt,undefined);
   assert.equal(posts[0].body.client_context.player_id,undefined);
   const leaked=await page.evaluate(()=>Object.keys(localStorage).filter(k=>String(localStorage.getItem(k)).includes('预算2000元')));
   console.log('CHAT_LOCAL_KEYS',JSON.stringify(leaked));
   assert.deepEqual(leaked,[]);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   fail=true;
   if(width<=700&&!await page.locator('#copilotInput').isVisible())await page.locator('#copilotHistory').click();
   await page.locator('#copilotInput').fill('模型失败测试');
   await page.locator('#copilotSend').click();
   await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&document.getElementById('copilotInput').value==='模型失败测试');
   assert.equal(score,63);
   await page.reload();
   await page.waitForFunction(()=>window.render_game_to_text&&document.getElementById('socialAffinity').textContent==='63/100');
   if(width<=700&&!await page.locator('#socialMessages').isVisible())await page.locator('#copilotHistory').click();
   assert.match(await page.locator('#socialMessages').innerText(),/预算2000元/);
   assert.doesNotMatch(await page.locator('#socialMessages').innerText(),/不能泄露/);
   assert.deepEqual(errors,[]);
   await context.close();
   console.log('PASS '+width+'px #62 production agent bridge, CSRF, chat, isolation, offline retention, reload');
  }
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
