(function(global){
  'use strict';
  const Story=global.EmcJourneyStory,J=global.EmcJourney,Api=global.EmcApi,Session=global.EmcSession;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const KEY='emc-journey-entry-v1';
  const STATUS={ready:'待行动',draft:'成果草稿',pending:'确认中',approved:'已完成',rejected:'需要补充',locked:'未解锁'};
  function create(options){
    let draft={saved:false,platform:'xiaohongshu',agent:'Codex',category:'',shop_name:options.shopName(),partner_name:options.partnerName()},project=null,projects=[],artifacts=[],verifications=[],owner=null,epoch=0;
    try{const raw=JSON.parse(localStorage.getItem(KEY));if(raw&&typeof raw==='object'){for(const key of ['category','shop_name','partner_name'])if(typeof raw[key]==='string')draft[key]=raw[key].slice(0,key==='category'?64:24);if(J.PLATFORMS[raw.platform])draft.platform=raw.platform;if(J.AGENTS.includes(raw.agent))draft.agent=raw.agent;draft.saved=raw.saved===true;}}catch(_){}
    let view=draft.saved?'task':'setup',active='L1',kitOpen=false,busy=false,loading=false,confirmed=false,error='',notice='',files={},notes='',attempt=null,advisorText=null,celebration=null;
    let welcomed=false,firstPrepared=false,firstNote={idea:'',budget:'',time:''};try{welcomed=localStorage.getItem('emc-journey-welcome-v1')==='1';}catch(_){}
    if(!welcomed)view='welcome';
    const demo=global.EmcJourneyDemo.create({host:options.container,isOpen:options.isOpen,update:()=>options.onUpdate(),sound:options.sound,workspace:id=>workspace(id),resetWorkspace:()=>global.EmcPractice.clear('demo')});
    const host=options.container,blobURLs=new Map(),deliveryDrafts=new Map();
    const workspaceScope=()=>demo.enabled()?'demo':String(Session.current()?.player?.id||'guest')+':'+String(project?.id||'entry')+':formal';
    function workspace(id){return global.EmcPractice.render(workspaceScope(),id,busy);}
    global.EmcPractice.bind(host,{scope:workspaceScope,onChange:()=>options.onPracticeChange?.()});

    function selectLevel(id){if(active===id)return;deliveryDrafts.set(active,{files,notes,attempt,confirmed});active=id;const saved=deliveryDrafts.get(id);files=saved?.files||{};notes=saved?.notes||'';attempt=saved?.attempt||null;confirmed=saved?.confirmed||false;}
    function clearPrivateDrafts(){for(const url of blobURLs.values())URL.revokeObjectURL(url);blobURLs.clear();deliveryDrafts.clear();files={};notes='';attempt=null;confirmed=false;firstPrepared=false;firstNote={idea:'',budget:'',time:''};}
    const profile=()=>demo.enabled()?{...demo.profile(),partner_name:options.partnerName()}:({...draft,platform:project?.platform||draft.platform,category:project?.category||draft.category,shop_name:project?.name||draft.shop_name});
    const progress=()=>demo.enabled()?demo.progress():J.progress(project,artifacts,verifications),task=()=>progress().levels.find(l=>l.id===(demo.enabled()?demo.summary().active:active))||progress().levels[0];
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
        project=selected;artifacts=arts;verifications=subs;if(view==='setup'&&!draft.saved){draft.platform=selected.platform;draft.category=selected.category;draft.shop_name=selected.name;view='task';}
        const next=progress();if(view==='welcome'&&next.completed>0)view='task';
        if(previousProject===project.id&&next.completed>previous.completed){
          celebration={levels:next.levels.filter(l=>l.status==='approved'&&previous.levels.find(old=>old.id===l.id)?.status!=='approved').map(l=>l.id),from:previous.stage,to:next.stage,xp:next.xp-previous.xp};
          if(view!=='submit'&&view!=='setup'){selectLevel(celebration.levels.at(-1));view='reward';host.scrollTop=0;options.sound(celebration.to>celebration.from?'upgrade':'reward');requestAnimationFrame(()=>options.celebrate?.());}
        }else if(!['submit','setup','supplies','certificate','reward'].includes(view))selectLevel(next.current?.id||'L6');
      }catch(e){if(token===epoch&&!silent)error=e.message||'暂时没能同步经营进度。';}
      finally{if(token===epoch){loading=false;options.onUpdate();renderIfOpen();}}
    }
    function open(entry){if(demo.enabled()){demo.open(entry);return;}if(busy){view='submit';render();return;}if(celebration){view='reward';render();host.scrollTop=0;return;}error='';notice='';view=!welcomed&&progress().completed===0?'welcome':draft.saved||project?(progress().completed===6?'final':'task'):'setup';selectLevel(progress().current?.id||'L6');kitOpen=entry==='kit';if(entry==='submit'&&view==='task'&&!['pending','locked','approved'].includes(task().status))view='submit';render();host.scrollTop=0;}
    function renderIfOpen(){if(options.isOpen())render();}
    function resource(item,locked=false){
      const id=typeof item==='string'?item:item.id,name=typeof item==='string'?J.SKILLS[id]:item.name,external=typeof item==='object'&&item.external;
      const url=external?item.url:'assets/skills/'+id+'.zip';
      return `<div class="j-resource ${locked?'locked':''}"><span class="j-item-icon" aria-hidden="true">${external?'▦':'▣'}</span><span><b>${esc(name)}</b><small>${locked?'完成本关后解锁':external?'方法表 · 飞书':'给 AI 工具用的方法包'}</small></span>${locked?'<span aria-label="未解锁">◇</span>':`<a href="${esc(url)}" ${external?'target="_blank" rel="noopener noreferrer"':'download'}>${external?'查看':'领取'} <span aria-hidden="true">↗</span></a>`}</div>`;
    }
    function setup(){
      return `<div class="j-intro"><span class="j-label">从一间小店，到真实第一单</span><h3>先认识你的小店。</h3><p>选一个平台，带上你的伙伴。<br>我会从你选的方向开始，带你一点点学习和尝试。</p></div>
      <form id="journeySetup"><div class="j-two-fields"><label>小店名称<input name="shop_name" maxlength="12" value="${esc(project?.name||draft.shop_name)}" ${project?'readonly':''} required></label><label>伙伴名称<input name="partner_name" maxlength="24" value="${esc(draft.partner_name)}" required></label></div>
      <fieldset class="j-platforms"><legend>你准备在哪里开店？</legend>${Object.entries(J.PLATFORMS).map(([id,p])=>`<label class="j-platform ${draft.platform===id?'selected':''}"><input type="radio" name="platform" value="${id}" ${draft.platform===id?'checked':''}><span style="--platform-color:${p.color}">${p.short}</span><b>${p.name}</b><small>${p.hint}</small></label>`).join('')}</fieldset>
      <label class="j-field">想经营什么类目？<input name="category" maxlength="64" placeholder="例如：通勤包、宠物用品、家居收纳" value="${esc(draft.category)}" required><small>还拿不准也没关系，可以先填一个方向，再和伙伴聊。</small></label>
      <label class="j-field">你准备使用的 AI 工具<select name="agent">${J.AGENTS.map(a=>`<option ${draft.agent===a?'selected':''}>${a}</option>`).join('')}</select><small>它可以按锦囊的方法帮你找资料、整理内容。暂时不会用也没关系，需要时我会介绍。</small></label>
      <div class="j-callout">▤ <span>每关都有一张任务卡和附带锦囊。<br>完成实操、交回成果，确认后小店才会成长。</span></div>
      <button class="j-button primary wide" type="submit" ${busy?'disabled':''}>带上伙伴，开始第一关 <span>→</span></button></form>`;
    }
    function kit(l){
      const support=Story.get(l.id).support;if(!support)return '';const p=profile(),ids=J.kitIds(l.id,p.platform),guided=['L1','L6'].includes(l.id);
      const tools=l.id==='L4'?(J.LISTING_TOOLS[p.platform]||[]).map(t=>`<a class="j-tool-link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer"><span><b>${esc(t.name)}</b><small>${esc(t.hint)}</small></span><span aria-hidden="true">↗</span></a>`).join(''):'';
      return `<section class="j-kit"><button class="j-kit-toggle" data-j-action="kit" aria-expanded="${kitOpen}" ${l.status==='locked'?'disabled':''}><span class="j-envelope" aria-hidden="true">▧</span><span><b>${esc(support.title)}</b><small>${kitOpen?'收起方法与工具':'点开看看，带着方法去做'}</small></span><i>${kitOpen?'−':'+'}</i></button>${kitOpen?`<div class="j-kit-content"><p>${esc(Story.get(l.id).help.replaceAll('小商',options.partnerName()))}</p>${guided?`<div class="j-companion-method"><span aria-hidden="true">✦</span><span><b>${esc(options.partnerName())}陪你${l.id==='L1'?'定方向':'做复盘'}</b><small>${l.id==='L1'?'准备好预算、货源与可投入的时间':'准备好经营数据、时间范围与已尝试的动作'}</small></span></div>`:''}${ids.map(id=>resource(id)).join('')}${tools}<div class="j-inline-actions">${guided?button('ask','找'+esc(options.partnerName())+'聊一聊','primary'):button('copy','复制给 '+esc(p.agent)+' 的任务指令','primary')}${guided?button('copy','交给自己的 agent','quiet'):button('ask','问问'+esc(options.partnerName()),'quiet')}</div><details class="j-question-guide"><summary>不知道怎么开口？</summary><p>说清目标、给出数据、补充已尝试的动作。基础问题也可以直接问。</p><blockquote>${l.id==='L1'?'我每周能投入 10 小时，预算 2000 元，有家居货源。想比较两个类目的机会，请先帮我列出需要验证的数据。':l.id==='L6'?'这是近 7 天的曝光、点击和成交数据，我已经调整过主图。请帮我区分可能原因，并排出下一轮验证顺序。':'我在做'+esc(l.title)+'，目标是…，已有材料是…，试过…，目前卡在…'}</blockquote><small>连续高质量提问的可以在伙伴面板查看本关验证锦囊的解锁进度。</small></details><small class="j-muted">技能包交给支持 Skills 的 agent 使用。上架、发布前，记得自己确认。</small></div>`:''}</section>`;
    }
    function taskCard(){
      const l=task(),p=profile(),story=Story.get(l.id,{platform:p.platform,completed:progress().completed});
      if(l.status==='pending')return `<article class="mail-attachment-sheet"><header class="mail-attachment-heading"><span>成果回执 / ${l.id}</span>${button('roadmap','任务路线','quiet')}</header><h3 class="j-task-title">成果已收到，正在确认。</h3><p class="j-description">${esc(l.title)}的材料已经交回。确认通过后，我们再继续下一步。</p>${receipt(l)}${button('refresh','查看最新进度','primary')}<p class="j-muted">你可以先收起回执，继续逛逛小岛。</p></article>`;
      const state=l.status==='pending'?`<section class="j-review-state"><b>成果已收到，正在确认。</b>${receipt(l)}${button('refresh','查看最新进度','quiet')}</section>`:l.status==='rejected'?`<section class="j-return-state"><b>这份材料还需要补充</b><p>${esc(l.submission?.rejection_reason||'补充与本关要求对应的清晰证据，再交给我。')}</p></section>`:l.status==='approved'?`<p class="mail-story-resolution">${esc(story.resolved)}</p>${button('next',l.id==='L6'?'看看最终试炼':'继续下一关 →','primary')}`:l.status==='locked'?'<p class="j-muted">完成前一步后，再来拆这封信。</p>':'';
      return `<article class="mail-letter-sheet" data-story="${l.id}"><header class="mail-correspondence"><span>${esc(options.partnerName())}的手写便笺<b>${esc(story.scene)}</b></span></header><span class="j-label">${l.id} · ${l.topic}</span><h3 class="j-task-title">${l.title}</h3>${state}<p class="mail-salutation">店主，见信好。</p><div class="mail-story-copy">${story.paragraphs.map(p=>`<p>${esc(p)}</p>`).join('')}</div><p class="mail-learning"><b>这次你会学到</b>${esc(story.learn)}</p><section class="j-goal"><h4>现在，先做这一小步</h4><p>${esc(story.firstAction)}</p></section><button class="j-button mail-reply" data-j-action="ask">和${esc(options.partnerName())}聊这一步 ↗</button><footer class="mail-signature">先做成眼前这一步。<b>${esc(options.partnerName())}</b></footer></article><section class="mail-enclosures"><div class="mail-attachment-grid">${l.status==='locked'?'':button('deliver',l.status==='rejected'?'取出附件，补充材料 ↗':'取出实践附件 ↗')}${story.support?kit(l):''}</div></section><nav class="mail-tools" aria-label="来信工具">${button('supplies','我的锦囊','quiet')}${button('roadmap','任务路线','quiet')}${button('profile','小店资料','quiet')}</nav>`;
    }
    function receipt(l){
      if(!l.submission)return '';
      const sent=l.submission.snapshot?.content?.evidence_groups||l.artifact?.content?.evidence_groups||[];
      return `<div class="j-receipt"><span>交付回执</span><b>${esc(l.deliverable)}</b>${sent.length?`<small>${sent.map(g=>esc(g.label)).join(' · ')}</small>`:''}<small>${l.submission.evidence_count||l.submission.evidence_ids?.length?'已收到 '+(l.submission.evidence_count||l.submission.evidence_ids?.length)+' 份材料':'对应材料已收到'}${l.submission.created_at?' · '+esc(new Date(l.submission.created_at).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})):''}</small></div>`;
    }
    function supplies(){
      const state=progress(),p=profile();
      return `<span class="j-label">带着方法，继续经营</span><h3 class="j-task-title">我的锦囊</h3><p class="j-description">任务附带的方法，和一路做成事情后获得的技能，都收在这里。</p>${state.levels.filter(l=>l.status!=='locked').map(l=>{const ids=Story.get(l.id).support?.kind==='skill'?J.kitIds(l.id,p.platform):[],drops=J.rewards(l.id,p.platform);return `<section class="j-supply-group"><header><span>${l.id} · ${l.topic}</span>${badge(l)}</header>${ids.map(id=>resource(id)).join('')}${l.id==='L4'?'<p class="j-muted">工具入口收在本关任务卡的锦囊里。</p>':''}${drops.length?`<div class="j-supply-drop"><small>${l.status==='approved'?'✦ 已获得的掉落':'◇ 完成后掉落'}</small>${drops.map(r=>resource(r,l.status!=='approved')).join('')}</div>`:!ids.length&&l.id!=='L4'?'<p class="j-muted">本关由伙伴陪你复盘，不掉落额外技能。</p>':''}<button class="j-button quiet" data-j-level="${l.id}">回看这张任务卡 →</button></section>`;}).join('')}${button('roadmap','回到闯关路线','quiet')}`;
    }
    function rewardCard(){
      const won=celebration?.levels.map(id=>J.level(id))||[task()],state=progress(),p=profile(),drops=won.flatMap(l=>J.rewards(l.id,p.platform));
      return `<section class="j-reward-screen" role="status"><span class="j-label">${won.map(l=>l.id).join(' + ')} · 成果确认通过</span><div class="j-reward-seal" aria-hidden="true">✓<span>STEP COMPLETE</span></div><h3 class="j-task-title">这一步，做成了。</h3><p class="j-description">${won.map(l=>esc(l.title)).join('、')}</p><div class="j-earned-xp">+${celebration?.xp||160}<small>经营经验</small></div>${celebration&&celebration.to>celebration.from?`<div class="j-growth-earned"><small>小店进入新阶段</small><b>${J.GROWTH[celebration.to-1]}</b><span>${J.GROWTH[celebration.from-1]} → ${J.GROWTH[celebration.to-1]}</span></div>`:''}${drops.length?`<section class="j-drops"><h4>你的新锦囊 <span>✦</span></h4>${drops.map(r=>resource(r)).join('')}</section>`:'<p class="j-muted">这次的经营成果已经记入你的成长进度。</p>'}<p class="j-muted">${state.current?'下一张任务卡已解锁：'+esc(state.current.title):'六个环节已经完成，下一步是用真实订单完成最终试炼。'}</p><div class="j-reward-actions">${button('next',state.current?'带上锦囊，继续下一关 →':'打开最终试炼 →','primary wide')}</div>${button('supplies','回看已获得的锦囊','quiet')}</section>`;
    }
    function certificate(){return `<span class="j-label">样式预览 · 未获认证</span><article class="j-certificate"><div class="j-certificate-top">FIRST ORDER / 01</div><span class="j-certificate-star" aria-hidden="true">✦</span><p>从一间小店，到真实第一单</p><h3>破零证书</h3><h4>${esc(profile().shop_name)}</h4><p>完成六环节实操，并通过真实首单核验</p><div class="j-certificate-stages">定方向 · 会选品 · 做素材<br>会上架 · 会内容 · 会复盘</div><b class="j-certificate-watermark">样式预览<br>未获认证</b><footer>${esc(J.PLATFORMS[profile().platform]?.name)} · ${esc(profile().category)}<br>认证编号与成交日期将在核验后生成</footer></article><p class="j-muted">真实首单核验通过后，才会获得可分享的证书、通关海报与徽章。</p><button class="j-button primary wide" disabled>通过首单核验后领取与分享</button>${button('final','返回最终试炼','quiet')}`;}
    function roadmap(){const state=progress();return `<div class="j-intro"><span class="j-label">你的第一单之路</span><h3>每做成一步，<br>小店就向前一点。</h3><p>已完成 ${state.completed} / 6 个经营环节。<br>最后用真实的第一单，为自己交卷。</p></div><ol class="j-roadmap">${state.levels.map(l=>`<li class="${l.status}"><button data-j-level="${l.id}"><span class="j-road-node">${l.status==='approved'?'✓':l.id.slice(1)}</span><span><small>${l.id} · ${l.topic}</small><b>${l.title}</b></span>${badge(l)}</button></li>`).join('')}<li class="final"><button data-j-action="final"><span class="j-road-node">✦</span><span><small>最终试炼</small><b>卖出真实第一单</b></span><span class="j-status ${state.completed<6?'locked':''}">${state.completed<6?'未解锁':'待开放'}</span></button></li></ol><div class="j-growth-strip">${J.GROWTH.map((name,i)=>`<span class="${state.stage===i+1?'current':''}">${name}</span>`).join('')}</div>`;}
    function uploadSlots(l){return l.slots.map(slot=>`<section class="j-upload-slot"><div><h4>${slot.label} ${slot.required?'<small>必填</small>':'<small>选填</small>'}</h4><p>${slot.hint}</p></div><label class="j-upload"><input type="file" data-j-files="${slot.id}" accept="image/png,image/jpeg,image/webp${slot.images?'':',application/pdf'}" ${busy?'disabled':''} multiple><span aria-hidden="true">＋</span><b>选择${slot.images?'图片':'文件'}</b><small>${slot.images?'PNG / JPG / WebP':'PDF / PNG / JPG / WebP'} · 每个 ≤10 MB</small></label><div class="j-file-list">${(files[slot.id]||[]).map((file,index)=>{let preview='';if(file.type.startsWith('image/')){if(!blobURLs.has(file))blobURLs.set(file,URL.createObjectURL(file));preview=`<img src="${blobURLs.get(file)}" alt="${esc(slot.label)}预览">`;}return `<div>${preview}<span><b>${esc(file.name)}</b><small>${(file.size/1024).toFixed(0)} KB</small></span><button aria-label="移除 ${esc(file.name)}" data-j-remove="${slot.id}:${index}" ${busy?'disabled':''}>×</button></div>`;}).join('')}</div></section>`).join('');}
    function delivery(){
      const l=task();const paper=workspace(l.id);if(!Session.isLoggedIn())return `${paper}<span class="j-label">${l.id} · 交成果</span><h3 class="j-task-title">让这一步留下记录。</h3><p class="j-description">登录后，成果会保存到你的经营项目。任务内容和锦囊可以继续查看。</p><div class="j-checklist">${l.slots.filter(s=>s.required).map(s=>`<p>□ ${s.label}</p>`).join('')}</div>${button('login','登录后提交成果','primary wide')}${button('back','返回任务卡','quiet')}`;
      return `${paper}<div class="j-card-top"><span class="j-label">${l.id} · 交成果</span>${button('back','← 返回任务卡','quiet')}</div><h3 class="j-task-title">${l.deliverable}</h3><p class="j-description">把对应的材料放进来，交给${esc(options.partnerName())}确认。</p><form id="journeyDelivery">${uploadSlots(l)}<label class="j-field">补充说明<textarea name="notes" rows="3" maxlength="2000" ${busy?'disabled':''} placeholder="说说你做了什么、使用了哪些数据，或这次最想确认的问题…">${esc(notes)}</textarea></label><label class="j-consent"><input name="confirm" type="checkbox" required ${confirmed?'checked':''} ${busy?'disabled':''}><span>我已检查材料真实、与本关对应，并遮盖了无关的个人信息。</span></label><p class="j-muted">最多 5 个文件。上传与提交成功后进入确认中，确认通过后才解锁下一关。</p><button type="submit" class="j-button primary wide" ${busy?'disabled':''}>${busy?'正在交付，请稍候…':'交给'+esc(options.partnerName())+'确认 →'}</button></form>`;
    }
    function finalTrial(){const done=progress().completed===6;return `<span class="j-label">最终试炼 · 真实第一单</span><h3 class="j-task-title">让小店，迎来<br>第一位真实买家。</h3><p class="j-description">${done?'六个经营环节已经完成。最后的门槛，是一笔真实、可核验的成交。':'先完成六个经营环节，再用真实订单完成最后的试炼。'}</p>${done?workspace('first_order'):''}<div class="j-final-stamp" aria-hidden="true">01<span>FIRST ORDER</span></div><section class="j-goal"><h4>需要交回什么</h4><ul><li>□ 平台订单成交或付款成功截图</li><li>□ 对应店铺、商品与成交时间</li><li>□ 可核验的订单信息，隐藏买家隐私</li></ul></section><p class="j-callout">${done?'首单核验与证书领取尚未开放。你的六关成果会保留，开放后可在这里提交。':'六关完成后可准备订单证据；证书将在真实订单核验通过后发放。'}</p><button class="j-button primary wide" disabled>${done?'等待首单核验开放':'完成六关后解锁'}</button>${button('certificate','预览破零证书','quiet')}${button('roadmap','查看闯关路线','quiet')}`;}
    function render(){
      if(!options.isOpen())return;if(demo.enabled()){demo.render();return;}
      const p=profile();host.classList.add('journey-body');host.dataset.jView=view;
      host.innerHTML=''+(error?`<div class="j-message error" role="alert">${esc(error)}</div>`:'')+(notice?`<div class="j-message" role="status">${esc(notice)}</div>`:'')+(view==='welcome'?global.EmcJourneyGuidance.welcome(options.partnerName(),'data-j-action="begin"'):view==='setup'?setup():view==='roadmap'?roadmap():view==='submit'?`<article class="mail-attachment-sheet"><header class="mail-attachment-heading"><span>随信附件 / ${task().id} 实践卡</span>${button('letter-back','← 放回信封','quiet')}</header>${task().id==='L1'&&!firstPrepared?global.EmcJourneyGuidance.warmup(firstNote,{prepare:'data-j-action="first-prepare"',unsure:'data-j-action="first-unsure"',ask:'data-j-action="first-ask"',name:options.partnerName()}):delivery()}</article>`:view==='final'?finalTrial():view==='supplies'?supplies():view==='reward'?rewardCard():view==='certificate'?certificate():taskCard());global.EmcLetterArt?.decorate(host);
    }
    async function ensureProject(){
      if(project)return project;
      const p=profile();const created=await Api.post('/api/projects',{name:p.shop_name,platform:p.platform,category:p.category,description:'第一单经营旅程；使用 '+p.agent},{idempotencyKey:attempt.projectKey});return created;
    }
    async function submit(){
      if(!project&&!draft.saved){view='setup';error='先选好平台和类目，再交回这一关的成果。';render();return;}
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
        current();const savedProject=await ensureProject();current();global.EmcPractice.migrate(workspaceScope(),String(Session.current()?.player?.id||'guest')+':'+savedProject.id+':formal');project=savedProject;const p=profile();
        if(!attempt.artifact)attempt.artifact=await Api.post('/api/artifacts',{project_id:project.id,artifact_type:l.type,schema_version:1,title:l.title,origin:'formal',source_level_id:l.id,content:{summary:notes.trim()||l.deliverable,platform:p.platform,category:p.category,delivery_method:l.method,agent:p.agent,evidence_groups:groups}},{idempotencyKey:attempt.artifactKey});
        current();attempt.submission=await Api.post('/api/verifications',{artifact_id:attempt.artifact.id,artifact_version:attempt.artifact.version,evidence_ids:groups.flatMap(g=>g.evidence_ids),note:notes.trim()||l.goal},{idempotencyKey:attempt.submissionKey});current();
        const submitted=attempt.submission,submittedArtifact=attempt.artifact;clearFiles();notes='';view='task';artifacts=[{...submittedArtifact,id:submitted.artifact_id,project_id:project.id,artifact_type:l.type,origin:'formal',status:'submitted'},...artifacts];notice='成果已提交，确认后会收到新的任务。';options.sound('submit');await refresh({afterSubmit:true});
      }catch(e){error=e.message||'暂时没能提交，已选材料仍在，可以重试。';}
      finally{busy=false;renderIfOpen();options.onUpdate();}
    }
    async function copyBrief(){const text=J.brief(active,profile(),options.partnerName());try{await navigator.clipboard.writeText(text);notice='任务指令已复制，交给你的 agent 即可。';options.sound('pick');}catch(_){notice='请手动复制下面的任务指令。';render();const pre=document.createElement('textarea');pre.className='j-copy-fallback';pre.readOnly=true;pre.value=text;host.append(pre);pre.select();return;}render();}
    async function prepareContext(){if(task().id==='L1'&&!advisorText){try{const r=await fetch('assets/skills/category-business-advisor.md');if(r.ok)advisorText=await r.text();}catch(_){}}return api.context();}
    async function ask(){const l=task();await prepareContext();options.ask(l.id==='L1'?'我想做'+(profile().category||'一个小生意')+'，请帮我判断赛道、竞争和我的机会。':l.id==='L6'?'我想复盘经营数据，请先告诉我需要提供哪些数据和时间范围。':'我在做「'+l.title+'」，请帮我理清交付成果的步骤。');}
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
      else if(b.dataset.jAction==='certificate')view='certificate';
      else if(b.dataset.jAction==='final')view='final';
      else if(b.dataset.jAction==='deliver'){if(task().status==='locked')return;view='submit';}
      else if(['back','letter-back'].includes(b.dataset.jAction))view='task';
      else if(b.dataset.jAction==='profile'){if(project){draft.platform=project.platform;draft.category=project.category;draft.shop_name=project.name;}view='setup';}
      else if(b.dataset.jAction==='next'){celebration=null;const index=J.LEVELS.findIndex(l=>l.id===active);if(index===5)view='final';else{selectLevel(J.LEVELS[index+1].id);view='task';kitOpen=false;}}
      else if(b.dataset.jAction==='refresh'){await refresh();return;}
      else if(b.dataset.jAction==='copy'){await copyBrief();return;}
      else if(b.dataset.jAction==='companion'){options.openCompanion?.();return;}
      else if(b.dataset.jAction==='ask'){await ask();return;}
      else if(b.dataset.jAction==='login'){Session.requireLogin('提交经营成果');return;}
      render();if(!['kit','copy'].includes(b.dataset.jAction))host.scrollTop=0;
    });
    host.addEventListener('input',e=>{if(busy)return;if(e.target.dataset.guideInput)firstNote[e.target.dataset.guideInput]=e.target.value.slice(0,120);if(e.target.matches('#journeyDelivery textarea')){notes=e.target.value;attempt=null;confirmed=false;const confirm=host.querySelector('[name=confirm]');if(confirm)confirm.checked=false;}});
    host.addEventListener('change',e=>{if(busy)return;const slot=e.target.dataset.jFiles;if(slot){const additions=Array.from(e.target.files);files[slot]=[...(files[slot]||[]),...additions];attempt=null;confirmed=false;const invalid=J.validateFiles({...task(),slots:task().slots.map(s=>({...s,required:false}))},files);if(invalid){files[slot].splice(-additions.length);error=invalid;}else error='';render();}else if(e.target.name==='platform'){draft.platform=e.target.value;host.querySelectorAll('.j-platform').forEach(el=>el.classList.toggle('selected',el.querySelector('input').checked));}});
    host.addEventListener('submit',e=>{
      if(!['journeySetup','journeyDelivery'].includes(e.target.id))return;e.preventDefault();if(busy)return;
      if(e.target.id==='journeyDelivery'){notes=e.target.elements.notes.value;confirmed=e.target.elements.confirm.checked;void submit();return;}
      const data=new FormData(e.target),partner=global.EmcCopilot.validName(data.get('partner_name'));
      if(!partner){error='伙伴名称请使用 1—12 个中英文字或数字。';render();return;}
      if(project&&(project.platform!==data.get('platform')||project.category!==String(data.get('category')).trim())){error='当前项目的平台与类目已确定。请保留原设置，另一个方向需要单独建立经营项目。';render();return;}
      if(!String(data.get('shop_name')).trim()||!String(data.get('category')).trim()){error='请填写小店名称和想经营的类目。';render();return;}
      draft={saved:true,platform:data.get('platform'),agent:data.get('agent'),category:String(data.get('category')).trim(),shop_name:String(data.get('shop_name')).trim().slice(0,12),partner_name:partner};
      if(!remember()){render();return;}options.onProfile(draft);view='task';selectLevel(progress().current?.id||'L6');kitOpen=false;error='';notice='';render();options.onUpdate();host.scrollTop=0;global.toast?.('小店方向已记好，我们先从你自己的想法聊起。');
    });
    setInterval(()=>{if(!document.hidden&&options.isOpen()&&!busy&&!loading&&view==='task'&&progress().levels.some(l=>l.status==='pending'))void refresh({silent:true});},15000);
    const api={openLevel:id=>{if(demo.enabled()){demo.openLevel(id);return;}selectLevel(id==='first_order'?'L6':id);view=!welcomed&&progress().completed===0?'welcome':id==='first_order'?'final':'task';kitOpen=false;celebration=null;render();host.scrollTop=0;},demoSettings:demo.settings,practiceRecords:()=>global.EmcPractice.records(workspaceScope()),isDemo:demo.enabled,setDemo:demo.setEnabled,open,render,refresh,prepareContext,profile,progress,isEditing:()=>view==='submit'||view==='setup',context:()=>({journey:{platform:profile().platform,category:profile().category,agent:profile().agent,completed:progress().completed,status:task().status},task:{id:task().id,name:task().title,topic:task().topic,deliverable:task().deliverable,required_evidence:task().slots.filter(s=>s.required).map(s=>s.label)},skill_ids:J.kitIds(task().id,profile().platform),...(advisorText?{skill_instructions:advisorText}:{})}),summary:()=>demo.enabled()?demo.summary():({project_id:project?.id||null,view,active,loading,busy,error,profile:profile(),completed:progress().completed,stage:progress().stage,status:task().status,files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,v.length]))})};
    return api;
  }
  global.EmcJourneyUI={create};
})(window);
