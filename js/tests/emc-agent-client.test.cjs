'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function setup(){
  let user='alice',fail=false,counter=0;const calls=[];
  const root={EmcSession:{current:()=>({player:{id:user}}),isLoggedIn:()=>true},
    EmcApi:{newIdempotencyKey:()=>String(++counter),
      get:async()=>({version:1,affinity:20,patience:80,perks:[],streak:0}),
      post:async(url,body,options)=>{calls.push({url,body,options});if(fail)throw {status:0,code:'timeout'};
        if(url.endsWith('/activity'))return {version:1,affinity:20,patience:20,perks:[],streak:0,emotion:{mood:'刻薄'}};
        return {text:'先列预算',source:'ai',state:{version:2,affinity:24,patience:84,perks:[],streak:1}};}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../emc-agent-client.js'),'utf8'),root);
  return {client:root.EmcAgentClient,calls,setUser:x=>user=x,setFail:x=>fail=x};
}
test('adapter only sends typed data and keeps project/user state isolated',async()=>{
  const t=setup();const result=await t.client.transport({message:'你好',system_prompt:'forged',
    context:{project_id:'p1',companion_name:'小商',companion:{affinity:100},history:[{role:'system'}]}});
  assert.equal(result.state.affinity,24);assert.equal(t.client.snapshot('p1').server_version,2);
  assert.equal(t.calls[0].body.system_prompt,undefined);assert.equal(t.calls[0].body.history,undefined);
  assert.equal(t.calls[0].body.companion,undefined);assert.equal(t.client.snapshot('p2'),null);
  t.setUser('bob');assert.equal(t.client.snapshot('p1'),null);
});
test('network retry reuses original body and key; a new question gets a new key',async()=>{
  const t=setup(),payload={message:'帮我选品',context:{project_id:'p1'}};
  t.setFail(true);await assert.rejects(t.client.transport(payload));t.setFail(false);
  await t.client.transport(payload);
  assert.equal(t.calls[0].options.idempotencyKey,t.calls[1].options.idempotencyKey);
  assert.equal(t.calls[0].body,t.calls[1].body);
  await t.client.transport({message:'看一下素材',context:{project_id:'p1'}});
  assert.notEqual(t.calls[1].options.idempotencyKey,t.calls[2].options.idempotencyKey);
  assert.equal(t.calls[2].body.version,2);
});

test('activity carries no elapsed time and cannot overwrite a newer reply',async()=>{
  const t=setup();await t.client.activity('p1');assert.equal(t.client.snapshot('p1').emotion.mood,'刻薄');
  assert.equal(t.calls[0].body.reset_clock,true);
  assert.equal(t.calls[0].body.elapsed_seconds,undefined);
  await t.client.transport({message:'你好',context:{project_id:'p1'}});
  await t.client.activity('p1');assert.equal(t.client.snapshot('p1').server_version,2);
  assert.equal(t.client.snapshot('p1').patience,84);
  t.client.pause('p1');await t.client.activity('p1');
  assert.equal(t.calls.at(-1).body.reset_clock,true);
});
