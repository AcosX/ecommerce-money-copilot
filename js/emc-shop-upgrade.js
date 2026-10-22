import * as T from 'three';
// Subtle gold shimmer and a short rotation, with a fade between the two models.
export function startShopUpgrade(owner,oldObjects,swap,{onReveal=()=>{},reduced=matchMedia('(prefers-reduced-motion: reduce)').matches}={}){
 const root=owner.root,rotor=new T.Group(),fx=new T.Group();root.add(rotor,fx);for(const obj of oldObjects)if(obj)rotor.attach(obj);
 const bounds=new T.Box3().setFromObject(rotor),height=Math.max(2,bounds.max.y-bounds.min.y),radius=2.6;
 const count=reduced?0:owner.quality.lite?12:22,positions=new Float32Array(count*3),geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(positions,3));const particleMaterial=new T.PointsMaterial({color:'#ffe5a1',toneMapped:false,size:.045,transparent:true,opacity:0,depthWrite:false,blending:T.AdditiveBlending});fx.add(new T.Points(geometry,particleMaterial));
 const light=new T.PointLight('#ffd480',0,7,2);light.position.set(0,height*.45,1.6);fx.add(light);
 const mats=new Map(),gold=new T.Color('#e8ad3f');
 const remember=objects=>{for(const obj of objects)obj?.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material])if(!mats.has(m))mats.set(m,{opacity:m.opacity,transparent:m.transparent,depthWrite:m.depthWrite,emissive:m.emissive?.clone(),intensity:m.emissiveIntensity});});};remember(oldObjects);
 const shade=(objects,opacity,strength)=>{for(const obj of objects)obj?.traverse(o=>{if(!o.isMesh)return;for(const m of Array.isArray(o.material)?o.material:[o.material]){const base=mats.get(m);if(!base)continue;if(!m.transparent){m.transparent=true;m.needsUpdate=true;}m.opacity=base.opacity*opacity;m.depthWrite=opacity>.95&&base.depthWrite;if(m.emissive){m.emissive.copy(base.emissive).lerp(gold,strength);m.emissiveIntensity=Math.max(base.intensity,strength*.4);}}});};
 const restoreMaterials=()=>{for(const[m,b]of mats){m.opacity=b.opacity;m.transparent=b.transparent;m.depthWrite=b.depthWrite;if(m.emissive){m.emissive.copy(b.emissive);m.emissiveIntensity=b.intensity;}m.needsUpdate=true;}};
 const previousControls=owner.controls.enabled;owner.controls.enabled=false;let elapsed=0,swapped=false,finished=false,resolve,reject,newObjects=[];const duration=reduced ? .36 : 1.9,promise=new Promise((a,b)=>{resolve=a;reject=b});
 const release=()=>{restoreMaterials();geometry.dispose();particleMaterial.dispose();root.remove(fx,rotor);owner.controls.enabled=previousControls;owner.render();};
 const restore=objects=>{rotor.rotation.y=0;rotor.updateMatrixWorld(true);for(const obj of objects)if(obj)root.attach(obj);};
 return {promise,state:()=>({active:!finished,phase:swapped?'revealing':'shimmering',progress:Math.min(1,elapsed/duration),reduced}),update(dt){if(finished)return;elapsed+=Math.min(dt,.05);const t=Math.min(1,elapsed/duration),shimmer=Math.sin(t*Math.PI);light.intensity=shimmer*.8;particleMaterial.opacity=shimmer*.65;
 if(!reduced){rotor.rotation.y=swapped?-.35*Math.pow(1-(t-.5)*2,3):T.MathUtils.smoothstep(t,0,.5)*Math.PI*.65;for(let i=0;i<count;i++){const a=i*2.39996+elapsed*.35,r=radius*(.68+.18*Math.sin(i*1.7));positions[i*3]=Math.cos(a)*r;positions[i*3+1]=((i/count+elapsed*.2)%1)*(height+.4)+.15;positions[i*3+2]=Math.sin(a)*r;}geometry.attributes.position.needsUpdate=true;}
 if(!swapped)shade(oldObjects,1-T.MathUtils.smoothstep(t,.44,.5),shimmer*.28);
 if(t>=.5&&!swapped){try{for(const obj of oldObjects)if(obj)rotor.remove(obj);rotor.rotation.y=0;newObjects=swap();remember(newObjects);for(const obj of newObjects)if(obj)rotor.attach(obj);swapped=true;onReveal();}catch(error){finished=true;restore(oldObjects);release();reject(error);return;}}
 if(swapped)shade(newObjects,T.MathUtils.smoothstep(t,.5,.59),shimmer*.24);
 owner.renderer.shadowMap.needsUpdate=true;owner.render();if(t===1){finished=true;restore(newObjects);release();resolve(true);}},cancel(){if(finished)return;finished=true;restore(swapped?newObjects:oldObjects);release();resolve(false);}};
}
