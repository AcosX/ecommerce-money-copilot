import * as THREE from 'three';

export const CHARACTER_MOTIONS={
 idle:{label:'自然待机',loop:true},walk:{label:'走路',loop:true},
 wave:{label:'招手',loop:false},talk:{label:'说话手势',loop:true},
 turn:{label:'转身张望',loop:false},window:{label:'看橱窗',loop:false},
 lookout:{label:'眺望',loop:false},inspect:{label:'观察装饰',loop:false},
 nod:{label:'点头',loop:false}
};

// The caller supplies navigation and facing. Clips are in-place and contain no
// facial tracks, so dialogue / emotion can keep controlling the face independently.
export function createCharacterMotion(root,clips){
 const mixer=new THREE.AnimationMixer(root),actions=new Map();let current=null,paused=false,transition=null;
 for(const clip of clips){
  if(!CHARACTER_MOTIONS[clip.name])continue;
  const body=clip.clone();body.tracks=body.tracks.filter(t=>!t.name.includes('morphTargetInfluences'));
  actions.set(clip.name,mixer.clipAction(body));
 }
 for(const name of Object.keys(CHARACTER_MOTIONS))if(!actions.has(name))throw new Error('Missing NPC motion: '+name);
 function play(name,{fade=.46,instant=false}={}){
  const next=actions.get(name);if(!next)throw new Error('Unknown NPC motion: '+name);
  if(current===next&&!instant){next.paused=false;paused=false;return;}
  const previous=current;
  const from=[...actions.values()].filter(a=>a.isScheduled()&&a!==next&&a.getEffectiveWeight()>.0001).map(a=>[a,a.getEffectiveWeight()]);
  const initial=instant?1:(next.isScheduled()?next.getEffectiveWeight():0);
  if(instant){mixer.stopAllAction();transition=null;}
  next.reset().setEffectiveWeight(initial).setEffectiveTimeScale(1);
  next.setLoop(CHARACTER_MOTIONS[name].loop?THREE.LoopRepeat:THREE.LoopOnce,CHARACTER_MOTIONS[name].loop?Infinity:1);
  next.clampWhenFinished=true;next.paused=false;next.play();
  if(previous&&!instant&&previous!==next)transition={from,to:next,initial,age:0,duration:Math.max(.05,fade)};
  else next.setEffectiveWeight(1);
  current=next;paused=false;mixer.update(0);
 }
 mixer.addEventListener('finished',event=>{if(event.action===current&&!paused)play('idle');});
 play('idle',{instant:true});
 return {play,update(dt){if(paused)return;const seconds=Math.max(0,Math.min(.1,dt||0));if(transition){transition.age+=seconds;const t=Math.min(1,transition.age/transition.duration),s=t*t*(3-2*t);for(const [action,weight] of transition.from)action.setEffectiveWeight(weight*(1-s));transition.to.setEffectiveWeight(transition.initial+(1-transition.initial)*s);if(t===1){for(const [action] of transition.from)action.stop();transition=null;}}mixer.update(seconds);},
  pause(value=true){paused=!!value;if(current)current.paused=paused;},
  seek(phase){if(!current)return;transition=null;for(const action of actions.values())if(action!==current)action.stop();current.setEffectiveWeight(1);paused=true;current.paused=true;current.time=Math.max(0,Math.min(.99999,phase))*current.getClip().duration;mixer.update(0);},
  state:()=>({name:current?.getClip().name,time:current?.time||0,duration:current?.getClip().duration||0,paused,clips:[...actions.keys()],transitioning:!!transition,weights:Object.fromEntries([...actions].filter(([,a])=>a.isScheduled()).map(([name,a])=>[name,a.getEffectiveWeight()]))}),
  dispose(){mixer.stopAllAction();mixer.uncacheRoot(root);}
 };
}
