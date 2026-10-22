'use strict';
const assert=require('node:assert/strict');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.EMC_CHROMIUM_PATH?{executablePath:process.env.EMC_CHROMIUM_PATH,args:['--no-sandbox']}:{})});
  try{
    for(const width of [390,1440]){
      const page=await browser.newPage({viewport:{width,height:width===390?844:900}});
      const errors=[],posts=[];
      page.on('pageerror',error=>errors.push(error.message));
      await page.route('**/*.glb',route=>route.abort());
      await page.route('**/api/**',route=>{
        const url=new URL(route.request().url()).pathname;
        if(url==='/api/agent/chat')posts.push(JSON.parse(route.request().postData()));
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url==='/api/agent/chat'?{reply:'小商已收到你的选品问题',provider:'ai_gateway_live'}:{authenticated:false,items:[],next_cursor:null})});
      });
      await page.goto(process.env.EMC_TEST_ORIGIN||'http://127.0.0.1:5173/?demo=1#view=journey',{waitUntil:'domcontentloaded'});
      await page.locator('[data-demo=begin]').waitFor();
      await page.evaluate(()=>document.getElementById('opening')?.remove());
      const initial=await page.evaluate(()=>({
        main:document.querySelectorAll('#copilotInput').length,
        secondary:document.querySelectorAll('#cpPanel,#cpInput,#cpBody').length,
        settings:document.querySelectorAll('#emcAvatarConfig').length,
        headline:getComputedStyle(document.querySelector('.mail-welcome .mail-correspondence b')).fontSize,
        overflowing:document.querySelector('.mail-page-body').scrollHeight>document.querySelector('.mail-page-body').clientHeight+1
      }));
      assert.equal(initial.main,1);
      assert.equal(initial.secondary,0);
      assert.equal(initial.settings,1);
      assert.equal(initial.overflowing,false);
      assert.ok(Number.parseFloat(initial.headline)>=15);
      await page.locator('#emcAvatarHolo').dispatchEvent('click');
      if(width===390)assert.equal(await page.locator('.copilot-dock').evaluate(el=>el.classList.contains('mobile-chat-open')),true);
      await page.evaluate(()=>window.EmcOpenCompanionChat('如何做选品单',{send:true}));
      await page.waitForFunction(()=>document.querySelector('#socialMessages').textContent.includes('小商已收到你的选品问题'));
      assert.equal(posts.length,1,'同一次提问只发送一次 Agent 请求');
      assert.equal(posts[0].message,'如何做选品单');
      assert.deepEqual(errors,[]);
      await page.close();
      console.log('PASS '+width+'px: 只有一个 Agent 对话、首封信标题可读且无内容溢出');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error.stack||error);process.exit(1);});

