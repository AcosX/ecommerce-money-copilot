import * as THREE from 'three';

// Reusable scene prop; the character GLB keeps its facial and body tracks clean.
// Pose anchors are delivered alongside the model in its JSON metadata.
export function createCharacterProps(root){
 let wrist;root.traverse(o=>{if(o.isBone&&o.name.endsWith('1_Left_Limb_2'))wrist=o;});
 const envelope=new THREE.Group();envelope.name='Xiaoshang_Envelope';
 const paper=new THREE.MeshStandardMaterial({color:0xffefc5,roughness:.95});
 envelope.add(new THREE.Mesh(new THREE.BoxGeometry(.009,.12,.19),paper));
 const flap=new THREE.BufferGeometry();flap.setAttribute('position',new THREE.Float32BufferAttribute([.006,.057,-.093,.006,-.010,0,.006,.057,.093],3));flap.computeVertexNormals();
 envelope.add(new THREE.Mesh(flap,new THREE.MeshStandardMaterial({color:0xe4cfa0,roughness:1,side:THREE.DoubleSide})));
 const seal=new THREE.Mesh(new THREE.CylinderGeometry(.014,.014,.004,8),new THREE.MeshStandardMaterial({color:0xc6503e,roughness:.85}));seal.rotation.z=-Math.PI/2;seal.position.set(.010,-.008,0);envelope.add(seal);
 envelope.visible=false;root.add(envelope);
 const p=new THREE.Vector3();
 return {update(state){const phase=(state?.time||0)/(state?.duration||1);envelope.visible=!!wrist&&state?.name==='letter'&&phase>=.16&&phase<=.86;if(envelope.visible){root.updateMatrixWorld(true);wrist.getWorldPosition(p);root.worldToLocal(p);envelope.position.copy(p).add(new THREE.Vector3(.020,.10,.06));}},state:()=>({envelopeVisible:envelope.visible}),dispose(){envelope.removeFromParent();envelope.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});}};
}
