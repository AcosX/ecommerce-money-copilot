'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright'),J=require('../emc-journey.js');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191',state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const image={name:'test-image-fixture.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGNgAAIAAAUAAen63NgAAAAASUVORK5CYII=','base64')};
const profile={saved:true,shop_name:'小满杂货铺',partner_name:'小商',category:'家居收纳',platform:'xiaohongshu',agent:'Codex'};
async function mock(p,level,{empty=false,platform=profile.platform}={}){
 const index=J.LEVELS.findIndex(l=>l.id===level),project={id:'prj_owner',name:profile.shop_name,platform,category:profile.category,version:1};
 const store={artifacts:J.LEVELS.slice(0,index).map(l=>({id:'art_'+l.id,project_id:project.id,artifact_type:l.type,title:l.title,origin:'formal',status:'approved',version:1})),verifications:[],calls:[],failSubmission:false,hasProject:!empty};
 await p.addInitScript(v=>{localStorage.setItem('emc-journey-welcome-v1','1');localStorage.setItem('emc-journey-entry-v1',JSON.stringify(v));},{...profile,platform});
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
   else{status=201;result={...body,id:'ver_'+store.verifications.length,status:'pending',method:'agent_review',created_at:new Date().toISOString()};store.verifications.unshift(result);store.artifacts.find(a=>a.id===body.artifact_id).status='submitted';}
  }else{status=404;result={error:{code:'not_found',message:'not found'}};}
  await r.fulfill({status,contentType:'application/json',body:JSON.stringify(result)});
 });
 return store;
}
// API fixtures here exercise UI contracts; live provider verification is in emc-focus-flow-browser.cjs.
(async()=>{const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});try{
 for(const width of [1440,390])for(const level of J.LEVELS){
  const context=await browser.newContext({viewport:{width,height:900}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));const store=await mock(p,level.id);
  await p.goto(url);await p.waitForFunction(()=>window.render_game_to_text&&!JSON.parse(render_game_to_text()).journey.loading&&JSON.parse(render_game_to_text()).journey.project_id);await p.locator('#opening').waitFor({state:'hidden',timeout:45000});await p.locator('#continueButton').click();await p.locator('.j-focus-card').waitFor();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).mail.opening);
  assert.equal((await state(p)).journey.active,level.id);assert.equal(await p.locator('.j-focus-card .primary:visible').count(),1);assert.equal(await p.locator('.practice-workspace,[data-j-action=kit]:visible').count(),0);
  await p.locator('.j-secondary summary').click();await p.locator('[data-j-action=deliver]').click();
  assert.equal((await state(p)).journey.view,'submit');
  if(level.id==='L3'){await p.locator('[data-j-files=before]').setInputFiles(image);await p.locator('[name=confirm]').check();await p.locator('#journeyDelivery button[type=submit]').click();assert.match(await p.locator('.j-message.error').innerText(),/优化后/);assert.equal(store.calls.filter(c=>c.method==='POST').length,0);}
  for(const slot of level.slots.filter(s=>s.required)){if(level.id==='L3'&&slot.id==='before')continue;await p.locator('[data-j-files="'+slot.id+'"]').setInputFiles({...image,name:slot.id+'.png'});}
  if(level.id==='L4')await p.locator('[name=listing_url]').fill('https://example.com/item/fixture');
  await p.locator('[name=notes]').fill('界面回归夹具：当前成果的事实、来源、限制和下一步验证方法。'.repeat(3));await p.locator('[name=confirm]').check();
  if(level.id==='L3')store.failSubmission=true;
  await p.locator('#journeyDelivery button[type=submit]').click();
  if(level.id==='L3'){await p.locator('.j-message.error').waitFor();assert.ok((await state(p)).journey.files.before);assert.ok(await p.locator('[name=confirm]').isChecked());await p.locator('#journeyDelivery button[type=submit]').click();}
  await p.waitForFunction(()=>JSON.parse(render_game_to_text()).journey.status==='pending'&&!JSON.parse(render_game_to_text()).journey.busy);
  assert.equal((await state(p)).journey.completed,J.LEVELS.indexOf(level));
  const uploads=store.calls.filter(c=>c.uri==='/api/evidence');assert.equal(uploads.length,level.slots.filter(s=>s.required).length);
  for(const call of uploads){assert.match(call.headers['content-type'],/^multipart\/form-data/);assert.equal(call.headers['x-csrf-token'],'test-csrf');assert.ok(call.headers['idempotency-key']);}
  const created=store.calls.find(c=>c.uri==='/api/artifacts'&&c.method==='POST');assert.equal(created.body.artifact_type,level.type);assert.equal(created.body.origin,'formal');assert.deepEqual(created.body.content.evidence_groups.map(g=>g.slot),level.slots.filter(s=>s.required).map(s=>s.id));
  if(level.id==='L4')assert.equal(created.body.content.listing_url,'https://example.com/item/fixture');
  if(level.id==='L3'){assert.equal(store.calls.filter(c=>c.uri==='/api/artifacts'&&c.method==='POST').length,1);const submissions=store.calls.filter(c=>c.uri==='/api/verifications'&&c.method==='POST');assert.equal(submissions[0].headers['idempotency-key'],submissions[1].headers['idempotency-key']);}
  // Later review must update the receipt without changing the user's current level.
  store.artifacts[0].status='approved';store.verifications[0].status='approved';
  await p.locator('.j-secondary summary').click();await p.locator('[data-j-action=refresh]').click();
  await p.waitForFunction(count=>JSON.parse(render_game_to_text()).journey.completed===count,J.LEVELS.indexOf(level)+1);
  assert.equal((await state(p)).journey.active,level.id);assert.equal((await state(p)).journey.view,'task');assert.equal((await state(p)).formal_verification,'not_certified');
  if(level.id==='L6'){await p.locator('[data-j-action=final]').click();assert.match(await p.locator('#panelBody').innerText(),/成果一致性/);assert.equal(await p.locator('.j-certificate').count(),0);}
  assert.deepEqual(errors,[]);await context.close();console.log('PASS fixture regression '+width+'px '+level.id+': one entry, delivery contract, pending, review without focus jump');
 }
}finally{await browser.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
