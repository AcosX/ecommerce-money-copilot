'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os'),fs=require('node:fs');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173',out=process.env.EMC_CHARACTER_SHOTS||path.join(os.tmpdir(),'emc-island-character');fs.mkdirSync(out,{recursive:true});
const state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()));
const ready=p=>p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).npc?.visible&&JSON.parse(render_game_to_text()).scene_status==='ready',null,{timeout:60000});
async function orbit(p,amount){const r=await p.locator('#homeCanvas canvas').boundingBox(),x=r.x+r.width*.5,y=r.y+r.height*.55;await p.mouse.move(x,y);await p.mouse.down();await p.mouse.move(x+amount,y,{steps:12});await p.mouse.up();await p.waitForTimeout(200);}
(async()=>{const b=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||'msedge'});try{
 for(const width of [1440,390]){
  const c=await b.newContext({viewport:{width,height:width===390?844:1000}}),p=await c.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await p.addInitScript(({lite})=>{Object.defineProperty(navigator,'deviceMemory',{get:()=>lite?2:8});Object.defineProperty(navigator,'hardwareConcurrency',{get:()=>8});window.EmcCopilotTransport=async()=>({text:'先把预算、货源和时间说清楚，我们再选一个方向。'});},{lite:width===390});
  await p.goto(url+'/?demo=1#view=island');await ready(p);await p.locator('#opening').waitFor({state:'hidden'});
  let s=await state(p);assert.equal(s.npc.model,'xiaoshang-animated-v1');assert.equal(s.npc.morphs,26);assert.equal(s.npc.profile,width===390?'lite':'web');assert.equal(await p.locator('canvas').count(),1);assert.equal(s.graphics.tier,width===390?'smooth':'detail');
  await p.waitForTimeout(2400);const walked=await state(p);assert.notDeepEqual(walked.npc.position,s.npc.position);assert.equal(walked.npc.motion,'walk');await p.screenshot({path:path.join(out,width+'-walking.png')});
  await p.locator('#copilotInput').fill('我预算2000元，想先卖收纳用品');await p.waitForTimeout(250);s=await state(p);assert.equal(s.npc.talking,true);const expected=Math.atan2(s.camera[0]-s.npc.position[0],s.camera[2]-s.npc.position[2]);assert.ok(Math.abs(expected-s.npc.heading)<.02);await p.waitForTimeout(500);assert.deepEqual((await state(p)).npc.position,s.npc.position);
  await p.locator('#copilotSend').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).chat.history_count===2);await p.waitForFunction(()=>JSON.parse(render_game_to_text()).npc.motion==='talk');await p.screenshot({path:path.join(out,width+'-conversation.png')});
  for(let i=0;i<8&&!(await state(p)).npc.occluded;i++)await orbit(p,-150);assert.equal((await state(p)).npc.occluded,true);assert.equal(await p.locator('#copilotInput').isDisabled(),true);assert.equal(await p.locator('#npcBubble').isHidden(),true);
  for(let i=0;i<9&&!(await state(p)).npc.visible;i++)await orbit(p,150);await ready(p);
  await p.locator('#themeNight').click();await p.waitForTimeout(200);await p.screenshot({path:path.join(out,width+'-night.png')});await p.locator('#themeDay').click();
  await p.locator('#continueButton').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).npc.holding_letter===true);assert.equal((await state(p)).npc.motion,'letter');await p.waitForFunction(()=>JSON.parse(render_game_to_text()).npc.props.envelopeVisible===true);await p.screenshot({path:path.join(out,width+'-letter.png')});await p.locator('#drawer[aria-modal=true]').waitFor();assert.equal((await state(p)).npc.holding_letter,false);await p.keyboard.press('Escape');await p.waitForTimeout(2800);assert.equal((await state(p)).npc.props.envelopeVisible,false);assert.equal((await state(p)).npc.props.exclamationVisible,false);
  assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await c.close();console.log('PASS '+width+'px: 新模型/LOD/行走/对话停步朝向/遮挡禁聊/日夜/递信与收信');
 }
 const p=await b.newPage();let requests=0;await p.route('**/xiaoshang-animated-v1-*.glb*',r=>{requests++;return r.fulfill({status:503,body:'offline'});});await p.goto(url+'/?demo=1');await p.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='error');assert.equal(requests,2);assert.equal(await p.locator('#homeCanvas').isHidden(),true);await p.unroute('**/xiaoshang-animated-v1-*.glb*');await p.locator('#bootRetry').click();await ready(p);assert.equal((await state(p)).npc.model,'xiaoshang-animated-v1');await p.close();console.log('PASS 角色加载失败不露半成品，重试恢复');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
