'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright'),G=require('../emc-game.js'),S=require('../emc-tutorial-save.js');
const shots=path.join(os.tmpdir(),'emc-npc-checks');fs.mkdirSync(shots,{recursive:true});
const state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const ready=p=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible);
const pause=p=>p.waitForTimeout(300);
async function orbit(p,left=true){const r=await p.locator('#homeCanvas canvas').boundingBox(),x=r.x+r.width*.5,y=r.y+r.height*.68;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+(left?-160:160),y,{steps:10});await p.mouse.up();await pause(p);}
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});let passed=0;
async function scenario(name,run,{width=1440,stage=1,init}={}){const context=await browser.newContext({viewport:{width,height:width<=700?844:1000}}),p=await context.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});if(stage>1){const data=S.createDefault(),game=G.create();game.main=G.MAIN.slice(0,[0,0,2,4,7,12][stage]).map(t=>t.id);data.levels.L1.exercise_result.shop_game_v1=game;await p.addInitScript(({k,v})=>{if(!sessionStorage.seeded){sessionStorage.seeded='1';localStorage.setItem(k,v);}},{k:S.KEY,v:JSON.stringify(data)});}if(init)await p.addInitScript(init);try{await p.goto(process.env.EMC_TEST_URL||'http://127.0.0.1:5173');await ready(p);await run(p);assert.deepEqual(errors,[]);passed++;console.log('PASS '+name);}finally{await context.close();}}
try{
 await scenario('NPC 闲逛、对话停步朝向镜头、一问一答、结束后继续走动与历史恢复',async p=>{
  const start=(await state(p)).npc.position;await p.waitForTimeout(2300);assert.notEqual((await state(p)).npc.position[0],start[0]);
  await p.locator('#copilotInput').fill('下一步做什么');await pause(p);const stopped=await state(p);assert.equal(stopped.npc.talking,true);const expected=Math.atan2(stopped.camera[0]-stopped.npc.position[0],stopped.camera[2]-stopped.npc.position[2]);assert.ok(Math.abs(expected-stopped.npc.heading)<.02);await p.waitForTimeout(600);assert.deepEqual((await state(p)).npc.position,stopped.npc.position);
  await p.locator('#copilotSend').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.history_count===2);assert.equal((await state(p)).xp,0);assert.match((await state(p)).chat.bubble,/认识你的第一位顾客/);assert.equal(await p.locator('#npcReplySource').textContent(),'本地教学演示');await pause(p);await p.screenshot({path:path.join(shots,'desktop-day-conversation.png')});
  await p.locator('#npcContinue').click();await p.waitForTimeout(600);assert.equal((await state(p)).npc.talking,false);assert.notEqual((await state(p)).npc.position[0],stopped.npc.position[0]);await p.locator('#copilotHistory').click();await pause(p);assert.equal(await p.locator('.chat-message').count(),2);await p.screenshot({path:path.join(shots,'desktop-history.png')});await p.reload();await ready(p);await p.locator('#copilotHistory').click();await pause(p);assert.equal(await p.locator('.chat-message').count(),2);
 });
 await scenario('建筑遮挡立即禁聊并隐藏气泡，历史仍可读，转回后恢复',async p=>{
  await p.locator('#copilotInput').fill('怎么装修');await p.locator('#copilotSend').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.history_count===2);
  for(let i=0;i<7&&!(await state(p)).npc.occluded;i++)await orbit(p);
  assert.equal((await state(p)).npc.occluded,true);assert.ok(await p.locator('#copilotInput').isDisabled());assert.ok(await p.locator('#copilotSend').isDisabled());assert.ok(await p.locator('#npcBubble').isHidden());assert.ok(await p.locator('#npcAnchor').isHidden());await p.screenshot({path:path.join(shots,'desktop-building-occlusion.png')});
  await p.evaluate(()=>{document.getElementById('copilotInput').value='被挡住仍尝试发送';document.getElementById('copilotForm').requestSubmit();});assert.equal((await state(p)).chat.history_count,2);
  await p.locator('#copilotHistory').click();await pause(p);assert.equal(await p.locator('.chat-message').count(),2);await p.locator('#closePanel').click();
  for(let i=0;i<8&&!(await state(p)).npc.visible;i++)await orbit(p,false);assert.equal((await state(p)).npc.visible,true);assert.ok(await p.locator('#copilotInput').isEnabled());
 });
 await scenario('真实接口迟到的回复只存历史，不穿过建筑弹出',async p=>{
  await p.locator('#copilotInput').fill('测试消息');await p.locator('#copilotSend').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.sending);
  for(let i=0;i<7&&!(await state(p)).npc.occluded;i++)await orbit(p);assert.equal((await state(p)).npc.occluded,true);
  await p.evaluate(()=>window.replyNpc({text:'接口返回的回复'}));await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);assert.equal((await state(p)).chat.history_count,2);assert.equal((await state(p)).chat.bubble,null);await p.locator('#copilotHistory').click();assert.match(await p.locator('.chat-log').textContent(),/接口返回的回复/);
 },{init:()=>{window.EmcCopilotTransport=()=>new Promise(resolve=>{window.replyNpc=resolve;});}});
 await scenario('主动收起后的迟到回复不重开气泡，返回内容按文本显示',async p=>{
  await p.locator('#copilotInput').fill('测试消息');await p.locator('#copilotSend').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.sending);await p.locator('#closeNpcBubble').click();await p.evaluate(()=>replyNpc({text:'<img src=x onerror=alert(1)> 这是纯文本'}));await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);assert.equal((await state(p)).chat.bubble,null);await p.locator('#copilotHistory').click();assert.equal(await p.locator('.chat-log img').count(),0);assert.match(await p.locator('.chat-log').textContent(),/<img/);
 },{init:()=>{window.EmcCopilotTransport=()=>new Promise(resolve=>{window.replyNpc=resolve;});}});
 await scenario('接口失败保留输入、不会伪造 AI 回复',async p=>{
  await p.locator('#copilotInput').fill('保留这句话');await p.locator('#copilotSend').click();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&JSON.parse(render_game_to_text()).chat.history_count===1);assert.equal(await p.locator('#copilotInput').inputValue(),'保留这句话');assert.equal(await p.locator('#npcReplySource').textContent(),'连接失败');
 },{init:()=>{window.EmcCopilotTransport=async()=>{throw Error('offline')};}});
 for(const stage of [2,3,4,5])await scenario('Lv.'+stage+' NPC 与店铺共处同一场景',async p=>{assert.equal((await state(p)).stage,stage);assert.equal(await p.locator('canvas').count(),1);await p.locator('#copilotInput').fill('怎么升级');await p.locator('#copilotSend').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.history_count===2);await p.screenshot({path:path.join(shots,'npc-stage-'+stage+'.png')});},{stage});
 for(const width of [320,390])await scenario(width+'px 日夜气泡、底部入口、历史以及非阻塞提醒',async p=>{
  await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.bubble!==null,{},{timeout:15000});assert.equal((await state(p)).npc.talking,false);assert.ok(await p.locator('#npcTask').isVisible());await p.screenshot({path:path.join(shots,width+'-reminder.png')});const taskBox=await p.locator('#npcTask').boundingBox();await p.mouse.move(taskBox.x+taskBox.width/2,taskBox.y+taskBox.height/2);await p.locator('#npcTask').click();assert.equal((await state(p)).panel,'quests');assert.equal((await state(p)).xp,0);await p.locator('#closePanel').click();
  for(const mode of ['Day','Night']){await p.locator('#theme'+mode).click();await p.locator('#copilotInput').fill('怎么装修');await p.locator('#copilotSend').click();await p.waitForFunction(()=>!!JSON.parse(render_game_to_text()).chat.bubble&&!JSON.parse(render_game_to_text()).chat.sending);await pause(p);const input=await p.locator('#copilotForm').boundingBox(),bubble=await p.locator('#npcBubble').boundingBox();assert.ok(input.y+input.height<=844);assert.ok(bubble.x>=0&&bubble.x+bubble.width<=width);assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await p.screenshot({path:path.join(shots,width+'-'+mode+'-conversation.png')});await p.locator('#copilotHistory').click();await pause(p);await p.screenshot({path:path.join(shots,width+'-'+mode+'-history.png')});await p.locator('#closePanel').click();}
 },{width});
}finally{await browser.close();}console.log(passed+' NPC browser scenarios passed. Screenshots: '+shots);
})().catch(error=>{console.error(error);process.exitCode=1;});
