(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcSky=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=v=>Math.max(0,Math.min(1,v)),smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
  const frames=[
    [0,'#111b46','#1e2c59','#2d3b67','#7184c4',0,.55,0],
    [5,'#293654','#665577','#d89992','#bc9eac',.15,.35,.3],
    [6,'#7894ba','#efb5a2','#ffd5a0','#ffe1ca',.50,.05,.75],
    [7.5,'#bbdef5','#d4eaf8','#eef7fd','#ffffff',1,0,0],
    [12,'#aed6f0','#d4eaf8','#eef7fd','#ffffff',1,0,0],
    [16,'#bad0eb','#ead8db','#ffdfb4','#ffead6',.95,0,.2],
    [17.5,'#8e9bc7','#e3a1ad','#ffbd83','#ffd7bb',.76,.04,.85],
    [18.5,'#3a416e','#965e8d','#f4a594','#d6a9ca',.4,.22,.7],
    [19.5,'#17224a','#2c3866','#55547c','#858bc3',0,.55,.05],
    [24,'#111b46','#1e2c59','#2d3b67','#7184c4',0,.55,0]
  ];
  function mix(a,b,t){const rgb=c=>c.match(/\w\w/g).map(x=>parseInt(x,16));a=rgb(a.slice(1));b=rgb(b.slice(1));return '#'+a.map((v,i)=>Math.round(v+(b[i]-v)*t).toString(16).padStart(2,'0')).join('');}
  // 按设备本地钟点绘制艺术化昼夜周期，不请求定位或模拟精确天文日出时间。
  function sample(mode='auto',date=new Date()){
    mode=['auto','day','night'].includes(mode)?mode:'auto';
    const hour=date.getHours()+date.getMinutes()/60+date.getSeconds()/3600;
    const h=mode==='day'?12:mode==='night'?0:hour;
    let index=frames.findIndex((f,i)=>i<frames.length-1&&h>=f[0]&&h<frames[i+1][0]);if(index<0)index=0;
    const a=frames[index],b=frames[index+1],t=smooth((h-a[0])/(b[0]-a[0])),lerp=i=>a[i]+(b[i]-a[i])*t;
    const daylight=lerp(5),stars=lerp(6),glow=lerp(7),sunProgress=clamp((h-6)/13),moonProgress=clamp((h>=18.5?h-18.5:h+5.5)/12);
    const orbit=p=>({x:10+80*p,y:62-46*Math.sin(Math.PI*p)});
    const sunOpacity=smooth((h-5.3)/.9)*(1-smooth((h-18.1)/1.1));
    const moonOpacity=h<12?1-smooth((h-5.4)/1.3):smooth((h-18.5)/1.2);
    const fixed=mode!=='auto';
    return {mode,local_hour:hour,phase:fixed?mode:h<5||h>=19.5?'night':h<7.5?'dawn':h<16?'day':h<18.5?'sunset':'twilight',ui_theme:daylight<.45?'night':'day',daylight,stars,glow,
      colors:{top:mix(a[1],b[1],t),middle:mix(a[2],b[2],t),bottom:mix(a[3],b[3],t),cloud:mix(a[4],b[4],t)},
      sun:{...(fixed?{x:82,y:29}:orbit(sunProgress)),opacity:fixed?(mode==='day'?1:0):sunOpacity},
      moon:{...(fixed?{x:82,y:29}:orbit(moonProgress)),opacity:fixed?(mode==='night'?1:0):moonOpacity},
      light:{amount:daylight,warmth:glow,progress:sunProgress,fixed}
    };
  }
  return {sample};
});
