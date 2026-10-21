'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const url=process.env.EMC_TEST_URL||'http://127.0.0.1:5173',state=p=>p.evaluate(()=>JSON.parse(render_game_to_text()).audio);
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.waitForFunction(()=>window.render_game_to_text);assert.equal((await state(page)).context,'locked');assert.equal((await state(page)).playing,false);
  await page.locator('[data-panel="settings"]').click();await page.waitForFunction(()=>JSON.parse(render_game_to_text()).audio.playing);assert.equal((await state(page)).context,'running');
  await page.locator('[data-audio-toggle="music"]').click();assert.equal((await state(page)).playing,false);assert.equal((await state(page)).music,false);
  const count=(await state(page)).effect_count;await page.locator('[data-audio-toggle="sfx"]').click();await page.locator('[data-theme-option="night"]').click();assert.equal((await state(page)).effect_count,count);
  await page.locator('[data-audio-toggle="sfx"]').click();assert.ok((await state(page)).effect_count>count);await page.locator('#musicVolume').fill('30');assert.equal((await state(page)).musicVolume,.3);
  await page.screenshot({path:path.join(os.tmpdir(),'emc-audio-settings-'+width+'.png')});
  await page.reload();await page.waitForFunction(()=>window.render_game_to_text);let a=await state(page);assert.equal(a.music,false);assert.equal(a.sfx,true);assert.equal(a.musicVolume,.3);assert.equal(a.context,'locked');
  await page.locator('[data-panel="settings"]').click();await page.locator('[data-audio-toggle="music"]').click();await page.waitForFunction(()=>JSON.parse(render_game_to_text()).audio.playing);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{value:true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>JSON.parse(render_game_to_text()).audio.context==='suspended');assert.equal((await state(page)).playing,false);
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>JSON.parse(render_game_to_text()).audio.playing);
  // 实际渲染完整谱面，检查非静音、峰值及结尾包络，保存可试听 WAV。
  if(width===1440){const rendered=await page.evaluate(async()=>{const b=await EmcAudio.preview(),samples=b.getChannelData(0);let peak=0,sum=0;for(const v of samples){peak=Math.max(peak,Math.abs(v));sum+=v*v;}return {samples:Array.from(samples),rate:b.sampleRate,peak,rms:Math.sqrt(sum/samples.length)};});assert.ok(rendered.peak>.02&&rendered.peak<.95);assert.ok(rendered.rms>.005);const n=rendered.samples.length,wav=Buffer.alloc(44+n*2);wav.write('RIFF');wav.writeUInt32LE(36+n*2,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(rendered.rate,24);wav.writeUInt32LE(rendered.rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(n*2,40);rendered.samples.forEach((v,i)=>wav.writeInt16LE(Math.round(Math.max(-1,Math.min(1,v))*32767),44+i*2));fs.writeFileSync(path.join(os.tmpdir(),'emc-island-opening-8bit.wav'),wav);console.log('PASS 原创谱面实际渲染，峰值 '+rendered.peak.toFixed(3)+' / RMS '+rendered.rms.toFixed(3));}
  await page.locator('#closePanel').click();await page.locator('#continueButton').click();const task=require('../emc-game.js').MAIN[0];
  await page.locator('[data-answer="'+((task.answer+1)%task.options.length)+'"]').click();await page.locator('#submitAnswer').click();assert.equal((await state(page)).last_effect,'wrong');
  await page.locator('[data-answer="'+task.answer+'"]').click();await page.locator('#submitAnswer').click();assert.equal((await state(page)).last_effect,'reward');
  assert.deepEqual(errors,[]);await context.close();console.log('PASS '+width+'px 首次交互启音、独立开关/音量、刷新记忆、后台暂停恢复及答题反馈');
 }
 const context=await browser.newContext();await context.addInitScript(()=>{window.AudioContext=undefined;window.webkitAudioContext=undefined;});const page=await context.newPage();await page.goto(url);await page.locator('[data-panel="settings"]').click();assert.equal((await state(page)).available,false);assert.equal(await page.locator('[data-audio-toggle="music"]').isDisabled(),true);await context.close();console.log('PASS 无 WebAudio 时正常游玩');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
