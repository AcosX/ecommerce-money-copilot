const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
function correlation(a,b){const mean=x=>x.reduce((s,v)=>s+v,0)/x.length,ma=mean(a),mb=mean(b);let xy=0,xx=0,yy=0;for(let i=0;i<a.length;i++){const x=a[i]-ma,y=b[i]-mb;xy+=x*y;xx+=x*x;yy+=y*y;}return xy/Math.sqrt(xx*yy);}
(async()=>{const browser=await chromium.launch({headless:true,channel:'msedge'});try{
 const page=await browser.newPage({viewport:{width:1200,height:900}});await page.goto('http://127.0.0.1:5173/tools/character-preview.html?motion=1');await page.waitForFunction(()=>window.characterPreviewState?.().loaded);
 for(const profile of ['detail','lite']){
  if(profile==='lite'){await page.locator('#lite').click();await page.waitForFunction(()=>characterPreviewState().loaded&&characterPreviewState().profile==='lite');}
  const samples=await page.evaluate(()=>{const rows=[];for(let i=0;i<80;i++){characterInspectMotion('walk',i/80);const j=characterJointProbe(),find=s=>Object.entries(j).find(([k])=>k.endsWith(s))[1];const hands=[find('0_Right_Limb_2'),find('1_Left_Limb_2')].sort((a,b)=>a[2]-b[2]),feet=[find('0_Left_Limb_2'),find('1_Right_Limb_2')].sort((a,b)=>a[2]-b[2]);rows.push({hands,feet});}return rows;});
  // Pair by actual transverse position. Arm and leg bone labels disagree here.
  for(let side=0;side<2;side++){
   const arms=samples.map(r=>r.hands[side][0]),same=samples.map(r=>r.feet[side][0]),opposite=samples.map(r=>r.feet[1-side][0]);
   const sameCorrelation=correlation(arms,same),oppositeCorrelation=correlation(arms,opposite);
   console.log(profile,side,{sameCorrelation,oppositeCorrelation});assert.ok(sameCorrelation<-.8,'Same-side hand and foot must counter-swing');assert.ok(oppositeCorrelation>.8,'Opposite arm and leg advance together');
  }
  for(const phase of [.1,.35,.6,.85]){await page.evaluate(t=>characterInspectMotion('walk',t),phase);await page.waitForTimeout(80);await page.screenshot({path:path.join(os.tmpdir(),`emc-walk-coordination-${profile}-${phase}.png`)});}
 }
 console.log('PASS 两档模型完整步态周期的同侧反摆、对侧协同与连续姿态');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1)});
