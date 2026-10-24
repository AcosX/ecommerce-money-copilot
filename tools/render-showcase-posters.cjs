// Render the released models, not design concepts, for the lightweight showcase hub.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const{chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const output=path.resolve('assets/models/previews');fs.mkdirSync(output,{recursive:true});
 const browser=await chromium.launch({headless:true,...(process.env.EMC_CHROMIUM?{executablePath:process.env.EMC_CHROMIUM}:{channel:process.env.EMC_BROWSER_CHANNEL||'msedge'})});
 try{for(let level=0;level<=5;level++){
  const page=await browser.newPage({viewport:{width:1200,height:850}});
  await page.goto((process.env.EMC_TEST_URL||'http://127.0.0.1:5173')+'/tools/island-buildings-preview.html?level='+level+'&quality=detail');
  await page.waitForFunction(level=>window.islandBuildingReady===level,level);
  await page.evaluate(()=>{
   document.body.style.background='transparent';for(const selector of ['#model-showcase-nav','#levels','#status','#load-error'])document.querySelector(selector).style.display='none';
   const s=islandBuilding;s.camera.position.set(14.2,9.7,17.2);s.controls.target.set(0,.6,0);s.controls.update();s.render(true);
  });
  const png=await page.screenshot({omitBackground:true}),file=path.join(output,`showcase-level-${level}.webp`);
  execFileSync(process.env.EMC_FFMPEG||'ffmpeg',['-y','-loglevel','error','-i','pipe:0','-c:v','libwebp','-q:v','82','-frames:v','1',file],{input:png});
  console.log(file,fs.statSync(file).size);await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
