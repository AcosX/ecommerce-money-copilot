const {test}=require('node:test'),assert=require('node:assert/strict');
const values=new Map();global.localStorage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
const P=require('../emc-practice.js');
test('未知和零分母不产生虚构转化率，跨口径数据要求检查',()=>{
  assert.equal(P.rates({}),'点击率 — · 点击成交率 —');
  assert.equal(P.rates({impressions:'0',clicks:'0',orders:'0'}),'点击率 — · 点击成交率 —');
  assert.equal(P.rates({impressions:'1000',clicks:'100',orders:'5'}),'点击率 10.0% · 点击成交率 5.0%');
  assert.match(P.rates({impressions:'100',clicks:'150'}),/口径/);
});
test('试玩和正式项目不混用；创建项目后可延续账号入场草稿',()=>{
  const draft={L1:{values:{audience:'租房上班族'},updated:1}};
  values.set('emc-practice-v1:demo',JSON.stringify(draft));
  assert.equal(P.records('person-a:entry:formal').length,0);
  values.set('emc-practice-v1:person-a:entry:formal',JSON.stringify(draft));
  P.migrate('person-a:entry:formal','person-a:project-1:formal');
  assert.equal(P.records('person-a:project-1:formal').length,1);
  assert.equal(P.records('person-b:project-1:formal').length,0);
  assert.match(P.text('person-a:project-1:formal','L1'),/尚未核验/);
});
test('工作纸中的玩家文本只渲染为文字，不创建可执行标签',()=>{
  values.set('emc-practice-v1:escaped',JSON.stringify({L1:{values:{audience:'"><img src=x onerror=alert(1)>'},updated:1}}));
  const html=P.render('escaped','L1');assert.doesNotMatch(html,/<img/);assert.match(html,/&lt;img/);
});
