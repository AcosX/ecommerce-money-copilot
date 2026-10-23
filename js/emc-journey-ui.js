(function(global){
  'use strict';
  const Story=global.EmcJourneyStory,J=global.EmcJourney,Api=global.EmcApi,Session=global.EmcSession;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KEY='emc-journey-entry-v1';
  const STATUS={ready:'待行动',draft:'成果草稿',pending:'审核中',approved:'已通过',rejected:'需完善',locked:'未解锁'};
  function create(options){
    let draft={saved:false,platform:'xiaohongshu',agent:'Codex',category:'',shop_name:options.shopName(),partner_name:options.partnerName()},project=null,projects=[],artifacts=[],verifications=[],owner=null,epoch=0;
    try{const raw=JSON.parse(localStorage.getItem(KEY));if(raw&&typeof raw==='object'){for(const key of ['category','shop_name','partner_name'])if(typeof raw[key]==='string')draft[key]=raw[key].slice(0,key==='category'?64:24);if(J.PLATFORMS[raw.platform])draft.platform=raw.platform;if(J.AGENTS.includes(raw.agent))draft.agent=raw.agent;draft.saved=raw.saved===true;}}catch(_){}
    let view=draft.saved?'task':'setup',active='L1',kitOpen=false,busy=false,loading=false,confirmed=false,error='',notice='',files={},notes='',listingUrl='',attempt=null,advisorText=null,celebration=null;
    let welcomed=false,firstPrepared=false,firstNote={idea:'',budget:'',time:''};try{welcomed=localStorage.getItem('emc-journey-welcome-v1')==='1';}catch(_){}
    if(!welcomed)view='welcome';
    const host=options.container,blobURLs=new Map(),deliveryDrafts=new Map(),aiReviews=new Map();
    const workspaceScope=()=>String(Session.current()?.player?.id||'guest')+':'+String(project?.id||'entry')+':formal';

    function selectLevel(id){if(active===id)return;saveConversation();deliveryDrafts.set(active,{files,notes,listingUrl,attempt,confirmed});active=id;planningConversation=conversations.get(id)||[];planningReport=reports.get(id)||'';const saved=deliveryDrafts.get(id);files=saved?.files||{};notes=saved?.notes||'';listingUrl=saved?.listingUrl||'';attempt=saved?.attempt||null;confirmed=saved?.confirmed||false;}
    const conversations=new Map(),reports=new Map();let planningConversation=[],planningReport='';
    function saveConversation(){conversations.set(active,planningConversation);reports.set(active,planningReport);}
    function clearPrivateDrafts(){conversations.clear();reports.clear();planningConversation=[];planningReport='';for(const url of blobURLs.values())URL.revokeObjectURL(url);blobURLs.clear();deliveryDrafts.clear();aiReviews.clear();files={};notes='';listingUrl='';attempt=null;confirmed=false;firstPrepared=false;firstNote={idea:'',budget:'',time:''};}
    const profile=()=>({...draft,platform:project?.platform||draft.platform,category:project?.category||draft.category,shop_name:project?.name||draft.shop_name});
    const progress=()=>J.progress(project,artifacts,verifications),task=()=>progress().levels.find(l=>l.id===active)||progress().levels[0];
    const badge=l=>`<span class="j-status ${l.status}">${STATUS[l.status]}</span>`;
    const button=(action,text,cls='')=>action==='deliver'?`<button type="button" class="mail-attachment primary" data-j-action="deliver" ${busy?'disabled':''}><i aria-hidden="true">▤</i><span><b>${esc(Story.get(task().id).practice)}</b><small>${esc(Story.get(task().id).enclosureHint)}</small><em>${text}</em></span></button>`:`<button type="button" class="j-button ${cls}" data-j-action="${action}" ${busy?'disabled':''}>${text}</button>`;
    function remember(){try{localStorage.setItem(KEY,JSON.stringify(draft));return true;}catch(_){error='浏览器暂时无法保存入场信息，请稍后重试。';return false;}}
    function clearFiles(){for(const file of Object.values(files).flat()){const url=blobURLs.get(file);if(url)URL.revokeObjectURL(url);blobURLs.delete(file);}deliveryDrafts.delete(active);files={};attempt=null;confirmed=false;}
    async function pages(path){let cursor=null,rows=[];do{const result=await Api.get(path+(path.includes('?')?'&':'?')+'limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));rows.push(...result.items);cursor=result.next_cursor;}while(cursor);return rows;}
    async function refresh({silent=false,afterSubmit=false}={}){
      const player=Session.current()?.authenticated?Session.current().player.id:null;
      if(busy&&owner===player&&!afterSubmit)return;
      const token=++epoch;
      if(owner!==player){owner=player;project=null;projects=[];artifacts=[];verifications=[];celebration=null;clearPrivateDrafts();view=!welcomed?'welcome':draft.saved?'task':'setup';}
      if(!player){loading=false;options.onUpdate();return;}
      const previousProject=project?.id,previous=progress();loading=true;if(!silent){error='';renderIfOpen();}
      try{
        const found=await pages('/api/projects?status=active');if(token!==epoch)return;projects=found;
        const selected=found.find(p=>p.id===project?.id)||found[0]||null;
        if(!selected){project=null;artifacts=[];verifications=[];return;}
        const [arts,subs]=await Promise.all([pages('/api/artifacts?project_id='+encodeURIComponent(selected.id)),pages('/api/verifications')]);if(token!==epoch)return;
        project=selected;artifacts=arts;verifications=subs;for(const sub of subs){if(sub.status!=='pending')options.notify?.({id:sub.id+':'+sub.status,time:sub.decided_at||sub.created_at,text:`${J.LEVELS.find(l=>l.type===sub.snapshot?.artifact_type)?.id||'本关'} 审核${sub.status==='approved'?'通过':'需要补充'}：${sub.reviews?.at(-1)?.reason||sub.rejection_reason||'请查看对应关卡的审核详情。'}`});}if(view==='setup'&&!draft.saved){draft.platform=selected.platform;draft.category=selected.category;draft.shop_name=selected.name;view='task';}
        const next=progress();if(view==='welcome'&&next.completed>0)view='task';
        if(!previousProject&&!['submit','setup','supplies','kit'].includes(view))selectLevel(next.current?.id||'L6');
      }catch(e){if(token===epoch&&!silent)error=e.message||'暂时没能同步经营进度。';}
      finally{if(token===epoch){loading=false;options.onUpdate();renderIfOpen();}}
    }
    function open(entry){if(busy){view='submit';render();return;}if(celebration){view='reward';render();host.scrollTop=0;return;}error='';notice='';view=!welcomed&&progress().submittedCount===0?'welcome':draft.saved||project?(progress().completed===6?'final':'task'):'setup';selectLevel(progress().current?.id||'L6');kitOpen=entry==='kit';if(entry==='kit')view='kit';if(entry==='submit'&&view==='task'&&!['pending','locked','approved'].includes(task().status))view='submit';render();host.scrollTop=0;}
    function renderIfOpen(){if(options.isOpen())render();}
    function resource(item,locked=false){
      const id=typeof item==='string'?item:item.id,name=typeof item==='string'?J.SKILLS[id]:item.name;
      const url=typeof item==='object'&&item.url?item.url:'assets/skills/'+id+'.zip';
      const external=/^https?:\/\//.test(url);
      const label=locked?'审核通过后获得':id==='score'?'四维选品示例（CSV，交成果前请导出 PDF）':external?'外部资料':'给 AI 工具用的方法包';
      return `<div class="j-resource ${locked?'locked':''}"><span class="j-item-icon" aria-hidden="true">${id==='score'?'▦':'▣'}</span><span><b>${esc(name)}</b><small>${label}</small></span>${locked?'<span aria-label="未解锁">◇</span>':`<a href="${esc(url)}" ${external?'target="_blank" rel="noopener noreferrer"':'download'}>${external?'查看':'领取'} <span aria-hidden="true">↗</span></a>`}</div>`;
    }
    function setup(){
      return `<div class="j-intro"><span class="j-label">先选一个起点</span><h3>你想先了解哪个平台？</h3><p>先选平台，其他事情让${esc(options.partnerName())}陪你一步步想。没有商品和货源也可以开始。</p></div><form id="journeySetup"><fieldset class="j-platforms"><legend>选择本次练习的平台</legend>${Object.entries(J.PLATFORMS).map(([id,p])=>`<label class="j-platform ${draft.platform===id?'selected':''}"><input type="radio" name="platform" value="${id}" ${draft.platform===id?'checked':''}><span style="--platform-color:${p.color}">${p.short}</span><b>${p.name}</b><small>${p.hint}</small></label>`).join('')}</fieldset><input type="hidden" name="shop_name" value="${esc(project?.name||draft.shop_name)}"><input type="hidden" name="partner_name" value="${esc(draft.partner_name)}"><input type="hidden" name="category" value="${esc(project?.category||draft.category||'待确定')}"><input type="hidden" name="agent" value="${esc(draft.agent)}"><button class="j-button primary wide" type="submit">看看第一关要做什么 →</button></form>`;
    }
    function kit(l){
      const ids=J.kitIds(l.id,profile().platform);
      return `<article class="mail-attachment-sheet"><span class="j-label">${l.id} · 按需取用</span><h3 class="j-task-title">这一步用到的方法</h3><p class="j-description">这些资料可以辅助当前操作，不需要全部下载，也不用切换聊天。</p>${ids.map(id=>resource(id)).join('')}${l.id==='L2'?resource({id:'score',name:'四维选品打分表',url:J.SCORE_URL}):''}${l.id==='L4'?(J.LISTING_TOOLS[profile().platform]||[]).map(t=>`<a class="j-tool-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.name)} ↗</a>`).join(''):''}${button('ask','回到小商，继续当前步骤 →','primary wide')}</article>`;
    }
    function taskCard(){
      const l=task(),name=esc(options.partnerName());
      if(l.status==='pending')return `<article class="mail-attachment-sheet"><header class="mail-attachment-heading"><span>成果回执 / ${l.id}</span></header><h3 class="j-task-title">成果已收到。</h3><p class="j-description">材料已保存，审核结果会由${name}告诉你。你现在可以继续下一关。</p>${receipt(l)}${button(l.id==='L6'?'final':'next',l.id==='L6'?'查看六关进度 →':'让'+name+'带我开始下一关 →','primary wide')}<details class="j-secondary"><summary>查看审核详情</summary>${button('refresh','同步审核进度','quiet')}</details></article>`;
      if(l.status==='locked')return `<article class="mail-attachment-sheet"><h3 class="j-task-title">先完成眼前这一步。</h3><p class="j-description">前一关成功提交后就会开放这里，不需要等待审核。</p>${button('current','回到当前任务 →','primary wide')}</article>`;
      if(l.status==='approved')return `<article class="mail-attachment-sheet"><span class="j-label">${l.id} · 审核通过</span><h3 class="j-task-title">这一步，做成了。</h3>${receipt(l)}${button(l.id==='L6'?'final':'next',l.id==='L6'?'查看结业进度 →':'开始下一关 →','primary wide')}</article>`;
      return `<article class="mail-attachment-sheet j-focus-card" data-story="${l.id}"><header class="mail-attachment-heading"><span>${l.id} / 6 · ${l.topic}</span></header><span class="j-label">这次只做一件事</span><h3 class="j-task-title">${l.title}</h3><p class="j-description">${esc(l.description)}</p><section class="j-deliverable"><span>最后交回</span><h4>${esc(l.deliverable)}</h4><ul>${l.checks.map(x=>`<li>${esc(x)}</li>`).join('')}</ul><p>${['L1','L2','L6'].includes(l.id)?'和小商整理的成果即可提交，附件选填。':l.id==='L4'?'手工上架也可以，无需强制使用工具。':l.id==='L6'?'没有订单、数据少也可以，说明限制与下一步。':'整理好后再统一上传对应材料。'}</p></section>${l.status==='rejected'?`<section class="j-return-state"><b>这次先补充这一点</b><p>${esc(l.submission?.rejection_reason||'请和小商一起查看审核意见。')}</p></section>`:''}<p class="j-coach-handoff">接下来跟${name}聊。一次只处理一步，整理好后再提交。</p>${button('ask',conversations.get(l.id)?.length||planningConversation.length?'继续和'+name+'完成这一步 →':'让'+name+'带我开始 →','primary wide')}<details class="j-secondary"><summary>已经准备好成果？</summary>${button('deliver','直接检查并提交成果','quiet')}</details></article>`;
    }
    function receipt(l){
      if(!l.submission)return '';
      const feedback=l.submission.reviews?.at(-1)?.report||l.submission.agent_review?.report;
      const sent=l.submission.snapshot?.content?.evidence_groups||l.artifact?.content?.evidence_groups||[];
      const report=l.submission.snapshot?.content?.report_text||l.submission.snapshot?.content?.planning_report;
      return `${l.submission.agent_review?`<p class="j-muted">${{queued:'小商已收到审核任务',leased:'小商正在阅读材料',retry:'审核服务暂时繁忙，正在重试',waiting_manual:'材料已保留，等待进一步复核',completed:'小商已完成审核'}[l.submission.agent_review.state]||'审核中'}</p>`:''}${feedback?`<section class="j-goal"><h4>小商的反馈</h4><p>${esc(feedback.summary)}</p><ul>${(feedback.issues||[]).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`:''}${report?`<details class="j-goal"><summary>查看已提交的成果</summary><div class="markdown-body">${global.EmcMarkdown.render(report)}</div></details>`:''}<div class="j-receipt"><span>交付回执</span><b>${esc(l.deliverable)}</b>${sent.length?`<small>${sent.map(g=>esc(g.label)).join(' · ')}</small>`:''}<small>${l.submission.evidence_count||l.submission.evidence_ids?.length?'已收到 '+(l.submission.evidence_count||l.submission.evidence_ids?.length)+' 份材料':'对应材料已收到'}${l.submission.created_at?' · '+esc(new Date(l.submission.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):''}</small></div>`;
    }
    function supplies(){
      const state=progress(),p=profile();
      return `<span class="j-label">带着方法，继续经营</span><h3 class="j-task-title">我的锦囊</h3><p class="j-description">任务附带的方法，和一路做成事情后获得的技能，都收在这里。</p>${state.levels.filter(l=>l.status!=='locked').map(l=>{const ids=Story.get(l.id).support?.kind==='skill'?J.kitIds(l.id,p.platform):[],drops=J.rewards(l.id,p.platform),canClaim=l.id==='L1'?l.submitted:l.status==='approved';return `<section class="j-supply-group"><header><span>${l.id} · ${l.topic}</span>${badge(l)}</header>${ids.map(id=>resource(id)).join('')}${l.id==='L4'?'<p class="j-muted">工具入口收在本关任务卡的锦囊里。</p>':''}${drops.length?`<div class="j-supply-drop"><small>${canClaim?'✦ 可领取的锦囊':'◇ 审核后获得'}</small>${drops.map(r=>resource(r,!canClaim)).join('')}</div>`:!ids.length&&l.id!=='L4'?'<p class="j-muted">本关由伙伴陪你复盘，不掉落额外技能。</p>':''}<button class="j-button quiet" data-j-level="${l.id}">回看这张任务卡 →</button></section>`;}).join('')}${button('roadmap','回到闯关路线','quiet')}`;
    }
    function rewardCard(){
      const won=celebration?.levels.map(id=>J.level(id))||[task()],state=progress(),p=profile(),drops=won.flatMap(l=>J.rewards(l.id,p.platform));
      return `<section class="j-reward-screen" role="status"><span class="j-label">${won.map(l=>l.id).join(' + ')} · 成果确认通过</span><div class="j-reward-seal" aria-hidden="true">✓<span>STEP COMPLETE</span></div><h3 class="j-task-title">这一步，做成了。</h3><p class="j-description">${won.map(l=>esc(l.title)).join('、')}</p><div class="j-earned-xp">+${celebration?.xp||160}<small>经营经验</small></div>${celebration&&celebration.to>celebration.from?`<div class="j-growth-earned"><small>小店进入新阶段</small><b>${J.GROWTH[celebration.to-1]}</b><span>${J.GROWTH[celebration.from-1]} → ${J.GROWTH[celebration.to-1]}</span></div>`:''}${drops.length?`<section class="j-drops"><h4>你的新锦囊 <span>✦</span></h4>${drops.map(r=>resource(r)).join('')}</section>`:'<p class="j-muted">这次的经营成果已经记入你的成长进度。</p>'}<p class="j-muted">${state.current?'下一张任务卡已解锁：'+esc(state.current.title):'六关已认可，你获得了经营训练结业资格；真实第一单是独立挑战。'}</p><div class="j-reward-actions">${button('next',state.current?'带上锦囊，继续下一关 →':'查看结业与破零挑战 →','primary wide')}</div>${button('supplies','回看已获得的锦囊','quiet')}</section>`;
    }
    function roadmap(){
      const state=progress();
      return `<div class="j-intro"><span class="j-label">六关经营训练</span><h3>每做成一步，<br>小店就向前一点。</h3>
      <p>已提交 ${state.submittedCount} / 6 关成果，<br>审核通过 ${state.completed} / 6 关。<br>提交即可继续，六关通过后获得训练结业资格。</p></div>
      <ol class="j-roadmap">${state.levels.map(l=>`<li class="${l.status}"><button data-j-level="${l.id}"><span class="j-road-node">${l.status==='approved'?'✓':l.id.slice(1)}</span><span><small>${l.id} · ${l.topic}</small><b>${l.title}</b></span>${badge(l)}</button></li>`).join('')}
      </ol>
      <div class="j-growth-strip">${J.GROWTH.map((name,i)=>`<span class="${state.stage===i+1?'current':''}">${name}</span>`).join('')}</div>`;
    }
    function uploadSlots(l){return l.slots.map(slot=>`<section class="j-upload-slot"><div><h4>${slot.label} ${slot.required?'<small>必填</small>':'<small>选填</small>'}</h4><p>${slot.hint}</p></div><label class="j-upload"><input type="file" data-j-files="${slot.id}" accept="image/png,image/jpeg,image/webp${slot.images?'':',application/pdf'}" ${busy?'disabled':''} multiple><span aria-hidden="true">＋</span><b>选择${slot.images?'图片':'文件'}</b><small>${slot.images?'PNG / JPG / WebP':'PDF / PNG / JPG / WebP'} · 每个 ≤10 MB</small></label><div class="j-file-list">${(files[slot.id]||[]).map((file,index)=>{let preview='';if(file.type.startsWith('image/')){if(!blobURLs.has(file))blobURLs.set(file,URL.createObjectURL(file));preview=`<img src="${blobURLs.get(file)}" alt="${esc(slot.label)}预览">`;}return `<div>${preview}<span><b>${esc(file.name)}</b><small>${(file.size/1024).toFixed(0)} KB</small></span><button aria-label="移除 ${esc(file.name)}" data-j-remove="${slot.id}:${index}" ${busy?'disabled':''}>×</button></div>`;}).join('')}</div></section>`).join('');}
    function delivery(){
      const l=task();const paper='';if(!Session.isLoggedIn())return `${paper}<span class="j-label">${l.id} · 交成果</span><h3 class="j-task-title">让这一步留下记录。</h3><p class="j-description">登录后，成果会保存到你的经营项目。任务内容和锦囊可以继续查看。</p><div class="j-checklist">${l.slots.filter(s=>s.required).map(s=>`<p>□ ${s.label}</p>`).join('')}</div>${button('login','登录后提交成果','primary wide')}${button('back','返回任务卡','quiet')}`;
      return `${paper}<div class="j-card-top"><span class="j-label">${l.id} · 交成果</span>${button('back','← 返回任务卡','quiet')}</div><h3 class="j-task-title">${l.deliverable}</h3><p class="j-description">${['L1','L2','L6'].includes(l.id)?'检查和小商整理的成果后，直接交给':'把对应的材料放进来，交给'}${esc(options.partnerName())}确认。</p><form id="journeyDelivery">${['L1','L2','L6'].includes(l.id)?`<details class="j-secondary"><summary>需要补充来源或附件？（选填）</summary>${uploadSlots(l)}</details>`:uploadSlots(l)}${l.id==='L4'?`<label class="j-field">商品链接（与在售截图二选一）<input name="listing_url" type="url" maxlength="2000" value="${esc(listingUrl)}" placeholder="https://…" ${busy?'disabled':''}></label>`:''}${!project&&(!draft.category||draft.category==='待确定')?`<label class="j-field">这次确定的经营方向<input name="category" required maxlength="64" value="" placeholder="例如：租房桌面收纳" ${busy?'disabled':''}></label>`:''}<label class="j-field">${['L1','L2','L6'].includes(l.id)?'成果内容（可直接提交）':'成果内容 / 操作说明'}<textarea name="notes" rows="${l.id==='L1'?10:3}" maxlength="12000" ${l.id==='L1'?'required':''} ${busy?'disabled':''} placeholder="说说你做了什么、使用了哪些数据，或这次最想确认的问题…">${esc(notes)}</textarea></label><label class="j-consent"><input name="confirm" type="checkbox" required ${confirmed?'checked':''} ${busy?'disabled':''}><span>我已检查材料真实、与本关对应，并遮盖了无关的个人信息。</span></label><p class="j-muted">最多 5 个文件。提交成功后进入确认中，并可继续下一关；审核结果另行通知。</p><button type="submit" class="j-button primary wide" ${busy?'disabled':''}>${busy?'正在交付，请稍候…':'交给'+esc(options.partnerName())+'确认 →'}</button></form>`;
    }
    function finalTrial(){
      const p=progress();
      return `<span class="j-label">六关成果</span><h3 class="j-task-title">回看走过的每一步。</h3><p class="j-description">已提交 ${p.submittedCount} / 6；审核通过 ${p.completed} / 6。提交记录与审核结果都来自你的经营项目。</p><p class="j-muted">经营训练不要求真实成交。六关认可后还需核对成果一致性；目前这里仅显示审核进度。</p>${button('roadmap','查看六关审核结果 →','primary wide')}`;
    }
    function render(){
      if(!options.isOpen())return;
      const p=profile();host.classList.add('journey-body');host.dataset.jView=view;
      host.innerHTML=''+(error?`<div class="j-message error" role="alert">${esc(error)}</div>`:'')+(notice?`<div class="j-message" role="status">${esc(notice)}</div>`:'')+(view==='welcome'?global.EmcJourneyGuidance.welcome(options.partnerName(),'data-j-action="begin"'):view==='setup'?setup():view==='roadmap'?roadmap():view==='submit'?`<article class="mail-attachment-sheet"><header class="mail-attachment-heading"><span>${task().id} / 检查成果</span>${button('letter-back','← 放回信封','quiet')}</header>${delivery()}</article>`:view==='final'?finalTrial():view==='kit'?kit(task()):view==='supplies'?supplies():view==='reward'?rewardCard():taskCard());global.EmcLetterArt?.decorate(host);
    }
    async function ensureProject(){
      if(project)return project;
      const p=profile();const created=await Api.post('/api/projects',{name:p.shop_name,platform:p.platform,category:p.category,description:'第一单经营旅程；使用 '+p.agent},{idempotencyKey:attempt.projectKey});return created;
    }
    async function submit(){
      if(!confirmed){error='请先检查成果并勾选确认。';render();return;}
      if(!project&&!draft.saved){view='setup';error='先选好平台和类目，再交回这一关的成果。';render();return;}
      if(loading){error='正在同步经营进度，请稍候再交成果。';render();return;}
      const l=task(),invalid=J.validateDelivery(l,files,notes,listingUrl);if(invalid){error=invalid;render();return;}
      if(l.status==='locked'||['pending','approved'].includes(l.status)){error='本关当前无法提交，请同步进度。';render();return;}
      const token=epoch,identity=owner;
      attempt=attempt||{projectKey:Api.newIdempotencyKey(),artifactKey:Api.newIdempotencyKey(),submissionKey:Api.newIdempotencyKey(),uploads:new Map(),uploadKeys:new Map(),artifact:null,submission:null};
      busy=true;error='';render();
      try{
        const current=()=>{if(token!==epoch||identity!==Session.current()?.player?.id)throw new Error('登录身份已变化，请重新选择成果文件。');};
        const groups=[];
        for(const slot of l.slots){const ids=[];for(const file of files[slot.id]||[]){current();let uploaded=attempt.uploads.get(file);if(!uploaded){const data=new FormData();data.append('file',file);let key=attempt.uploadKeys.get(file);if(!key){key=Api.newIdempotencyKey();attempt.uploadKeys.set(file,key);}uploaded=await Api.post('/api/evidence',data,{idempotencyKey:key,timeoutMs:60000});current();attempt.uploads.set(file,uploaded);}ids.push(uploaded.id);}if(ids.length)groups.push({slot:slot.id,label:slot.label,evidence_ids:ids});}
        current();const savedProject=await ensureProject();current();project=savedProject;const p=profile();
        if(!attempt.artifact)attempt.artifact=await Api.post('/api/artifacts',{project_id:project.id,artifact_type:l.type,schema_version:1,title:l.title,origin:'formal',source_level_id:l.id,content:{summary:notes.trim().slice(0,1000)||l.deliverable,report_text:notes.trim(),...(l.id==='L4'&&listingUrl?{listing_url:listingUrl.trim()}:{}),conversation:planningConversation,platform:p.platform,category:p.category,delivery_method:l.method,agent:p.agent,evidence_groups:groups,...(l.id==='L1'?{planning_report:notes.trim(),conversation:planningConversation,delivery_method:planningConversation.length?'conversation':'report'}:{})}},{idempotencyKey:attempt.artifactKey});
        current();attempt.submission=await Api.post('/api/verifications',{artifact_id:attempt.artifact.id,artifact_version:attempt.artifact.version,evidence_ids:groups.flatMap(g=>g.evidence_ids),note:(notes.trim()||l.goal).slice(0,2000)},{idempotencyKey:attempt.submissionKey});current();
        const submitted=attempt.submission,submittedArtifact=attempt.artifact;options.notify?.({id:submitted.id+':received',time:submitted.created_at,text:`${l.id} 的成果已经收到并保存，审核中。${l.id==='L6'?'六关成果交齐后可以查看结业进度。':'下一关已开放，我们继续一次做一步。'}`});clearFiles();notes='';listingUrl='';view='task';artifacts=[{...submittedArtifact,id:submitted.artifact_id,project_id:project.id,artifact_type:l.type,origin:'formal',status:'submitted'},...artifacts];notice='成果已提交，下一关已经解锁！审核在后台进行。';options.sound('submit');await refresh({afterSubmit:true});
      }catch(e){error=e.message||'暂时没能提交，已选材料仍在，可以重试。';}
      finally{busy=false;renderIfOpen();options.onUpdate();}
    }
    async function copyBrief(){const text=J.brief(active,profile(),options.partnerName());try{await navigator.clipboard.writeText(text);notice='任务指令已复制，交给你的 agent 即可。';options.sound('pick');}catch(_){notice='请手动复制下面的任务指令。';render();const pre=document.createElement('textarea');pre.className='j-copy-fallback';pre.readOnly=true;pre.value=text;host.append(pre);pre.select();return;}render();}
    async function prepareContext(){if(task().id==='L1'&&!advisorText){try{const r=await fetch('assets/skills/category-business-advisor.md');if(r.ok)advisorText=await r.text();}catch(_){}}return api.context();}
    async function ask(){await prepareContext();options.ask(global.EmcLevelCoach.prompt(task(),profile()));}
    host.addEventListener('click',async e=>{
      const level=e.target.closest('[data-j-level]'),remove=e.target.closest('[data-j-remove]'),b=e.target.closest('[data-j-action]');if(busy)return;
      if(level){celebration=null;selectLevel(level.dataset.jLevel);view='task';kitOpen=false;error='';notice='';render();host.scrollTop=0;return;}
      if(remove){const [slot,index]=remove.dataset.jRemove.split(':');const file=files[slot][Number(index)];if(blobURLs.has(file)){URL.revokeObjectURL(blobURLs.get(file));blobURLs.delete(file);}files[slot].splice(Number(index),1);attempt=null;confirmed=false;render();return;}
      if(!b)return;if(b.dataset.jAction==='deliver')global.EmcLetterArt?.capture(host,b);else if(['back','letter-back'].includes(b.dataset.jAction))global.EmcLetterArt?.capture(host,b,true);error='';notice='';options.sound(b.dataset.jAction==='kit'?'kit':'click');
      if(b.dataset.jAction==='begin'){welcomed=true;try{localStorage.setItem('emc-journey-welcome-v1','1');}catch(_){}view=draft.saved||project?'task':'setup';}
      else if(b.dataset.jAction==='first-prepare')firstPrepared=true;
      else if(b.dataset.jAction==='first-unsure'){const hint=host.querySelector('[data-guide-hint]');if(hint)hint.hidden=false;return;}
      else if(b.dataset.jAction==='first-ask'){options.ask('我想从零学电商。想尝试的方向：'+(firstNote.idea||'还没想好')+'；预算：'+(firstNote.budget||'还不确定')+'；每周时间：'+(firstNote.time||'还不确定')+'。请先陪我理清自己的条件，不用直接给结论。');return;}
      else if(b.dataset.jAction==='kit'){if(task().status==='locked')return;kitOpen=!kitOpen;}
      else if(b.dataset.jAction==='roadmap'){celebration=null;view='roadmap';}
      else if(b.dataset.jAction==='supplies'){celebration=null;view='supplies';}

      else if(b.dataset.jAction==='final')view='final';
      else if(b.dataset.jAction==='deliver'){if(task().status==='locked')return;view='submit';}
      else if(['back','letter-back'].includes(b.dataset.jAction))view='task';
      else if(b.dataset.jAction==='profile'){if(project){draft.platform=project.platform;draft.category=project.category;draft.shop_name=project.name;}view='setup';}
      else if(b.dataset.jAction==='current'){selectLevel(progress().current?.id||'L6');view='task';}
      else if(b.dataset.jAction==='next'){celebration=null;const index=J.LEVELS.findIndex(l=>l.id===active);if(index===5)view='final';else{selectLevel(J.LEVELS[index+1].id);view='task';kitOpen=false;}}
      else if(b.dataset.jAction==='refresh'){await refresh();return;}
      else if(b.dataset.jAction==='ai-review'){const subId=task().submission?.id,slot=host.querySelector('[data-emc-review-slot]')||host;if(subId&&global.EmcAvatarAgent?.runDeliverablePreReview){await global.EmcAvatarAgent.runDeliverablePreReview(subId,slot);if(slot!==host)aiReviews.set(subId,slot.innerHTML);}return;}
      else if(b.dataset.jAction==='copy'){await copyBrief();return;}
      else if(b.dataset.jAction==='companion'){options.openCompanion?.();return;}
      else if(b.dataset.jAction==='ask'){await ask();return;}
      else if(b.dataset.jAction==='login'){Session.requireLogin('提交经营成果');return;}
      render();if(!['kit','copy'].includes(b.dataset.jAction))host.scrollTop=0;
    });
    host.addEventListener('input',e=>{if(busy)return;if(e.target.dataset.guideInput)firstNote[e.target.dataset.guideInput]=e.target.value.slice(0,120);if(e.target.matches('#journeyDelivery textarea,#journeyDelivery [name=listing_url]')){if(e.target.name==='listing_url')listingUrl=e.target.value;else notes=e.target.value;attempt=null;confirmed=false;const confirm=host.querySelector('[name=confirm]');if(confirm)confirm.checked=false;}});
    host.addEventListener('change',e=>{if(busy)return;const slot=e.target.dataset.jFiles;if(slot){const additions=Array.from(e.target.files);files[slot]=[...(files[slot]||[]),...additions];attempt=null;confirmed=false;const invalid=J.validateFiles({...task(),slots:task().slots.map(s=>({...s,required:false}))},files);if(invalid){files[slot].splice(-additions.length);error=invalid;}else error='';render();}else if(e.target.name==='platform'){draft.platform=e.target.value;host.querySelectorAll('.j-platform').forEach(el=>el.classList.toggle('selected',el.querySelector('input').checked));}});
    host.addEventListener('submit',e=>{
      if(!['journeySetup','journeyDelivery'].includes(e.target.id))return;e.preventDefault();if(busy)return;
      if(e.target.id==='journeyDelivery'){notes=e.target.elements.notes.value;listingUrl=e.target.elements.listing_url?.value||'';if(e.target.elements.category){draft.category=e.target.elements.category.value.trim();if(!draft.category){error='请确认这次的经营方向。';render();return;}remember();}confirmed=e.target.elements.confirm.checked;void submit();return;}
      const data=new FormData(e.target),partner=global.EmcCopilot.validName(data.get('partner_name'));
      if(!partner){error='伙伴名称请使用 1—12 个中英文字或数字。';render();return;}
      if(project&&(project.platform!==data.get('platform')||project.category!==String(data.get('category')).trim())){error='当前项目的平台与类目已确定。请保留原设置，另一个方向需要单独建立经营项目。';render();return;}
      if(!String(data.get('shop_name')).trim()||!String(data.get('category')).trim()){error='请填写小店名称和想经营的类目。';render();return;}
      draft={saved:true,platform:data.get('platform'),agent:data.get('agent'),category:String(data.get('category')).trim(),shop_name:String(data.get('shop_name')).trim().slice(0,12),partner_name:partner};
      if(!remember()){render();return;}options.onProfile(draft);view='task';selectLevel(progress().current?.id||'L6');kitOpen=false;error='';notice='';render();options.onUpdate();host.scrollTop=0;
    });
    setInterval(()=>{if(!document.hidden&&Session.isLoggedIn()&&!busy&&!loading&&!(options.isOpen()&&['submit','setup'].includes(view))&&artifacts.some(a=>a.status==='submitted'))void refresh({silent:true});},15000);
    const api={recordConversation:(message,reply,id=active)=>{const rows=[...(conversations.get(id)||[]),{role:'user',text:message.slice(0,1000)},{role:'assistant',text:reply.slice(0,4000)}].slice(-16);conversations.set(id,rows);reports.set(id,reply.slice(0,8000));if(id===active){planningReport=reports.get(id);planningConversation=rows;}},collectConversation:()=>{if(!planningConversation.length)return false;notes=planningReport;firstPrepared=true;welcomed=true;view='submit';render();return true;},openLevel:(id,entry)=>{if(entry==='submit'){welcomed=true;firstPrepared=true;}selectLevel(id==='first_order'?'L6':id);view=!welcomed&&progress().submittedCount===0?'welcome':id==='first_order'?'final':entry==='submit'&&!['pending','locked','approved'].includes(task().status)?'submit':entry==='kit'?'kit':entry==='roadmap'?'roadmap':entry==='supplies'?'supplies':entry==='profile'?'setup':'task';kitOpen=entry==='kit';celebration=null;render();host.scrollTop=0;},practiceRecords:()=>progress().levels.filter(l=>l.artifact).map(l=>({id:l.id,title:l.deliverable,status:STATUS[l.status]})),open,render,refresh,prepareContext,profile,progress,isEditing:()=>view==='submit'||view==='setup',currentTask:task,reportPrompt:()=>global.EmcLevelCoach.prompt(task(),{...profile(),report:true}),context:()=>({journey:{platform:profile().platform,category:profile().category,agent:profile().agent,completed:progress().completed,status:task().status},task:{id:task().id,name:task().title,topic:task().topic,deliverable:task().deliverable,required_evidence:task().slots.filter(s=>s.required).map(s=>s.label)},skill_ids:J.kitIds(task().id,profile().platform),...(advisorText?{skill_instructions:advisorText}:{})}),summary:()=>({project_id:project?.id||null,view,active,loading,busy,error,profile:profile(),completed:progress().completed,stage:progress().stage,status:task().status,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,v.length]))})};
    return api;
  }
  global.EmcJourneyUI={create};
})(window);
