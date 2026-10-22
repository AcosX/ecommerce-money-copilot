(function(){
  'use strict';
  const KEY='emc-island-audio-v1',BPM=92,STEP=60/BPM/2;
  // 原创 16 小节《小岛开张》：C / Am / F / G，第二段抬高旋律再回到起点。
  const melody=[
    [76,79,81,79,76,74,72,0],[76,79,84,83,81,79,76,0],
    [76,81,84,83,81,76,74,0],[72,76,79,76,74,72,71,0],
    [77,81,84,81,79,77,76,0],[77,79,81,84,81,79,77,0],
    [79,83,86,84,83,79,76,74],[71,74,79,77,76,74,72,0],
    [84,0,79,81,79,76,74,76],[79,81,84,88,86,84,79,0],
    [81,84,88,86,84,81,79,76],[79,76,74,72,76,79,81,0],
    [81,84,89,88,84,81,79,77],[84,81,79,77,76,77,81,0],
    [83,86,84,83,79,76,74,71],[74,79,77,74,72,0,0,0]
  ];
  const chords=[[48,60,64,67],[48,60,64,67],[45,57,60,64],[45,57,60,64],[41,53,57,60],[41,53,57,60],[43,55,59,62],[43,55,59,62]];
  const frequency=n=>440*Math.pow(2,(n-69)/12);
  function tone(ctx,bus,n,time,duration,volume,type='square',bend=0){
    const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type=type;osc.frequency.setValueAtTime(frequency(n),time);
    if(bend)osc.frequency.exponentialRampToValueAtTime(frequency(n+bend),time+duration);
    gain.gain.setValueAtTime(0,time);gain.gain.linearRampToValueAtTime(volume,time+.008);gain.gain.exponentialRampToValueAtTime(.0001,time+duration);
    osc.connect(gain);gain.connect(bus);osc.start(time);osc.stop(time+duration+.015);osc.onended=()=>{osc.disconnect();gain.disconnect();};
  }
  function noise(ctx,bus,time,volume){
    const length=Math.ceil(ctx.sampleRate*.045),buffer=ctx.createBuffer(1,length,ctx.sampleRate),data=buffer.getChannelData(0);let seed=923;
    for(let i=0;i<length;i++){seed=(seed*16807)%2147483647;data[i]=(seed/2147483647*2-1)*(1-i/length);}
    const src=ctx.createBufferSource(),filter=ctx.createBiquadFilter(),gain=ctx.createGain();src.buffer=buffer;filter.type='highpass';filter.frequency.value=6500;gain.gain.value=volume;
    src.connect(filter);filter.connect(gain);gain.connect(bus);src.start(time);src.onended=()=>{src.disconnect();filter.disconnect();gain.disconnect();};
  }
  function step(ctx,bus,index,time){
    const bar=Math.floor(index/8)%16,beat=index%8,chord=chords[bar%8],note=melody[bar][beat];
    if(note)tone(ctx,bus,note,time,STEP*(beat===7?1.5:.82),.18,'square');
    tone(ctx,bus,chord[1+[0,1,2,1,0,2,1,2][beat]],time,STEP*.72,.11,'triangle');
    if(beat%2===0)tone(ctx,bus,chord[0]+(beat===4?7:0),time,STEP*1.55,.28,'triangle');
    if(beat===0||beat===4)tone(ctx,bus,43,time,.12,.23,'sine',-19);
    if(beat%2===1)noise(ctx,bus,time,.08);
    if(beat===2||beat===6)noise(ctx,bus,time,.16);
  }
  const effects={click:[[79,0,.055,.15]],open:[[72,0,.09,.17],[79,.055,.12,.13]],close:[[76,0,.08,.13],[69,.045,.1,.12]],pick:[[84,0,.09,.15],[88,.06,.1,.1]],place:[[72,0,.1,.2],[76,.065,.12,.17],[79,.13,.18,.14]],cancel:[[72,0,.08,.12],[67,.055,.1,.1]],wrong:[[60,0,.12,.13],[59,.12,.15,.1]],reward:[[72,0,.13,.2],[76,.09,.13,.19],[79,.18,.13,.18],[84,.3,.33,.17]],upgrade:[[72,0,.15,.19],[76,.12,.15,.18],[79,.24,.15,.18],[84,.36,.2,.18],[88,.5,.2,.17],[91,.65,.45,.15]],message:[[79,0,.1,.13],[84,.07,.16,.11]]};
  function create(){
    let preferences={music:true,sfx:true,musicVolume:.45,sfxVolume:.6};try{const p=JSON.parse(localStorage.getItem(KEY));if(p&&typeof p==='object')for(const k of Object.keys(preferences)){if(typeof p[k]===typeof preferences[k])preferences[k]=typeof p[k]==='number'&&Number.isFinite(p[k])?Math.max(0,Math.min(1,p[k])):typeof p[k]==='boolean'?p[k]:preferences[k];}}catch(_){}
    let ctx,music,sfx,master,timer=null,next=0,index=0,unlocked=false,disposed=false,lastEffect=null,effectCount=0;
    const available=!!(window.AudioContext||window.webkitAudioContext);
    function gains(){if(!ctx)return;const now=ctx.currentTime;music.gain.setTargetAtTime(preferences.music?preferences.musicVolume*.32:0,now,.04);sfx.gain.setTargetAtTime(preferences.sfx?preferences.sfxVolume*.6:0,now,.015);}
    function stop(){if(timer!==null)clearInterval(timer);timer=null;}
    function tick(){if(ctx.state!=='running'||document.hidden)return;while(next<ctx.currentTime+.15){if(next<ctx.currentTime-.1)next=ctx.currentTime+.02;step(ctx,music,index,next);index=(index+1)%128;next+=STEP;}}
    function start(){if(disposed||!ctx||ctx.state!=='running'||document.hidden||!preferences.music)return;stop();next=Math.max(next,ctx.currentTime+.04);tick();timer=setInterval(tick,50);}
    async function unlock(){
      if(disposed||!available||document.hidden)return;
      try{
        if(!ctx){ctx=new (window.AudioContext||window.webkitAudioContext)();music=ctx.createGain();sfx=ctx.createGain();master=ctx.createDynamicsCompressor();master.threshold.value=-18;master.ratio.value=5;music.connect(master);sfx.connect(master);master.connect(ctx.destination);gains();}
        if(ctx.state==='suspended')await ctx.resume();unlocked=ctx.state==='running';if(unlocked&&timer===null)start();
      }catch(_){} // 音频不可用时仍可完整游玩。
    }
    function play(name){if(!ctx||ctx.state!=='running'||document.hidden||!preferences.sfx||!effects[name])return;lastEffect=name;effectCount++;effects[name].forEach(([n,offset,duration,volume])=>tone(ctx,sfx,n,ctx.currentTime+.005+offset,duration,volume,'square'));}
    function set(key,value){if(!(key in preferences))return;preferences[key]=typeof preferences[key]==='boolean'?!!value:Math.max(0,Math.min(1,Number(value)||0));try{localStorage.setItem(KEY,JSON.stringify(preferences));}catch(_){}gains();if(key==='music'){if(preferences.music)start();else stop();}}
    function gesture(e){if(e.isTrusted&&(e.type!=='keydown'||!e.repeat))void unlock();}
    function visibility(){if(!ctx)return;if(document.hidden){stop();void ctx.suspend().catch(()=>{});}else if(unlocked)void unlock();}
    document.addEventListener('pointerdown',gesture,{capture:true});document.addEventListener('keydown',gesture,{capture:true});document.addEventListener('visibilitychange',visibility);
    function dispose(){disposed=true;stop();document.removeEventListener('pointerdown',gesture,true);document.removeEventListener('keydown',gesture,true);document.removeEventListener('visibilitychange',visibility);if(ctx)void ctx.close().catch(()=>{});}
    return {play,set,dispose,state:()=>({...preferences,available,unlocked,context:ctx?.state||'locked',playing:timer!==null,last_effect:lastEffect,effect_count:effectCount,track:'小岛开张',bpm:BPM})};
  }
  // 与实时播放共用谱面，可导出试听及检查波形，不依赖外部音乐资源。
  async function preview(){const rate=22050,length=STEP*128,ctx=new OfflineAudioContext(1,Math.ceil((length+.5)*rate),rate),bus=ctx.createGain();bus.gain.value=.45*.32;bus.connect(ctx.destination);for(let i=0;i<128;i++)step(ctx,bus,i,i*STEP);return ctx.startRendering();}
  window.EmcAudio={create,preview};
})();
