/* Real browser acceptance: images, native search, close/reopen and all six forms. */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const {prepare,openChat,nativePosts}=require('./emc-chat-composer-browser.cjs');
const shots=process.env.EMC_SCREENSHOTS||'/tmp/emc-upgrade-shots';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||undefined,args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  for(const [width,height,level] of [[1440,900,1],[1440,900,2],[1440,900,3],[1440,900,4],[1440,900,5],[1440,900,6],[790,700,1],[390,844,1],[320,568,1]]){
   const page=await browser.newPage({viewport:{width,height},reducedMotion:'reduce'}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   const fixture=await prepare(page,{advanced:false,history:false,welcomeFlag:true,completed:level-1});
   await openChat(page,width);
   await page.locator('#closeMobileChat').click();
   assert.equal(await page.locator('.copilot-dock').isVisible(),false);
   assert.equal(await page.locator('#openCompanionChat').isVisible(),true);
   if(width>700){
    const journal=page.locator('#shopJournal');
    if(await journal.isVisible())assert.ok(await journal.evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+Math.min(20,r.height/2)));}),'underlying journal is reachable');
   }
   await page.locator('#openCompanionChat').click();
   assert.equal(await page.locator('.copilot-dock').isVisible(),true);
   assert.ok(await page.locator('#chatPickImage').evaluate(e=>e.scrollWidth<=e.clientWidth),'image label fits its button');
   const encoded=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=240;c.height=160;const x=c.getContext('2d');x.fillStyle='red';x.fillRect(0,0,240,160);return c.toDataURL('image/png').split(',')[1];});
   const png=Buffer.from(encoded,'base64');
   await page.locator('#chatImageFiles').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:png});
   await page.waitForFunction(()=>EmcChatMedia.images().length===1);
   assert.equal(await page.locator('.chat-image-previews img').count(),1);
   await page.getByRole('button',{name:'移除图片 1',exact:true}).click();
   assert.equal(await page.locator('.chat-image-previews img').count(),0);
   await page.locator('#chatImageFiles').setInputFiles({name:'evidence.png',mimeType:'image/png',buffer:png});
   await page.waitForFunction(()=>EmcChatMedia.images().length===1);
   await page.locator('#chatWebSearch').check();
   await page.locator('#copilotSend').click();
   await page.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending);
   const post=nativePosts(fixture).at(-1);
   assert.ok(post,'native turn prepared');
   assert.equal(post.body.images.length,1);
   assert.match(post.body.images[0],/^data:image\/jpeg;base64,/);
   assert.equal(post.body.web_search,true);
   assert.equal(await page.locator('.chat-sent-image').count(),1);
   assert.equal(await page.locator('.chat-image-previews img').count(),0);
   await page.locator('#closeMobileChat').click();
   await page.locator('#continueButton').click();
   await page.locator('[data-j-action="ask"]').waitFor({state:'visible'});
   const ask=page.locator('[data-j-action="ask"]'),deliver=page.locator('[data-j-action="deliver"]');
   assert.equal(await deliver.count(),1);
   assert.equal(await page.locator('.mail-attachment[data-j-action="deliver"]').count(),0);
   await page.evaluate(()=>Promise.allSettled(document.getAnimations().filter(a=>a.effect?.target?.closest?.('#drawer')&&a.effect.getTiming().iterations!==Infinity).map(a=>a.finished)));
   const a=await ask.boundingBox(),d=await deliver.boundingBox();
   assert.ok(d.y>=a.y+a.height-1,'submission follows chat button');
   assert.ok(Math.abs(a.width-d.width)<=1&&Math.abs(a.height-d.height)<=1,'same button dimensions '+JSON.stringify({a,d,level}));
   assert.equal(await deliver.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(242, 207, 99)');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   fs.mkdirSync(shots,{recursive:true});
   await page.screenshot({path:path.join(shots,`${width}-L${level}-submission.png`)});
   await deliver.click();
   await page.locator('#journeyDelivery').waitFor({state:'visible'});
   assert.equal(errors.length,0,errors.join('\n'));
   await page.close();console.log('PASS',width,'L'+level,'close/reopen, image/native search payload, submission placement');
  }
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
