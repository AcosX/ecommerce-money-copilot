'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),J=require('../emc-journey.js');
const project={id:'prj_test'},artifact=(id,status='approved',origin='formal')=>({id:'art_'+id,project_id:project.id,artifact_type:J.level(id).type,status,origin});
test('正式成果有效提交立即解锁下一关；草稿和越级成果不解锁',()=>{
  assert.equal(J.progress(project,[artifact('L1','draft')]).levels[1].status,'locked');
  assert.equal(J.progress(project,[{...artifact('L1'),project_id:'other'}]).levels[1].status,'locked');
  assert.equal(J.progress(project,[artifact('L2')]).levels[1].status,'locked');
  const pending=J.progress(project,[artifact('L1','submitted')]);
  assert.equal(pending.levels[0].status,'pending');
  assert.equal(pending.levels[1].status,'ready');
  assert.equal(pending.current.id,'L2');
  assert.equal(pending.submittedCount,1);
  assert.equal(pending.completed,0);
  const rejected=J.progress(project,[artifact('L1','rejected'),artifact('L2','submitted')]);
  assert.equal(rejected.levels[2].status,'ready');
  assert.equal(rejected.current.id,'L3');
  assert.equal(rejected.completed,0);
  assert.equal(rejected.submittedCount,2);
});
test('六关全部正式成果提交可继续但不能因 pending 直接结业',()=>{
  const state=J.progress(project,J.LEVELS.map(l=>artifact(l.id,'submitted')));
  assert.equal(state.submittedCount,6);
  assert.equal(state.current,null);
  assert.equal(state.completed,0);
  assert.equal(state.certified,false);
  assert.equal(state.firstOrder,'optional');
});
test('五段成长与六关对应，六关通过也不能冒充真实首单与正式证书',()=>{
  for(const [count,stage] of [[0,1],[1,1],[2,2],[3,2],[4,3],[5,4],[6,4]]){
    const state=J.progress(project,J.LEVELS.slice(0,count).map(l=>artifact(l.id)));
    assert.equal(state.stage,stage);
    assert.equal(state.completed,count);
    assert.equal(state.certified,false);
    assert.equal(state.firstOrder,'optional');
  }
});
test('每关有独立交付结构，前后图和工具/在售图不能互相替代',()=>{const image={name:'a.png',type:'image/png',size:200};assert.match(J.validateFiles(J.level('L3'),{before:[image]}),/优化后/);assert.equal(J.validateFiles(J.level('L3'),{before:[image],after:[image]}),null);assert.match(J.validateFiles(J.level('L4'),{listing:[image]}),/工具/);assert.match(J.validateFiles(J.level('L2'),{selection:[{...image,type:'application/zip'}]}),/PDF/);assert.match(J.validateFiles(J.level('L1'),{report:[{...image,size:11*1024*1024}]}),/10 MB/);});
test('平台对应的锦囊与掉落不混用；13 个原始技能包都有前端资源',()=>{assert.deepEqual(J.kitIds('L2','pinduoduo'),['pdd-product-scout']);assert.deepEqual(J.kitIds('L3','xiaohongshu'),['xhs-visual-material']);assert.equal(J.rewards('L3','pinduoduo')[0].id,'pdd-keyword-title');assert.deepEqual(J.rewards('L2','pinduoduo'),[]);for(const id of Object.keys(J.SKILLS))assert.ok(fs.existsSync(path.join(__dirname,'../../assets/skills',id+'.zip')));assert.equal(Object.keys(J.SKILLS).length,13);});
test('任务指令带入平台、类目、交付物与人工确认',()=>{const text=J.brief('L3',{platform:'pinduoduo',category:'家居收纳'},'小满');assert.match(text,/拼多多/);assert.match(text,/家居收纳/);assert.match(text,/Before \/ After/);assert.match(text,/标明数据来源/);assert.match(text,/发布或上架前先让我确认/);});
