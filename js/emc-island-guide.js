import * as THREE from 'three';
import {batchDecoration} from './emc-model-performance.js';

// 岛屿向导：沿建筑外侧巡游；投影与射线遮挡使用同一份三维坐标。
export class IslandGuide{
  constructor(scene){
    this.host=scene;this.root=new THREE.Group();scene.root.add(this.root);
    const body=new THREE.Group();this.root.add(body);
    const box=(size,pos,mat,parent=body)=>scene.box(parent,size,pos,mat);
    const navy=scene.mat('#30466a'),skin=scene.mat('#e5bb8b'),cream=scene.mat('#eddfbb'),mint=scene.mat('#709d85'),gold=scene.mat('#dfb84e'),dark=scene.mat('#263344');
    box([.34,.39,.23],[0,.53,0],cream);box([.36,.23,.25],[0,.58,0],mint);box([.04,.25,.025],[0,.59,.14],navy);
    box([.33,.31,.28],[0,.89,0],skin);box([.36,.10,.31],[0,1.06,0],navy);box([.39,.045,.14],[0,1.015,.17],navy);box([.08,.055,.015],[0,1.07,.16],gold);
    for(const x of [-.085,.085])box([.035,.045,.015],[x,.91,.15],dark);
    box([.055,.025,.035],[0,.85,.15],skin);box([.07,.015,.015],[0,.805,.15],navy);
    box([.16,.20,.14],[.23,.44,.05],gold);box([.025,.35,.025],[.18,.66,.15],gold);
    this.legs=[];this.arms=[];
    for(const side of [-1,1]){
      const leg=new THREE.Group();leg.position.set(side*.095,.36,0);this.root.add(leg);box([.115,.26,.13],[0,-.13,0],navy,leg);box([.13,.075,.20],[0,-.29,.035],dark,leg);this.legs.push(leg);
      const arm=new THREE.Group();arm.position.set(side*.235,.71,0);this.root.add(arm);box([.12,.21,.15],[0,-.10,0],mint,arm);box([.10,.10,.13],[0,-.25,0],skin,arm);this.arms.push(arm);
    }
    batchDecoration(body);
    this.route=[[-2.8,3.0],[2.8,3.0],[3.1,0],[2.8,-2.8],[-2.8,-2.8],[-3.1,0]];this.index=1;this.root.position.set(-2.8,0,3);this.elapsed=0;this.pause=1.5;this.checkAt=0;this.groundAt=0;this.talking=false;this.ray=new THREE.Raycaster();this.ray.firstHitOnly=true;this.root.rotation.y=Math.PI/2;this.root.traverse(o=>{if(o.isMesh)o.castShadow=false;});
  }
  setTalking(value){if(value&&!this.status(true).visible)return false;this.talking=!!value;return true;}
  update(dt){
    this.elapsed+=dt;
    let moving=false;
    if(this.talking){const camera=this.host.camera.position;this.root.rotation.y=Math.atan2(camera.x-this.root.position.x,camera.z-this.root.position.z);}
    else if(this.pause>0)this.pause-=dt;
    else{
      const [x,z]=this.route[this.index],dx=x-this.root.position.x,dz=z-this.root.position.z,length=Math.hypot(dx,dz),step=Math.min(length,dt*.46);
      if(length<.035){this.index=(this.index+1)%this.route.length;this.pause=1.6;}
      else{this.root.position.x+=dx/length*step;this.root.position.z+=dz/length*step;this.root.rotation.y=Math.atan2(dx,dz);moving=true;}
    }
    const stride=moving?Math.sin(this.elapsed*8)*.40:0;this.legs.forEach((limb,i)=>limb.rotation.x=i?stride:-stride);this.arms.forEach((limb,i)=>limb.rotation.x=i?-stride:stride);
    if(this.elapsed>=this.groundAt){this.groundAt=this.elapsed+.15;this.root.position.y=this.host.surfaceHeight(this.root.position.x,this.root.position.z)-.02;}
    const status=this.status();this.host.options.onNpcFrame?.(status);
  }
  status(force=false){
    const host=this.host,point=this.root.position.clone().add(new THREE.Vector3(0,1.15,0));host.camera.updateMatrixWorld();const projection=point.clone().project(host.camera),rect=host.renderer.domElement.getBoundingClientRect();
    const screen={x:rect.left+(projection.x+1)*rect.width/2,y:rect.top+(1-projection.y)*rect.height/2};
    const onscreen=projection.z>-1&&projection.z<1&&screen.x>12&&screen.x<innerWidth-12&&screen.y>12&&screen.y<(window.visualViewport?.height||innerHeight)-12;
    if(force||this.elapsed>=this.checkAt){
      this.checkAt=this.elapsed+.12;this.occluded=false;
      for(const height of [.25,.65,1.04]){
        const target=this.root.position.clone().add(new THREE.Vector3(0,height,0)),direction=target.clone().sub(host.camera.position),distance=direction.length();
        this.ray.set(host.camera.position,direction.normalize());this.ray.far=distance-.07;
        if(host.shopModel&&this.ray.intersectObjects([host.shopModel,...(host.signBoard?[host.signBoard]:[])],true).length){this.occluded=true;break;}
      }
      this.ray.far=Infinity;
    }
    return {visible:!!host.presentable&&onscreen&&!this.occluded,occluded:!!this.occluded,onscreen,talking:this.talking,position:this.root.position.toArray(),heading:this.root.rotation.y,screen};
  }
}
