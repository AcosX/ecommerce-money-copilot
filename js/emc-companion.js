/* Local companion practice state. Never grants formal XP, verification or cloud rewards. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcCompanion=api;})(globalThis,function(){
  'use strict';
  const DIMENSIONS=[['goal','说清目标'],['evidence','补充事实'],['scope','明确范围'],['attempt','说明尝试']];
  const clamp=(v,min,max,fallback)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,Math.round(v))):fallback;
  const fingerprint=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'').slice(0,240);
  function create(){return {version:1,affinity:20,patience:80,level:'L1',streak:0,seen:[],perks:[],last:null};}
  function normalize(value){const state=create();if(!value||value.version!==1)return state;state.affinity=clamp(value.affinity,0,100,20);state.patience=clamp(value.patience,25,100,80);state.level=/^(L[1-6]|first_order)$/.test(value.level)?value.level:'L1';state.streak=clamp(value.streak,0,3,0);state.seen=Array.isArray(value.seen)?value.seen.filter(s=>typeof s==='string').slice(-120):[];state.perks=Array.isArray(value.perks)?[...new Set(value.perks.filter(s=>/^L[1-6]$/.test(s)))]:[];return state;}
  function assess(text){
    const message=String(text||'').slice(0,240);
    const goal=/(想|目标|希望|计划|打算|需要|准备|怎么|如何|帮我).{2,45}/.test(message);
    const evidence=/(\d+(?:\.\d+)?\s*(元|块|%|％|次|个|件|单|小时|天|周|万|预算))|((预算|货源|数据|成本|点击|曝光|转化|销量|利润|反馈|评价|样本|库存).{0,8}\d)|((有|没有|已有).{0,6}(货源|店铺|资源|数据|截图))/.test(message);
    const scope=/(小红书|拼多多|本周|上周|近\s*\d+\s*[天周月]|每天|每周|过去|通勤|人群|类目|宝妈|学生|上班族|时间范围|家居|服饰|收纳)/.test(message);
    const attempt=/(已经|已尝试|试过|尝试了|对比了|比较了|调整过|改过|验证过|做过|发现|结果是|但|不过|仍然|依然).{2,60}/.test(message);
    const flags={goal,evidence,scope,attempt},count=Object.values(flags).filter(Boolean).length;
    return {dimensions:DIMENSIONS.map(([id,label])=>({id,label,met:flags[id]})),count,high_quality:goal&&count>=3};
  }
  function enter(input,level){const state=normalize(input);if(level&&level!==state.level&&/^(L[1-6]|first_order)$/.test(level)){state.level=level;state.streak=0;state.patience=Math.max(80,state.patience);}return state;}
  function record(input,text,{level='L1',guided=false}={}){
    const state=enter(input,level),key=level+':'+fingerprint(text),assessment=assess(text);
    if(guided||!fingerprint(text)||state.seen.includes(key))return {state,assessment,changed:false,unlocked:false,reason:guided?'guided':'duplicate'};
    const before={affinity:state.affinity,patience:state.patience};state.seen=[...state.seen,key].slice(-120);
    state.affinity=Math.min(100,state.affinity+(assessment.high_quality?4:1));
    state.patience=Math.max(25,Math.min(100,state.patience+(assessment.high_quality?8:assessment.count>=2?2:-2)));
    state.streak=assessment.high_quality?Math.min(3,state.streak+1):0;
    const unlocked=state.streak===3&&/^L[1-6]$/.test(level)&&!state.perks.includes(level);if(unlocked)state.perks.push(level);
    state.last={high_quality:assessment.high_quality,dimensions:assessment.dimensions,affinity_delta:state.affinity-before.affinity,patience_delta:state.patience-before.patience};
    return {state,assessment,changed:true,unlocked};
  }
  function relationship(state){return state.affinity>=85?'默契搭档':state.affinity>=60?'并肩经营':state.affinity>=35?'越来越熟悉':'初识同行';}
  function depth(state,assessment){return assessment?.high_quality?'deep':state.patience<45?'focused':'standard';}
  function brief(task,status='ready',name='小商'){
    if(!task)return '六个经营环节已经完成。下一步是准备真实订单证据，首单核验开放后再提交。';
    if(status==='pending')return '「'+task.name+'」的成果已经交回，目前还在确认中。我们可以先聊聊这次的判断和发现；确认通过后，我再陪你进入下一关。';
    if(status==='rejected')return '「'+task.name+'」还有材料需要补充。先看看任务卡里的反馈，我们一起把缺口补上，再交回来。';
    const lines={L1:'先和我聊预算、货源和每周能投入的时间，我们一起判断赛道、竞争与你的机会。',L2:'先说说你选品的方向、候选商品和手头的数据。我们比较需求、竞争和利润，决定权在你。',L3:'把商品和现在的素材说给我听。我们先确定主图要表达什么，再做优化前后的对比。',L4:'我们一起核对价格、库存、类目和配送。去平台上架后，记得带回工具记录和成功截图。',L5:'这次想说给哪种顾客听？先提炼卖点和真实依据，再自己确认发布内容。',L6:'先给我数据来源、时间范围和你已经试过的调整。我们区分事实与假设，再排出优化顺序。'};
    return '这一步，我们做「'+task.name+'」。'+(lines[task.id]||'先看看任务要求，再一起拆解。')+' 做好后交回'+(task.deliverable||'对应成果')+'，确认通过再继续。';
  }
  function perk(task){return [{title:'先验证最关键的假设',text:'围绕「'+(task?.name||'当前任务')+'」，写下你最拿不准的一件事，以及能支持或推翻它的证据。'},{title:'给判断留一个对照',text:'固定时间范围和其他条件，记录改动前后结果；没有数据就标注待验证。'},{title:'带着结论交成果',text:'把事实、判断、下一步分开写，再对照本关的材料要求补齐证据。'}];}
  function createStore(storage,scope){let lastKey=null,lastState=null;function read(){const key='emc-companion-practice-v1:'+encodeURIComponent(scope());if(key!==lastKey){lastKey=key;try{lastState=normalize(JSON.parse(storage.getItem(key)));}catch(_){lastState=create();}}return normalize(lastState);}function save(state){read();lastState=normalize(state);try{storage.setItem(lastKey,JSON.stringify(lastState));return true;}catch(_){return false;}}return {read,save};}
  return {DIMENSIONS,create,normalize,assess,enter,record,relationship,depth,brief,perk,createStore,fingerprint};
});
