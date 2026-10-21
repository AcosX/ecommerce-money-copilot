import {acceleratedRaycast,computeBoundsTree} from '../assets/vendor/three-mesh-bvh/index.js';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import * as THREE from 'three';
// Keep original indices/UVs intact: the acceleration structure uses an indirect triangle table.
export function acceleratePicking(root){root.traverse(o=>{if(!o.isMesh)return;o.geometry.computeBoundingBox();o.geometry.computeBoundingSphere();if(!o.geometry.boundsTree&&o.geometry.attributes.position.count>1000)computeBoundsTree.call(o.geometry,{indirect:true,maxLeafSize:10});if(o.geometry.boundsTree)o.raycast=acceleratedRaycast;});}
// Decorations are rigid objects. Bake transforms and merge only opaque meshes sharing the exact material.
export function batchDecoration(root){
  root.updateMatrixWorld(true);const inverse=root.matrixWorld.clone().invert(),groups=new Map();
  root.traverse(o=>{if(!o.isMesh||Array.isArray(o.material)||o.material.transparent)return;const key=o.material;const group=groups.get(key)||[];group.push(o);groups.set(key,group);});
  for(const [material,meshes] of groups){if(meshes.length<2)continue;const geometries=meshes.map(o=>{const g=o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse,o.matrixWorld));const normalized=g.index?g.toNonIndexed():g;if(normalized!==g)g.dispose();for(const key of Object.keys(normalized.attributes))if(!['position','normal','uv'].includes(key))normalized.deleteAttribute(key);if(!normalized.attributes.uv)normalized.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(normalized.attributes.position.count*2),2));normalized.clearGroups();return normalized;});const merged=mergeGeometries(geometries,false);geometries.forEach(g=>g.dispose());if(!merged)continue;meshes.forEach(o=>{o.parent.remove(o);o.geometry.dispose();});merged.computeBoundingSphere();merged.computeBoundingBox();const mesh=new THREE.Mesh(merged,material);mesh.castShadow=true;mesh.receiveShadow=true;root.add(mesh);}
  return root;
}
