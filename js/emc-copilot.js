(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcCopilot=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function history(value){return Array.isArray(value)?value.filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.text==='string'&&m.text.trim()).slice(-40).map(m=>({role:m.role,text:m.text.trim().slice(0,400),source:m.source==='ai'?'ai':'local-guide',time:Number.isFinite(m.time)&&m.time>0&&m.time<=8640000000000000?m.time:0})):[];}
  function localReply(message,context){
    const task=context.task;
    if(/颜色|装修|背包|招牌|屋顶|墙/.test(message))return '点开背包，选墙面、招牌或屋顶，长按配色拖到对应位置。看到绿色提示后松手；拖回背包就取消。';
    if(/升级|经验|成长|大楼/.test(message))return '完成主线每次获得 80 经验，支线每次 20 经验。经验和主线进度都达到门槛，小店才会升级；已经获得的装饰会保留。';
    if(/成本|利润|定价/.test(message))return '可以先列采购、包装、运费、推广和退货损耗，再用售价减去全部成本估算单笔利润。这是学习建议，练习不会执行真实交易。';
    if(/顾客|人群|选品|需求/.test(message))return '先挑一个具体人群，想清楚他们在什么场景遇到什么问题，再对照商品评价、竞争和成本验证需求。不要只靠“我觉得会卖得好”。';
    if(/下一步|任务|开始|做什么|怎么做|进度/.test(message))return task?'你现在可以做「'+task.name+'」。点“继续主线”进入练习；答错也没关系，不会扣经验。': '主线已经全部完成了！可以探索支线拿装饰，或去任务手册回顾之前的知识。';
    return '当前是本地教学演示，还不能像真实 AI 一样回答所有问题。你可以问我“下一步做什么”“怎么升级”“怎么装修”，也可以先去'+(task?'完成「'+task.name+'」。':'探索支线。');
  }
  async function reply(message,context,{transport,signal}={}){
    if(typeof transport!=='function')return {text:localReply(message,context),source:'local-guide'};
    const result=await transport({message,context},{signal});if(signal?.aborted)throw new Error('对话已取消');
    if(!result||typeof result.text!=='string'||!result.text.trim())throw new Error('AI 没有返回可显示的内容');
    return {text:result.text.trim().slice(0,400),source:'ai'};
  }
  return {history,localReply,reply};
});
