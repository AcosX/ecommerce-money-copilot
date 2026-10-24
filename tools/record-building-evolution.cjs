// Record the real continuous demo, including its WebAudio mix. No AI video.
// EMC_PLAYWRIGHT_MODULE / EMC_BROWSER_CHANNEL / EMC_TEST_URL / EMC_VIDEO_OUTPUT
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const{execFileSync}=require('node:child_process');
const{chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
const output=path.resolve(process.env.EMC_VIDEO_OUTPUT||'output/building-evolution/building-evolution.mp4');
(async()=>{
 fs.mkdirSync(path.dirname(output),{recursive:true});const work=fs.mkdtempSync(path.join(os.tmpdir(),'emc-evolution-video-'));
 const browser=await chromium.launch({channel:process.env.EMC_BROWSER_CHANNEL||'msedge',headless:true});
 let video,audio;
 try{
  const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:work,size:{width:1280,height:720}}});
  await context.addInitScript(()=>{
   // Tap only the final mix connected to the speakers, without changing gain.
   const connect=AudioNode.prototype.connect;
   AudioNode.prototype.connect=function(destination,...args){
    const result=connect.call(this,destination,...args);
    if(destination===this.context.destination){
     window.demoAudioCapture??=this.context.createMediaStreamDestination();
     connect.call(this,window.demoAudioCapture);
    }
    return result;
   };
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));video=page.video();
  await page.goto((process.env.EMC_TEST_URL||'http://127.0.0.1:5173')+'/tools/building-evolution.html');
  await page.waitForFunction(()=>window.render_game_to_text&&JSON.parse(render_game_to_text()).phase==='ready');
  await page.waitForTimeout(600);
  const button=await page.locator('#play').boundingBox();await page.mouse.move(button.x+button.width/2,button.y+button.height/2);await page.mouse.down();
  await page.evaluate(()=>{
   window.demoAudioChunks=[];window.demoAudioRecorder=new MediaRecorder(demoAudioCapture.stream,{mimeType:'audio/webm;codecs=opus'});
   demoAudioRecorder.ondataavailable=e=>demoAudioChunks.push(e.data);window.demoAudioStarted=performance.now();demoAudioRecorder.start();
  });
  await page.mouse.up();await page.mouse.move(1260,700);
  await page.waitForFunction(()=>JSON.parse(render_game_to_text()).phase==='complete',null,{timeout:90000});
  await page.waitForTimeout(1500);
  audio=await page.evaluate(()=>new Promise(resolve=>{
   demoAudioRecorder.onstop=async()=>{
    const data=new Uint8Array(await new Blob(demoAudioChunks).arrayBuffer());let text='';
    for(let i=0;i<data.length;i+=32768)text+=String.fromCharCode(...data.subarray(i,i+32768));
    resolve({base64:btoa(text),duration:(performance.now()-demoAudioStarted)/1000});
   };demoAudioRecorder.stop();
  }));
  await page.screenshot({path:output.replace(/\.mp4$/,'.png')});
  if(errors.length)throw Error(errors.join('\n'));
  await context.close();
 }finally{await browser.close();}
 const raw=await video.path(),track=path.join(work,'audio.webm');fs.writeFileSync(track,Buffer.from(audio.base64,'base64'));
 const duration=Number(execFileSync(process.env.EMC_FFPROBE||'ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',raw],{encoding:'utf8'}));
 const lead=Math.max(0,duration-audio.duration),trim=Math.max(0,lead-.8),movieDuration=duration-trim;
 execFileSync(process.env.EMC_FFMPEG||'ffmpeg',['-y','-ss',trim.toFixed(3),'-i',raw,'-itsoffset',(lead-trim).toFixed(3),'-i',track,'-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','medium','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','160k','-movflags','+faststart','-t',movieDuration.toFixed(3),output],{stdio:['ignore','ignore','pipe']});
 fs.writeFileSync(path.join(work,'capture.json'),JSON.stringify({raw,track,lead,trim,movieDuration}));
 console.log(JSON.stringify({output,duration:movieDuration,bytes:fs.statSync(output).size,sourceCapture:work}));
})().catch(e=>{console.error(e);process.exitCode=1});
