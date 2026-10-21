(function(global){
  'use strict';
  const J=global.EmcJourney,Api=global.EmcApi,Session=global.EmcSession;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KEY='emc-journey-entry-v1';
  const STATUS={ready:'待行动',draft:'成果草稿',pending:'确认中',approved:'已完成',rejected:'需要补充',locked:'未解锁'};
  function create(options){
    let draft={saved:false,platform:'xiaohongshu',agent:'Codex',category:'',shop_name:options.shopName(),partner_name:options.partnerName()},project=null,projects=[],artifacts=[],verifications=[],owner=null,epoch=0;
    try{const raw=JSON.parse(localStorage.getItem(KEY));if(raw&&typeof raw==='object'){for(const key of ['category','shop_name','partner_name'])if(typeof raw[key]==='string')draft[key]=raw[key].slice(0,key==='category'?64:24);if(J.PLATFORMS[raw.platform])draft.platform=raw.platform;if(J.AGENTS.includes(raw.agent))draft.agent=raw.agent;draft.saved=raw.saved===true;}}catch(_){}
    let view='task',active='L1',kitOpen=false,busy=false,loading=false,confirmed=false,error='',notice='',files={},notes='',attempt=null,advisorText=null;
    const host=options.container,blobURLs=new Map(),deliveryDrafts=new Map();
    function selectLevel(id){if(active===id)return;deliveryDrafts.set(active,{files,notes,attempt,confirmed});active=id;const saved=deliveryDrafts.get(id);files=saved?.files||{};notes=saved?.notes||'';attempt=saved?.attempt||null;confirmed=saved?.confirmed||false;}
    function clearPrivateDrafts(){for(const url of blobURLs.values())URL.revokeObjectURL(url);blobURLs.clear();deliveryDrafts.clear();files={};notes='';attempt=null;confirmed=false;}
    const profile=()=>({...draft,platform:project?.platform||draft.platform,category:project?.category||draft.category,shop_name:project?.name||draft.shop_name});
    const progress=()=>J.progress(project,artifacts,verifications),task=()=>progress().levels.find(l=>l.id===active)||progress().levels[0];
    const badge=l=>`<span class="j-status ${l.status}">${STATUS[l.status]}</span>`;
    const button=(action,text,cls='')=>`<button type="button" class="j-button ${cls}" data-j-action="${action}" ${busy?'disabled':''}>${text}</button>`;
    function remember(){try{localStorage.setItem(KEY,JSON.stringify(draft));return true;}catch(_){error='浏览器暂时无法保存入场信息，请稍后重试。';return false;}}
    function clearFiles(){for(const file of Object.values(files).flat()){const url=blobURLs.get(file);if(url)URL.revokeObjectURL(url);blobURLs.delete(file);}deliveryDrafts.delete(active);files={};attempt=null;confirmed=false;}
    async function pages(path){let cursor=null,rows=[];do{const result=await Api.get(path+(path.includes('?')?'&':'?')+'limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''));rows.push(...result.items);cursor=result.next_cursor;}while(cursor);return rows;}
    async function refresh(){
      const player=Session.current()?.authenticated?Session.current().player.id:null,token=++epoch;
      if(owner!==player){owner=player;project=null;projects=[];artifacts=[];verifications=[];clearPrivateDrafts();view='task';}
      if(!player){loading=false;options.onUpdate();return;}
      loading=true;error='';renderIfOpen();
      try{
        const found=await pages('/api/projects?status=active');if(token!==epoch)return;projects=found;
        const selected=found.find(p=>p.id===project?.id)||found[0]||null;
        if(!selected){project=null;artifacts=[];verifications=[];return;}
        const [arts,subs]=await Promise.all([pages('/api/artifacts?project_id='+encodeURIComponent(selected.id)),pages('/api/verifications')]);if(token!==epoch)return;
        project=selected;artifacts=arts;verifications=subs;if(view!=='submit')selectLevel(progress().current?.id||'L6');
      }catch(e){if(token===epoch)error=e.message||'暂时没能同步经营进度。';}
      finally{if(token===epoch){loading=false;options.onUpdate();renderIfOpen();}}
    }
    function open(){if(busy){view='submit';render();return;}error='';notice='';view=draft.saved||project?(progress().completed===6?'final':'task'):'setup';selectLevel(progress().current?.id||'L6');kitOpen=false;render();host.scrollTop=0;}
    function renderIfOpen(){if(options.isOpen())render();}
    function resource(item,locked=false){
      const id=typeof item==='string'?item:item.id,name=typeof item==='string'?J.SKILLS[id]:item.name,external=typeof item==='object'&&item.external;
      const url=external?item.url:'assets/skills/'+id+'.zip';
      return `<div class="j-resource ${locked?'locked':''}"><span class="j-item-icon" aria-hidden="true">${external?'▦':'▣'}</span><span><b>${esc(name)}</b><small>${locked?'完成本关后解锁':external?'方法表 · 飞书':'技能包 · ZIP'}</small></span>${locked?'<span aria-label="未解锁">◇</span>':`<a href="${esc(url)}" ${external?'target="_blank" rel="noopener noreferrer"':'download'}>${external?'查看':'领取'} <span aria-hidden="true">↗</span></a>`}</div>`;
    }
    function setup(){
      return `<div class="j-intro"><span class="j-label">从一间小店，到真实第一单</span><h3>先把小店开起来。</h3><p>选一个平台，带上你的伙伴。<br>六个环节，一步一步把生意做出来。</p></div>
      <form id="journeySetup"><div class="j-two-fields"><label>小店名称<input name="shop_name" maxlength="12" value="${esc(project?.name||draft.shop_name)}" ${project?'readonly':''} required></label><label>伙伴名称<input name="partner_name" maxlength="24" value="${esc(draft.partner_name)}" required></label></div>
      <fieldset class="j-platforms"><legend>你准备在哪里开店？</legend>${Object.entries(J.PLATFORMS).map(([id,p])=>`<label class="j-platform ${draft.platform===id?'selected':''}"><input type="radio" name="platform" value="${id}" ${draft.platform===id?'checked':''}><span style="--platform-color:${p.color}">${p.short}</span><b>${p.name}</b><small>${p.hint}</small></label>`).join('')}</fieldset>
      <label class="j-field">想经营什么类目？<input name="category" maxlength="64" placeholder="例如：通勤包、宠物用品、家居收纳" value="${esc(draft.category)}" required><small>还拿不准也没关系，可以先填一个方向，再和伙伴聊。</small></label>
      <label class="j-field">你常用的 agent<select name="agent">${J.AGENTS.map(a=>`<option ${draft.agent===a?'selected':''}>${a}</option>`).join('')}</select><small>锦囊和任务指令可以交给它使用。飞书多维表格可作为辅助工具。</small></label>
      <div class="j-callout">▤ <span>每关都有一张任务卡和附带锦囊。<br>完成实操、交回成果，确认后小店才会成长。</span></div>
      <button class="j-button primary wide" type="submit" ${busy?'disabled':''}>带上伙伴，开始第一关 <span>→</span></button></form>`;
    }
    function kit(l){
      const p=profile(),ids=J.kitIds(l.id,p.platform);
      return `<section class="j-kit"><button class="j-kit-toggle" data-j-action="kit" aria-expanded="${kitOpen}" ${l.status==='locked'?'disabled':''}><span class="j-envelope" aria-hidden="true">▧</span><span><b>这一关的锦囊</b><small>${kitOpen?'收起方法与工具':'点开看看，带着方法去做'}</small></span><i>${kitOpen?'−':'+'}</i></button>${kitOpen?`<div class="j-kit-content"><p>${esc(l.tip.replaceAll('伙伴',options.partnerName()))}</p>${ids.map(id=>resource(id)).join('')}${!ids.length?'<p class="j-muted">'+(l.id==='L4'?'可使用妙手、逸淘或自己的 agent；在平台操作前请核对商品信息。':'带着数据与问题，找伙伴一起拆解。')+'</p>':''}<div class="j-inline-actions">${button('copy','复制给 '+esc(p.agent)+' 的任务指令')}${button('ask','问问'+esc(options.partnerName()),'quiet')}</div><small class="j-muted">技能包交给支持 Skills 的 agent 使用；领取文件不等于自动执行平台操作。</small></div>`:''}</section>`;
    }
    function taskCard(){
      const l=task(),p=profile(),reward=J.rewards(l.id,p.platform);
      return `<div class="j-card-top"><span class="j-label">${l.id} · ${l.topic}</span>${badge(l)}</div><h3 class="j-task-title">${l.title}</h3><p class="j-description">${l.description}</p>
      <div class="j-loop" aria-label="任务流程">${['领任务','去实践','交成果','等确认'].map((s,i)=>`<span class="${l.status==='approved'||i===(['pending','rejected'].includes(l.status)?3:view==='submit'?2:1)?'current':''}"><i>${l.status==='approved'?'✓':i+1}</i>${s}</span>`).join('')}</div>
      <section class="j-goal"><h4>这关要做到什么</h4><p>${esc(l.goal.replaceAll('伙伴',options.partnerName()))}</p><ul>${l.checks.map(x=>`<li><span aria-hidden="true">□</span>${x}</li>`).join('')}</ul></section>
      ${kit(l)}
      ${l.status==='pending'?`<section class="j-review-state"><span>◷</span><b>成果已交给${esc(options.partnerName())}</b><p>正在等待确认，暂时不会解锁下一关。<br>你可以继续逛小岛，也可以回看锦囊。</p>${button('refresh','查看最新进度','quiet')}</section>`:l.status==='rejected'?`<section class="j-return-state"><b>还需要补充一点材料</b><p>${esc(l.submission?.rejection_reason||'请补充与任务要求对应的清晰证据，再次提交。')}</p>${button('deliver','补充成果，再交一次','primary')}</section>`:l.status==='approved'?`<section class="j-review-state approved"><span>✦</span><b>这一步，做到了。</b><p>已获得 160 经验。成果确认后，下一步已经为你打开。</p>${button('next',l.id==='L6'?'看看最终试炼':'继续下一关 →','primary')}</section>`:l.status==='locked'?`<p class="j-muted">先完成前一关并获得确认，这张任务卡就会解锁。</p>`:`<div class="j-task-actions">${button('deliver','我来交成果 →','primary')}${button('copy','复制任务指令','quiet')}</div>`}
      ${reward.length?`<section class="j-drops"><h4>${l.status==='approved'?'本关掉落':'完成后掉落'} <span>✦</span></h4>${reward.map(r=>resource(r,l.status!=='approved')).join('')}</section>`:l.id==='L2'&&p.platform==='pinduoduo'?'<p class="j-muted">竞品分析锦囊：拼多多版本待补充，现有小红书技能包不会混作本平台奖励。</p>':''}
      <div class="j-card-footer">${button('roadmap','查看我的闯关路线','quiet')}${button('profile',esc(J.PLATFORMS[p.platform]?.name)+' · '+esc(p.category),'quiet')}</div>`;
    }
    function roadmap(){const state=progress();return `<div class="j-intro"><span class="j-label">你的第一单之路</span><h3>每做成一步，<br>小店就向前一点。</h3><p>已完成 ${state.completed} / 6 个经营环节。<br>最后用真实的第一单，为自己交卷。</p></div><ol class="j-roadmap">${state.levels.map(l=>`<li class="${l.status}"><button data-j-level="${l.id}"><span class="j-road-node">${l.status==='approved'?'✓':l.id.slice(1)}</span><span><small>${l.id} · ${l.topic}</small><b>${l.title}</b></span>${badge(l)}</button></li>`).join('')}<li class="final"><button data-j-action="final"><span class="j-road-node">✦</span><span><small>最终试炼</small><b>卖出真实第一单</b></span><span class="j-status ${state.completed<6?'locked':''}">${state.completed<6?'未解锁':'待开放'}</span></button></li></ol><div class="j-growth-strip">${J.GROWTH.map((name,i)=>`<span class="${state.stage===i+1?'current':''}">${name}</span>`).join('')}</div>`;}
    function uploadSlots(l){return l.slots.map(slot=>`<section class="j-upload-slot"><div><h4>${slot.label} ${slot.required?'<small>必填</small>':'<small>选填</small>'}</h4><p>${slot.hint}</p></div><label class="j-upload"><input type="file" data-j-files="${slot.id}" accept="image/png,image/jpeg,image/webp${slot.images?'':',application/pdf'}" ${busy?'disabled':''} multiple><span aria-hidden="true">＋</span><b>选择${slot.images?'图片':'文件'}</b><small>${slot.images?'PNG / JPG / WebP':'PDF / PNG / JPG / WebP'} · 每个 ≤10 MB</small></label><div class="j-file-list">${(files[slot.id]||[]).map((file,index)=>{let preview='';if(file.type.startsWith('image/')){if(!blobURLs.has(file))blobURLs.set(file,URL.createObjectURL(file));preview=`<img src="${blobURLs.get(file)}" alt="${esc(slot.label)}预览">`;}return `<div>${preview}<span><b>${esc(file.name)}</b><small>${(file.size/1024).toFixed(0)} KB</small></span><button aria-label="移除 ${esc(file.name)}" data-j-remove="${slot.id}:${index}" ${busy?'disabled':''}>×</button></div>`;}).join('')}</div></section>`).join('');}
    function delivery(){
      const l=task();if(!Session.isLoggedIn())return `<span class="j-label">${l.id} · 交成果</span><h3 class="j-task-title">让这一步留下记录。</h3><p class="j-description">登录后，成果会保存到你的经营项目。任务内容和锦囊可以继续查看。</p><div class="j-checklist">${l.slots.filter(s=>s.required).map(s=>`<p>□ ${s.label}</p>`).join('')}</div>${button('login','登录后提交成果','primary wide')}${button('back','返回任务卡','quiet')}`;
      return `<div class="j-card-top"><span class="j-label">${l.id} · 交成果</span>${button('back','← 返回任务卡','quiet')}</div><h3 class="j-task-title">${l.deliverable}</h3><p class="j-description">把对应的材料放进来，交给${esc(options.partnerName())}确认。</p><form id="journeyDelivery">${uploadSlots(l)}<label class="j-field">补充说明<textarea name="notes" rows="3" maxlength="2000" ${busy?'disabled':''} placeholder="说说你做了什么、使用了哪些数据，或这次最想确认的问题…">${esc(notes)}</textarea></label><label class="j-consent"><input name="confirm" type="checkbox" required ${confirmed?'checked':''} ${busy?'disabled':''}><span>我已检查材料真实、与本关对应，并遮盖了无关的个人信息。</span></label><p class="j-muted">最多 5 个文件。上传与提交成功后进入确认中，确认通过后才解锁下一关。</p><button type="submit" class="j-button primary wide" ${busy?'disabled':''}>${busy?'正在交付，请稍候…':'交给'+esc(options.partnerName())+'确认 →'}</button></form>`;
    }
    function finalTrial(){const done=progress().completed===6;return `<span class="j-label">最终试炼 · 真实第一单</span><h3 class="j-task-title">让小店，迎来<br>第一位真实买家。</h3><p class="j-description">${done?'六个经营环节已经完成。最后的门槛，是一笔真实、可核验的成交。':'先完成六个经营环节，再用真实订单完成最后的试炼。'}</p><div class="j-final-stamp" aria-hidden="true">01<span>FIRST ORDER</span></div><section class="j-goal"><h4>需要交回什么</h4><ul><li>□ 平台订单成交或付款成功截图</li><li>□ 对应店铺、商品与成交时间</li><li>□ 可核验的订单信息，隐藏买家隐私</li></ul></section><p class="j-callout">${done?'首单核验与证书领取尚未开放。你的六关成果会保留，开放后可在这里提交。':'六关完成后可准备订单证据；证书将在真实订单核验通过后发放。'}</p><button class="j-button primary wide" disabled>${done?'等待首单核验开放':'完成六关后解锁'}</button>${button('roadmap','查看闯关路线','quiet')}`;}
    function render(){
      if(!options.isOpen())return;
      const p=profile();host.classList.add('journey-body');
      const top=`<div class="j-project-line"><span class="j-platform-dot" style="--platform-color:${J.PLATFORMS[p.platform]?.color}">${J.PLATFORMS[p.platform]?.short||'店'}</span><span>${esc(p.shop_name||'我的小店')}<small>${esc(p.category||'等你定个方向')} · ${esc(p.agent)}</small></span><button class="j-sync" data-j-action="refresh" ${loading||busy?'disabled':''} aria-label="同步经营进度">${loading?'同步中':'↻'}</button></div>`;
      host.innerHTML=(view==='setup'?'':top)+(error?`<div class="j-message error" role="alert">${esc(error)}</div>`:'')+(notice?`<div class="j-message" role="status">${esc(notice)}</div>`:'')+(view==='setup'?setup():view==='roadmap'?roadmap():view==='submit'?delivery():view==='final'?finalTrial():taskCard());
    }
    async function ensureProject(){
      if(project)return project;
      const p=profile();const created=await Api.post('/api/projects',{name:p.shop_name,platform:p.platform,category:p.category,description:'第一单经营旅程；使用 '+p.agent},{idempotencyKey:attempt.projectKey});return created;
    }
    async function submit(){
      if(loading){error='正在同步经营进度，请稍候再交成果。';render();return;}
      const l=task(),invalid=J.validateFiles(l,files);if(invalid){error=invalid;render();return;}
      if(l.status==='locked'||['pending','approved'].includes(l.status)){error='本关当前无法提交，请同步进度。';render();return;}
      const token=epoch,identity=owner;
      attempt=attempt||{projectKey:Api.newIdempotencyKey(),artifactKey:Api.newIdempotencyKey(),submissionKey:Api.newIdempotencyKey(),uploads:new Map(),uploadKeys:new Map(),artifact:null,submission:null};
      busy=true;error='';render();
      try{
        const current=()=>{if(token!==epoch||identity!==Session.current()?.player?.id)throw new Error('登录身份已变化，请重新选择成果文件。');};
        const groups=[];
        for(const slot of l.slots){const ids=[];for(const file of files[slot.id]||[]){current();let uploaded=attempt.uploads.get(file);if(!uploaded){const data=new FormData();data.append('file',file);let key=attempt.uploadKeys.get(file);if(!key){key=Api.newIdempotencyKey();attempt.uploadKeys.set(file,key);}uploaded=await Api.post('/api/evidence',data,{idempotencyKey:key,timeoutMs:60000});current();attempt.uploads.set(file,uploaded);}ids.push(uploaded.id);}if(ids.length)groups.push({slot:slot.id,label:slot.label,evidence_ids:ids});}
        current();const savedProject=await ensureProject();current();project=savedProject;const p=profile();
        if(!attempt.artifact)attempt.artifact=await Api.post('/api/artifacts',{project_id:project.id,artifact_type:l.type,schema_version:1,title:l.title,origin:'formal',source_level_id:l.id,content:{summary:notes.trim()||l.deliverable,platform:p.platform,category:p.category,delivery_method:l.method,agent:p.agent,evidence_groups:groups}},{idempotencyKey:attempt.artifactKey});
        current();attempt.submission=await Api.post('/api/verifications',{artifact_id:attempt.artifact.id,artifact_version:attempt.artifact.version,evidence_ids:groups.flatMap(g=>g.evidence_ids),note:notes.trim()||l.goal},{idempotencyKey:attempt.submissionKey});current();
        const submitted=attempt.submission,submittedArtifact=attempt.artifact;clearFiles();notes='';view='task';artifacts=[{...submittedArtifact,id:submitted.artifact_id,project_id:project.id,artifact_type:l.type,origin:'formal',status:'submitted'},...artifacts];notice='成果已提交，确认后会收到新的任务。';options.sound('place');await refresh();
      }catch(e){error=e.message||'暂时没能提交，已选材料仍在，可以重试。';}
      finally{busy=false;renderIfOpen();options.onUpdate();}
    }
    async function copyBrief(){const text=J.brief(active,profile(),options.partnerName());try{await navigator.clipboard.writeText(text);notice='任务指令已复制，交给你的 agent 即可。';options.sound('pick');}catch(_){notice='请手动复制下面的任务指令。';render();const pre=document.createElement('textarea');pre.className='j-copy-fallback';pre.readOnly=true;pre.value=text;host.append(pre);pre.select();return;}render();}
    async function prepareContext(){if(task().id==='L1'&&!advisorText){try{const r=await fetch('assets/skills/category-business-advisor.md');if(r.ok)advisorText=await r.text();}catch(_){}}return api.context();}
    async function ask(){const l=task();await prepareContext();options.ask(l.id==='L1'?'我想做'+(profile().category||'一个小生意')+'，请帮我判断赛道、竞争和我的机会。':l.id==='L6'?'我想复盘经营数据，请先告诉我需要提供哪些数据和时间范围。':'我在做「'+l.title+'」，请帮我理清交付成果的步骤。');}
    host.addEventListener('click',async e=>{
      const level=e.target.closest('[data-j-level]'),remove=e.target.closest('[data-j-remove]'),b=e.target.closest('[data-j-action]');if(busy)return;
      if(level){selectLevel(level.dataset.jLevel);view='task';kitOpen=false;error='';notice='';render();host.scrollTop=0;return;}
      if(remove){const [slot,index]=remove.dataset.jRemove.split(':');const file=files[slot][Number(index)];if(blobURLs.has(file)){URL.revokeObjectURL(blobURLs.get(file));blobURLs.delete(file);}files[slot].splice(Number(index),1);attempt=null;confirmed=false;render();return;}
      if(!b)return;error='';notice='';options.sound('click');
      if(b.dataset.jAction==='kit'){if(task().status==='locked')return;kitOpen=!kitOpen;}
      else if(b.dataset.jAction==='roadmap')view='roadmap';
      else if(b.dataset.jAction==='final')view='final';
      else if(b.dataset.jAction==='deliver'){if(task().status==='locked')return;view='submit';}
      else if(b.dataset.jAction==='back')view='task';
      else if(b.dataset.jAction==='profile'){if(project){draft.platform=project.platform;draft.category=project.category;draft.shop_name=project.name;}view='setup';}
      else if(b.dataset.jAction==='next'){const index=J.LEVELS.findIndex(l=>l.id===active);if(index===5)view='final';else{selectLevel(J.LEVELS[index+1].id);view='task';kitOpen=false;}}
      else if(b.dataset.jAction==='refresh'){await refresh();return;}
      else if(b.dataset.jAction==='copy'){await copyBrief();return;}
      else if(b.dataset.jAction==='ask'){await ask();return;}
      else if(b.dataset.jAction==='login'){Session.requireLogin('提交经营成果');return;}
      render();if(!['kit','copy'].includes(b.dataset.jAction))host.scrollTop=0;
    });
    host.addEventListener('input',e=>{if(busy)return;if(e.target.matches('#journeyDelivery textarea')){notes=e.target.value;attempt=null;confirmed=false;const confirm=host.querySelector('[name=confirm]');if(confirm)confirm.checked=false;}});
    host.addEventListener('change',e=>{if(busy)return;const slot=e.target.dataset.jFiles;if(slot){const additions=Array.from(e.target.files);files[slot]=[...(files[slot]||[]),...additions];attempt=null;confirmed=false;const invalid=J.validateFiles({...task(),slots:task().slots.map(s=>({...s,required:false}))},files);if(invalid){files[slot].splice(-additions.length);error=invalid;}else error='';render();}else if(e.target.name==='platform'){draft.platform=e.target.value;host.querySelectorAll('.j-platform').forEach(el=>el.classList.toggle('selected',el.querySelector('input').checked));}});
    host.addEventListener('submit',e=>{
      if(!['journeySetup','journeyDelivery'].includes(e.target.id))return;e.preventDefault();if(busy)return;
      if(e.target.id==='journeyDelivery'){notes=e.target.elements.notes.value;confirmed=e.target.elements.confirm.checked;void submit();return;}
      const data=new FormData(e.target),partner=global.EmcCopilot.validName(data.get('partner_name'));
      if(!partner){error='伙伴名称请使用 1—12 个中英文字或数字。';render();return;}
      if(project&&(project.platform!==data.get('platform')||project.category!==String(data.get('category')).trim())){error='当前项目的平台与类目已确定。请保留原设置，另一个方向需要单独建立经营项目。';render();return;}
      if(!String(data.get('shop_name')).trim()||!String(data.get('category')).trim()){error='请填写小店名称和想经营的类目。';render();return;}
      draft={saved:true,platform:data.get('platform'),agent:data.get('agent'),category:String(data.get('category')).trim(),shop_name:String(data.get('shop_name')).trim().slice(0,12),partner_name:partner};
      if(!remember()){render();return;}options.onProfile(draft);view='task';selectLevel(progress().current?.id||'L6');kitOpen=false;error='';notice='';render();options.onUpdate();host.scrollTop=0;global.toast?.('小店方向已记好，第一张任务卡给你。');
    });
    const api={open,render,refresh,prepareContext,profile,progress,isEditing:()=>view==='submit'||view==='setup',context:()=>({journey:{platform:profile().platform,category:profile().category,agent:profile().agent,completed:progress().completed,status:task().status},task:{id:task().id,name:task().title,topic:task().topic,deliverable:task().deliverable,required_evidence:task().slots.filter(s=>s.required).map(s=>s.label)},skill_ids:J.kitIds(task().id,profile().platform),...(advisorText?{skill_instructions:advisorText}:{})}),summary:()=>({project_id:project?.id||null,view,active,loading,busy,error,profile:profile(),completed:progress().completed,stage:progress().stage,status:task().status,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,v.length]))})};
    return api;
  }
  global.EmcJourneyUI={create};
})(window);
