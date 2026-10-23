/* Run against the static test server; all account/Agent calls are isolated fixtures. */
'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.EMC_TEST_URL||'http://127.0.0.1:5193';
const output=process.env.EMC_SHOTS_DIR||'/tmp/emc-conversation-shots';
fs.mkdirSync(output,{recursive:true});
const report='# 生意规划报告\n\n## 顾客与方向\n预算 **2000 元**，每周 10 小时，有家居货源。在小红书面向租房青年经营免安装桌下收纳。\n\n'+
'## 机会与验证\n- 先比较三款商品的需求、竞争与综合成本。\n- 评价与趋势数据尚待验证，不把假设当结论。\n\n'+
'| 候选 | 预算 | 下一步 |\n| --- | --- | --- |\n| 桌下收纳 | 500 元 | 询价并检查样品 |\n\n'+
'> 先小步验证，再决定进货。\n\n```text\n单笔利润 = 售价 - 全部成本\n```\n\n'+
'## 下一步\n'+Array.from({length:12},(_,i)=>`${i+1}. 比较商品 ${i+1} 的需求、竞争、运费和退货风险，并记录数据来源与日期。`).join('\n')+
'\n\n**完整报告结束**\n\n<script>window.pwned=true</script><img src=x onerror="window.pwned=true">[危险链接](javascript:alert(1))';
async function prepare(page,{guest=false,failAvatar=false,restoreHistory=false}={}){
 const state={calls:[],artifacts:[],verifications:[],turns:0};
 await page.addInitScript(({guest})=>{
  localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'小满杂货铺',partner_name:'小商',platform:'xiaohongshu',category:'家居收纳',agent:'Codex'}));
  window.sdkCalls={created:0,speeches:[],destroyed:0};
  window.XmovAvatar=class {
   constructor(options){this.options=options;window.sdkCalls.created++;}
   async init({onDownloadProgress}){const response=await fetch(this.options.gatewayServer,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'browser-fixture',config:{}})});const data=await response.json();if(data.error_code)throw new Error('unavailable');onDownloadProgress(100);this.options.onStatusChange(0);}
   speak(text){window.sdkCalls.speeches.push(text);}think(){}idle(){}interrupt(){}
   async destroy(){window.sdkCalls.destroyed++;}
  };
 },{guest});
 await page.route('**/api/**',async route=>{
  const request=route.request(),uri=new URL(request.url()).pathname,method=request.method();
  const body=method==='GET'?null:request.postDataJSON();state.calls.push({uri,method,body});let result={},status=200;
  if(uri==='/api/me')result=guest?{authenticated:false}:{authenticated:true,player:{id:'ply_conversation',display_name:'小满'},roles:['player'],csrf_token:'test-csrf'};
  else if(uri==='/api/projects'&&method==='GET')result={items:guest?[]:[{id:'prj_conversation',name:'小满杂货铺',platform:'xiaohongshu',category:'家居收纳',version:1}],next_cursor:null};
  else if(uri==='/api/artifacts'&&method==='GET')result={items:state.artifacts,next_cursor:null};
  else if(uri==='/api/verifications'&&method==='GET')result={items:state.verifications,next_cursor:null};
  else if(uri==='/api/agent/memory')result={memory:{intimacy_score:47,patience_score:86,interactions_count:3,current_focus_level:'L1'},recent_conversation:restoreHistory?[{session_id:'prj_conversation',user_message:'问题一',reply:'模型回复',provider:'ai_gateway_live'},{session_id:'prj_conversation',user_message:'问题二',reply:'规则回复',provider:'local_copilot_fallback'},{session_id:'prj_conversation',user_message:'问题三',reply:'旧回复'}]:[]};
  else if(uri==='/api/agent/config')result={xingyun:{app_id:'fixture-app',default_preset:'yingyi'}};
  else if(uri==='/api/agent/xingyun/session')result=failAvatar?{error_code:5001}:{error_code:0,data:{session_id:'fixture-session'}};
  else if(uri==='/api/agent/chat'){state.turns++;result={reply:report,provider:'ai_gateway_live',memory:{intimacy_score:47+state.turns*3,patience_score:86+state.turns*2,interactions_count:3+state.turns,current_focus_level:'L1'}};}
  else if(uri==='/api/artifacts'&&method==='POST'){status=201;result={...body,id:'art_conversation',version:1,status:'draft'};state.artifacts=[result];}
  else if(uri==='/api/verifications'&&method==='POST'){status=201;result={...body,id:'ver_conversation',status:'pending',created_at:new Date().toISOString()};state.verifications=[result];state.artifacts[0].status='submitted';}
  else if(uri==='/api/evidence')throw new Error('L1 conversation must not upload evidence');
  await route.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 return state;
}
async function ready(page){await page.goto(base);await page.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);await page.locator('#opening').waitFor({state:'hidden',timeout:30000});}
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--ignore-gpu-blocklist','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  for(const [width,height] of (process.env.EMC_HISTORY_ONLY?[]:[[1440,900],[390,844],[320,568]])){
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   const state=await prepare(page);await ready(page);
   await page.locator('#continueButton').click();await page.locator('.mail-welcome').waitFor();
   let header=page.locator('.mail-correspondence');
   assert.ok(await header.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=13));
   assert.ok(await header.locator('b').evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=16));
   assert.ok(await header.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   await page.screenshot({path:path.join(output,`welcome-${width}.png`)});
   await page.locator('[data-j-action=begin]').click();await page.locator('[data-story=L1]').waitFor();
   assert.ok(await header.evaluate(el=>parseFloat(getComputedStyle(el).fontSize)>=13));
   await page.screenshot({path:path.join(output,`letter-l1-${width}.png`)});

   await page.keyboard.press('Escape');
   if(width<=700)await page.locator('#copilotHistory').click();
   await page.locator('#copilotInput').fill('预算两千元，每周十小时，有家居货源，想在小红书经营收纳商品。请和我聊清方向并整理完整生意规划。');
   await page.locator('#copilotSend').click();await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);
   await page.waitForFunction(()=>window.EmcAvatarAgent._state.mode==='rtc');
   const last=page.locator('.social-message.theirs .markdown-body').last();
   assert.ok((await last.innerText()).includes('完整报告结束'));
   assert.equal(await last.locator('table').count(),1);assert.equal(await last.locator('pre code').count(),1);assert.ok(await last.locator('strong').count());
   assert.equal(await page.evaluate(()=>Boolean(window.pwned)),false);assert.equal(await last.locator('script,img,a[href^="javascript:"]').count(),0);
   assert.equal(await page.locator('#socialAffinity').innerText(),'50/100');assert.equal(await page.locator('#socialPatience').innerText(),'88/100');
   assert.equal(await page.locator('#cpFab,#emcAvatarCanvas,[data-avatar-pose-btn]').count(),0);
   if(width>700){await page.locator('#expandCompanionChat').click();assert.equal(await page.locator('#expandCompanionChat').getAttribute('aria-expanded'),'true');if(width>700)assert.ok((await page.locator('.copilot-dock').boundingBox()).width>=700);await page.locator('#expandCompanionChat').click();}
   if(width<=700)assert.equal(await page.locator('#expandCompanionChat').isVisible(),false);
   const dock=await page.locator('.copilot-dock').boundingBox();assert.ok(dock.width>=(width>700?400:width-20));assert.ok(dock.x>=0&&dock.x+dock.width<=width+1);
   assert.ok(await page.locator('#socialMessages').evaluate(el=>el.clientHeight>=140));
   await page.locator('#socialMessages').evaluate(el=>el.scrollTop=el.scrollHeight);await page.screenshot({path:path.join(output,`chat-long-${width}.png`)});
   assert.equal(await page.evaluate(()=>sdkCalls.created),1);assert.ok((await page.evaluate(()=>sdkCalls.speeches[0])).includes('完整报告结束'));
   await page.locator('[data-companion-action=plan]').click();await page.locator('#journeyDelivery').waitFor();
   assert.ok((await page.locator('[name=notes]').inputValue()).includes('完整报告结束'));
   await page.locator('[name=confirm]').check();await page.locator('#journeyDelivery button[type=submit]').click();
   await page.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.status==='pending'&&!JSON.parse(render_game_to_text()).journey.busy);
   const submitted=state.calls.find(call=>call.uri==='/api/verifications'&&call.method==='POST');assert.deepEqual(submitted.body.evidence_ids,[]);
   const artifact=state.calls.find(call=>call.uri==='/api/artifacts'&&call.method==='POST');assert.equal(artifact.body.content.delivery_method,'conversation');assert.ok(artifact.body.content.conversation.length>=2);
   assert.deepEqual(errors,[]);await page.close();console.log('PASS',width,height,'letters, Markdown, full reply, automatic avatar, Agent meters, L1 no-upload submission');
  }
  {
   const page=await browser.newPage({viewport:{width:1440,height:900}});await prepare(page,{restoreHistory:true});await ready(page);
   for(let i=0;i<2;i++){
    await page.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.history_count===6);
    await page.evaluate(()=>document.dispatchEvent(new CustomEvent('emc:route-restore',{cancelable:true,detail:{view:'history'}})));await page.locator('.chat-log').waitFor();
    const labels=await page.locator('.chat-message.assistant header small').allTextContents();
    assert.deepEqual(labels,['AI 副驾','本地规则引导','历史回复 · 来源未记录']);
    assert.equal(await page.evaluate(()=>JSON.parse(render_game_to_text()).chat.reply_source),'history');
    if(i===0)await page.reload();
   }
   await page.close();console.log('PASS restored AI, fallback and unrecorded history labels survive reload');
  }
  if(process.env.EMC_HISTORY_ONLY)return;
  const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));const state=await prepare(page,{guest:true,failAvatar:true});await ready(page);await page.locator('#copilotHistory').click();
  for(let i=0;i<2;i++){await page.locator('#copilotInput').fill('继续帮我完善生意规划，补充成本和需求验证步骤。');await page.locator('#copilotSend').click();await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);}
  await page.waitForFunction(()=>!window.EmcAvatarAgent._state.connecting);assert.equal(await page.evaluate(()=>sdkCalls.created),1);assert.ok((await page.locator('.social-message.theirs').last().innerText()).includes('完整报告结束'));
  assert.ok(state.calls.filter(c=>c.uri==='/api/agent/chat')[1].body.client_context.conversation.some(t=>t.role==='assistant'&&t.text.includes('完整报告结束')));
  assert.ok(await page.locator('.avatar-status').innerText().then(t=>t.includes('重试')));assert.deepEqual(errors,[]);await page.close();console.log('PASS guest long replies, conversation context, one automatic attempt, avatar failure fallback');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
