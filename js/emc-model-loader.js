import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const ROOT=new URL('../',import.meta.url);
function disposeModel(model){model.scene.traverse(obj=>{obj.geometry?.dispose();for(const material of obj.material?(Array.isArray(obj.material)?obj.material:[obj.material]):[]){Object.values(material).forEach(v=>{if(v?.isTexture)v.dispose();});material.dispose();}});}

// Deadline includes download and image decoding. Disposed/obsolete scenes cancel immediately.
async function bounded(work,signal){
  const controller=new AbortController();let rejectAbort;
  const stopped=new Promise((_,reject)=>{rejectAbort=()=>reject(controller.signal.reason||new Error('资源加载已取消'));});
  const abort=()=>controller.abort(signal.reason||new Error('资源加载已取消'));
  controller.signal.addEventListener('abort',rejectAbort,{once:true});signal?.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>controller.abort(new Error('资源下载或贴图解码超时，请重试')),180000);
  try{if(signal?.aborted)abort();return await Promise.race([Promise.resolve().then(()=>{controller.signal.throwIfAborted();return work(controller.signal);}),stopped]);}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',rejectAbort);}
}
async function download(url,signal,onProgress){
  let response;
  // One retry for interrupted connections/5xx (e.g. a CDN HTTP/2 stream reset).
  for(let attempt=0;attempt<2;attempt++){
    try{
      response=await fetch(url,{signal,cache:attempt?'reload':'default'});
      if(!response.ok)throw Object.assign(new Error('模型资源请求失败（'+response.status+'）'),{status:response.status});
      const total=Number(response.headers.get('Content-Length'))||0;
      if(!response.body)return await response.arrayBuffer();
      const reader=response.body.getReader(),parts=[];let loaded=0;
      try{for(;;){const {done,value}=await reader.read();if(done)break;parts.push(value);loaded+=value.byteLength;onProgress?.({loaded,total});}}
      finally{reader.releaseLock();}
      const bytes=new Uint8Array(loaded);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return bytes.buffer;
    }catch(error){if(signal.aborted||attempt||error.status&&error.status<500)throw error;onProgress?.({loaded:0,total:0,retrying:true});}
  }
}
export function loadSceneManifest(signal){return bounded(async active=>{const data=await download(new URL('assets/models/manifest.json?v=20261022-roof8',ROOT),active);try{return JSON.parse(new TextDecoder().decode(data));}catch(_){throw new Error('模型清单格式错误，请刷新后重试');}},signal);}
export function loadTexturedModel(path,{signal,onProgress,revision}={}){
  return bounded(async active=>{
    const url=new URL(path,ROOT);if(revision)url.searchParams.set('v',revision);const data=await download(url,active,onProgress);active.throwIfAborted();
    if(data.byteLength<20||new DataView(data).getUint32(0,true)!==0x46546c67)throw new Error('模型文件不完整或被服务器替换，请重试');
    onProgress?.({decoding:true});
    const manager=new THREE.LoadingManager();let imageFailed=false;manager.onError=()=>{imageFailed=true;};
    const loader=new GLTFLoader(manager);
    // The pinned GLTFLoader otherwise fetches blob: URLs through ImageBitmapLoader.
    // Use <img> decoding, governed by img-src (already permits blob:) rather than
    // connect-src. This works with the deployed CSP without broadening it.
    loader.register(parser=>{parser.textureLoader=new THREE.TextureLoader(manager);return {name:'EMC_ImageTextureDecoder'};});
    const model=await loader.parseAsync(data,new URL('.',url).href);
    if(active.aborted||imageFailed){disposeModel(model);if(active.aborted)active.throwIfAborted();throw new Error('店铺贴图加载失败，请重试');}
    return model;
  },signal);
}
