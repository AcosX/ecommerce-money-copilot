// Facial controls for the reviewed Xiaoshang model. Viseme timing comes from a
// speech provider; this module blends supplied mouth cues with independent emotion / blink.
export const FACE_EMOTIONS={
  neutral:{mouthClose:.15},
  friendly:{mouthClose:.10,mouthSmile:.30,cheekRaise:.15},
  happy:{mouthClose:.05,mouthSmile:.55,cheekRaise:.45},
  thinking:{mouthClose:.80,browInnerUp:.35,browDown:.08},
  worried:{mouthClose:.65,browInnerUp:.60,mouthFrown:.35},
  surprised:{browOuterUp:.65,eyeWideLeft:.55,eyeWideRight:.55,viseme_oh:.45}
};
export const FACE_VISEMES=['sil','aa','ih','ou','ee','oh','mbp','fv'];
const clamp=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(1,Number(v))):0;
export function createCharacterFace(root,{autoBlink=true,random=Math.random}={}){
  const meshes=[];root.traverse(o=>{if(o.morphTargetDictionary?.viseme_aa!==undefined)meshes.push(o);});
  if(!meshes.length)throw new Error('Character has no reviewed facial morph targets');
  const names=Object.keys(meshes[0].morphTargetDictionary),overrides=new Map();
  let emotion='neutral',intensity=1,viseme='sil',mouthAmount=0,proximity=0,blinkAge=-1,nextBlink=2.8+random()*2.6;
  function update(seconds,{instant=false}={}){
    const dt=Math.max(0,Math.min(.1,seconds||0));let blink=0;
    if(autoBlink){if(blinkAge>=0){blinkAge+=dt;if(blinkAge>=.22){blinkAge=-1;nextBlink=2.8+random()*2.6;}else blink=Math.sin(Math.PI*blinkAge/.22);}else{nextBlink-=dt;if(nextBlink<=0)blinkAge=0;}}
    const targets={};for(const [key,amount] of Object.entries(FACE_EMOTIONS[emotion]))targets[key]=amount*intensity;
    targets.mouthSmile=clamp((targets.mouthSmile||0)+proximity*.08);
    if(viseme!=='sil'&&mouthAmount){
      for(const key of ['mouthClose','jawOpen','mouthFunnel','mouthPucker','mouthStretch','lowerLipUp','viseme_oh'])targets[key]=(targets[key]||0)*(1-mouthAmount);
      targets['viseme_'+viseme]=mouthAmount;
      // Rounded vowels relax lip corners; the eyes / cheeks retain the emotion.
      if(['ou','oh','mbp','fv'].includes(viseme))for(const key of ['mouthSmile','mouthFrown'])targets[key]=(targets[key]||0)*(1-mouthAmount*.8);
    }
    targets.eyeBlinkLeft=blink;targets.eyeBlinkRight=blink;
    for(const [key,value] of overrides)targets[key]=value;
    const alpha=instant?1:1-Math.exp(-dt*24);
    for(const mesh of meshes)for(const [name,index] of Object.entries(mesh.morphTargetDictionary)){
      const desired=clamp(targets[name]||0),current=mesh.morphTargetInfluences[index]||0;
      mesh.morphTargetInfluences[index]=current+(desired-current)*alpha;
    }
  }
  return {names,update,
    setEmotion(name,amount=1){if(!FACE_EMOTIONS[name])throw new Error('Unknown emotion');emotion=name;intensity=clamp(amount);},
    setViseme(name,amount=1){if(!FACE_VISEMES.includes(name))throw new Error('Unknown viseme');viseme=name;mouthAmount=clamp(amount);},
    setMorph(name,value){if(!names.includes(name))throw new Error('Unknown facial morph');overrides.set(name,clamp(value));},
    clearOverrides(){overrides.clear();},setAutoBlink(value){autoBlink=!!value;blinkAge=-1;},setProximity(value){proximity=clamp(value);},
    state:()=>({emotion,intensity,viseme,mouthAmount,autoBlink,proximity,weights:Object.fromEntries(names.map(name=>[name,meshes[0].morphTargetInfluences[meshes[0].morphTargetDictionary[name]]||0]))})
  };
}
