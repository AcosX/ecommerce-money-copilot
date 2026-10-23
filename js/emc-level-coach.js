(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcLevelCoach=api;})(globalThis,function(){
  'use strict';
  const FIRST={L1:'你想服务什么样的人？还没方向也可以，我们先从你熟悉的人和事聊起。',L2:'沿用上一关的方向，你已经看到过什么候选商品？先说一件就好。',L3:'沿用选定的商品，顾客看到原图时，最看不清哪一件事？',L4:'商品和素材准备好了，我们先核对售价。你准备卖多少钱？',L5:'先确定这条内容写给谁。谁最可能在什么场景用到这件商品？',L6:'先确定复盘的时间范围。你想看哪几天？数据少、没有成交也没关系。'};
  function introduction(task){return `这次我们只做「${task.title}」。\n最后交回：${task.deliverable}。\n我会一次带你处理一个问题，整理好成果后再去提交。\n\n${FIRST[task.id]||''}`;}
  function prompt(task,{platform='',category='',report=false}={}){
    const scope=`我正在做 ${task.id}「${task.title}」，平台：${platform||'待确定'}，方向：${category||'待确定'}。`;
    const contract=`本关成果：${task.deliverable}。需要覆盖：${task.checks.join('；')}。`;
    return report?`${scope}请根据我们本关已经讨论的内容，整理一份可以检查并提交的《${task.deliverable}》。只使用我提供的事实，缺少信息明确写待补充，不编造数据或已执行操作。${contract}最后只列出仍需我实际完成的事项。`:`${scope}${contract}请带我完成本关，一次只推进一个小步骤、只问一个最关键的问题；先利用我已经给过的信息，不要同时让我填表、下载锦囊或打开多个工具。工具只在当下需要时介绍，不必让我复述已提交的前序成果。`;
  }
  return {introduction,prompt};
});
