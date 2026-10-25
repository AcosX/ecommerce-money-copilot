const{test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{pathToFileURL}=require('node:url');
const moduleURL=pathToFileURL(path.resolve(__dirname,'../../tools/model-showcase.js')).href;
test('展示链接约束等级与画质，跨页保留选择且不接受任意跳转',async()=>{
 const{readShowcaseState,showcaseURL}=await import(moduleURL);
 assert.deepEqual(readShowcaseState('https://example.test/tools/models.html?level=3&quality=smooth'),{level:3,quality:'smooth'});
 for(const [level,expected]of [['-3',0],['99',5],['3.9',3],['bad',0],['Infinity',0]])assert.equal(readShowcaseState('https://example.test/?level='+level).level,expected);
 assert.equal(readShowcaseState('https://example.test/?quality=bad').quality,'auto');
 for(const page of ['hub','single','island','evolution']){
  const url=showcaseURL(page,{level:4,quality:'smooth'},'https://example.test/sub/tools/models.html');
  assert.equal(url.origin,'https://example.test');assert.ok(url.pathname.startsWith('/sub/tools/'));
  assert.equal(url.searchParams.get('level'),'4');assert.equal(url.searchParams.get('quality'),'smooth');
 }
 assert.throws(()=>showcaseURL('https://other.test/',{}),RangeError);
});
test('生产 Apache 放行展示页面所需资源，录制脚本与其他工具仍不发布',()=>{
 const root=path.resolve(__dirname,'../..'),config=fs.readFileSync(path.join(root,'deploy/apache/money-acosx.conf.template'),'utf8');
 const section=config.match(/<LocationMatch "(\^\/tools\/[^\n]+)">([\s\S]*?)<\/LocationMatch>/);
 assert.ok(section);assert.match(section[2],/Require all granted/);
 // 项目归档后展示页同为静态冻结内容，随 assets/css/js 一起长缓存（无单独 Header）。
 const caching=config.match(/<LocationMatch "\^\/\(assets\|css\|js\|tools\)\/">([\s\S]*?)<\/LocationMatch>/);
 assert.ok(caching);assert.match(caching[1],/Cache-Control "public, max-age=31536000, immutable"/);
 const allowed=new RegExp(section[1]);
 for(const file of ['models.html','models.css','models.js','model-showcase.js','model-showcase.css','building-evolution.html','building-evolution.js','building-evolution.css','buildings-preview.html','island-buildings-preview.html','building-diy.js','building-diy.css']){
  assert.equal(allowed.test('/tools/'+file),true,file);assert.ok(fs.existsSync(path.join(root,'tools',file)),file);
 }
 for(const file of ['record-building-evolution.cjs','render-showcase-posters.cjs','build-flat-island.py','character-preview.html','.env','models.html/anything'])assert.equal(allowed.test('/tools/'+file),false,file);
});
