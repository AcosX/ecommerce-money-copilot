// Texture packing and a body-only LOD. Facial topology, UVs and all morph targets are preserved.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const runtime=createRequire(path.join(process.env.EMC_MODEL_TOOLS||path.join(require('node:os').tmpdir(),'emc-model-optimization'),'package.json'));
const {NodeIO}=runtime('@gltf-transform/core'),{ALL_EXTENSIONS}=runtime('@gltf-transform/extensions'),{dedup,weld,prune,textureCompress,simplifyPrimitive}=runtime('@gltf-transform/functions'),{MeshoptSimplifier}=runtime('meshoptimizer'),sharp=runtime('sharp');
(async()=>{await MeshoptSimplifier.ready;const source=process.argv[2],io=new NodeIO().registerExtensions(ALL_EXTENSIONS),outputs=[];
 for(const lite of [false,true]){
  const doc=await io.read(source);await doc.transform(dedup(),weld());
  if(lite)for(const mesh of doc.getRoot().listMeshes())for(const prim of mesh.listPrimitives())if(!prim.listTargets().length)simplifyPrimitive(prim,{simplifier:MeshoptSimplifier,ratio:.50,error:.001,lockBorder:true});
  await doc.transform(prune(),textureCompress({encoder:sharp,targetFormat:'webp',resize:lite?[1024,1024]:[2048,2048],quality:96}));
  const target=source.replace('.glb',lite?'-lite.glb':'-web.glb');await io.write(target,doc);
  const meshes=doc.getRoot().listMeshes(),face=meshes.find(m=>m.listPrimitives().some(p=>p.listTargets().length));
  const report={model_url:target.split(path.sep).join('/'),bytes:fs.statSync(target).size,triangles:meshes.reduce((s,m)=>s+m.listPrimitives().reduce((a,p)=>a+p.getIndices().getCount()/3,0),0),morphs:face.listPrimitives()[0].listTargets().length,face_vertices:face.listPrimitives().reduce((n,p)=>n+p.getAttribute('POSITION').getCount(),0),bones:doc.getRoot().listSkins()[0].listJoints().length,texture_limit:lite?1024:2048};
  outputs.push(report);console.log(report);
 }
 fs.writeFileSync(source.replace('.glb','-delivery.json'),JSON.stringify(outputs,null,2)+'\n');
})().catch(e=>{console.error(e);process.exitCode=1;});
