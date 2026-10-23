/* Real ASR and Brain under the deployment CSP; no API route mocks. */
'use strict';
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const url=process.env.EMC_TEST_URL, wav=process.env.EMC_ASR_TEST_WAV;
if(!url||!wav)throw new Error('Set isolated EMC_TEST_URL and a local EMC_ASR_TEST_WAV');
const template=fs.readFileSync(path.join(__dirname,'../../deploy/apache/money-acosx.conf.template'),'utf8');
const csp=template.match(/Header setifempty Content-Security-Policy "([^"\n]+)"/)[1];
(async()=>{const b=await chromium.launch({headless:true,executablePath:process.env.EMC_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage','--use-angle=swiftshader','--enable-unsafe-swiftshader','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream','--use-file-for-fake-audio-capture='+wav]});try{
  const p=await b.newPage({viewport:{width:390,height:900}}),errors=[],origins=new Set();let prepared=0,fallback=0;
  await p.addInitScript(()=>{localStorage.setItem('emc-journey-welcome-v1','1');window.audioBytes=0;window.audioMimes=[];const selected=new WeakSet(),add=MediaSource.prototype.addSourceBuffer,append=SourceBuffer.prototype.appendBuffer;MediaSource.prototype.addSourceBuffer=function(type){const buffer=add.call(this,type);audioMimes.push(type);if(type.includes('audio')||type.includes('opus'))selected.add(buffer);return buffer;};SourceBuffer.prototype.appendBuffer=function(value){if(selected.has(this))audioBytes+=value.byteLength;return append.call(this,value);};});
  await p.route(url+'/',async route=>{const response=await route.fetch();await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp,'permissions-policy':'geolocation=(), microphone=(self), camera=()'}});});
  p.on('pageerror',e=>errors.push(e.message));p.on('websocket',ws=>origins.add(new URL(ws.url()).origin));p.on('request',r=>{if(r.method()==='POST'&&/\/web-sessions\/[^/]+\/turns$/.test(new URL(r.url()).pathname))prepared++;if(new URL(r.url()).pathname==='/api/agent/chat')fallback++;});
  await p.goto(url+'/');await p.waitForFunction(()=>window.EmcAvatarAgent&&window.render_game_to_text,{},{timeout:45000});await p.locator('#opening').waitFor({state:'hidden',timeout:45000});
  await p.evaluate(()=>EmcOpenCompanionChat('',{send:false}));await p.evaluate(()=>EmcAvatarAgent.connectXingyunSession());assert.equal(await p.evaluate(()=>EmcAvatarAgent._state.mode),'rtc');
  await p.locator('#emcVoiceInput').click();await p.waitForFunction(()=>document.getElementById('copilotInput').value.includes('语音识别'),{},{timeout:35000});
  assert.equal(prepared,0);assert.equal(fallback,0);assert.equal(await p.evaluate(()=>EmcAvatarAgent._state.recording),false);
  assert.equal(await p.locator('#emcVoiceInput').getAttribute('aria-pressed'),'false');
  await p.locator('#copilotSend').click();await p.waitForFunction(()=>!JSON.parse(render_game_to_text()).chat.sending&&EmcAvatarAgent._state.nativeReplies>=1&&EmcAvatarAgent._state.nativeSpeechStarts>=1,{},{timeout:60000});
  assert.equal(prepared,1);assert.equal(fallback,0);assert.equal(JSON.parse(await p.evaluate(()=>render_game_to_text())).chat.reply_source,'ai');
  await p.waitForFunction(()=>audioBytes>0,{},{timeout:15000}).catch(()=>{});
  assert.ok(await p.evaluate(()=>audioBytes>0),'native reply must deliver actual encoded speech');
  console.log('AUDIO',JSON.stringify(await p.evaluate(()=>({bytes:audioBytes,mimes:audioMimes}))));
  assert.deepEqual(errors,[]);assert.ok(origins.has('wss://e2emp.xingyun3d.com'));
  if(process.env.EMC_SCREENSHOTS){fs.mkdirSync(process.env.EMC_SCREENSHOTS,{recursive:true});await p.screenshot({path:path.join(process.env.EMC_SCREENSHOTS,'voice-csp-390.png')});}
  const grant=await p.evaluate(()=>EmcAvatarAgent._state.grant.id);await p.evaluate(()=>EmcAvatarAgent.disconnect());
  assert.equal((await p.request.get(url+'/api/agent/xingyun/web-sessions/'+grant+'/turns/unused')).status(),409);
  console.log('PASS real native ASR -> same input -> explicit send -> native Brain/speech -> scoped disconnect under deployment CSP');
}finally{await b.close();}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
