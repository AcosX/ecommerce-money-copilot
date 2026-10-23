const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const J=require('../emc-journey.js');

test('another project review never enters the current companion conversation',async()=>{
  const notices=[];
  const project={id:'project-current',platform:'xiaohongshu',category:'收纳',name:'当前小店'};
  const responses={
    '/api/projects?status=active':{items:[project]},
    '/api/artifacts?project_id=project-current':{items:[{id:'artifact-current',project_id:project.id,artifact_type:'direction_plan',origin:'formal',status:'approved'}]},
    '/api/verifications':{items:[
      {id:'old-submission',artifact_id:'artifact-other',status:'approved',snapshot:{project_id:'project-other',artifact_type:'direction_plan'},reviews:[{reason:'别的小店的审核'}]},
      {id:'current-submission',artifact_id:'artifact-current',status:'approved',snapshot:{project_id:project.id,artifact_type:'direction_plan'},reviews:[{reason:'当前小店的审核'}]}
    ]}
  };
  const root={EmcJourney:J,EmcApi:{get:async url=>responses[url.replace(/[?&]limit=100/,'')]},EmcSession:{current:()=>({authenticated:true,player:{id:'player'}})},localStorage:{getItem:()=>null},setInterval:()=>{}};
  root.window=root;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../emc-journey-ui.js'),'utf8'),root);
  const journey=root.EmcJourneyUI.create({container:{addEventListener:()=>{}},shopName:()=>'',partnerName:()=>'',isOpen:()=>false,onUpdate:()=>{},notify:event=>notices.push(event)});
  await journey.refresh();
  assert.equal(journey.summary().error,'');
  assert.equal(notices.length,1);
  assert.match(notices[0].text,/当前小店的审核/);
  assert.doesNotMatch(notices[0].text,/别的小店/);
});
