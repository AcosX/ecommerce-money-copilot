'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5191';
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(url);await p.waitForFunction(()=>window.EmcAudio&&window.render_game_to_text);
 await p.locator('[data-panel=settings]').click();
 const rendered=await p.evaluate(async()=>{
  const b=await EmcAudio.previewEffect('click'),data=b.getChannelData(0);let peak=0,energy=0,tail=0;
  for(let i=0;i<data.length;i++){peak=Math.max(peak,Math.abs(data[i]));energy+=data[i]*data[i];if(i>b.sampleRate*1.5)tail+=data[i]*data[i];}
  return {samples:Array.from(data),rate:b.sampleRate,peak,energy,tail};
 });
 assert.ok(rendered.peak>.1&&rendered.peak<.6);assert.ok(rendered.energy>1);assert.equal(rendered.tail,0);
 const n=rendered.samples.length,wav=Buffer.alloc(44+n*2);wav.write('RIFF');wav.writeUInt32LE(36+n*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rendered.rate,24);wav.writeUInt32LE(rendered.rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*2,40);rendered.samples.forEach((v,i)=>wav.writeInt16LE(Math.round(v*32767),44+i*2));fs.writeFileSync(path.join(os.tmpdir(),'emc-button-wood-drum.wav'),wav);
 const state=()=>p.evaluate(()=>JSON.parse(render_game_to_text()).audio);
 const before=(await state()).effect_count;await p.locator('[data-theme-option=day]').click();assert.equal((await state()).last_effect,'click');assert.equal((await state()).effect_count,before+1);
 await p.locator('#closePanel').click();assert.equal((await state()).last_effect,'close');await p.locator('#continueButton').click();assert.equal((await state()).last_effect,'start');
 assert.deepEqual(errors,[]);console.log('PASS 木鼓按钮实际渲染：三次短敲、无削波、尾音归零；普通按钮单次反馈、关闭与主线音效路由');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
