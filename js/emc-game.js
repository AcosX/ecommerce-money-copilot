/* 教学游戏规则；经验与外观只代表模拟学习，不提供任何正式认证权限。 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcGame=api;
})(globalThis,function(){
  'use strict';
  const STAGES=[
    {name:'起步小屋',title:'新手店主',xp:0,mains:0},
    {name:'成长小店',title:'经营学徒',xp:160,mains:2},
    {name:'精品商店',title:'选品能手',xp:320,mains:4},
    {name:'综合商厦',title:'经营行家',xp:560,mains:7},
    {name:'百货大楼',title:'独当一面',xp:960,mains:12}
  ];
  const MAIN=[
    {id:'audience',level:'L1',name:'认识你的第一位顾客',topic:'定方向',xp:80,question:'准备开一家通勤包小店，哪一种目标人群更明确？',options:['所有喜欢购物的人','需要装电脑、重视轻便的上班族','只关注哪个商品最火'],answer:1,why:'具体的人群和场景，让你有依据地选商品、定价格和写卖点。'},
    {id:'goal',level:'L1',name:'把第一步定得小一点',topic:'定方向',xp:80,question:'刚开始经营，哪一个目标更容易执行和验证？',options:['本周比较 3 款商品，记录成本与需求','尽快成为类目第一','先准备一千款商品再说'],answer:0,why:'把目标缩小到可执行的动作，再根据结果调整，能降低起步风险。'},
    {id:'demand',level:'L2',name:'热闹不一定是商机',topic:'会选品',xp:80,question:'判断需求时，哪组线索更有参考价值？',options:['只看点赞数','只看自己的喜好','结合用户求购、评价痛点和同类成交线索'],answer:2,why:'多种来源相互验证，比单一热度更接近真实需求；也要记录信息时间。'},
    {id:'margin',level:'L2',name:'算清一件商品的账',topic:'会选品',xp:80,question:'商品卖 59 元，进货 25、物流 6、平台及包装 4，未计退货与推广时还剩多少？',options:['34 元','24 元','59 元'],answer:1,why:'59 − 25 − 6 − 4 = 24 元。这仍不是最终净利润，还要考虑售后、推广和其他成本。'},
    {id:'photo',level:'L3',name:'让主图把商品说清楚',topic:'做素材',xp:80,question:'一张新商品主图，优先应该做到什么？',options:['真实清晰地展示商品和核心使用场景','把所有卖点塞满图片','用与实物无关的夸张效果'],answer:0,why:'先让人看懂商品，再组织卖点；素材要与实物和规格一致。'},
    {id:'check',level:'L3',name:'发布素材前，多看一眼',topic:'做素材',xp:80,question:'AI 生成商品图后，应该怎样处理？',options:['生成即发布','只挑最好看的那张','核对外观、规格与文字，标记错误后再使用'],answer:2,why:'AI 素材仍需要人工检查，尤其是商品细节、文字和容易误导消费者的内容。'},
    {id:'listing',level:'L4',name:'上架前的最后一张清单',topic:'会上架',xp:80,question:'提交真实商品上架前，哪一项最重要？',options:['只确认标题有热门关键词','核对价格、库存、规格、素材与配送信息','先上架再补齐重要信息'],answer:1,why:'上架是对外承诺，核心商品信息和履约信息应由你逐项确认。'},
    {id:'proof',level:'L4',name:'区分点击成功和上架成功',topic:'会上架',xp:80,question:'在真实经营中，怎样确认商品已成功上架？',options:['查看平台在售状态，并保留可核验记录','点击了提交按钮就算成功','教学进度条满了就算成功'],answer:0,why:'教学模拟与真实平台状态是两回事。正式成果需要平台记录或证据与审核。'},
    {id:'content',level:'L5',name:'写给一个具体的人',topic:'懂推广',xp:80,question:'推广通勤包时，哪种表达更具体可信？',options:['全网第一，所有人都需要','保证买了就能升职','说明容量、重量及通勤使用体验，并提供真实素材'],answer:2,why:'具体的使用场景和可验证的商品信息，比无法证明的承诺更有价值。'},
    {id:'review',level:'L5',name:'让发布由自己确认',topic:'懂推广',xp:80,question:'AI 写完推广文案后，下一步应当是？',options:['静默自动发到所有平台','人工核对内容与商品，再确认发布','不看内容，只看字数'],answer:1,why:'外部发布应经人工确认，同时保存发布记录，便于后续复盘。'},
    {id:'funnel',level:'L6',name:'沿着经营链路找问题',topic:'会复盘',xp:80,question:'商品有曝光但点击少，你会优先检查什么？',options:['主图、标题与目标人群是否匹配','马上断定平台没有用','只增加库存'],answer:0,why:'先定位问题发生在哪个环节，再针对该环节调整；保留前后数据作比较。'},
    {id:'iterate',level:'L6',name:'做一次有依据的调整',topic:'会复盘',xp:80,question:'怎样让下一次复盘更有价值？',options:['每天同时改掉全部设置','只记住偶然卖得好的那天','记录假设、调整内容和结果，再决定是否保留'],answer:2,why:'记录变化及其依据，能让经营经验逐步成为可复用的方法。'}
  ];
  const DECOR=[
    {id:'ufo',name:'飞碟招牌',tag:'给灵感一个着陆点',cell:0,color:'#70d7cb'},
    {id:'ramen',name:'深夜拉面灯',tag:'夜里也有烟火气',cell:1,color:'#ff826d'},
    {id:'flowers',name:'窗边小花箱',tag:'先种下一个小目标',cell:2,color:'#e9be5b'},
    {id:'telescope',name:'屋顶望远镜',tag:'总有新商机在远处',cell:3,color:'#dfc88d'},
    {id:'windmill',name:'慢慢转风车',tag:'小店也有自己的节奏',cell:4,color:'#d5a16b'},
    {id:'cat',name:'打盹的小橘',tag:'今日最佳摸鱼搭子',cell:5,color:'#efaa69'}
  ];
  const SIDE=[
    {id:'side-demand',name:'别只看点赞数',reward:'ufo',question:'判断一个商机，值得同时关注什么？',options:['需求、竞争与成本','只有热搜排名','只有个人喜好'],answer:0,why:'结合多种线索，才容易看见机会与风险。'},
    {id:'side-review',name:'读懂一条差评',reward:'ramen',question:'同类商品反复被评价“拉链易坏”，你应该？',options:['忽略差评','验证问题，检查自己的货源与质量','删掉自己的商品介绍'],answer:1,why:'差评可以提供需求与质量线索，但要进一步核实，而非盲目照搬。'},
    {id:'side-photo',name:'给素材做个体检',reward:'flowers',question:'素材里的商品颜色与实物不一致时？',options:['更漂亮就行','让买家自己猜','修正后再用，并核对其他细节'],answer:2,why:'素材的准确性和美观同样重要。'},
    {id:'side-cost',name:'找出隐藏成本',reward:'telescope',question:'估计利润时，容易被漏掉的是？',options:['物流、退货损耗与推广成本','只有采购价','商品名称'],answer:0,why:'完整记录成本，再判断商品是否适合你。'},
    {id:'side-test',name:'一次只验证一个想法',reward:'windmill',question:'想知道新主图有没有效果，最好？',options:['主图、价格、标题一起改','尽量控制其他条件，观察调整后的数据','只看朋友喜不喜欢'],answer:1,why:'减少同时变化的因素，更容易解释结果。'},
    {id:'side-rest',name:'给小店留一点呼吸',reward:'cat',question:'学习卡住了，你可以怎样继续？',options:['必须立刻做完所有关卡','放弃记录，全部重来','先保存，回顾一个小问题，稍后接着学'],answer:2,why:'经营和学习都需要节奏。进度会保留，你随时可以回来。'}
  ].map(task=>({...task,xp:20,level:'side',topic:'支线探索'}));
  const COLORS=['#eee0c5','#a6c4b0','#a8bdd4','#d4b8a2','#c4b6d8'];
  const PALETTES={wall:COLORS,sign:['#9c531e','#407766','#426a9c','#805284','#cc9741'],roof:['#bd3f23','#517b61','#4c6e97','#715589','#806453']};
  function create(){return {schema_version:1,graphics_quality:'auto',theme:'auto',main:[],side:[],placements:[],npc_chat:[],inventory_seen:Object.entries(PALETTES).flatMap(([category,colors])=>colors.map(color=>category+':'+color)),wall_color:COLORS[0],sign_color:PALETTES.sign[0],roof_color:PALETTES.roof[0],shop_name:'我的小店',companion_name:'阿策',companion_named:false};}
  function normalize(value){
    const s=create();if(!value||value.schema_version!==1)return s;
    s.graphics_quality=['auto','smooth','detail'].includes(value.graphics_quality)?value.graphics_quality:'auto';
    s.theme=['day','night','auto'].includes(value.theme)?value.theme:'auto';
    s.main=MAIN.filter(t=>Array.isArray(value.main)&&value.main.includes(t.id)).map(t=>t.id);
    // 主线仅认可连续完成的前缀，防止乱序存档跳过学习阶段。
    const firstMissing=MAIN.findIndex(t=>!s.main.includes(t.id));if(firstMissing>=0)s.main=s.main.slice(0,firstMissing);
    s.side=SIDE.filter(t=>Array.isArray(value.side)&&value.side.includes(t.id)).map(t=>t.id);
    s.wall_color=COLORS.includes(value.wall_color)?value.wall_color:COLORS[0];
    for(const part of ['sign','roof'])s[part+'_color']=PALETTES[part].includes(value[part+'_color'])?value[part+'_color']:PALETTES[part][0];
    s.npc_chat=typeof EmcCopilot!=='undefined'?EmcCopilot.history(value.npc_chat):(typeof require==='function'?require('./emc-copilot.js').history(value.npc_chat):[]);
    const copilot=typeof EmcCopilot!=='undefined'?EmcCopilot:require('./emc-copilot.js');
    s.companion_name=copilot.companionName(value.companion_name);s.companion_named=value.companion_named===true&&!!copilot.validName(value.companion_name);
    s.shop_name=typeof value.shop_name==='string'?value.shop_name.trim().slice(0,12)||s.shop_name:s.shop_name;
    if(Array.isArray(value.placements)){
      const seen=new Set();
      s.placements=value.placements.slice(0,6).filter(p=>p&&DECOR.some(d=>d.id===p.id)&&s.side.some(id=>SIDE.find(t=>t.id===id).reward===p.id)&&!seen.has(p.id)&&seen.add(p.id)).map(p=>({id:p.id,anchor:p.anchor==='roof'?'roof':'ground',x:clamp(p.x,-4,4),y:clamp(p.y,p.anchor==='roof'?-3:0,12),z:clamp(p.z,-3.5,3.5),rotation:clamp(p.rotation,-Math.PI*2,Math.PI*2)}));
    }
    const available=inventoryItems(s).map(item=>item.key),valid=new Set(available);
    // 旧存档已有物品作为已读迁移，避免把历史奖励都误报成新获得。
    s.inventory_seen=Array.isArray(value.inventory_seen)?[...new Set(value.inventory_seen.filter(key=>typeof key==='string'&&valid.has(key)))]:available;
    return s;
  }
  function inventoryItems(s){
    const colors=Object.entries(PALETTES).flatMap(([category,values])=>values.map(color=>({key:category+':'+color,category,color})));
    return colors.concat(DECOR.filter(d=>s.side.some(id=>SIDE.find(t=>t.id===id)?.reward===d.id)).map(d=>({key:'decor:'+d.id,category:'decor',id:d.id})));
  }
  function unreadInventory(s){const seen=new Set(s.inventory_seen);return inventoryItems(s).filter(item=>!seen.has(item.key));}
  function markInventorySeen(s,key){
    if(!inventoryItems(s).some(item=>item.key===key)||s.inventory_seen.includes(key))return false;
    s.inventory_seen.push(key);return true;
  }
  function clamp(v,min,max){return typeof v==='number'&&Number.isFinite(v)?Math.max(min,Math.min(max,v)):0;}
  function xp(s){return s.main.length*80+s.side.length*20;}
  function stage(s){let n=0;STAGES.forEach((v,i)=>{if(xp(s)>=v.xp&&s.main.length>=v.mains)n=i});return n;}
  function current(s){return MAIN.find(t=>!s.main.includes(t.id))||null;}
  function complete(s,id,answer){
    const task=[...MAIN,...SIDE].find(t=>t.id===id);
    if(!task)return {ok:false,reason:'任务不存在'};
    const collection=task.level==='side'?s.side:s.main;
    if(collection.includes(id))return {ok:false,reason:'这项任务已经完成，不会重复发放经验'};
    if(task.level!=='side'&&current(s)?.id!==id)return {ok:false,reason:'请先完成当前主线'};
    if(answer!==task.answer)return {ok:false,reason:'再想一想。'+task.why};
    collection.push(id);return {ok:true,xp:task.xp,reward:task.reward,why:task.why};
  }
  return {STAGES,MAIN,SIDE,DECOR,COLORS,PALETTES,create,normalize,xp,stage,current,complete,inventoryItems,unreadInventory,markInventorySeen};
});
