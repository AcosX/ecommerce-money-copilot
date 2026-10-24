const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),path=require('node:path');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:width===390?'reduce':'no-preference'}),errors=[];let approved=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{localStorage.setItem('emc-journey-welcome-v1','1');localStorage.setItem('emc-journey-entry-v1',JSON.stringify({saved:true,shop_name:'测试小店',partner_name:'小商',category:'家居',platform:'xiaohongshu',agent:'Codex'}));let api;Object.defineProperty(window,'EmcJourneyUI',{get:()=>api,set:value=>{api=value;const create=value.create;value.create=(...args)=>(window.testJourney=create(...args));}});});
  await page.route('**/api/**',async route=>{const uri=new URL(route.request().url()).pathname;let result={items:[],next_cursor:null};if(uri==='/api/me')result={authenticated:true,player:{id:'ply_test',display_name:'测试'},roles:['player'],csrf_token:'fixture'};else if(uri==='/api/projects')result={items:[{id:'prj_test',name:'测试小店',platform:'xiaohongshu',category:'家居',version:1}]};else if(uri==='/api/artifacts')result={items:approved?[{id:'art_test',project_id:'prj_test',artifact_type:'business_plan',status:'approved',title:'规划',origin:'formal',version:1}]:[]};await route.fulfill({json:result});});
  await page.goto(process.env.EMC_TEST_URL||'http://127.0.0.1:8000/');
  await page.waitForFunction(()=>window.testJourney&&!JSON.parse(render_game_to_text()).journey.loading&&JSON.parse(render_game_to_text()).scene_status==='ready',{timeout:120000});
  await page.locator('#continueButton').click();await page.waitForFunction(()=>JSON.parse(render_game_to_text()).panel==='journey');
  approved=true;await page.evaluate(()=>window.testJourney.refresh());
  await page.waitForFunction(()=>JSON.parse(render_game_to_text()).upgrade?.active,{timeout:60000});
  const state=await page.evaluate(()=>({state:JSON.parse(render_game_to_text()),drawer:document.getElementById('drawer').hidden,mask:document.getElementById('missionBackdrop').hidden,flight:document.getElementById('missionFlight').hidden}));
  assert.equal(await page.locator('.copilot-dock').isVisible(),false);assert.equal(state.state.panel,null);assert.equal(state.state.mail.visible,false);assert.equal(state.state.mail.opening,false);assert(state.drawer&&state.mask&&state.flight);assert(state.state.camera[2]>0,'升级前镜头回到房屋正面');
  await page.screenshot({path:path.resolve('backend/var/upgrade-focus-'+width+'.png')});
  await page.waitForFunction(()=>JSON.parse(render_game_to_text()).building_level===1&&!JSON.parse(render_game_to_text()).upgrade,{timeout:30000});
  assert.equal(await page.locator('#drawer').isVisible(),false);assert.equal(await page.locator('.copilot-dock').isVisible(),true);assert.deepEqual(errors,[]);console.log('PASS',width,'关闭信封、镜头聚焦、升级后保持岛屿');await page.close();
 }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

