(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcJourney=api;})(globalThis,function(){
  'use strict';
  const PLATFORMS={xiaohongshu:{name:'小红书',short:'红',hint:'用内容讲清商品价值',color:'#ee6b77'},pinduoduo:{name:'拼多多',short:'拼',hint:'从需求与价格力出发',color:'#ed985b'}};
  const AGENTS=['Codex','WorkBuddy','千问办公','豆包工作','AccioWork'];
  const SKILLS={
    'category-business-advisor':'类目生意分析','xhs-product-scout':'小红书选品参谋','pdd-product-scout':'拼多多选品参谋','xhs-competitor-analyzer':'小红书竞品分析',
    'xhs-visual-material':'小红书视觉素材','pdd-listing-optimizer':'拼多多商品优化','xhs-keyword-topic':'小红书关键词与选题','pdd-keyword-title':'拼多多关键词与标题',
    'xhs-video-script':'小红书视频脚本','pdd-video-script':'拼多多视频脚本','xhs-note-optimizer':'小红书笔记优化','xhs-ads-doctor':'小红书广告诊断','pdd-ads-doctor':'拼多多广告诊断'
  };
  const SCORE_URL='assets/templates/四维选品单-示例.csv';
  const LEVELS=[
    {id:'L1',type:'business_plan',topic:'定方向',title:'给小生意定个方向',description:'开店前先想清楚：这个赛道有没有得做？竞争有多大？凭什么是你？',goal:'完成你的《生意规划报告》，交给伙伴确认。',deliverable:'生意规划报告',tip:'告诉伙伴你的预算、货源和可投入的时间，一起判断先做哪个平台、哪个类目。',checks:['赛道空间与增长线索','竞争情况与切入机会','你的资源、优势与下一步'],slots:[{id:'report',label:'生意规划报告',hint:'上传完整报告的 PDF 或清晰截图',required:true}],kits:{both:['category-business-advisor']},reward:'score',method:'report'},
    {id:'L2',type:'product_selection',topic:'会选品',title:'选出能卖得动的商品',description:'用规则跑一版选品单，再用打分表比较热度、竞争与利润。AI 帮你跑单，最后由你拍板。',goal:'提交选品单或选品报告，附上你的选择理由。',deliverable:'选品单 / 选品报告',tip:'从销量、高增低供、趋势信号和供给优势中选一个角度，让你的 agent 跑出候选单。',checks:['候选商品与参考来源','热度、竞争、利润的比较','你确认的商品与理由'],slots:[{id:'selection',label:'选品单或报告',hint:'表格请导出 PDF，也可上传清晰截图',required:true}],kits:{xiaohongshu:['xhs-product-scout'],pinduoduo:['pdd-product-scout']},reward:'competitor',method:'selection'},
    {id:'L3',type:'asset_pack',topic:'做素材',title:'让商品图替你说话',description:'把选中的商品做成一套清晰、真实、让人想点进去的主图与详情。',goal:'分别提交优化前与优化后的素材，说明你改了什么。',deliverable:'Before / After 对比图',tip:'用你的 agent，或 Linkfox、绘蛙等工具优化素材，再对照平台规范检查商品还原度与文字。',checks:['商品外观、规格与实物一致','主体清晰，信息容易看懂','改动说明与前后对比对应'],slots:[{id:'before',label:'优化前',hint:'原商品主图或详情截图',required:true,images:true},{id:'after',label:'优化后',hint:'优化后的对应图片',required:true,images:true}],kits:{xiaohongshu:['xhs-visual-material'],pinduoduo:['pdd-listing-optimizer']},reward:'keyword',method:'comparison'},
    {id:'L4',type:'listing_record',topic:'会上架',title:'把商品摆上货架',description:'素材做好，把选中的商品铺到店铺后台，让小店正式开始营业。',goal:'提交工具使用截图和平台上架成功截图。',deliverable:'工具使用 + 上架成功截图',tip:'可以使用妙手、逸淘或你的 agent。提交前自己核对价格、库存、类目和配送信息。',checks:['价格、库存与类目已核对','保留工具实际使用记录','商家后台显示商品已在售'],slots:[{id:'tool',label:'工具使用记录',hint:'工具或 agent 操作页面截图',required:true,images:true},{id:'listing',label:'上架成功',hint:'平台显示商品在售的截图',required:true,images:true}],kits:{both:[]},method:'listing'},
    {id:'L5',type:'content_post',topic:'会内容',title:'让商品被看见',description:'把卖点变成一篇有人愿意看的笔记或视频：说清价值、拿出证据、写给具体的人。',goal:'提交内容发布成功截图，可补充工具使用过程。',deliverable:'发布成功截图',tip:'用内容工具或 agent 生成图文、脚本和视频；发布前自己看一遍，确认内容与商品一致。',checks:['卖点清楚，有真实素材支撑','发布前已人工检查','平台显示内容发布成功'],slots:[{id:'published',label:'发布成功',hint:'包含内容与发布状态的截图',required:true,images:true},{id:'tool',label:'工具使用过程',hint:'可选，附上生成过程的截图',required:false,images:true}],kits:{xiaohongshu:['xhs-video-script','xhs-note-optimizer'],pinduoduo:['pdd-video-script']},reward:'ads',method:'content'},
    {id:'L6',type:'data_review',topic:'会复盘',title:'从数据里解锁出单密码',description:'看清哪里好、哪里差，找到最该优化的一环，为下一轮经营排出顺序。',goal:'提交归因与调优策略报告，附上使用的数据。',deliverable:'归因与调优策略报告',tip:'把经营数据交给伙伴或自己的 agent，先确认时间范围与数据口径，再讨论原因和优化动作。',checks:['数据来源、时间范围与口径明确','区分事实、假设与待验证的问题','优化动作有优先级与验证办法'],slots:[{id:'review',label:'复盘报告',hint:'归因分析与下一步调优策略',required:true},{id:'data',label:'经营数据',hint:'可选，补充后台数据截图或 PDF',required:false}],kits:{both:[]},method:'review'}
  ];
  const LISTING_TOOLS={xiaohongshu:[{name:'逸淘 · 张飞搬家',url:'https://www.1tsoft.com/html/pay_down.html',hint:'从官方页面选择小红书铺货工具'}],pinduoduo:[{name:'妙手 · 拼多多上货',url:'https://pdd.91miaoshou.com/',hint:'前往官方上货工具'},{name:'逸淘 · 大胡子搬家',url:'https://www.1tsoft.com/html/pay_down.html',hint:'从官方页面选择拼多多铺货工具'}]};
  const GROWTH=['新手店主','成长店主','成熟店主','进阶店主','破零卖家'];
  function level(id){return LEVELS.find(l=>l.id===id);}
  function kitIds(id,platform){const kits=level(id)?.kits||{};return [...(kits.both||[]),...(kits[platform]||[])];}
  function rewards(id,platform){const reward=level(id)?.reward;if(reward==='score')return [{id:'score',name:'四维选品打分表示例',url:SCORE_URL,external:false}];if(reward==='competitor')return platform==='xiaohongshu'?[{id:'xhs-competitor-analyzer',name:SKILLS['xhs-competitor-analyzer']}]:[];const key=reward==='keyword'?(platform==='pinduoduo'?'pdd-keyword-title':'xhs-keyword-topic'):reward==='ads'?(platform==='pinduoduo'?'pdd-ads-doctor':'xhs-ads-doctor'):null;return key?[{id:key,name:SKILLS[key]}]:[];}
  function progress(project,artifacts=[],verifications=[]){
    // A successful formal submission, not an AI/human approval, opens the next lesson.
    // Backend-reviewed "approved" and "rejected" artifacts also prove a prior submission.
    const formal=artifacts.filter(a=>a.project_id===project?.id&&['formal','tutorial_copy'].includes(a.origin));
    const submittedStatuses=new Set(['submitted','approved','rejected']);
    let previousSubmitted=true;
    const levels=LEVELS.map(l=>{
      const rows=formal.filter(a=>a.artifact_type===l.type);
      const submittedRows=rows.filter(a=>submittedStatuses.has(a.status));
      const hasSubmitted=submittedRows.length>0;
      const selected=submittedRows[0]||rows[0]||null;
      const submission=verifications.filter(v=>v.artifact_id===selected?.id)
        .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
      const raw=selected?.status==='approved'?'approved':selected?.status==='submitted'?'pending':
        selected?.status==='rejected'?'rejected':selected?'draft':'ready';
      const status=previousSubmitted?raw:'locked';
      const unlocked=previousSubmitted;
      previousSubmitted=previousSubmitted&&hasSubmitted;
      return {...l,status,reviewStatus:raw,submitted:hasSubmitted,unlocked,artifact:selected,submission:submission||null};
    });
    const completed=levels.filter(l=>l.reviewStatus==='approved').length;
    const submittedCount=levels.filter(l=>l.submitted).length;
    const current=levels.find(l=>l.unlocked&&!l.submitted)||levels.find(l=>l.unlocked&&l.reviewStatus==='rejected')||null;
    // Real first-order achievement is separate from completing the training.
    const stage=completed>=5?4:completed>=4?3:completed>=2?2:1;
    return {levels,completed,submittedCount,allSubmitted:submittedCount===6,current,stage,
      xp:completed*160,firstOrder:'optional',certified:false};
  }
  function brief(id,profile,name='小商'){
    const l=level(id);if(!l)return '';
    return `我在${PLATFORMS[profile.platform]?.name||'小红书 / 拼多多'}经营「${profile.category||'待确定类目'}」，正在完成「${l.title}」。\n请帮我产出${l.deliverable}。\n需要覆盖：\n${l.checks.map((x,i)=>`${i+1}. ${x}`).join('\n')}\n请标明数据来源与日期；缺失的数据说明待验证，不编造结果。对外发布或上架前先让我确认。\n最后给出我可以提交给伙伴${name}的成果和证据清单。`;
  }
  function validateFiles(task,groups){const all=[];for(const slot of task.slots){const files=groups[slot.id]||[];if(slot.required&&!files.length)return `请先添加「${slot.label}」。`;for(const file of files){if(!['image/png','image/jpeg','image/webp',...(!slot.images?['application/pdf']:[])].includes(file.type))return '请使用 PNG、JPG、WebP'+(!slot.images?' 或 PDF':'')+'；表格和文档可先导出 PDF。';if(file.size>10*1024*1024)return '每个文件需小于 10 MB。';all.push(file);}}return all.length>5?'每次最多提交 5 个文件。':null;}
  return {PLATFORMS,AGENTS,SKILLS,LEVELS,GROWTH,LISTING_TOOLS,SCORE_URL,level,kitIds,rewards,progress,brief,validateFiles};
});
