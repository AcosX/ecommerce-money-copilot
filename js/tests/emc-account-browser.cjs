'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.EMC_ACCOUNT_TEST_URL||'http://127.0.0.1:5191',shots=path.join(os.tmpdir(),'emc-account-checks');fs.mkdirSync(shots,{recursive:true});
const ready=p=>p.waitForFunction(()=>window.EmcSession?.status()==='ready'&&window.render_game_to_text&&JSON.parse(render_game_to_text()).scene_status==='ready');
(async()=>{const b=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390,320]){
  const c=await b.newContext({viewport:{width,height:width===1440?1000:844}}),p=await c.newPage(),errors=[],logout=[];p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.url().endsWith('/auth/logout'))logout.push(r);});
  await p.goto(base);await ready(p);assert.ok(await p.locator('#emcLoginBtn').isVisible());
  const rectangles=await p.locator('.brand,.top-controls').evaluateAll(es=>es.map(e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right};}));assert.ok(rectangles[0].right<=rectangles[1].left,'Header controls must not overlap the brand at '+width);assert.ok(rectangles[1].right<=width);
  await p.locator('[data-panel="settings"]').click();await p.locator('#shopNameInput').fill('联调小店');await p.locator('#saveName').click();const local=await p.evaluate(()=>localStorage.getItem(EmcTutorialSave.KEY));
  await p.locator('[data-account-action="login"]').click();await p.waitForFunction(()=>window.EmcSession?.isLoggedIn());await ready(p);assert.equal(new URL(p.url()).hash,'#view=settings');assert.ok(await p.locator('#emcLogoutBtn').isVisible());assert.equal(await p.locator('#shopNameInput').inputValue(),'联调小店');assert.ok(await p.locator('.account-email').isVisible());
  await p.screenshot({path:path.join(shots,width+'-signed-in.png')});
  const cookies=await c.cookies();assert.ok(cookies.find(x=>x.name==='emc_session'&&x.httpOnly));const storage=await p.evaluate(()=>({local:Object.keys(localStorage),session:Object.keys(sessionStorage),visible:document.cookie}));assert.ok(!storage.visible.includes('emc_session'));assert.ok(![...storage.local,...storage.session].some(k=>/csrf|token|session/i.test(k)));
  await p.locator('[data-account-action="logout"]').click();await p.waitForFunction(()=>!EmcSession.isLoggedIn());assert.equal(logout.length,1);assert.ok(logout[0].headers()['x-csrf-token']);assert.equal(await p.evaluate(()=>localStorage.getItem(EmcTutorialSave.KEY)),local);assert.ok(await p.locator('#emcLoginBtn').isVisible());assert.deepEqual(errors,[]);
  await p.screenshot({path:path.join(shots,width+'-guest.png')});await c.close();console.log('PASS '+width+'px guest, login return, identity, HttpOnly/CSRF logout, local save retained');
 }
 const c=await b.newContext({viewport:{width:390,height:844}}),p=await c.newPage();let unavailable=true;
 await p.route('**/api/me',r=>unavailable?r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{code:'unavailable',message:'offline'}})}):r.continue());
 await p.goto(base);await p.waitForFunction(()=>EmcSession.status()==='unavailable');await p.locator('[data-panel="settings"]').click();await p.locator('#emcLoginBtn').click();await p.locator('#emcLoginPrompt').waitFor({state:'visible'});assert.equal(await p.locator('.game-shell').getAttribute('inert'),'');
 await p.locator('#emcPromptPrimary').click();await p.waitForFunction(()=>document.querySelector('#emcPromptBody')?.textContent.includes('仍然')); await p.screenshot({path:path.join(shots,'390-service-unavailable.png')});await p.keyboard.press('Escape');assert.ok(await p.locator('#drawer').isVisible());assert.equal(await p.locator('.game-shell').getAttribute('inert'),null);
 unavailable=false;await p.locator('#emcLoginBtn').click();await p.waitForFunction(()=>window.EmcSession?.isLoggedIn());await ready(p);await c.clearCookies();await p.evaluate(()=>EmcSession.getMe({force:true}));assert.ok(await p.locator('#emcLoginBtn').isVisible());
 await p.evaluate(()=>EmcSession.requireLogin('提交认证'));await p.locator('#emcLoginPrompt').waitFor({state:'visible'});assert.ok((await p.locator('#emcPromptBody').innerText()).includes('提交认证'));await p.locator('#emcPromptClose').click();assert.equal(await p.locator('.game-shell').getAttribute('inert'),null);
 await c.close();console.log('PASS unavailable/retry/recovery, modal focus/escape, expired session, restricted action hook');
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
