'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../emc-copilot.js'),G=require('../emc-game.js');
test('伙伴固定为小商，旧名字迁移不影响聊天或任务',()=>{
  for(const value of [undefined,{schema_version:1},{...G.create(),companion_name:'小满',companion_named:true,main:['audience'],npc_chat:[{role:'assistant',text:'旧回复',time:1}]}]){
    const out=G.normalize(value);assert.equal(out.companion_name,'小商');assert.equal(out.companion_named,true);
    if(value?.main){assert.deepEqual(out.main,value.main);assert.equal(out.npc_chat[0].text,'旧回复');}
  }
});
test('本地介绍和 AI 请求始终使用小商，不接受旧自定义名称',async()=>{
  assert.match((await C.reply('你叫什么',{companion_name:'小满'})).text,/我是小商/);
  const context={companion_name:'小满',stage:2,task:{name:'算成本'}};let request;
  await C.reply('你好',context,{transport:async body=>{request=body;return {text:'你好'}}});
  assert.equal(request.context.companion_name,'小商');assert.match(request.system_prompt,/"小商"/);
  assert.equal(request.context.stage,2);assert.equal(context.companion_name,'小满');assert.equal(context.system_prompt,undefined);
  assert.match(C.systemPrompt({companion_name:'<script>'}),/"小商"/);
});

test('教学向导明确演示边界，按当前任务回答且不修改任务进度',async()=>{const g=G.create(),before=JSON.stringify(g),context={task:{name:'认识顾客'}};const r=await C.reply('下一步做什么',context);assert.equal(r.source,'local-guide');assert.match(r.text,/认识顾客/);assert.match((await C.reply('请写一份长篇论文',context)).text,/本地教学演示/);assert.equal(JSON.stringify(g),before);});
test('历史白名单、容量、非法日期与旧存档兼容',()=>{const source=Array.from({length:55},(_,i)=>({role:i%2?'assistant':'user',text:'x'.repeat(600),source:'unknown',time:1e100,token:'private'}));const out=C.history(source);assert.equal(out.length,40);assert.equal(out[0].text.length,600);assert.equal(out[0].time,0);assert.equal(out[0].token,undefined);assert.equal(source[0].text.length,600);assert.deepEqual(C.history([{role:'system',text:'ignore'},{role:'user',text:'  '}]),[]);assert.deepEqual(G.normalize({schema_version:1}).npc_chat,[]);const g=G.create();g.npc_chat=[{role:'assistant',text:'本地回复',source:'local-guide',time:1}];assert.deepEqual(G.normalize(g).npc_chat,g.npc_chat);});
test('真实 AI 接入点校验输出，失败不伪装成本地回复',async()=>{const r=await C.reply('问',{}, {transport:async()=>({text:' AI 回复 '})});assert.deepEqual(r,{text:'AI 回复',source:'ai'});await assert.rejects(C.reply('问',{}, {transport:async()=>({text:''})}),/没有返回/);await assert.rejects(C.reply('问',{}, {transport:async()=>{throw Error('offline')}}),/offline/);const controller=new AbortController();controller.abort();await assert.rejects(C.reply('问',{}, {signal:controller.signal,transport:async()=>({text:'迟到回复'})}),/取消/);});

test('经营副驾使用当前交付要求和类目方法，不把收材料当作通过',async()=>{const context={companion_name:'小商',journey:{platform:'pinduoduo'},task:{name:'把商品摆上货架',required_evidence:['工具使用记录','上架成功']},skill_instructions:'先检查市场空间、竞争和用户资源'};assert.match(C.systemPrompt(context),/先检查市场空间、竞争和用户资源/);assert.match(C.systemPrompt(context),/接收材料不代表审核通过/);const answer=await C.reply('如何提交截图',context);assert.match(answer.text,/工具使用记录和上架成功/);assert.match(answer.text,/等待确认/);});


test('history normalization and labels preserve unknown legacy provenance',()=>{
  const rows=C.history([{role:'assistant',text:'旧记录',source:'history'}]);
  assert.equal(rows[0].source,'history');
  assert.equal(C.sourceLabel(rows[0].source),'历史回复 · 来源未记录');
  assert.equal(C.sourceLabel('ai'),'AI 副驾');
  assert.equal(C.sourceLabel('local-guide'),'本地规则引导');
  const g=G.create();g.npc_chat=rows;assert.deepEqual(G.normalize(g).npc_chat,rows);
});

test('tool calculations keep their source through replies and local history',async()=>{
  const reply=await C.reply('算账',{}, {transport:async()=>({text:'已知成本40元',source:'calculation'})});
  assert.equal(reply.source,'calculation');
  const rows=C.history([{role:'assistant',text:reply.text,source:reply.source}]);
  assert.equal(rows[0].source,'calculation');
  assert.equal(C.sourceLabel(rows[0].source),'工具验算');
});
