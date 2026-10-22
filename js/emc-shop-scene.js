import * as THREE from 'three';
import './emc-render-quality.js';
import {acceleratePicking} from './emc-model-performance.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {IslandGuide} from './emc-island-guide.js?v=gait2-20261022-character12';
import {createDecoration} from './emc-decorations.js?v=20261022-perf1';
import {loadSceneManifest,loadTexturedModel} from './emc-model-loader.js?v=20261022-perf1';
// 浮岛模型、配色、背包装饰与向导共用一个场景和画布。
export class ShopScene{
  constructor(container,options){
    this.container=container;this.options=options;this.draft=options.draft;this.items=new Map();this.materials=[];this.disposed=false;this.selected=null;this.drag=null;this.shopName=options.shopName||'我的小店';
    this.quality=globalThis.EmcRenderQuality.choose(options.quality||'auto');this.currentRatio=Math.min(window.devicePixelRatio||1,this.quality.pixelRatio);this.dirty=true;this.framesDrawn=0;this.frameCost=0;this.costSamples=0;
    this.scene=new THREE.Scene();this.root=new THREE.Group();this.scene.add(this.root);
    this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:false});
    this.renderer.setPixelRatio(this.currentRatio);this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.setClearColor(0,0);
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.15;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;this.renderer.shadowMap.autoUpdate=false;
    this.renderer.domElement.setAttribute('aria-label','可旋转的店铺三维场景');this.renderer.domElement.tabIndex=0;container.append(this.renderer.domElement);
    this.camera=new THREE.PerspectiveCamera(34,1,.1,150);this.camera.position.set(13+options.stage,10+options.stage,17+options.stage);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.target.set(0,Math.max(1.7,options.stage*.6),0);this.controls.enableDamping=true;this.controls.addEventListener('change',()=>this.render());this.controls.enablePan=false;this.controls.minDistance=10;this.controls.maxDistance=60;this.controls.minPolarAngle=.25;this.controls.maxPolarAngle=Math.PI*.49;
    this.controls.mouseButtons={LEFT:THREE.MOUSE.ROTATE,MIDDLE:THREE.MOUSE.DOLLY,RIGHT:THREE.MOUSE.ROTATE};this.controls.touches={ONE:THREE.TOUCH.ROTATE,TWO:THREE.TOUCH.DOLLY_ROTATE};
    this.ambient=new THREE.HemisphereLight('#e9f6ff','#655e4b',2.6);this.scene.add(this.ambient);
    this.sun=new THREE.DirectionalLight('#fff1d2',3.5);this.sun.position.set(-5,12,9);this.sun.castShadow=true;this.sun.shadow.mapSize.set(this.quality.shadowSize,this.quality.shadowSize);Object.assign(this.sun.shadow.camera,{left:-9,right:9,top:12,bottom:-7,near:.5,far:45});this.sun.shadow.bias=-.0004;this.sun.shadow.normalBias=.025;this.scene.add(this.sun);
    this.fill=new THREE.DirectionalLight('#a5c8ff',1);this.fill.position.set(7,4,-8);this.scene.add(this.fill);
    this.windowMaterial=new THREE.MeshStandardMaterial({color:'#779fa9',roughness:.4,metalness:.05});this.materials.push(this.windowMaterial);
    this.wallMaterial=new THREE.MeshStandardMaterial({color:this.draft.wall_color,roughness:1,flatShading:true});this.materials.push(this.wallMaterial);
    this.paintUniforms={wall:{value:new THREE.Color(1,1,1)},sign:{value:new THREE.Color('#9c531e')},roof:{value:new THREE.Color('#bd3f23')},preview:{value:0},signStrength:{value:0},roofStrength:{value:0},signMatrix:{value:new THREE.Matrix4()},signSize:{value:new THREE.Vector2()},signBack:{value:-.06},roofY:{value:100}};
    this.textureStatus={shop:0,island:0};this.loadController=new AbortController();this.source='procedural_base';this.canPaint=true;this.paintMaterials=[this.wallMaterial];
    this.buildBase();this.baseIslandObjects=[...this.root.children];const baseObjects=new Set(this.root.children);this.buildShop(options.stage);this.baseShopObjects=this.root.children.filter(obj=>!baseObjects.has(obj));this.decorRoot=new THREE.Group();this.root.add(this.decorRoot);
    this.selection=new THREE.BoxHelper(new THREE.Object3D(),0x51d9be);this.selection.visible=false;this.scene.add(this.selection);
    this.ray=new THREE.Raycaster();this.ray.firstHitOnly=true;this.pointer=new THREE.Vector2();this.dragPlane=new THREE.Plane(new THREE.Vector3(0,1,0),0);this.hit=new THREE.Vector3();
    this.boundDown=e=>this.down(e);this.boundMove=e=>this.move(e);this.boundUp=e=>this.up(e);
    const canvas=this.renderer.domElement;canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();if(!this.disposed)this.options.onContextLost?.();});if(!options.readOnly){canvas.addEventListener('pointerdown',this.boundDown,true);canvas.addEventListener('pointermove',this.boundMove,true);canvas.addEventListener('pointerup',this.boundUp,true);canvas.addEventListener('pointercancel',this.boundUp,true);}
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(container);if(options.framingElement)this.resizeObserver.observe(options.framingElement);
    this.sync();this.setNight(options.night);if(options.atmosphere)this.setAtmosphere(options.atmosphere);this.resize();this.loop();this.ready=this.loadReviewedModel(options.stage);
  }
  async loadReviewedModel(stage){
    let pendingShop=null,pendingIsland=null;
    try{
      this.options.onLoadProgress?.({phase:'manifest'});
      const manifest=await loadSceneManifest(this.loadController.signal),entry=manifest.shops?.[String(stage)];if(this.disposed)return;if(!entry?.model_url||!manifest.island?.model_url)throw new Error('当前等级的模型清单不完整');
      const assets=await Promise.allSettled([loadTexturedModel(this.quality.lite&&entry.lite?.model_url||entry.model_url,{signal:this.loadController.signal,onProgress:p=>this.options.onLoadProgress?.({phase:'shop',...p})}),loadTexturedModel(this.quality.lite&&manifest.island.lite?.model_url||manifest.island.model_url,{signal:this.loadController.signal,onProgress:p=>this.options.onLoadProgress?.({phase:'island',...p})})]);
      const failed=assets.find(result=>result.status==='rejected');
      if(this.disposed||failed){assets.forEach(result=>{if(result.status==='fulfilled')disposeAsset(result.value.scene);});if(failed)throw failed.reason;return;}
      const model=pendingShop=assets[0].value,island=pendingIsland=assets[1].value;
      acceleratePicking(model.scene);acceleratePicking(island.scene);
      const box=new THREE.Box3().setFromObject(model.scene),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      const scale=4.4/Math.max(size.x,size.z);model.scene.position.set(-center.x,-box.min.y,-center.z);const group=new THREE.Group();group.add(model.scene);group.scale.setScalar(scale);group.rotation.y=entry.rotation_y||0;
      this.textureStatus.shop=countTexturedMeshes(model.scene);
      this.paintMaterials=[];model.scene.traverse(obj=>{if(!obj.isMesh)return;obj.castShadow=true;obj.receiveShadow=true;const list=Array.isArray(obj.material)?obj.material:[obj.material];list.forEach(mat=>{this.materials.push(mat);if(entry.wall_mask==='cream'){installPartTint(mat,this.paintUniforms);this.paintMaterials.push(mat);}else if(entry.wall_materials?.includes(mat.name))this.paintMaterials.push(mat);});});
      if(manifest.island?.model_url){

        this.textureStatus.island=countTexturedMeshes(island.scene);
        const bounds=new THREE.Box3().setFromObject(island.scene),dimensions=bounds.getSize(new THREE.Vector3()),mid=bounds.getCenter(new THREE.Vector3()),islandScale=11.4/Math.max(dimensions.x,dimensions.z);
        island.scene.position.set(-mid.x,-(bounds.min.y+dimensions.y*(manifest.island.surface_ratio??.9)),-mid.z);const islandGroup=new THREE.Group();islandGroup.add(island.scene);islandGroup.scale.setScalar(islandScale);islandGroup.rotation.y=manifest.island.rotation_y||0;this.root.add(islandGroup);pendingIsland=null;this.terrain=islandGroup;this.baseIslandObjects.forEach(obj=>{this.root.remove(obj);disposeGeometry(obj);});this.baseIslandObjects=[];island.scene.traverse(obj=>{if(obj.isMesh){obj.receiveShadow=true;obj.castShadow=false;(Array.isArray(obj.material)?obj.material:[obj.material]).forEach(mat=>this.materials.push(mat));}});
      }
      this.baseShopObjects.forEach(obj=>{this.root.remove(obj);disposeGeometry(obj);});this.baseShopObjects=[];this.root.add(group);pendingShop=null;this.shopModel=group;this.seatShop(group);this.roofHeight=group.position.y+size.y*scale*(entry.roof_ratio||1);this.createShopSign(group,entry.sign,size.y*scale);this.paintUniforms.roofY.value=group.position.y+size.y*scale*([0,.55,.67,.67,.82,.90][stage]);this.source='tripo_model';this.guide=new IslandGuide(this);await this.guide.ready;if(this.disposed)return;this.canPaint=this.paintMaterials.length>0;this.sync();this.options.onModelLoaded?.(this.canPaint);
    }catch(error){if(pendingIsland)disposeAsset(pendingIsland.scene);if(pendingShop)disposeAsset(pendingShop.scene);if(!this.disposed){this.options.onModelError?.(error);throw error;}}
  }
  createShopSign(shop,anchor,height){
    if(!anchor)return;
    const y=shop.position.y+height*anchor.height_ratio,probe=new THREE.Raycaster();
    // 生成模型的牌面可能倾斜；用牌面中心的真实法线贴字，避免侧视时产生视差和穿插。
    shop.updateMatrixWorld(true);
    probe.set(new THREE.Vector3(anchor.x||0,y,10),new THREE.Vector3(0,0,-1));
    const hit=probe.intersectObject(shop,true)[0];if(!hit)return;
    const normal=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    if(normal.z<0)normal.negate();
    this.signCanvas=document.createElement('canvas');this.signCanvas.width=2048;this.signCanvas.height=Math.round(2048*anchor.height/anchor.width);
    this.signTexture=new THREE.CanvasTexture(this.signCanvas);this.signTexture.colorSpace=THREE.SRGBColorSpace;this.signTexture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
    const material=new THREE.MeshBasicMaterial({map:this.signTexture,transparent:true,alphaTest:.02,depthWrite:false,toneMapped:false});this.materials.push(material);
    this.shopSign=new THREE.Mesh(new THREE.PlaneGeometry(anchor.width,anchor.height),material);this.shopSign.position.copy(hit.point).addScaledVector(normal,anchor.depth_offset??.018);this.shopSign.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);this.root.add(this.shopSign);if(anchor.rebuild)this.rebuildSign(anchor.rebuild,anchor.x||0,y);this.shopSign.updateMatrixWorld(true);this.paintUniforms.signMatrix.value.copy(this.shopSign.matrixWorld).invert();this.paintUniforms.signBack.value=anchor.paint_back_depth??-.06;this.paintUniforms.signSize.value.set(this.signBoard?0:anchor.width*.49,this.signBoard?0:anchor.height*1.16);this.drawShopName();
  }
  rebuildSign(spec,x,y){
    // 第四级生成牌面有歪斜，用独立的水平木牌覆盖；边框与店名共用一个基准。
    const board=this.signBoard=new THREE.Group();board.position.set(x,y,spec.depth);this.root.add(board);
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=128;const ctx=canvas.getContext('2d');ctx.fillStyle='#d5d0c6';ctx.fillRect(0,0,512,128);
    for(let i=0;i<13;i++){ctx.strokeStyle=i%2?'#b4ada023':'#ffffff15';ctx.lineWidth=i%3+1;ctx.beginPath();ctx.moveTo(0,i*10.7);ctx.bezierCurveTo(140,i*10.7+Math.sin(i)*4,360,i*10.7-3,512,i*10.7+Math.sin(i)*3);ctx.stroke();}
    const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;
    this.signBoardMaterial=new THREE.MeshStandardMaterial({map,color:'#c18a46',roughness:1});this.materials.push(this.signBoardMaterial);
    const backing=this.box(board,[spec.width,spec.height,.12],[0,0,0],'#70472d');backing.userData.paintPart='sign';
    const face=this.box(board,[spec.width-.12,spec.height-.12,.04],[0,0,.075],this.signBoardMaterial);face.userData.paintPart='sign';
    const frame=this.mat('#915c32');
    this.signBoardWood=[{material:backing.material,base:'#70472d',shade:.65},{material:this.signBoardMaterial,base:'#c18a46',shade:1},{material:frame,base:'#915c32',shade:.8}];
    for(const sy of [-1,1]){const rail=this.box(board,[spec.width,.065,.055],[0,sy*(spec.height-.065)/2,.085],frame);rail.userData.paintPart='sign';}
    for(const sx of [-1,1]){const rail=this.box(board,[.065,spec.height,.055],[sx*(spec.width-.065)/2,0,.085],frame);rail.userData.paintPart='sign';}
    const metal=this.mat('#625f55');
    for(const sx of [-1,1])for(const sy of [-1,1]){const bolt=this.cylinder(board,.021,.021,.025,6,[sx*(spec.width/2-.075),sy*(spec.height/2-.075),.12],metal);bolt.rotation.x=Math.PI/2;bolt.userData.paintPart='sign';}
    this.shopSign.position.set(x,y,spec.depth+.105);this.shopSign.quaternion.identity();
  }
  drawShopName(){
    if(!this.signCanvas)return;
    const canvas=this.signCanvas,context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);
    let fontSize=Math.floor(canvas.height*.76);
    const font=()=>`700 ${fontSize}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
    context.font=font();while(context.measureText(this.shopName).width>canvas.width*.92&&fontSize>12){fontSize--;context.font=font();}
    context.textAlign='center';context.textBaseline='middle';context.lineJoin='round';context.strokeStyle='#513221';context.lineWidth=Math.max(2,fontSize*.045);context.fillStyle='#fff0c4';
    context.strokeText(this.shopName,canvas.width/2,canvas.height/2);context.fillText(this.shopName,canvas.width/2,canvas.height/2);this.signFits=context.measureText(this.shopName).width<=canvas.width*.92;this.signTexture.needsUpdate=true;this.render();
  }
  setShopName(name){const next=String(name||'我的小店');if(next===this.shopName)return;this.shopName=next;this.drawShopName();}
  surfaceHeight(x,z){
    if(!this.terrain)return 0;
    const key=x.toFixed(4)+':'+z.toFixed(4);this.surfaceCache??=new Map();
    if(this.surfaceCache.has(key))return this.surfaceCache.get(key);
    this.terrain.updateMatrixWorld(true);
    this.surfaceProbe??=new THREE.Raycaster();this.surfaceProbe.firstHitOnly=true;this.surfaceProbe.set(new THREE.Vector3(x,30,z),new THREE.Vector3(0,-1,0));
    const height=this.surfaceProbe.intersectObject(this.terrain,true)[0]?.point.y??0;
    if(this.surfaceCache.size>=512)this.surfaceCache.clear();this.surfaceCache.set(key,height);return height;
  }
  seatShop(shop){
    if(!this.terrain)return;
    shop.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(shop),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()),clearances=[];
    const probe=new THREE.Raycaster(),up=new THREE.Vector3(0,1,0);
    // 从地基下方向上采样，避开屋檐等悬挑部分；模型包围盒最低点不代表整圈地基。
    for(const u of [-.85,-.45,0,.45,.85])for(const v of [-.85,-.45,0,.45,.85]){
      const x=center.x+size.x*.5*u,z=center.z+size.z*.5*v;
      probe.set(new THREE.Vector3(x,bounds.min.y-1,z),up);
      const bottom=probe.intersectObject(shop,true)[0]?.point.y;
      if(bottom===undefined||bottom>bounds.min.y+Math.min(.4,size.y*.15))continue;
      clearances.push(bottom-this.surfaceHeight(x,z));
    }
    if(!clearances.length)return;
    const offset=-Math.max(...clearances)-.025;
    shop.position.y+=offset;shop.updateMatrixWorld(true);
    this.grounding={offset,samples:clearances.length,min_clearance:Math.min(...clearances)+offset,max_clearance:Math.max(...clearances)+offset};
  }
  mat(color){const m=new THREE.MeshStandardMaterial({color,roughness:.9,flatShading:true});this.materials.push(m);return m;}
  box(parent,size,pos,material){const mesh=new THREE.Mesh(new THREE.BoxGeometry(...size),typeof material==='string'?this.mat(material):material);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  cylinder(parent,r1,r2,h,sides,pos,material){const mesh=new THREE.Mesh(new THREE.CylinderGeometry(r1,r2,h,sides),typeof material==='string'?this.mat(material):material);mesh.position.set(...pos);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  buildBase(){
    const stone=this.mat('#70777a'),grass=this.mat('#8baf72'),pave=this.mat('#c5bd9e');
    const cone=this.cylinder(this.root,5.6,.45,4.2,8,[0,-2.65,0],stone);cone.rotation.y=Math.PI/8;
    this.cylinder(this.root,5.7,5.5,.55,8,[0,-.32,0],grass);
    this.cylinder(this.root,4.5,4.5,.07,8,[0,-.01,0],pave);
    for(let i=0;i<18;i++){
      const a=i*2.4,r=4.8-(i%3)*.35,y=-.6-(i%4)*.55;
      const rock=this.box(this.root,[.65+(i%2)*.35,.6,.7],[Math.cos(a)*r,y,Math.sin(a)*r],i%3===0?'#8b947f':'#828789');rock.rotation.y=a;
    }
    const path=this.mat('#d9cfb5');for(let z=2;z<4.7;z+=.6)this.box(this.root,[1.1,.07,.48],[0,.04,z],path);
  }
  buildShop(stage){
    const floors=stage,wood=this.mat('#6e4935'),trim=this.mat('#e9ddc3'),roof=this.mat('#ba5a45'),sage=this.mat('#659178');
    const floorHeight=1.65;this.roofHeight=floors*floorHeight+.45;
    this.box(this.root,[4.4,floors*floorHeight,3.6],[0,floors*floorHeight/2,0],this.wallMaterial);
    for(let floor=0;floor<floors;floor++){
      const y=floor*floorHeight;
      this.box(this.root,[4.55,.13,3.73],[0,y+.08,0],trim);
      for(const x of [-1.45,0,1.45]){
        if(floor===0&&x===0){this.box(this.root,[.94,1.3,.1],[0,.72,1.86],wood);this.box(this.root,[.72,1.1,.04],[0,.78,1.93],this.windowMaterial);continue;}
        this.box(this.root,[floor===0?1.05:.75,.98,.12],[x,y+.85,1.87],wood);this.box(this.root,[floor===0?.85:.57,.78,.06],[x,y+.86,1.95],this.windowMaterial);
        this.box(this.root,[.07,.83,.06],[x,y+.86,1.995],trim);
      }
      for(const z of [-.9,.85]){
        this.box(this.root,[.12,.98,.8],[2.25,y+.85,z],wood);this.box(this.root,[.04,.78,.62],[2.33,y+.86,z],this.windowMaterial);
      }
    }
    for(const x of [-2.16,2.16])this.box(this.root,[.17,floors*floorHeight,.15],[x,floors*floorHeight/2,1.87],trim);
    this.box(this.root,[3.8,.43,.15],[0,1.48,2.04],wood);
    // 遮棚分条，墙体使用独立材质，因此换色不会污染门窗和屋顶。
    for(let i=0;i<10;i++){const awn=this.box(this.root,[.43,.11,.95],[-1.94+i*.43,1.34,2.22],i%2===0?sage:trim);awn.rotation.x=.23;this.box(this.root,[.43,.21,.09],[-1.94+i*.43,1.13,2.67],i%2===0?sage:trim);}
    if(stage<3){
      const shape=new THREE.Shape();shape.moveTo(-2.45,0);shape.lineTo(0,.95);shape.lineTo(2.45,0);shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:4,bevelEnabled:false});const mesh=new THREE.Mesh(geo,roof);mesh.position.set(0,floors*floorHeight,-2);this.root.add(mesh);this.roofHeight=floors*floorHeight+1;
    }else{
      this.box(this.root,[4.8,.18,3.95],[0,floors*floorHeight+.07,0],roof);
      for(const x of [-2.25,2.25])this.box(this.root,[.18,.35,3.8],[x,floors*floorHeight+.3,0],trim);
      for(const z of [-1.8,1.8])this.box(this.root,[4.5,.35,.18],[0,floors*floorHeight+.3,z],trim);
    }
    // 门前灯和暖光窗户随日夜切换，使用同一套几何。
    const lamp=new THREE.PointLight('#ffcd79',0,9,2);lamp.position.set(0,1.5,3);this.scene.add(lamp);this.lamp=lamp;
  }
  makeDecoration(id){return createDecoration(this,id);}
  sync(){
    const c=new THREE.Color(this.draft.wall_color),base=new THREE.Color('#eee0c5');this.paintUniforms.wall.value.setRGB(c.r/base.r,c.g/base.g,c.b/base.b);
    this.paintUniforms.sign.value.set(this.draft.sign_color||'#9c531e');this.paintUniforms.roof.value.set(this.draft.roof_color||'#bd3f23');this.paintUniforms.signStrength.value=this.draft.sign_color&&this.draft.sign_color!=='#9c531e'?1:0;this.paintUniforms.roofStrength.value=this.draft.roof_color&&this.draft.roof_color!=='#bd3f23'?1:0;
    this.wallMaterial.color.set(this.draft.wall_color);for(const part of this.signBoardWood||[]){const tinted=this.paintUniforms.signStrength.value>0;part.material.color.set(tinted?this.draft.sign_color:part.base);if(tinted)part.material.color.multiplyScalar(part.shade);if(this.previewPartName==='sign')part.material.color.lerp(new THREE.Color('#38e77d'),.55);}
    for(const [id,obj] of this.items){if(!this.draft.placements.some(p=>p.id===id)){this.decorRoot.remove(obj);disposeGeometry(obj);this.items.delete(id);}}
    for(const p of this.draft.placements){let obj=this.items.get(p.id);if(!obj){obj=this.makeDecoration(p.id);this.items.set(p.id,obj);this.decorRoot.add(obj);}obj.position.set(p.x,p.y+(p.anchor==='roof'?this.roofHeight:this.surfaceHeight(p.x,p.z)),p.z);obj.rotation.y=p.rotation;}
    if(this.selected&&!this.items.has(this.selected))this.selected=null;
    this.selection.visible=!!this.selected;if(this.selected)this.selection.setFromObject(this.items.get(this.selected));this.renderer.shadowMap.needsUpdate=true;this.render();
  }
  previewPart(part){if((this.previewPartName||null)===(part||null))return;this.previewPartName=part||null;this.paintUniforms.preview.value=({wall:1,sign:2,roof:3})[part]||0;this.sync();}
  paintHit(e){
    if(!this.presentable||!this.shopModel)return null;
    this.rayAt(e);const hit=this.ray.intersectObjects([this.shopModel,...(this.signBoard?[this.signBoard]:[])],true)[0];if(!hit)return null;if(hit.object.userData.paintPart)return hit.object.userData.paintPart;
    const mat=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material,map=mat.map;if(!map||!hit.uv)return null;
    this.texturePixels??=new Map();let pixels=this.texturePixels.get(map);
    if(!pixels){const canvas=document.createElement('canvas');canvas.width=map.image.width;canvas.height=map.image.height;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(map.image,0,0);pixels={data:ctx.getImageData(0,0,canvas.width,canvas.height).data,width:canvas.width,height:canvas.height};this.texturePixels.set(map,pixels);}
    const uv=map.transformUv(hit.uv.clone()),i=(Math.min(pixels.height-1,Math.max(0,Math.floor(uv.y*pixels.height)))*pixels.width+Math.min(pixels.width-1,Math.max(0,Math.floor(uv.x*pixels.width))))*4;
    const r=pixels.data[i]/255,g=pixels.data[i+1]/255,b=pixels.data[i+2]/255,hi=Math.max(r,g,b),lo=Math.min(r,g,b),local=hit.point.clone().applyMatrix4(this.paintUniforms.signMatrix.value),size=this.paintUniforms.signSize.value;
    // 整块牌面与边框共用紧贴正面的空间范围，避开后方屋檐。
    if(Math.abs(local.x)<size.x&&Math.abs(local.y)<size.y&&local.z>this.paintUniforms.signBack.value&&local.z<.16&&r>g*1.15&&g>b*1.3)return 'sign';
    if(hit.point.y>this.paintUniforms.roofY.value&&r>Math.max(g,b)*1.35)return 'roof';
    if((hi-lo)/Math.max(hi,.001)<.58&&hi>.25&&r>=b*.85)return 'wall';
    return null;
  }
  paintTargets(){
    if(!this.shopModel)return [];
    const rect=this.renderer.domElement.getBoundingClientRect(),out=[];
    // 提供可见表面的屏幕坐标，供键盘辅助与交互回归验证使用。
    for(let y=rect.top+rect.height*.22;y<rect.top+rect.height*.85;y+=10)for(let x=rect.left+rect.width*.25;x<rect.left+rect.width*.75;x+=10){const part=this.paintHit({clientX:x,clientY:y});if(part&&!out.some(t=>t.part===part))out.push({part,x,y});if(out.length===3)return out;}
    return out;
  }
  decorDrop(e,id){
    if(!this.presentable||!this.terrain)return null;
    this.rayAt(e);const hit=this.ray.intersectObjects([this.shopModel,this.terrain],true)[0];if(!hit||Math.abs(hit.point.x)>4||Math.abs(hit.point.z)>3.5)return null;
    const normal=hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize();
    let node=hit.object,onShop=false;while(node){if(node===this.shopModel)onShop=true;node=node.parent;}
    if(normal.y<.35&&id!=='ramen')return null;
    const roof=onShop&&normal.y>.35,ground=this.surfaceHeight(hit.point.x,hit.point.z);
    return {anchor:roof?'roof':'ground',x:hit.point.x,z:hit.point.z,y:roof?Math.max(-3,Math.min(12,hit.point.y-this.roofHeight+.04)):Math.max(0,Math.min(12,hit.point.y-ground+.04)),rotation:id==='ramen'&&normal.y<.35?Math.atan2(normal.x,normal.z):0};
  }
  decorTargets(id){
    const rect=this.renderer.domElement.getBoundingClientRect(),out=[];
    for(const [x,z,y] of [[0,0,this.roofHeight-.4],[1,0,this.roofHeight-.4],[-1,0,this.roofHeight-.4],[-2.8,3,this.surfaceHeight(-2.8,3)+.1],[0,3.3,this.surfaceHeight(0,3.3)+.1],[3,2.8,this.surfaceHeight(3,2.8)+.1]]){
      const screen=new THREE.Vector3(x,y,z).project(this.camera),point={x:rect.left+(screen.x+1)*rect.width/2,y:rect.top+(1-screen.y)*rect.height/2},placement=this.decorDrop({clientX:point.x,clientY:point.y},id);if(placement&&!out.some(t=>t.anchor===placement.anchor))out.push({...point,anchor:placement.anchor});
    }
    return out;
  }
  previewDecoration(id,placement){
    if(!this.decorPreview){const start=this.materials.length;this.decorPreview=this.makeDecoration(id);this.decorPreviewMaterials=this.materials.slice(start);this.decorPreview.traverse(o=>{if(o.isMesh){o.material.transparent=true;o.material.opacity=.60;o.material.depthWrite=false;}});this.root.add(this.decorPreview);this.decorPreviewBox=new THREE.BoxHelper(this.decorPreview,0x37d972);this.root.add(this.decorPreviewBox);}
    this.decorPreview.position.set(placement.x,placement.y+(placement.anchor==='roof'?this.roofHeight:this.surfaceHeight(placement.x,placement.z)),placement.z);this.decorPreview.rotation.y=placement.rotation;this.decorPreviewBox.setFromObject(this.decorPreview);this.render();
  }
  clearDecorPreview(){
    if(!this.decorPreview)return;
    this.root.remove(this.decorPreview,this.decorPreviewBox);disposeGeometry(this.decorPreview);this.decorPreviewBox.geometry.dispose();this.decorPreviewBox.material.dispose();
    this.decorPreviewMaterials.forEach(mat=>{disposeMaterial(mat);const index=this.materials.indexOf(mat);if(index>=0)this.materials.splice(index,1);});this.decorPreview=null;this.decorPreviewBox=null;this.render();
  }
  select(id){const next=this.items.has(id)?id:null,changed=next!==this.selected;this.selected=next;if(changed)this.options.onSelect?.(next);this.selection.visible=!!this.selected;if(this.selected)this.selection.setFromObject(this.items.get(this.selected));this.render();}
  screenTargets(){const rect=this.renderer.domElement.getBoundingClientRect();return [...this.items].map(([id,obj])=>{const p=new THREE.Box3().setFromObject(obj).getCenter(new THREE.Vector3()).project(this.camera);return {id,x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};});}
  setNight(night){this.ambient.intensity=night?1.3:2.6;this.sun.intensity=night?.65:3.5;this.fill.intensity=night?1.4:1;this.windowMaterial.color.set(night?'#f6cc83':'#779fa9');this.windowMaterial.emissive.set(night?'#b47735':'#000000');this.windowMaterial.emissiveIntensity=night?.45:0;this.lamp.intensity=night?7:0;this.render();}
  setAtmosphere(light){
    const {amount,warmth,progress,fixed}=light,key=[amount.toFixed(3),warmth.toFixed(3),fixed,progress.toFixed(3)].join(':');if(key===this.atmosphereKey)return;this.atmosphereKey=key;
    this.ambient.intensity=1.3+1.3*amount;this.sun.intensity=.65+2.85*amount;this.fill.intensity=1.4-.4*amount;
    this.sun.color.copy(new THREE.Color('#c1c8ff').lerp(new THREE.Color('#fff1d2'),amount).lerp(new THREE.Color('#ffb078'),warmth*.65));
    if(fixed)this.sun.position.set(-5,12,9);else this.sun.position.set(-9+18*progress,4+10*Math.sin(Math.PI*progress),9);
    this.windowMaterial.color.set(amount<.45?'#f6cc83':'#779fa9');this.windowMaterial.emissive.set('#b47735');this.windowMaterial.emissiveIntensity=(1-amount)*.45;this.lamp.intensity=(1-amount)*7;
    this.renderer.shadowMap.needsUpdate=true;this.render();
  }
  rayAt(e){const rect=this.renderer.domElement.getBoundingClientRect();this.pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);this.ray.setFromCamera(this.pointer,this.camera);}
  down(e){
    if(e.button!==0)return;
    if(this.pendingDrag||this.drag){clearTimeout(this.pendingDrag?.timer);this.pendingDrag=null;return;}
    this.rayAt(e);const hit=this.ray.intersectObjects([...this.items.values(),this.shopModel,this.terrain].filter(Boolean),true)[0];
    let obj=hit?.object;while(obj&&!obj.userData.decorationId)obj=obj.parent;const id=obj?.userData.decorationId||null;
    this.tapGesture={pointerId:e.pointerId,x:e.clientX,y:e.clientY,id,moved:false};if(!id)return;
    const pending=this.pendingDrag={pointerId:e.pointerId,x:e.clientX,y:e.clientY};
    pending.timer=setTimeout(()=>{
      if(this.pendingDrag!==pending||this.disposed)return;this.pendingDrag=null;
      this.options.onBeforeChange?.();this.select(id);this.dragPlane.constant=-obj.position.y;this.rayAt(e);if(!this.ray.ray.intersectPlane(this.dragPlane,this.hit))return;
      const p=this.draft.placements.find(p=>p.id===id);this.drag={id,pointerId:e.pointerId,offset:this.hit.clone().sub(obj.position),original:{x:p.x,z:p.z},returning:false};this.controls.enabled=false;this.renderer.domElement.setPointerCapture(e.pointerId);
    },280);
  }
  move(e){
    if(this.tapGesture?.pointerId===e.pointerId&&Math.hypot(e.clientX-this.tapGesture.x,e.clientY-this.tapGesture.y)>8)this.tapGesture.moved=true;
    if(this.pendingDrag&&Math.hypot(e.clientX-this.pendingDrag.x,e.clientY-this.pendingDrag.y)>8){clearTimeout(this.pendingDrag.timer);this.pendingDrag=null;}
    if(!this.drag||e.pointerId!==this.drag.pointerId)return;
    this.drag.returning=!!this.options.isInventoryPoint?.(e);this.items.get(this.drag.id).visible=!this.drag.returning;this.selection.visible=!this.drag.returning;if(this.drag.returning){e.stopImmediatePropagation();return;}
    this.rayAt(e);if(!this.ray.ray.intersectPlane(this.dragPlane,this.hit))return;const p=this.draft.placements.find(p=>p.id===this.drag.id);p.x=Math.max(-4,Math.min(4,Math.round((this.hit.x-this.drag.offset.x)*5)/5));p.z=Math.max(-3.5,Math.min(3.5,Math.round((this.hit.z-this.drag.offset.z)*5)/5));this.sync();e.stopImmediatePropagation();
  }
  up(e){
    clearTimeout(this.pendingDrag?.timer);this.pendingDrag=null;
    const tap=this.tapGesture;this.tapGesture=null;
    if(!this.drag||e.pointerId!==this.drag.pointerId){if(e.type==='pointerup'&&tap?.pointerId===e.pointerId&&!tap.moved)this.select(tap.id);return;}
    const drag=this.drag;this.drag=null;this.controls.enabled=true;this.items.get(drag.id).visible=true;
    if(e.type==='pointercancel'){Object.assign(this.draft.placements.find(p=>p.id===drag.id),drag.original);this.sync();}
    else if(drag.returning)this.options.onReturnDecoration?.(drag.id);
    else this.options.onChange?.();
  }
  resize(){
    const w=this.container.clientWidth,h=this.container.clientHeight;if(!w||!h)return;
    this.renderer.setSize(w,h,false);
    const rect=this.container.getBoundingClientRect(),frame=this.options.framingElement?.getBoundingClientRect(),fw=frame?.width||w,fh=frame?.height||h;
    const framing=Math.max(1,.95/(fw/fh)),ratio=framing/(this.framing||1);
    this.camera.position.sub(this.controls.target).multiplyScalar(ratio).add(this.controls.target);this.framing=framing;
    // 将原有构图扩展到整屏，而不是扩大模型或在局部画布边缘截断岛屿。
    if(frame)this.camera.setViewOffset(fw,fh,rect.left-frame.left,rect.top-frame.top,w,h);
    else{this.camera.clearViewOffset();this.camera.aspect=w/h;}
    this.camera.updateProjectionMatrix();this.render();
  }
  async prepareFrame(){this.resize();this.options.onLoadProgress?.({phase:'compile'});let timer;try{await Promise.race([this.renderer.compileAsync(this.scene,this.camera),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('显卡准备场景超时，请重试')),15000);})]);}finally{clearTimeout(timer);}if(this.disposed)return;this.render(true);await new Promise(resolve=>requestAnimationFrame(resolve));if(!this.disposed)this.presentable=true;}
  render(immediate=false){if(this.disposed)return;this.dirty=true;if(immediate)this.draw();}
  draw(){if(this.disposed||document.hidden)return;if(this.selected)this.selection.setFromObject(this.items.get(this.selected));const started=performance.now();this.renderer.render(this.scene,this.camera);this.framesDrawn++;this.dirty=false;this.frameCost+=performance.now()-started;this.costSamples++;if(this.costSamples>=120){if(this.quality.mode==='auto'){const next=globalThis.EmcRenderQuality.nextRatio(this.currentRatio,this.frameCost/this.costSamples);if(next!==this.currentRatio){this.currentRatio=next;this.renderer.setPixelRatio(next);this.dirty=true;}}this.frameCost=0;this.costSamples=0;}}
  performanceSummary(){return {tier:this.quality.tier,mode:this.quality.mode,pixel_ratio:this.currentRatio,shadow_size:this.quality.shadowSize,frames:this.framesDrawn,draw_calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures};}
  loop(){if(this.disposed)return;this.frame=requestAnimationFrame(()=>this.loop());if(this.container.hidden||document.hidden){this.lastFrame=performance.now();return;}const now=performance.now();if(now-(this.lastFrame||0)<1000/this.quality.fps-1)return;const dt=Math.min(.1,(now-(this.lastFrame||now))/1000);this.lastFrame=now;if(!this.options.readOnly)this.controls.update();if(this.guide){this.guide.update(dt);this.dirty=true;}if(this.dirty)this.draw();}
  dispose(){this.loadController.abort(new Error('场景已关闭'));clearTimeout(this.pendingDrag?.timer);this.clearDecorPreview();this.disposed=true;cancelAnimationFrame(this.frame);this.resizeObserver.disconnect();this.controls.dispose();this.guide?.dispose();this.scene.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();});new Set(this.materials).forEach(disposeMaterial);this.texturePixels?.clear();this.surfaceCache?.clear();this.renderer.dispose();this.renderer.domElement.remove();}
}
function disposeGeometry(obj){obj.traverse(child=>child.geometry?.dispose());}
function disposeMaterial(material){Object.values(material).forEach(value=>{if(value?.isTexture)value.dispose();});material.dispose();}
function disposeAsset(obj){obj.traverse(child=>{child.geometry?.dispose();if(child.material)(Array.isArray(child.material)?child.material:[child.material]).forEach(disposeMaterial);});}
// 单张生成贴图按原始色相和空间边界着色，保留纹理；预览只覆盖对应部位。
function installPartTint(material,u){
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,{emcWall:u.wall,emcSign:u.sign,emcRoof:u.roof,emcPreview:u.preview,emcSignStrength:u.signStrength,emcRoofStrength:u.roofStrength,emcSignMatrix:u.signMatrix,emcSignSize:u.signSize,emcSignBack:u.signBack,emcRoofY:u.roofY});
    shader.vertexShader='varying vec3 emcWorld;\n'+shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nemcWorld=(modelMatrix*vec4(transformed,1.0)).xyz;');
    shader.fragmentShader='varying vec3 emcWorld; uniform vec3 emcWall,emcSign,emcRoof; uniform float emcPreview,emcRoofY,emcSignStrength,emcRoofStrength,emcSignBack; uniform mat4 emcSignMatrix; uniform vec2 emcSignSize;\n'+shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
      vec3 original=diffuseColor.rgb;
      // 判定使用 sRGB，和射线取样一致；颜色计算保留在线性空间。
      vec3 sampleColor=sRGBTransferOETF(vec4(original,1.0)).rgb;
      float hi=max(sampleColor.r,max(sampleColor.g,sampleColor.b));
      float lo=min(sampleColor.r,min(sampleColor.g,sampleColor.b));
      vec3 signPos=(emcSignMatrix*vec4(emcWorld,1.0)).xyz;
      float signMask=step(abs(signPos.x),emcSignSize.x)*step(abs(signPos.y),emcSignSize.y)*step(emcSignBack,signPos.z)*step(signPos.z,0.16)*step(sampleColor.g*1.15,sampleColor.r)*step(sampleColor.b*1.3,sampleColor.g);
      float roofMask=step(emcRoofY,emcWorld.y)*step(max(sampleColor.g,sampleColor.b)*1.35,sampleColor.r)*(1.0-signMask);
      float wallMask=(1.0-smoothstep(0.42,0.60,(hi-lo)/max(hi,0.001)))*smoothstep(0.20,0.25,hi)*step(sampleColor.b*0.85,sampleColor.r)*(1.0-signMask)*(1.0-roofMask);
      diffuseColor.rgb=mix(original,original*emcWall,wallMask);
      diffuseColor.rgb=mix(diffuseColor.rgb,emcSign*dot(original,vec3(0.2126,0.7152,0.0722))/0.13,signMask*emcSignStrength);
      diffuseColor.rgb=mix(diffuseColor.rgb,emcRoof*dot(original,vec3(0.2126,0.7152,0.0722))/0.14,roofMask*emcRoofStrength);
      float previewMask=emcPreview<1.5?wallMask:(emcPreview<2.5?signMask:roofMask);
      if(emcPreview>0.5)diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.08,0.85,0.28),previewMask*0.55);
    `);
  };
  material.customProgramCacheKey=()=> 'emc-part-tint-v4';
}

function countTexturedMeshes(root){let count=0;root.traverse(obj=>{if(obj.isMesh&&(Array.isArray(obj.material)?obj.material:[obj.material]).some(mat=>mat?.map?.image))count++;});return count;}
