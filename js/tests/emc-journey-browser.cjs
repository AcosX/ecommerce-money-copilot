'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright'),J=require('../emc-journey.js');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191',state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const image={name:'my-real-evidence.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=','base64')};
const profile={saved:true,shop_name:'小满杂货铺',partner_name:'小商',category:'家居收纳',platform:'xiaohongshu',agent:'Codex'};
async function mock(p,level,{empty=false,platform=profile.platform}={}){
 const index=J.LEVELS.findIndex(l=>l.id===level),project={id:'prj_owner',name:profile.shop_name,platform,category:profile.category,version:1};
 const store={artifacts:J.LEVELS.slice(0,index).map(l=>({id:'art_'+l.id,project_id:project.id,artifact_type:l.type,title:l.title,origin:'formal',status:'approved',version:1})),verifications:[],calls:[],failSubmission:false,hasProject:!empty};
 await p.addInitScript(v=>localStorage.setItem('emc-journey-entry-v1',JSON.stringify(v)),{...profile,platform});
 await p.route('**/api/**',async r=>{
  const req=r.request(),uri=new URL(req.url()).pathname,method=req.method(),body=method==='GET'?null:uri==='/api/evidence'?null:req.postDataJSON();store.calls.push({uri,method,body,headers:req.headers(),bytes:req.postDataBuffer()?.length||0});let result,status=200;
  if(uri==='/api/me')result={authenticated:true,player:{id:'ply_owner',display_name:'小满'},roles:['player'],csrf_token:'test-csrf'};
  else if(uri==='/api/projects'&&method==='GET')result={items:store.hasProject?[project]:[],next_cursor:null};
  else if(uri==='/api/projects'&&method==='POST'){store.hasProject=true;Object.assign(project,body);status=201;result=project;}
  else if(uri==='/api/artifacts'&&method==='GET')result={items:store.artifacts,next_cursor:null};
  else if(uri==='/api/verifications'&&method==='GET')result={items:store.verifications,next_cursor:null};
  else if(uri==='/api/evidence'){if(store.uploadGate)await store.uploadGate;status=201;result={id:'evd_'+store.calls.filter(c=>c.uri===uri).length,original_filename:image.name};}
  else if(uri==='/api/artifacts'&&method==='POST'){status=201;result={...body,id:'art_new_'+store.artifacts.length,status:'draft',version:1};store.artifacts.unshift(result);}
  else if(uri==='/api/verifications'&&method==='POST'){
   if(store.failSubmission){store.failSubmission=false;status=503;result={error:{code:'unavailable',message:'暂时无法提交，请重试'}};}
   else{status=201;result={...body,id:'ver_'+store.verifications.length,status:'pending',method:'manual',created_at:new Date().toISOString()};store.verifications.unshift(result);store.artifacts.find(a=>a.id===body.artifact_id).status='submitted';}
  }else{status=404;result={error:{code:'not_found',message:'not found'}};}
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 return store;
}
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390])for(const level of J.LEVELS){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const store=await mock(p,level.id);
  await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading&&JSON.parse(render_game_to_text()).journey.project_id);await p.locator('#continueButton').click();await p.locator('#drawer[aria-modal=true]').waitFor();
  assert.equal((await state(p)).panel,'journey');assert.match(await p.locator('#panelBody').innerText(),new RegExp(level.title));assert.equal(await p.locator('.quest-options').count(),0);
  await p.locator('[data-j-action=kit]').click();const ids=J.kitIds(level.id,profile.platform);for(const id of ids)assert.ok(await p.locator('a[download][href$="'+id+'.zip"]').count());
  if(level.id==='L1'&&width===1440){const downloadPromise=p.waitForEvent('download');await p.locator('a[download][href$="category-business-advisor.zip"]').click();const download=await downloadPromise;assert.deepEqual(fs.readFileSync(await download.path()),fs.readFileSync(path.join(__dirname,'../../assets/skills/category-business-advisor.zip')));}
  await p.locator('[data-j-action=deliver]').click();assert.equal((await state(p)).journey.view,'submit');assert.equal(await p.locator('[data-j-files]').count(),level.slots.length);
  if(level.id==='L3'){await p.locator('[data-j-files=before]').setInputFiles(image);await p.locator('[name=confirm]').check();await p.locator('#journeyDelivery button[type=submit]').click();assert.match(await p.locator('.j-message.error').innerText(),/优化后/);assert.equal(store.calls.filter(c=>c.method==='POST').length,0);}
  for(const slot of level.slots.filter(s=>s.required)){if(level.id==='L3'&&slot.id==='before')continue;await p.locator('[data-j-files="'+slot.id+'"]').setInputFiles({...image,name:slot.id+'.png'});}
  await p.locator('[name=notes]').fill('我已按本关要求完成实操，并整理好对应的真实成果。');await p.locator('[name=confirm]').check();
  await p.waitForTimeout(250);await p.screenshot({path:path.join(os.tmpdir(),'emc-delivery-'+level.id+'-'+width+'.png')});if(level.id==='L3')store.failSubmission=true;
  await p.locator('#journeyDelivery button[type=submit]').click();
  if(level.id==='L3'){await p.locator('.j-message.error').waitFor();assert.ok((await state(p)).journey.files.before);assert.ok(await p.locator('[name=confirm]').isChecked());await p.locator('#journeyDelivery button[type=submit]').click();}
  await p.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.status==='pending'&&!JSON.parse(render_game_to_text()).journey.busy);
  assert.equal((await state(p)).journey.completed,J.LEVELS.indexOf(level));assert.equal((await state(p)).xp,J.LEVELS.indexOf(level)*160);assert.equal((await state(p)).feedback.bursts,0);
  const uploads=store.calls.filter(c=>c.uri==='/api/evidence');assert.equal(uploads.length,level.slots.filter(s=>s.required).length);for(const call of uploads){assert.match(call.headers['content-type'],/^multipart\/form-data/);assert.ok(call.bytes>image.buffer.length);assert.equal(call.headers['x-csrf-token'],'test-csrf');assert.ok(call.headers['idempotency-key']);}
  const created=store.calls.find(c=>c.uri==='/api/artifacts'&&c.method==='POST');assert.equal(created.body.artifact_type,level.type);assert.equal(created.body.origin,'formal');assert.deepEqual(created.body.content.evidence_groups.map(g=>g.slot),level.slots.filter(s=>s.required).map(s=>s.id));
  if(level.id==='L3'){assert.equal(store.calls.filter(c=>c.uri==='/api/artifacts'&&c.method==='POST').length,1);const submissions=store.calls.filter(c=>c.uri==='/api/verifications'&&c.method==='POST');assert.equal(submissions[0].headers['idempotency-key'],submissions[1].headers['idempotency-key']);}
  await p.waitForTimeout(250);await p.screenshot({path:path.join(os.tmpdir(),'emc-pending-'+level.id+'-'+width+'.png')});
  store.artifacts[0].status='approved';store.verifications[0].status='approved';await p.locator('[data-j-action=refresh]:visible').first().click();await p.waitForFunction(count=>JSON.parse(render_game_to_text()).journey.completed===count,J.LEVELS.indexOf(level)+1);assert.equal((await state(p)).formal_verification,'not_certified');assert.equal((await state(p)).journey.view,'reward');assert.match(await p.locator('.j-earned-xp').innerText(),/160/);assert.ok(['reward','upgrade'].includes((await state(p)).audio.last_effect));await p.waitForFunction(()=>JSON.parse(render_game_to_text()).feedback.bursts===1);await p.waitForTimeout(300);await p.screenshot({path:path.join(os.tmpdir(),'emc-reward-'+level.id+'-'+width+'.png')});
  if(level.id==='L6'){assert.equal((await state(p)).stage,4);await p.locator('[data-j-action=next]').click();assert.match(await p.locator('#panelBody').innerText(),/首单核验.*尚未开放/);assert.ok(await p.locator('.j-button.primary').isDisabled());await p.locator('[data-j-action=certificate]').click();assert.match(await p.locator('.j-certificate-watermark').innerText(),/未获认证/);assert.equal((await state(p)).formal_verification,'not_certified');await p.waitForTimeout(250);await p.screenshot({path:path.join(os.tmpdir(),'emc-certificate-'+width+'.png')});}
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+width+'px '+level.id+' 独立交付、真实文件上传、待确认/服务端通过；失败重试不重复上传');
 }

 const c=await browser.newContext({viewport:{width:1440,height:1000}}),p=await c.newPage();const store=await mock(p,'L1',{empty:true});
 await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading);await p.locator('#continueButton').click();await p.locator('#drawer[aria-modal=true]').waitFor();await p.locator('[data-j-action=deliver]').click();await p.locator('[data-j-files=report]').setInputFiles(image);await p.locator('[name=notes]').fill('报告附件说明');
 await p.locator('[data-j-action=back]').click();await p.locator('[data-j-action=roadmap]').click();await p.locator('[data-j-level=L2]').click();assert.deepEqual((await state(p)).journey.files,{});await p.locator('[data-j-action=roadmap]').click();await p.locator('[data-j-level=L1]').click();await p.locator('[data-j-action=deliver]').click();assert.equal((await state(p)).journey.files.report,1);assert.equal(await p.locator('[name=notes]').inputValue(),'报告附件说明');
 await p.locator('[name=confirm]').check();let releaseUpload;store.uploadGate=new Promise(resolve=>releaseUpload=resolve);await p.locator('#journeyDelivery button[type=submit]').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.busy);await p.evaluate(()=>EmcSession.getMe({force:true}));releaseUpload();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.status==='pending'&&!JSON.parse(render_game_to_text()).journey.busy);assert.equal(store.calls.filter(c=>c.uri==='/api/projects'&&c.method==='POST').length,1);
 store.artifacts[0].status='rejected';store.verifications[0].status='rejected';store.verifications[0].rejection_reason='请补充类目竞争分析和数据来源';await p.locator('[data-j-action=refresh]:visible').first().click();await p.locator('.j-return-state').waitFor();assert.match(await p.locator('.j-return-state').innerText(),/类目竞争分析和数据来源/);assert.equal((await state(p)).journey.completed,0);await p.locator('[data-j-action=deliver]').click();assert.deepEqual((await state(p)).journey.files,{});
 await p.locator('[data-j-action=back]').click();await p.locator('[data-j-action=supplies]').click();assert.match(await p.locator('#panelBody').innerText(),/我的锦囊/);assert.equal(await p.locator('a[href*=feishu]').count(),0);assert.ok(await p.locator('.j-resource.locked').count());
 await c.close();
 const pc=await browser.newContext(),pp=await pc.newPage();await mock(pp,'L4',{platform:'pinduoduo'});await pp.goto(url);await pp.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).journey.project_id&&!JSON.parse(render_game_to_text()).journey.loading);await pp.locator('#continueButton').click();await pp.locator('[data-j-action=kit]').click();assert.ok(await pp.locator('a[href="https://pdd.91miaoshou.com/"]').count());assert.ok(await pp.locator('a[href*="1tsoft.com"]').count());await pp.locator('[data-j-action=supplies]').click();assert.ok(await pp.locator('a[href*=pdd-keyword-title]').count());assert.equal(await pp.locator('a[href*=xhs-keyword-topic]').count(),0);await pc.close();console.log('PASS 工具入口和锦囊收藏按平台筛选、锁定掉落不可领取');
 console.log('PASS 新项目明确提交才创建、跨关草稿隔离、会话刷新不中断上传、驳回补交');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
