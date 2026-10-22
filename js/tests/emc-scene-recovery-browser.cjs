'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const {webkit}=require('/data/home/work/test-tools/node_modules/playwright');
const fs=require('node:fs'),path=require('node:path');
const browserName=process.env.EMC_BROWSER||'chromium';
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173/';
const policy=fs.readFileSync(path.join(__dirname,'../../deploy/apache/money-acosx.conf.template'),'utf8').match(/Header setifempty Content-Security-Policy "([^"]+)"/)[1];
const state=page=>page.evaluate(()=>({status:JSON.parse(render_game_to_text()).scene_status,source:JSON.parse(render_game_to_text()).model_source,tier:JSON.parse(render_game_to_text()).graphics?.tier,diagnostics:window.EmcSceneDiagnostics||[],hint:document.getElementById('sceneLoadHint').textContent}));
async function withPolicy(page){
 await page.route(url,async r=>{const resp=await r.fetch();await r.fulfill({response:resp,headers:{...resp.headers(),'content-security-policy':policy}})});
}
(async()=>{
 const browser=await (browserName==='webkit'?webkit:chromium).launch({headless:true});
 try{
  for(const width of [1440,390]){
   const page=await browser.newPage({viewport:{width,height:width===390?844:960}});
   await page.addInitScript(()=>{Object.defineProperty(navigator,"hardwareConcurrency",{value:8,configurable:true});Object.defineProperty(navigator,"deviceMemory",{value:16,configurable:true});});
   await withPolicy(page);
   const webOnly='**/*-web.glb*';
   await page.route(webOnly,route=>route.fulfill({status:503,body:'simulate broken high-resolution assets'}));
   await page.goto(url);
   await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='ready',null,{timeout:45000});
   const s=await state(page);
   assert.equal(s.source,'tripo_model');
   assert.equal(s.tier,'smooth');
   assert.ok(s.diagnostics.length>=1,'failure should be diagnosed');
   console.log('PASS',browserName,width,'detailed->lite',s.diagnostics.map(x=>x.code).join(','),'tier='+s.tier);
   await page.close();
  }
  {const page=await browser.newPage({viewport:{width:390,height:844}});
   await withPolicy(page);
   await page.route('**/*.glb*',route=>route.fulfill({status:503,body:'simulate all 3D assets unavailable'}));
   await page.goto(url);
   await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='error',null,{timeout:35000});
   let s=await state(page);
   assert.ok(s.diagnostics.length>=2);
   assert.ok(await page.locator('#bootSkip').isVisible(),'failure should allow skipping 3D');
   await page.locator('#bootSkip').click();
   await page.locator('#opening').waitFor({state:'detached',timeout:5000});
   await page.locator('#continueButton').click();
   await page.locator('#drawer').waitFor({state:'visible',timeout:12000});
   await page.evaluate(()=>document.dispatchEvent(new CustomEvent('emc:session-changed')));
   await page.waitForTimeout(300);
   assert.equal((await state(page)).diagnostics.length,s.diagnostics.length,'skipping 3D stops implicit retries on refresh');
   await page.locator('#closePanel').click();
   await page.unroute('**/*.glb*');
   await page.locator('#retryScene').click();
   await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='ready',null,{timeout:35000});
   console.log('PASS',browserName,'assets blocked -> skip 3D -> tasks -> manual scene retry',s.diagnostics.map(x=>x.code).join(','));
   await page.close();
  }
  {const page=await browser.newPage();
   await withPolicy(page);
   await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(type,...args){return ['webgl','experimental-webgl','webgl2'].includes(type)?null:original.call(this,type,...args)}});
   await page.goto(url);
   await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='error',null,{timeout:35000});
   const s=await state(page);
   assert.equal(s.diagnostics[0].code,'GPU');
   assert.ok(await page.locator('#bootSkip').isVisible());
   await page.locator('#bootSkip').click();
   await page.locator('#opening').waitFor({state:'detached',timeout:5000});
   await page.locator('#continueButton').click();
   await page.locator('#drawer').waitFor({state:'visible',timeout:12000});
   console.log('PASS',browserName,'no WebGL -> skip 3D -> tasks available',s.diagnostics.map(x=>x.code).join(','));
   await page.close();
  }
 }finally{await browser.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});

