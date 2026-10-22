const {test}=require('node:test'),assert=require('node:assert/strict');
const Story=require('../emc-journey-story.js'),Journey=require('../emc-journey.js');
test('剧情附件按任务发放，内置引导和工具地址不冒充通用技能锦囊',()=>{
  assert.deepEqual(Story.ids,['L1','L2','L3','L4','L5','L6','first_order']);
  for(const id of ['L1','L6','first_order'])assert.equal(Story.get(id).support,null);
  for(const id of ['L2','L3','L5'])assert.equal(Story.get(id).support.kind,'skill');
  assert.equal(Story.get('L4').support.kind,'tools');
  assert.match(Story.get('L4',{platform:'pinduoduo'}).support.hint,/妙手/);assert.doesNotMatch(Story.get('L4',{platform:'xiaohongshu'}).support.hint,/拼多多|妙手/);
});
test('跳关预览不声称玩家已经完成上一关，剧情不改真实经验与验收',()=>{
  const before=Journey.progress(null);
  assert.equal(Story.get('L2',{completed:0}).bridge,null);assert.ok(Story.get('L2',{completed:1}).bridge);
  for(const id of Story.ids){const story=Story.get(id,{completed:0});assert.equal(story.paragraphs.length,2);assert.equal(story.steps.length,3);assert.ok(story.practice);assert.ok(story.resolved);}
  assert.deepEqual(Journey.progress(null),before);assert.equal(before.xp,0);assert.equal(before.certified,false);
  const changed=Story.get('L2');changed.support.title='改名';changed.paragraphs.push('额外内容');assert.equal(Story.get('L2').paragraphs.length,2);assert.notEqual(Story.get('L2').support.title,'改名');
});
