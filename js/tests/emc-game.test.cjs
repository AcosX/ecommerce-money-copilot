'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../emc-game.js'),S=require('../emc-tutorial-save.js');
test('主线顺序、答错和幂等经验',()=>{const s=G.create();assert.equal(G.complete(s,'goal',0).ok,false);assert.equal(G.complete(s,'audience',0).ok,false);assert.equal(G.xp(s),0);assert.ok(G.complete(s,'audience',1).ok);assert.equal(G.complete(s,'audience',1).ok,false);assert.equal(G.xp(s),80);});
test('支线不跳过主线，最后一项主线才升到百货大楼',()=>{const s=G.create();G.SIDE.forEach(t=>G.complete(s,t.id,t.answer));assert.equal(G.stage(s),0);G.MAIN.forEach((t,i)=>{G.complete(s,t.id,t.answer);if(i<11)assert.ok(G.stage(s)<4);});assert.equal(G.stage(s),4);assert.equal(G.xp(s),1080);assert.equal(G.current(s),null);});
test('只保留连续主线、已拥有装饰和有限坐标',()=>{const s=G.normalize({...G.create(),main:['audience','demand'],side:['side-demand','unknown'],verified:true,placements:[{id:'ufo',anchor:'roof',x:100,y:NaN,z:-50,rotation:Infinity},{id:'ufo',x:1},{id:'cat',x:1}]});assert.deepEqual(s.main,['audience']);assert.deepEqual(s.side,['side-demand']);assert.deepEqual(s.placements,[{id:'ufo',anchor:'roof',x:4,y:0,z:-3.5,rotation:0}]);assert.equal(s.verified,undefined);});
test('五级边界和兼容旧存档，不损失装修及其他阶段练习',()=>{const g=G.create(),expected=[0,1,1,2,2,2,3,3,3,3,3,4];G.MAIN.forEach((t,i)=>{G.complete(g,t.id,t.answer);assert.equal(G.stage(g),expected[i]);});G.complete(g,G.SIDE[0].id,G.SIDE[0].answer);g.placements=[{id:'ufo',anchor:'roof',x:1,y:.25,z:2,rotation:Math.PI/2}];const root=S.createDefault();root.levels.L2.exercise_result.legacy={note:'保留既有练习'};root.levels.L1.exercise_result.shop_game_v1=g;const d=S.decode(JSON.stringify(root));assert.equal(d.status,'restored');assert.deepEqual(G.normalize(d.data.levels.L1.exercise_result.shop_game_v1),g);assert.deepEqual(d.data.levels.L2.exercise_result.legacy,{note:'保留既有练习'});});

test('新增招牌/屋顶配色兼容旧存档，非法颜色回到默认值',()=>{const old={schema_version:1,main:[],side:[],placements:[],wall_color:G.COLORS[2],shop_name:'旧店名'};let g=G.normalize(old);assert.equal(g.wall_color,G.COLORS[2]);assert.equal(g.sign_color,G.PALETTES.sign[0]);assert.equal(g.roof_color,G.PALETTES.roof[0]);g.sign_color=G.PALETTES.sign[3];g.roof_color=G.PALETTES.roof[2];assert.deepEqual(G.normalize(g),g);assert.equal(G.normalize({...g,roof_color:'url(evil)'}).roof_color,G.PALETTES.roof[0]);});

test('新物品逐件已读并汇总分类，重复奖励不重复提示',()=>{
 const g=G.create();assert.deepEqual(G.unreadInventory(g),[]);
 assert.ok(G.complete(g,G.SIDE[0].id,G.SIDE[0].answer).ok);assert.deepEqual(G.unreadInventory(g).map(i=>i.key),['decor:ufo']);
 assert.equal(G.markInventorySeen(g,'decor:cat'),false);assert.equal(G.markInventorySeen(g,'unknown'),false);
 assert.equal(G.markInventorySeen(g,'decor:ufo'),true);assert.equal(G.markInventorySeen(g,'decor:ufo'),false);assert.deepEqual(G.unreadInventory(g),[]);
 G.complete(g,G.SIDE[0].id,G.SIDE[0].answer);assert.deepEqual(G.unreadInventory(g),[]);
 G.complete(g,G.SIDE[1].id,G.SIDE[1].answer);assert.deepEqual(G.unreadInventory(g).map(i=>i.key),['decor:ramen']);
});
test('旧存档迁移不误报历史奖励，已读列表只接受已拥有物品',()=>{
 const old=G.create();old.side=[G.SIDE[0].id];delete old.inventory_seen;const migrated=G.normalize(old);assert.deepEqual(G.unreadInventory(migrated),[]);
 const g=G.normalize({...old,inventory_seen:['decor:cat','decor:ufo','decor:ufo','wall:'+G.COLORS[0],'bogus',null]});assert.deepEqual(g.inventory_seen,['decor:ufo','wall:'+G.COLORS[0]]);
 assert.ok(G.unreadInventory(g).some(i=>i.category==='wall'));assert.ok(G.unreadInventory(g).some(i=>i.category==='sign'));assert.ok(G.unreadInventory(g).some(i=>i.category==='roof'));assert.ok(G.unreadInventory(g).filter(i=>i.category==='decor').every(i=>G.DECOR.find(d=>d.id===i.id).available));
});
test('逐件已读状态可随教学存档保存恢复，保留尚未查看的奖励',()=>{
 const g=G.create();G.SIDE.slice(0,2).forEach(t=>G.complete(g,t.id,t.answer));G.markInventorySeen(g,'decor:ufo');
 const data=S.createDefault();data.levels.L1.exercise_result.shop_game_v1=g;
 const restored=G.normalize(S.decode(JSON.stringify(data)).data.levels.L1.exercise_result.shop_game_v1);
 assert.deepEqual(G.unreadInventory(restored).map(i=>i.key),['decor:ramen']);assert.deepEqual(restored,g);
});

test('导入装饰默认可用，超过六件的摆放存档完整保留',()=>{const g=G.create();G.SIDE.forEach(t=>G.complete(g,t.id,t.answer));g.placements=G.DECOR.map(d=>({id:d.id,anchor:'ground',x:0,y:0,z:0,rotation:0}));const saved=G.normalize(g);assert.equal(saved.placements.length,11);assert.deepEqual(saved.placements,g.placements);const fresh=G.create();assert.equal(G.inventoryItems(fresh).filter(i=>i.category==='decor').length,5);assert.equal(G.normalize({...fresh,placements:g.placements}).placements.length,5);});
