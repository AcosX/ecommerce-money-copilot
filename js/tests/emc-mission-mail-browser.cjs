const assert=require('node:assert/strict'),os=require('node:os'),path=require('node:path');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173';
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
  for(const [width,reduced] of [[1440,false],[390,false],[320,true]]){
    const page=await browser.newPage({viewport:{width,height:900},reducedMotion:reduced?'reduce':'no-preference'}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({authenticated:false,items:[],next_cursor:null})}));
    await page.goto(url+'/?demo=1#view=island');await page.locator('.quest-peek').waitFor();if(width>700){const nav=await page.locator('.quest-peek').boundingBox(),chat=await page.locator('.copilot-dock').boundingBox();assert.ok(nav.x>width/2);assert.ok(chat.x>width/2&&chat.width>200&&chat.x+chat.width<=width);}
    await page.locator('.quest-peek').click();assert.equal(await page.locator('.mission-list li').count(),7);assert.equal(await page.locator('.j-goal').count(),0);
    await page.locator('#closePanel').click();await page.locator('#continueButton').click();
    if(!reduced){await page.waitForTimeout(180);assert.equal((await page.evaluate(()=>JSON.parse(render_game_to_text()))).mail.opening,true);await page.screenshot({path:path.join(os.tmpdir(),`emc-letter-flight-${width}.png`)});}
    await page.locator('#drawer[aria-modal=true]').waitFor();await page.locator('[data-demo=begin]').click();await page.waitForTimeout(550);
    const rect=await page.locator('#drawer').boundingBox();assert.ok(Math.abs(rect.x+rect.width/2-width/2)<3);assert.ok(rect.y>=0&&rect.y+rect.height<=901);assert.equal(await page.locator('#sideButton').isVisible(),false);
    assert.ok(await page.locator('[data-demo=work]').isVisible());await page.screenshot({path:path.join(os.tmpdir(),`emc-letter-open-${width}.png`)});
    await page.keyboard.press('Escape');assert.equal(await page.locator('#drawer').isVisible(),false);assert.equal(await page.locator('#missionBackdrop').isVisible(),false);
    await page.locator('#continueButton').click();if(!reduced){await page.waitForTimeout(100);await page.keyboard.press('Escape');await page.waitForTimeout(1500);assert.equal(await page.locator('#drawer').isVisible(),false);assert.equal(await page.locator('#continueButton').isEnabled(),true);}
    else{await page.locator('#drawer[aria-modal=true]').waitFor();await page.keyboard.press('Escape');}
    await page.locator('.quest-peek').click();await page.locator('[data-mail-level=L3]').click();await page.locator('#drawer[aria-modal=true]').waitFor();assert.match(await page.locator('#panelBody').innerText(),/让商品图替你说话/);
    await page.locator('[data-demo=work]').click();await page.locator('[data-demo=submit]').click();await page.locator('[data-demo=next]').waitFor();await page.locator('[data-demo=next]').click();assert.match(await page.locator('#panelBody').innerText(),/把商品摆上货架/);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);await page.close();console.log(`PASS ${width}px reduced=${reduced}: 导航、举信飞入、居中拆信、取消、换关与交付`);
  }
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
