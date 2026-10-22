import * as THREE from 'three';
import {loadTexturedModel} from './emc-model-loader.js?v=20261022-perf1';
import {createCharacterMotion} from './emc-character-motion.js?v=20261022-character12';
import {createCharacterFace} from './emc-character-face.js?v=20261022-character12';
import {createCharacterProps} from './emc-character-props.js?v=20261022-character12';

// One actor in the shared island scene. Navigation uses +Z forward; the reviewed
// GLB uses +X, so only the visual child is rotated. UI and occlusion share root.
export class IslandGuide{
  constructor(scene){
    this.host=scene;this.root=new THREE.Group();this.root.name='Xiaoshang_Island';scene.root.add(this.root);
    this.visual=new THREE.Group();this.visual.rotation.y=-Math.PI/2;this.visual.scale.setScalar(.78);this.root.add(this.visual);
    this.route=[[-2.8,3],[2.8,3],[3.1,0],[2.8,-2.8],[-2.8,-2.8],[-3.1,0]];
    this.index=1;this.direction=1;this.root.position.set(-2.8,0,3);this.root.rotation.y=Math.PI/2;
    this.elapsed=0;this.pause=1.5;this.checkAt=0;this.groundAt=0;this.talking=false;this.holdingLetter=false;this.letterSettling=false;this.speechRemaining=0;
    this.ray=new THREE.Raycaster();this.ray.firstHitOnly=true;this.profile=scene.quality.lite?'lite':'web';this.loaded=false;this.disposed=false;this.behavior='loading';this.ready=this.load();
  }
  async load(){
    const url=`assets/models/characters/xiaoshang-animated-v1-${this.profile}.glb?v=island-v12`;
    const model=await loadTexturedModel(url,{signal:this.host.loadController.signal,onProgress:p=>this.host.options.onLoadProgress?.({phase:'character',...p})});
    if(this.disposed||this.host.disposed){disposeModel(model.scene);return;}
    try{
      this.model=model.scene;this.visual.add(this.model);
      this.motion=createCharacterMotion(this.model,model.animations);this.face=createCharacterFace(this.model);this.props=createCharacterProps(this.model);
      this.face.setEmotion('friendly');this.face.update(0,{instant:true});
      this.model.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;o.frustumCulled=false;}});
      this.root.position.y=this.host.surfaceHeight(this.root.position.x,this.root.position.z);this.loaded=true;this.behavior='idle';
    }catch(error){this.dispose();throw error;}
  }
  faceCamera(){const camera=this.host.camera.position;this.root.rotation.y=Math.atan2(camera.x-this.root.position.x,camera.z-this.root.position.z);}
  setHoldingLetter(value){
    const next=!!value;if(next===this.holdingLetter)return;
    this.holdingLetter=next;
    if(next){this.talking=false;this.speechRemaining=0;this.letterSettling=false;this.faceCamera();this.motion?.play('letter',{fade:.22});this.face?.setEmotion('happy');}
    else this.letterSettling=this.motion?.state().name==='letter';
  }
  setTalking(value){
    if(value&&!this.status(true).visible)return false;
    this.talking=!!value;if(value)this.faceCamera();else this.speechRemaining=0;
    return true;
  }
  speak(text){this.speechText=String(text);this.speechRemaining=Math.min(8,Math.max(1,this.speechText.length*.09));this.speechAge=0;}
  stopSpeaking(){this.speechRemaining=0;this.face?.setViseme('sil');}
  play(name){if(this.motion?.state().name!==name)this.motion?.play(name);}
  chooseRest(){
    const nearest=[...this.host.items.values()].find(o=>o.position.distanceTo(this.root.position)<1.5);
    const name=nearest?'inspect':this.root.position.z>2?'window':Math.random()<.5?'lookout':'turn';
    this.behavior=nearest?'decoration':name;this.motion.play(name);this.pause=Math.max(2+Math.random()*3,this.motion.state().duration+.4);
    if(nearest){const p=nearest.position;this.root.rotation.y=Math.atan2(p.x-this.root.position.x,p.z-this.root.position.z);}
    else if(name==='window')this.root.rotation.y=Math.atan2(-this.root.position.x,-this.root.position.z);
    else if(name==='lookout')this.root.rotation.y=Math.atan2(this.root.position.x,this.root.position.z);
  }
  update(dt){
    if(!this.loaded||this.disposed)return;
    this.elapsed+=dt;
    const state=this.motion.state();
    if(this.letterSettling&&(state.name!=='letter'||state.time/state.duration>.86))this.letterSettling=false;
    if(this.holdingLetter||this.letterSettling){this.faceCamera();this.behavior='letter';}
    else if(this.talking){this.faceCamera();this.behavior=this.speechRemaining>0?'speaking':'listening';this.play(this.speechRemaining>0?'talk':'idle');}
    else if(this.pause>0)this.pause-=dt;
    else{
      const [x,z]=this.route[this.index],dx=x-this.root.position.x,dz=z-this.root.position.z,length=Math.hypot(dx,dz),step=Math.min(length,dt*.32);
      if(length<.035){
        this.chooseRest();this.direction=Math.random()<.35?-this.direction:this.direction;
        this.index=(this.index+this.direction+this.route.length)%this.route.length;
      }else{
        this.root.position.x+=dx/length*step;this.root.position.z+=dz/length*step;
        const target=Math.atan2(dx,dz),difference=Math.atan2(Math.sin(target-this.root.rotation.y),Math.cos(target-this.root.rotation.y));this.root.rotation.y+=difference*(1-Math.exp(-dt*8));
        this.play('walk');this.behavior='walking';
      }
    }
    this.motion.update(dt);
    // Cancelled mail finishes its landing, but its prop disappears immediately.
    this.props.update(this.motion.state().name==='letter'&&!this.holdingLetter?{name:'idle'}:this.motion.state());
    this.speechAge=(this.speechAge||0)+dt;
    if(this.speechRemaining>0){this.speechRemaining=Math.max(0,this.speechRemaining-dt);const cues=['aa','ih','sil','ee','oh','mbp'];this.face.setViseme(cues[Math.floor(this.speechAge/.13)%cues.length],.62);}
    else this.face.setViseme('sil');
    this.face.setEmotion(this.holdingLetter?'happy':this.talking?'friendly':'neutral');this.face.setProximity(Math.max(0,1-this.host.camera.position.distanceTo(this.root.position)/14));this.face.update(dt);
    if(this.elapsed>=this.groundAt){this.groundAt=this.elapsed+.12;this.root.position.y=this.host.surfaceHeight(this.root.position.x,this.root.position.z);}
    this.host.options.onNpcFrame?.(this.status());
  }
  letterScreen(){
    const envelope=this.model?.getObjectByName('Xiaoshang_Envelope');if(!envelope?.visible)return null;this.root.updateMatrixWorld(true);const p=envelope.getWorldPosition(new THREE.Vector3()).project(this.host.camera),r=this.host.renderer.domElement.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  }
  status(force=false){
    const host=this.host,point=this.root.position.clone().add(new THREE.Vector3(0,1.42,0));host.camera.updateMatrixWorld();const projection=point.clone().project(host.camera),rect=host.renderer.domElement.getBoundingClientRect();
    const screen={x:rect.left+(projection.x+1)*rect.width/2,y:rect.top+(1-projection.y)*rect.height/2};
    const onscreen=projection.z>-1&&projection.z<1&&screen.x>12&&screen.x<innerWidth-12&&screen.y>12&&screen.y<(window.visualViewport?.height||innerHeight)-12;
    if(force||this.elapsed>=this.checkAt){
      this.checkAt=this.elapsed+.12;this.occluded=false;
      for(const height of [.30,.78,1.28]){
        const target=this.root.position.clone().add(new THREE.Vector3(0,height,0)),direction=target.clone().sub(host.camera.position),distance=direction.length();
        this.ray.set(host.camera.position,direction.normalize());this.ray.far=distance-.07;
        if(host.shopModel&&this.ray.intersectObjects([host.shopModel,...(host.signBoard?[host.signBoard]:[])],true).length){this.occluded=true;break;}
      }
      this.ray.far=Infinity;
    }
    return {visible:this.loaded&&!!host.presentable&&onscreen&&!this.occluded,occluded:!!this.occluded,onscreen,talking:this.talking,holding_letter:this.holdingLetter,position:this.root.position.toArray(),heading:this.root.rotation.y,screen,model:'xiaoshang-animated-v1',profile:this.profile,behavior:this.behavior,motion:this.motion?.state().name,morphs:this.face?.names.length||0,props:this.props?.state(),mouth:this.face?.state().viseme};
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.props?.dispose();this.motion?.dispose();this.root.removeFromParent();if(this.model)disposeModel(this.model);}
}
function disposeModel(root){const materials=new Set(),textures=new Set();root.traverse(o=>{o.geometry?.dispose();for(const m of o.material?(Array.isArray(o.material)?o.material:[o.material]):[])materials.add(m);});for(const m of materials){Object.values(m).forEach(v=>{if(v?.isTexture)textures.add(v);});m.dispose();}textures.forEach(t=>t.dispose());}
