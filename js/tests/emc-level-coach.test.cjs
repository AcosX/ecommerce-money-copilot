const {test}=require('node:test'),assert=require('node:assert/strict');
const J=require('../emc-journey.js'),C=require('../emc-level-coach.js');
const guides=require('../../backend/emc_api/data/level_guides.json');
test('六关页面与小商使用同一份交付要求',()=>{for(const level of J.LEVELS){assert.deepEqual(guides[level.id].checklist,level.checks);assert.equal(guides[level.id].deliverable_title,level.deliverable);assert.equal(guides[level.id].goal,level.goal);assert.deepEqual(guides[level.id].evidence_slots,level.slots);}});
test('每关由小商一次推进一步，整理时保留事实限制',()=>{for(const level of J.LEVELS){assert.match(C.prompt(level),/一次只/);assert.match(C.prompt(level),/不要同时/);assert.match(C.prompt(level,{report:true}),/不编造/);assert.match(C.introduction(level),new RegExp(level.deliverable.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}});

test('文本成果不用重复导出附件，上架支持真实链接，图片关卡仍需证据',()=>{
 for(const id of ['L1','L2','L6']){assert.equal(J.validateDelivery(J.level(id),{},'真实成果与来源、限制和下一步验证办法。'.repeat(4)),null);assert.ok(J.validateDelivery(J.level(id),{},'太短'));}
 assert.equal(J.validateDelivery(J.level('L4'),{},'','https://example.com/item/123'),null);
 for(const url of ['javascript:alert(1)','file:///etc/passwd','https://user:pass@example.com',''])assert.ok(J.validateDelivery(J.level('L4'),{},'',url));
 for(const id of ['L3','L5'])assert.ok(J.validateDelivery(J.level(id),{},'报告'.repeat(30)));
});
