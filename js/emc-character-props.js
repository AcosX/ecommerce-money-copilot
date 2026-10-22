import * as THREE from 'three';

// Reusable scene prop; the character GLB keeps its facial and body tracks clean.
// Pose anchors are delivered alongside the model in its JSON metadata.
export function createCharacterProps(root){
 let wrist,head;root.traverse(o=>{if(o.isBone&&o.name.endsWith('1_Left_Limb_2'))wrist=o;if(o.isBone&&o.name==='Xiaoshang_Head')head=o;});
 const envelope=new THREE.Group();envelope.name='Xiaoshang_Envelope';
 const paper=new THREE.MeshStandardMaterial({color:0xffefc5,roughness:.95});
 envelope.add(new THREE.Mesh(new THREE.BoxGeometry(.009,.12,.19),paper));
 const flap=new THREE.BufferGeometry();flap.setAttribute('position',new THREE.Float32BufferAttribute([.006,.057,-.093,.006,-.010,0,.006,.057,.093],3));flap.computeVertexNormals();
 envelope.add(new THREE.Mesh(flap,new THREE.MeshStandardMaterial({color:0xe4cfa0,roughness:1,side:THREE.DoubleSide})));
 const seal=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.004,8),new THREE.MeshStandardMaterial({color:0xc6503e,roughness:.85}));seal.rotation.z=-Math.PI/2;seal.position.set(.010,-.008,0);envelope.add(seal);
 const backFlap=envelope.children[1].clone();backFlap.rotation.y=Math.PI;envelope.add(backFlap);const backSeal=seal.clone();backSeal.position.x=-.010;envelope.add(backSeal);
 let bind;root.traverse(o=>{if(!bind&&o.isSkinnedMesh){const i=o.skeleton.bones.indexOf(wrist);if(i>=0)bind=o.skeleton.boneInverses[i].clone().invert();}});
 if(!wrist||!bind)throw new Error('Missing envelope hand binding');
 // Calibrate from the bind pose, never the currently playing animation.
 // Native character +Y-up conversion: fingers point +Z, palm normal is -Y.
 const along=new THREE.Vector3(0,0,1),normal=new THREE.Vector3(0,-1,0),across=new THREE.Vector3(-1,0,0);
 const rest=new THREE.Matrix4().makeBasis(normal,along,across);
 rest.setPosition(new THREE.Vector3().setFromMatrixPosition(bind).addScaledVector(along,.10).addScaledVector(normal,.018).addScaledVector(across,.06));
 envelope.applyMatrix4(bind.clone().invert().multiply(rest));
 envelope.visible=false;wrist.add(envelope);
 const canvas=document.createElement('canvas');canvas.width=128;canvas.height=192;
 const ctx=canvas.getContext('2d');ctx.font='900 164px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=12;ctx.strokeStyle='#59351e';ctx.strokeText('!',64,98);ctx.fillStyle='#ffe24c';ctx.fillText('!',64,98);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
 const alert=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:true}));alert.name='Xiaoshang_NewMessage';alert.visible=false;root.add(alert);
 const grip=envelope.position.length();
 return {update(state){const phase=(state?.time||0)/(state?.duration||1),active=state?.name==='letter';envelope.visible=active&&phase>=.16&&phase<=.86;alert.visible=active&&phase>=.18&&phase<=.79;if(alert.visible&&head){root.updateMatrixWorld(true);const p=head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0,.46,0));alert.position.copy(root.worldToLocal(p));const pop=Math.min(1,(phase-.18)/.05,(.79-phase)/.06),bounce=1+.08*Math.sin((phase-.18)*Math.PI*12);alert.scale.set(.23*pop*bounce,.35*pop*bounce,1);}},state:()=>({envelopeVisible:envelope.visible,exclamationVisible:alert.visible,attachedTo:wrist.name,gripDistance:grip}),dispose(){envelope.removeFromParent();envelope.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});alert.removeFromParent();texture.dispose();alert.material.dispose();}};
}
