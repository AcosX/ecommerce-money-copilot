(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcRenderQuality=api;})(globalThis,function(){
  function choose(mode='auto',env={}){
    mode=['auto','smooth','detail'].includes(mode)?mode:'auto';
    const memory=env.memory??globalThis.navigator?.deviceMemory,cores=env.cores??globalThis.navigator?.hardwareConcurrency,coarse=env.coarse??globalThis.matchMedia?.('(pointer:coarse)').matches??false;
    const tier=mode==='smooth'||mode==='auto'&&(coarse||memory&&memory<=4||cores&&cores<=4)?'smooth':'detail';
    return {mode:['auto','smooth','detail'].includes(mode)?mode:'auto',tier,pixelRatio:tier==='smooth'?1:1.5,shadowSize:tier==='smooth'?512:1024,lite:tier==='smooth',fps:60};
  }
  function nextRatio(ratio,meanMs){return meanMs>24&&ratio>.75?Math.max(.75,Math.round((ratio-.15)*100)/100):ratio;}
  return {choose,nextRatio};
});
