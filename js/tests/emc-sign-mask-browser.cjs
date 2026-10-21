'use strict';
const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'playwright');
(async()=>{const browser=await chromium.launch({headless:true,channel:process.env.EMC_BROWSER_CHANNEL||undefined});try{
 const p=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await p.route('**/sign-mask-proof',r=>r.fulfill({contentType:'text/html',body:'<script type="importmap">{"imports":{"three":"/assets/vendor/three/build/three.module.js","three/addons/":"/assets/vendor/three/examples/jsm/"}}</script><div id="scene" style="position:fixed;inset:0;background:#cce8fb"></div>'}));
 await p.goto('http://127.0.0.1:5173/sign-mask-proof');
 const result=await p.evaluate(async()=>{
  const {ShopScene}=await import('/js/emc-shop-scene.js'),THREE=await import('three');
  const s=new ShopScene(document.querySelector('#scene'),{stage:1,readOnly:true,draft:{wall_color:'#eee0c5',placements:[]},shopName:'神樂閣的小店'});await s.ready;s.presentable=true;cancelAnimationFrame(s.frame);
  s.camera.position.set(3.8,3.3,8);s.controls.target.set(0,2.6,0);s.camera.lookAt(s.controls.target);s.camera.updateMatrixWorld();s.render();
  const capture=()=>{const c=document.createElement('canvas');c.width=1200;c.height=900;const ctx=c.getContext('2d');ctx.drawImage(s.renderer.domElement,0,0,1200,900);return ctx.getImageData(0,0,1200,900).data;};
  const original=capture();s.draft.sign_color='#438b72';s.sync();s.render();const painted=capture();
  let roofSamples=0,roofChanges=0,signChanges=0,oldSpillSamples=0;const roofPixels=[];
  for(let y=370;y<740;y+=8)for(let x=170;x<1030;x+=8){s.rayAt({clientX:x,clientY:y});const hit=s.ray.intersectObject(s.shopModel,true)[0];if(!hit)continue;
   const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld),local=hit.point.clone().applyMatrix4(s.paintUniforms.signMatrix.value),i=(y*1200+x)*4;
   const changed=Math.max(...[0,1,2].map(k=>Math.abs(original[i+k]-painted[i+k])))>3;
   if(hit.point.y>s.paintUniforms.roofY.value&&normal.y>.3&&!(Math.abs(local.x)<1.2&&Math.abs(local.y)<.3&&Math.abs(local.z)<.12)){roofSamples++;roofPixels.push(i);if(changed)roofChanges++;if(Math.abs(local.x)<2.4*.54&&Math.abs(local.y)<.3*.72&&Math.abs(local.z)<.18)oldSpillSamples++;}
   if(s.paintHit({clientX:x,clientY:y})==='sign'&&changed)signChanges++;
  }
  // Green drag previews must obey the same roof exclusion as the final finish.
  s.previewPart('sign');s.render();const preview=capture();let previewRoofChanges=0;
  for(const i of roofPixels)if(Math.max(...[0,1,2].map(k=>Math.abs(original[i+k]-preview[i+k])))>3)previewRoofChanges++;
  s.previewPart(null);s.render();window.proofScene=s;return {roofSamples,roofChanges,signChanges,oldSpillSamples,previewRoofChanges};
 });
 assert.ok(result.roofSamples>100);assert.ok(result.oldSpillSamples>0,'Must exercise roof within the previous oversized sign mask');assert.ok(result.signChanges>10,'The board must still change colour');assert.equal(result.roofChanges,0,'Sign paint must leave roof pixels unchanged');assert.equal(result.previewRoofChanges,0,'Preview must leave roof pixels unchanged');assert.deepEqual(errors,[]);
 await p.screenshot({path:path.join(os.tmpdir(),'emc-sign-mask-verified.png')});console.log('PASS sign finish / green preview do not recolour roof:',result);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
