const assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const{chromium}=require(process.env.EMC_PLAYWRIGHT_MODULE||'C:/Users/kagurayami/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
(async()=>{
 const browser=await chromium.launch({channel:process.env.EMC_BROWSER_CHANNEL||'msedge',headless:true});
 try{
  for(const quality of ['detail','smooth']){
   const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.goto((process.env.EMC_TEST_URL||'http://127.0.0.1:5173')+'/tools/island-buildings-preview.html?level=0&quality='+quality);
   await page.waitForFunction(()=>window.islandBuildingReady===0);
   const result=await page.evaluate(async()=>{
    const T=await import('/assets/vendor/three/build/three.module.js'),s=islandBuilding,heights=[];
    for(let x=-2.2;x<=2.2;x+=.2)for(let z=-2.2;z<=2.2;z+=.2)heights.push(s.surfaceHeight(x,z));
    heights.sort((a,b)=>a-b);
    const box=new T.Box3().setFromObject(s.shopModel);let triangles=0,textures=0;
    s.terrain.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;if(o.material.map?.image?.width)textures++;}});
    return{triangles,textures,relief:heights[Math.floor(heights.length*.95)]-heights[Math.floor(heights.length*.05)],clothBase:box.min.y-s.surfaceHeight(0,0),presentable:s.presentable};
   });
   assert.equal(result.presentable,true);
   assert.equal(result.triangles,quality==='detail'?46958:32868);
   assert.ok(result.textures>0,'保留原有 UV 和材质');
   assert.ok(result.relief<.05,'中央经营区保持平整，同时容纳立体草石 '+JSON.stringify(result));
   assert.ok(result.clothBase>-.03&&result.clothBase<.03,'原模型摊布不应埋入地面');
   for(let angle=0;angle<4;angle++){
    await page.evaluate(angle=>{const s=islandBuilding,a=angle*Math.PI/2+Math.PI/4;s.camera.position.set(Math.cos(a)*10,2,Math.sin(a)*10);s.controls.target.set(0,-.3,0);s.controls.update();s.camera.zoom=1.2;s.camera.updateProjectionMatrix();s.render(true);},angle);
    await page.screenshot({path:path.join(os.tmpdir(),`island-rim-${quality}-${angle}.png`)});
   }
   assert.deepEqual(errors,[]);
   console.log('PASS 平整经营区/原布可见/立体草石与岛沿四向近景',quality,result);
   await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
