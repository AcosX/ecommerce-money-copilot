(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.EmcJourneyStory=api;})(globalThis,function(){
  'use strict';
  // Narrative framing is separate from evidence rules and never awards progress.
  const chapters={
    L1:{scene:'开门前夜',subject:'先别急着挂上营业牌',paragraphs:['店门还没开，柜台上只有一本空白账簿。今天先不进货，先决定这间小店要为谁解决什么问题。','把你能拿出的预算、货源和时间写下来。我们一起比较赛道与竞争，找一个你有机会做起来的方向。'],quote:'先找到你的机会，再花第一笔钱。',practice:'小店经营草案',support:null,bridge:null,steps:['说清准备服务的人群与需求','比较市场、竞争和自己的资源','把判断整理成生意规划报告'],resolved:'小店终于有了方向。接下来不是把货架塞满，而是选出值得先试的一件商品。'},
    L2:{scene:'第一份货源目录',subject:'货架只有一格，先放哪件？',paragraphs:['一份货源目录摊在柜台上，几件商品都看起来不错。但我们的第一格货架，只需要一个有依据的选择。','让你的 agent 跑出候选单，再比较需求、竞争、成本与利润。热闹的商品不一定适合你，最后这道选择题由你来做。'],quote:'把“我觉得好卖”，换成你能解释的选择。',practice:'候选商品比较册',support:{kind:'skill',title:'选品锦囊',hint:'按所选平台准备的选品方法'},bridge:'上一封信确定的方向，现在要落到具体商品上。',steps:['选一种选品思路，保留参考来源','对比候选商品的热度、竞争与利润','选定商品，留下你的选择理由'],resolved:'第一个候选商品有了。下一步，让没见过实物的人也能看懂它。'},
    L3:{scene:'顾客留下的问题',subject:'“它到底有多大？”',paragraphs:['我们把商品图放到橱窗里，收到的第一个问题不是价格，而是：“它到底有多大，适不适合我？”','这次不靠堆满漂亮特效。保留商品的真实外观，用一组清楚的主图与详情，把尺寸、场景和卖点讲明白。'],quote:'一张好图，是替顾客少猜一步。',practice:'商品素材对照夹',support:{kind:'skill',title:'素材优化锦囊',hint:'主图、详情与平台视觉方法'},bridge:'选品时确认的商品，是这次素材制作的主角。',steps:['保留优化前的原图','制作对应的主图或详情素材','标出改了什么，检查与实物是否一致'],resolved:'商品有了能说明问题的图片。现在，把它真正摆上平台的货架。'},
    L4:{scene:'翻开营业牌之前',subject:'开门前，再核对一遍',paragraphs:['营业牌已经放在门边，商品和图片也准备好了。离正式上架，还差最后一次核对。','价格、规格、库存和配送，哪一项填错都会给顾客添麻烦。用工具或 agent 辅助操作，最后由你确认，再把上架记录带回来。'],quote:'工具可以帮你填写，开门前的确认要由你来做。',practice:'开门营业核对单',support:{kind:'tools',title:'上架工具地址卡',hint:'妙手 / 逸淘等官方入口'},bridge:'前面准备好的商品信息和素材，在这一关一起派上用场。',steps:['核对价格、库存、规格与配送','保留工具或 agent 的使用记录','从平台后台确认商品已在售'],resolved:'货架已经摆好。接下来，要让需要它的人知道你的小店开张了。'},
    L5:{scene:'第一张营业告示',subject:'小店开了，怎么让人看见？',paragraphs:['商品上架了，但店门前还很安静。我们需要一条写给具体顾客的内容，而不是一句“欢迎光临”。','从一个使用场景开始，说清商品解决了什么，再用真实素材支撑卖点。内容发出去前，你自己先看一遍。'],quote:'别急着说“快来买”，先让顾客看到和自己有关的事。',practice:'营业内容编辑夹',support:{kind:'skill',title:'内容创作锦囊',hint:'所选平台的脚本与内容方法'},bridge:'已经上架的商品，这次要通过内容走到顾客面前。',steps:['确定顾客、场景与真实卖点','生成图文或视频并人工检查','发布后保留成功截图'],resolved:'第一条营业内容已经发出。先别猜它有没有用，下一封信我们看数据。'},
    L6:{scene:'柜台上的经营记录',subject:'有人看了，然后呢？',paragraphs:['柜台上多了一份经营记录：哪些人看过、点进来多少、有没有加购或成交。数字有高有低，先不急着下结论。','把时间范围和来源对齐，分清已知事实、可能原因和待验证的假设。找出最值得先改的一环，为下一轮安排一个能验证的小动作。'],quote:'数据不是评语，是下一轮行动的线索。',practice:'经营复盘记录册',support:null,bridge:'上架与发布留下的数据，终于可以放到一起看了。',steps:['确认数据来源、时间范围与口径','分别分析商品与内容的可能原因','写出有优先级、有验证办法的调优策略'],resolved:'这一轮经营有了复盘。把优化带回下一轮，最后让一笔真实订单为你作证。'},
    first_order:{scene:'留给第一单的位置',subject:'这一次，等真实的好消息',paragraphs:['六个环节走过，账簿上还留着一个特别的位置：第一笔真实成交。它不能由一份练习报告代替。','等订单真正发生，把支付状态、店铺归属和成交时间整理好，隐藏买家的隐私信息。通过核验后，再给这段旅程盖上最后一枚印章。'],quote:'最后这一格，留给你真正做成的生意。',practice:'首单成交凭证夹',support:null,bridge:'方法已经准备好，最后的确认来自真实经营。',steps:['准备订单支付或成交成功截图','核对店铺、商品与成交时间','隐藏买家隐私，提交可核验信息'],resolved:'从空白账簿，到第一笔真实成交。'}
  };
  function get(id,{platform='xiaohongshu',completed=0}={}){
    const chapter=chapters[id]||chapters.L1,index=id==='first_order'?6:Number(id.slice(1))-1;
    const support=chapter.support?{...chapter.support}:null;
    if(support?.kind==='tools')support.hint=platform==='pinduoduo'?'妙手 / 逸淘官方入口':'逸淘小红书铺货工具入口';
    return {...chapter,paragraphs:[...chapter.paragraphs],steps:[...chapter.steps],support,bridge:index>0&&completed>=index?chapter.bridge:null};
  }
  return {get,ids:Object.keys(chapters)};
});
