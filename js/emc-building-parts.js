import * as THREE from 'three';
// Building appearance is independent of the five business-growth titles.
export function buildingLevel(progress,stage=1){
 if(!progress)return [0,2,3,4,5][Math.max(0,Math.min(4,stage-1))];
 if(progress.certified||['approved','demo-approved'].includes(progress.firstOrder))return 5;
 const n=progress.completed||0;return n>=5?4:n>=4?3:n>=2?2:n>=1?1:0;
}
export function bindBuildingParts(model){
 const parts=[];model.traverse(obj=>{if(!obj.isMesh)return;let owner=obj;while(owner.parent&&owner.parent!==model)owner=owner.parent;
 const map=m=>{const material=m.clone(),name=m.name.replace(/\.\d+$/,'');let part=null;
 if(owner.name==='body'&&['stone','white','brick'].includes(name))part='wall';
 if(owner.name==='roof'&&!['glass','green'].includes(name))part='roof';
 if(owner.name==='sign')part='sign';
 if(part){material.userData.paintPart=part;parts.push({material,part,base:material.color.clone(),emissive:material.emissive.clone(),intensity:material.emissiveIntensity});}
 return material;};obj.material=Array.isArray(obj.material)?obj.material.map(map):map(obj.material);
 });return parts;
}
export function syncBuildingParts(parts,draft,preview){for(const p of parts||[]){const color=draft[p.part+'_color'],original={wall:'#eee0c5',roof:'#bd3f23',sign:'#9c531e'}[p.part];p.material.color.copy(p.base);if(color&&color!==original)p.material.color.set(color);p.material.emissive.copy(p.emissive);p.material.emissiveIntensity=p.intensity;if(preview===p.part){p.material.color.lerp(new THREE.Color('#38e77d'),.5);p.material.emissive.set('#1b8d45');p.material.emissiveIntensity=.25;}}}
export function createBuildingEnvironment(renderer){const room=new THREE.Scene();room.background=new THREE.Color('#a3b2c2');const materials=[],geometries=[];for(const[x,y,z,w,h,d,c]of[[0,6,0,10,.1,10,'#ffffff'],[-6,2,0,.1,6,10,'#d7deeb'],[5,3,2,.1,5,6,'#fff4df']]){const geometry=new THREE.BoxGeometry(w,h,d),material=new THREE.MeshBasicMaterial({color:c}),mesh=new THREE.Mesh(geometry,material);mesh.position.set(x,y,z);room.add(mesh);materials.push(material);geometries.push(geometry);}const pmrem=new THREE.PMREMGenerator(renderer);const target=pmrem.fromScene(room,.08);pmrem.dispose();materials.forEach(m=>m.dispose());geometries.forEach(g=>g.dispose());return target;}
