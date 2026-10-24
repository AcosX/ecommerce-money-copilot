const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const base=(process.env.EMC_TEST_URL||'http://127.0.0.1:5173').replace(/\/$/,''),shots=process.env.EMC_SCREENSHOTS||os.tmpdir();fs.mkdirSync(shots,{recursive:true});
const config=fs.readFileSync(path.resolve(__dirname,'../../deploy/apache/money-acosx.conf.template'),'utf8'),policy=config.match(/Header setifempty Content-Security-Policy "([^"]+)"/)[1];
async function guarded(page){
 const errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(()=>{window.showcaseCSP=[];document.addEventListener('securitypolicyviolation',e=>showcaseCSP.push(e.violatedDirective+':'+e.blockedURI));});
 await page.route('**/*',async route=>{if(route.request().resourceType()!=='document')return route.continue();const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':policy}});});
 return{errors,requests};
}
const singleReady=(p,level)=>p.waitForFunction(level=>window.buildingReview?.().loaded&&buildingReview().level===level,level);
const demoReady=(p,level)=>p.waitForFunction(level=>window.render_game_to_text&&JSON.parse(render_game_to_text()).phase==='ready'&&JSON.parse(render_game_to_text()).level===level,level);
(async()=>{
 const browser=await chromium.launch({headless:true,...(process.env.EMC_CHROMIUM?{executablePath:process.env.EMC_CHROMIUM}:{channel:process.env.EMC_BROWSER_CHANNEL||'msedge'})});
 try{
  const context=await browser.newContext({viewport:{width:1440,height:900},permissions:['clipboard-read','clipboard-write']});
  const p=await context.newPage(),check=await guarded(p);
  await p.goto(base+'/tools/models.html?level=3&quality=smooth');await p.waitForFunction(()=>document.querySelector('#showcase-poster').naturalWidth>0);
  assert.equal(await p.locator('#showcase-level').inputValue(),'3');await p.screenshot({path:path.join(shots,'showcase-hub-1440.png')});
  await p.locator('#copy-showcase-link').click();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),p.url());
  await p.locator('.showcase-entries [data-showcase=single]').click();await singleReady(p,3);
  assert.ok(check.requests.some(url=>url.includes('level-3-lite.glb')),'单体必须真正使用流畅档资产');
  await p.locator('[data-level="4"]').click();await singleReady(p,4);assert.equal(new URL(p.url()).searchParams.get('level'),'4');
  await p.screenshot({path:path.join(shots,'showcase-single-1440.png')});
  await p.locator('#model-showcase-nav [data-showcase=island]').click();await p.waitForFunction(()=>window.islandBuildingReady===4);
  assert.equal(await p.evaluate(()=>islandBuilding.quality.tier),'smooth');
  await p.locator('#model-showcase-nav [data-showcase=evolution]').click();await demoReady(p,4);
  await p.locator('#play').click();await p.waitForFunction(()=>JSON.parse(render_game_to_text()).phase==='playing'&&JSON.parse(render_game_to_text()).level===0);
  await p.waitForFunction(()=>JSON.parse(render_game_to_text()).level===1);await p.locator('#pause').click();
  await p.locator('#model-showcase-nav [data-showcase=single]').click();await singleReady(p,1);
  assert.equal(new URL(p.url()).searchParams.get('quality'),'smooth');
  await p.locator('#model-showcase-nav select').selectOption('detail');await singleReady(p,1);
  assert.equal(new URL(p.url()).searchParams.get('quality'),'detail');assert.ok(check.requests.some(url=>url.includes('level-1-web.glb')));
  await p.locator('#model-showcase-nav [data-showcase=hub]').click();await p.waitForFunction(()=>document.querySelector('#showcase-level')?.value==='1');assert.equal(await p.locator('#showcase-level').inputValue(),'1');
  await p.goBack();await singleReady(p,1);await p.goForward();await p.waitForFunction(()=>document.querySelector('#showcase-level')?.value==='1');
  assert.deepEqual(check.errors,[]);assert.equal(check.requests.some(url=>/\/api\//.test(url)),false,'展示链路不调用账号或关卡 API');assert.deepEqual(await p.evaluate(()=>showcaseCSP),[]);
  await context.close();console.log('PASS 展示中心→单体DIY→浮岛→连播→返回、等级画质、复制链接、生产CSP与无业务API');
  for(const [width,height]of [[390,844],[320,568]]){
   const p=await browser.newPage({viewport:{width,height}}),check=await guarded(p);
   await p.goto(base+'/tools/models.html?level=5&quality=smooth');await p.waitForFunction(()=>document.querySelector('#showcase-poster').naturalWidth>0);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(shots,`showcase-hub-${width}.png`),fullPage:true});
   await p.locator('.showcase-entries [data-showcase=evolution]').click();await demoReady(p,5);await p.waitForTimeout(400);
   assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await p.screenshot({path:path.join(shots,`showcase-deep-link-${width}.png`)});
   await p.locator('#model-showcase-nav [data-showcase=island]').click();await p.waitForFunction(()=>window.islandBuildingReady===5);
   await p.screenshot({path:path.join(shots,`showcase-island-${width}.png`)});
   assert.deepEqual(check.errors,[]);assert.deepEqual(await p.evaluate(()=>showcaseCSP),[]);await p.close();console.log('PASS 移动端直达与返回',width);
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
