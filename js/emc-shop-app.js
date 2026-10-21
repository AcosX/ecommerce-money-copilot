(function(){
  'use strict';
  const M=window.EmcCompanion,G=window.EmcGame,S=window.EmcTutorialSave,C=window.EmcCopilot,K=window.EmcSky,$=id=>document.getElementById(id);
  const sceneURL=new URL('./emc-shop-scene.js',document.currentScript.src);sceneURL.search=new URL(document.currentScript.src).search;
  const audio=window.EmcAudio.create(),juice=window.EmcJuice.create();
  const store=S.createStore(()=>window.localStorage),loaded=store.load();
  let journey=null,companionFeedback=null,companionQuote='',perkExpanded=false,companionSaveOk=true;
  const guidedPrompts=new Set();
  const companionScope=()=>String(window.EmcSession?.current()?.player?.id||'guest')+':'+String(journey?.summary().project_id||'local')+(journey?.isDemo()?':demo':'');
  const companionStore=M.createStore({getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)},companionScope);

  let tutorial=loaded.data;
  const rawGame=tutorial.levels.L1.exercise_result.shop_game_v1;
  let game=G.normalize(rawGame),panel=null,tab='main',activeTask=null,answer=null,feedback=null,selected=null,toastTimer,bagTab='wall',paintDrag=null,paintUndo=null;
  let continueLogin=null;
  const partnerName=()=>game.companion_name;
  if(!game.companion_named)game.companion_name='小商';
  const growthStage=()=>journey?journey.progress().stage-1:G.stage(game);
  const mainTask=()=>{if(!journey)return G.current(game);const current=journey.progress().current;return current?{id:current.id,name:current.title,topic:current.topic}:{id:'first_order',name:'卖出真实第一单',topic:'最终试炼'};};
  const futureGame=rawGame&&rawGame.schema_version>1;
  let npcState=null,conversation=false,sending=false,bubbleUntil=0,bubbleKind=null,lastReminderAt=performance.now()-28000,replyController=null,speechEpoch=0;
  let homeScene=null,homeStage=0,homeToken=0,homeReady=Promise.resolve();
  const mail=window.EmcMissionMail.create({sound:n=>audio.play(n),hold:value=>{const guide=homeScene?.guide;if(!guide)return null;guide.setHoldingLetter(value);const status=guide.status(true);return value&&status.visible?status.screen:null;}});
  function sceneLoading(context){
    finishConversation();npcState=null;$('npcAnchor').hidden=true;updateChatAvailability();
    $('scene').dataset.loading=context;$('scene').setAttribute('aria-busy','true');$('sceneLoader').hidden=false;$('sceneLoader').dataset.state='loading';$('retryScene').hidden=true;
    $('sceneLoadTitle').textContent='正在打开你的小店';$('sceneLoadHint').textContent='正在准备岛屿与店铺…';
  }
  function sceneLoaded(){delete $('scene').dataset.loading;$('scene').setAttribute('aria-busy','false');$('sceneLoader').hidden=true;}
  function sceneFailed(hint){
    delete $('scene').dataset.loading;$('scene').setAttribute('aria-busy','false');$('sceneLoader').hidden=false;$('sceneLoader').dataset.state='error';$('sceneLoadTitle').textContent='小店暂时没能打开';$('sceneLoadHint').textContent=hint||'可以重试加载，也可以先继续学习。';$('retryScene').hidden=false;
  }
  const icons=name=>`<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sprite=id=>`<span class="decor-sprite decor-${id}" aria-hidden="true"></span>`;
  let skyState=K.sample(game.theme);
  const theme=()=>skyState.ui_theme;
  const rewardOwned=id=>game.side.some(side=>G.SIDE.find(t=>t.id===side).reward===id);
  function saveStatus(status){
    const messages={empty:'小岛设置 · 当前浏览器保存',restored:'小岛设置 · 已恢复',saved:'小岛设置 · 已保存',recovered:'已恢复备份 · 原始存档会保留',corrupt:'存档损坏 · 操作后先备份原文再保存',unsupported:'存档来自更新版本 · 当前进度不会保存',unavailable:'保存失败 · 刷新可能丢失进度',recovery_full:'原始存档已保护 · 请先处理恢复副本',invalid:'数据格式异常 · 未覆盖存档'};
    $('saveStatus').textContent=messages[status]||messages.unavailable;
    $('saveRetry').hidden=!['unavailable','invalid'].includes(status);
    document.querySelector('.save-footer').classList.toggle('warning',!['empty','restored','saved'].includes(status));
  }
  function save(){
    if(futureGame){saveStatus('unsupported');return false;}
    tutorial.levels.L1.exercise_result.shop_game_v1=game;
    G.MAIN.forEach(task=>{
      const level=tutorial.levels[task.level];
      if(game.main.includes(task.id))level.task_checks[task.id]=true;
      const all=G.MAIN.filter(t=>t.level===task.level).every(t=>game.main.includes(t.id));
      if(all){level.completed=true;if(task.level==='L1')S.L1_TASK_IDS.forEach(id=>{level.task_checks[id]=true});}
    });
    tutorial.position={level_id:G.current(game)?.level||'L6',view:panel==='quests'?'level':'town'};
    const result=store.save(tutorial);if(result.status==='saved')tutorial=result.data;
    saveStatus(result.status);
    return result.status==='saved';
  }
  function setTheme(value){game.theme=value;renderTheme();save();}
  function renderTheme(){
    skyState=K.sample(game.theme);const night=skyState.ui_theme==='night',root=document.documentElement;
    root.dataset.theme=skyState.ui_theme;root.dataset.skyMode=game.theme;root.dataset.skyPhase=skyState.phase;
    for(const [key,value] of Object.entries(skyState.colors))root.style.setProperty('--sky-'+key,value);
    root.style.setProperty('--sky-stars',skyState.stars);root.style.setProperty('--sky-glow',skyState.glow);root.style.setProperty('--sky-daylight',skyState.daylight);
    for(const [name,body] of [['Sun',skyState.sun],['Moon',skyState.moon]]){const el=$('sky'+name);el.style.left=body.x+'%';el.style.top=body.y+'%';el.style.opacity=body.opacity;}
    root.style.setProperty('--sun-x',skyState.sun.x+'%');root.style.setProperty('--sun-fill',`rgb(255 ${Math.round(229-77*skyState.glow)} ${Math.round(162-63*skyState.glow)})`);
    for(const [id,value] of [['themeAuto','auto'],['themeDay','day'],['themeNight','night']])$(id).setAttribute('aria-pressed',String(game.theme===value));
    document.querySelector('meta[name="theme-color"]').content=skyState.colors.top;
    homeScene?.setAtmosphere(skyState.light);
  }
  // 钟点更新只改变天空与灯光，不写存档，也不重建三维场景。
  setInterval(()=>{if(!document.hidden&&game.theme==='auto')renderTheme();},1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)renderTheme();});
  function toast(text,upgrade=false){
    clearTimeout(toastTimer);$('toast').textContent=text;$('toast').className='toast show'+(upgrade?' upgrade':'');
    toastTimer=setTimeout(()=>{$('toast').className='toast'},upgrade?5000:3300);
  }
  function render(){
    renderPartnerName();renderSocialChat();renderTheme();const level=growthStage(),stage=journey?{...G.STAGES[level],xp:[0,320,640,800,960][level]}:G.STAGES[level],next=journey?(level<4?{xp:[320,640,800,960][level]}:null):G.STAGES[level+1],xp=journey?journey.progress().xp:G.xp(game),task=mainTask();
    $('shopOwner').textContent=game.shop_name;$('stageCount').textContent=(level+1)+' / 5';$('stageTitle').textContent=journey?.isDemo()?'演示 · '+window.EmcJourney.GROWTH[level]:journey?window.EmcJourney.GROWTH[level]:stage.title;
    $('xpCount').textContent=next?xp+' / '+next.xp:xp+' · 满级';
    const progress=next?Math.min(100,(xp-stage.xp)/(next.xp-stage.xp)*100):100;
    $('xpFill').style.width=progress+'%';
    const progressbar=document.querySelector('.xp-track');progressbar.setAttribute('aria-valuenow',String(xp));progressbar.setAttribute('aria-valuemax',String(next?.xp||Math.max(xp,800)));
    $('sceneCaption').innerHTML=escape(stage.name)+' <span>·</span> Lv.'+(level+1);
    $('questChapter').textContent=journey?mainTask().id+' · '+mainTask().topic:task?'主线 · '+task.topic:'全部主线已完成';$('questTitle').textContent=task?.name||'让知识，成为你的经营能力';
    $('questHint').textContent='领任务 · 带锦囊 · 交成果 · 等确认';
    $('continueText').textContent='';$('continueHint').textContent=journey?.profile().category?task?.name||'准备真实第一单':'先给小店定个方向';
    refreshInventoryDots();
    $('guideText').textContent='目标第一单，先拿下这一步！';
    if(panel)renderPanel();
    homeReady=syncHome();
  }
  async function syncHome(){
    const stage=growthStage()+1;
    if(homeScene&&homeStage===stage){homeScene.draft=game;homeScene.sync();homeScene.setShopName(game.shop_name);homeScene.setAtmosphere(skyState.light);return homeScene.ready;}
    if(homeStage===stage)return;
    const token=++homeToken;selected=null;homeStage=stage;homeScene?.dispose();homeScene=null;$('homeCanvas').hidden=false;
    sceneLoading('home');
    const deadline=setTimeout(()=>{if(token!==homeToken)return;++homeToken;homeScene?.dispose();homeScene=null;homeStage=0;$('homeCanvas').hidden=true;sceneFailed('场景加载超时，可以重试，或先继续学习。');},210000);
    try{
      const {ShopScene}=await import(sceneURL.href);if(token!==homeToken)return;
      const candidate=new ShopScene($('homeCanvas'),{stage,quality:game.graphics_quality,framingElement:$('sceneFraming'),night:theme()==='night',atmosphere:skyState.light,shopName:game.shop_name,draft:game,onLoadProgress:p=>{if(token!==homeToken)return;const label=p.phase==='shop'?'店铺':'小岛';$('sceneLoadHint').textContent=p.phase==='manifest'?'正在读取场景清单…':p.phase==='compile'?'正在准备灯光与材质…':p.retrying?'网络中断，正在重试下载'+label+'…':p.decoding?'正在准备'+label+'贴图…':'正在下载'+label+'…'+(p.total?' '+Math.min(100,Math.round(p.loaded/p.total*100))+'%':p.loaded?' '+(p.loaded/1048576).toFixed(1)+' MB':'');},onContextLost:()=>{if(token!==homeToken)return;++homeToken;homeStage=0;homeScene?.dispose();homeScene=null;$('homeCanvas').hidden=true;sceneFailed('显卡连接中断，请点击重新加载。');},onNpcFrame:updateNpcFrame,isInventoryPoint:e=>panel==='inventory'&&inBackpack(e),onReturnDecoration:id=>{audio.play('cancel');game.placements=game.placements.filter(p=>p.id!==id);selected=null;homeScene.sync();save();renderInventory();},onSelect:id=>{if(id)audio.play('pick');selected=id;if(panel==='inventory')renderInventory();},onChange:()=>{audio.play('place');save();if(panel==='inventory')renderInventory();}});homeScene=candidate;
      await candidate.ready;if(token!==homeToken)return;if(candidate.source!=='tripo_model')throw new Error('Scene assets unavailable');
      await candidate.prepareFrame();if(token!==homeToken)return;
      $('homeCanvas').hidden=false;sceneLoaded();
    }catch(error){if(token!==homeToken)return;homeScene?.dispose();homeScene=null;homeStage=0;$('homeCanvas').hidden=true;sceneFailed(/^[\u4e00-\u9fff]/.test(error.message)?error.message:'场景资源加载失败，请检查网络后重试。');}finally{clearTimeout(deadline);}
  }
  function openPanel(name,sound='open'){
    document.querySelector('.copilot-dock').classList.remove('mobile-chat-open');
    audio.play(sound);
    cancelPaint();finishConversation();
    if(name!=='journey')mail.cancel();$('missionBackdrop').hidden=name!=='journey';$('missionBackdrop').classList.toggle('paper-visible',name==='journey');if(name==='journey'){$('drawer').setAttribute('role','dialog');$('drawer').setAttribute('aria-modal','true');}else{$('drawer').removeAttribute('role');$('drawer').removeAttribute('aria-modal');}
    window.EmcRoute?.onView(name);
    panel=name;activeTask=null;answer=null;feedback=null;
    $('drawer').hidden=false;$('drawer').classList.toggle('backpack',name==='inventory');$('drawer').classList.toggle('journey-card',name==='journey');$('drawer').classList.toggle('companion-panel',name==='companion');renderPanel();$('closePanel').focus({preventScroll:true});
  }
  function closePanel(){mail.close();continueLogin=null;if(panel)audio.play('close');window.EmcRoute?.onView('island');cancelPaint();panel=null;$('drawer').removeAttribute('aria-modal');$('drawer').removeAttribute('role');$('drawer').hidden=true;activeTask=null;answer=null;feedback=null;}
  function renderPanel(){
    const titles={quests:['A LITTLE DETOUR','支线小挑战'],inventory:['LITTLE THINGS, BIG IDEAS','装饰背包'],collection:['GROW AT YOUR OWN PACE','成长图鉴'],settings:['MAKE IT YOURS','小店设置'],history:['CONVERSATIONS ON THE ISLAND','和'+partnerName()+'的对话'],partner:['HELLO, PARTNER','给伙伴起个名字'],missions:['YOUR JOURNEY','任务导航'],journey:['A LETTER FOR YOU',partnerName()+'的任务来信'],companion:['YOUR BUSINESS PARTNER','我的伙伴']};
    $('panelBody').classList.toggle('journey-body',panel==='journey');
    $('panelEyebrow').textContent=titles[panel][0];$('panelTitle').textContent=titles[panel][1];
    if(panel==='missions')renderMissionList();if(panel==='companion')renderCompanion();if(panel==='journey')journey?.render();if(panel==='quests')renderQuests();if(panel==='inventory')renderInventory();if(panel==='collection')renderCollection();if(panel==='partner')renderPartnerSetup();if(panel==='settings')renderSettings();if(panel==='history')renderChatHistory();
  }
  function renderMissionList(){
    const p=journey.profile(),state=journey.progress(),labels={approved:'已完成',pending:'确认中',rejected:'待补充',ready:'进行中',draft:'草稿',locked:'未解锁'};
    $('panelBody').innerHTML=`<p class="mission-list-intro">从一间小店，到第一单。这里查看路线和进度，具体任务写在小商的来信里。</p><div class="mission-list-info"><span>${escape(window.EmcJourney.PLATFORMS[p.platform]?.name||'待选平台')}</span><span>${escape(p.category||'待定类目')}</span><span>${state.completed} / 6 关${journey.isDemo()?' · 演示':''}</span></div><ol class="mission-list">${state.levels.map((l,i)=>`<li><button data-mail-level="${l.id}" ${l.status==='locked'&&!journey.isDemo()?'disabled':''}><i>${l.status==='approved'?'✓':i+1}</i><span><b>${escape(l.title)}</b><small>${l.id} · ${l.topic}</small></span><em>${labels[l.status]}</em></button></li>`).join('')}<li><button data-mail-level="first_order" ${state.completed<6&&!journey.isDemo()?'disabled':''}><i>✦</i><span><b>卖出真实第一单</b><small>最终试炼 · 订单核验</small></span><em>${state.completed<6?'未解锁':'待挑战'}</em></button></li></ol><p class="mission-list-note">${journey.isDemo()?'试玩支持直接预览各关，演示经验与真实成果独立保存。':'完成实操并通过核验后，才能解锁下一关。'}</p><button class="j-button primary" data-mail-current>拆开当前任务来信 →</button><button class="j-button" data-mail-side>查看可选支线</button>`;
  }
  document.addEventListener('click',e=>{const level=e.target.closest('[data-mail-level]');if(level)openMission(null,level.dataset.mailLevel);else if(e.target.closest('[data-mail-current]'))openMission();else if(e.target.closest('[data-mail-side]')){tab='side';openPanel('quests');}});
  function renderQuests(){
    if(tab==='main'&&journey){startMain();return;}
    const body=$('panelBody');
    const tabs=`<div class="panel-tabs"><button class="${tab==='main'?'active':''}" data-tab="main">回到主线任务卡</button><button class="${tab==='side'?'active':''}" data-tab="side">可选支线 <small>${game.side.length}/6</small></button></div>`;
    if(activeTask){
      const t=activeTask,done=(t.level==='side'?game.side:game.main).includes(t.id);
      body.innerHTML=tabs+`<p class="eyebrow">${escape(t.topic)} · 教学挑战</p><h3 class="quest-heading">${escape(t.name)}</h3><p class="quest-question">${escape(t.question)}</p><div class="quest-options">${t.options.map((o,i)=>`<button class="quest-option ${answer===i?'selected':''}" data-answer="${i}" aria-pressed="${answer===i}" ${done?'disabled':''}><span class="choice-key">${String.fromCharCode(65+i)}</span><span>${escape(o)}</span></button>`).join('')}</div>${feedback?`<div class="quest-feedback ${feedback.ok?'success':''}" role="status">${escape(feedback.message)}</div>`:''}<div class="quest-reward"><span>${t.level==='side'?'✦ 完成装饰挑战':'✦ 经验 +'+t.xp}</span>${t.reward?`<span>解锁 ${escape(G.DECOR.find(d=>d.id===t.reward).name)}</span>`:''}</div><button class="small-button gold quest-submit" id="submitAnswer" ${!done&&answer===null?'disabled':''}>${done?(t.level==='side'?'返回支线列表':'继续下一步'):'确认我的判断'}</button><p class="muted-note">可以随时离开，已完成的进度会保留。<br>当前为教学练习，不会执行真实平台操作。</p>`;
    }else if(tab==='main'){
      body.innerHTML=tabs+(game.main.length===G.MAIN.length?`<div class="completed-banner">${icons('star')}<h3>从第一步，到独当一面。</h3><p>六个学习阶段已完成。<br>你的小店已成长为百货大楼，<br>也可以随时回顾每一项练习。</p></div>`:'')+G.MAIN.map((t,i)=>`<button class="quest-row" data-task="${t.id}"><span class="eyebrow">${String(i+1).padStart(2,'0')}</span><span class="row-text"><b>${escape(t.name)}</b><small>${t.level} · ${t.topic} · +80 经验</small></span><span>${game.main.includes(t.id)?'✓ 已完成':G.current(game)?.id===t.id?'进行中 →':'可预览'}</span></button>`).join('');
    }else{
      body.innerHTML=tabs+'<p class="muted-note">不赶进度，找点灵感。完成一项小练习，带一件装饰回家。</p>'+G.SIDE.map(t=>`<button class="quest-row" data-task="${t.id}"><span class="row-icon">${sprite(t.reward)}</span><span class="row-text"><b>${escape(t.name)}</b><small>${escape(G.DECOR.find(d=>d.id===t.reward).name)} · +20 经验</small></span><span>${game.side.includes(t.id)?'✓ 已获得':'探索 →'}</span></button>`).join('');
    }
  }
  const partNames={wall:'墙面',sign:'招牌',roof:'屋顶',decor:'装饰'};
  const colorNames={wall:['奶油白','鼠尾草','雾蓝','燕麦棕','浅丁香'],sign:['原木棕','松叶绿','海盐蓝','葡萄紫','蜂蜜金'],roof:['砖红','苔绿','雾蓝','暮紫','可可棕']};
  function refreshInventoryDots(){
    const unread=G.unreadInventory(game),keys=new Set(unread.map(item=>item.key)),categories=new Set(unread.map(item=>item.category));
    $('inventoryDot').hidden=unread.length===0;
    document.querySelector('[data-panel="inventory"]').setAttribute('aria-label',unread.length?'背包，有新物品':'背包');
    document.querySelectorAll('[data-bag-tab]').forEach(button=>button.setAttribute('aria-label',partNames[button.dataset.bagTab]+(categories.has(button.dataset.bagTab)?'，有新物品':'')));
    document.querySelectorAll('[data-new-category]').forEach(dot=>{dot.hidden=!categories.has(dot.dataset.newCategory);});
    document.querySelectorAll('[data-new-item]').forEach(dot=>{dot.hidden=!keys.has(dot.dataset.newItem);});
    document.querySelectorAll('[data-inventory-key]').forEach(button=>button.setAttribute('aria-label',button.dataset.inventoryLabel+(keys.has(button.dataset.inventoryKey)?'，新解锁':'')));
  }
  function viewInventoryItem(button){
    if(!button||!G.markInventorySeen(game,button.dataset.inventoryKey))return;
    refreshInventoryDots();save();
  }
  function renderInventory(){
    const dot=(kind,key)=>`<i class="bag-new-dot" data-new-${kind}="${escape(key)}" aria-hidden="true" hidden></i>`;
    const tabs=Object.entries(partNames).map(([id,name])=>`<button data-bag-tab="${id}" aria-pressed="${bagTab===id}">${name}${dot('category',id)}</button>`).join('');
    let content;
    if(bagTab!=='decor')content='<div class="paint-grid">'+G.PALETTES[bagTab].map((color,i)=>{
      const key=bagTab+':'+color,label=partNames[bagTab]+' · '+colorNames[bagTab][i];
      return `<button class="paint-item" data-inventory-key="${key}" data-inventory-label="${escape(label)}" data-paint-part="${bagTab}" data-color="${color}" aria-label="${escape(label)}" aria-pressed="${game[bagTab+'_color']===color}">${dot('item',key)}<span class="paint-sample sample-${bagTab}" style="--paint:${color}"></span><b>${colorNames[bagTab][i]}</b><small>${game[bagTab+'_color']===color?'使用中':'长按拖动'}</small></button>`;
    }).join('')+'</div>';
    else content='<div class="bag-decor-grid">'+G.DECOR.map(d=>{const owned=rewardOwned(d.id),placed=game.placements.some(p=>p.id===d.id);return `<button class="bag-decor ${owned?'':'locked'}" ${owned?`data-decor-id="${d.id}" data-inventory-key="decor:${d.id}" data-inventory-label="${escape(d.name)}"`:'data-side="true"'}>${owned?dot('item','decor:'+d.id):''}${sprite(d.id)}<b>${d.name}</b><small>${owned?(placed?'已摆放 · 可拖动':'长按拖到岛上'):'支线解锁'}</small></button>`}).join('')+'</div>';
    $('panelBody').innerHTML=`<div class="bag-tabs">${tabs}</div><p class="bag-hint" id="bagHint">${bagTab==='decor'?'长按物品拖到岛上；拖回背包取消':'长按配色，拖到'+(partNames[bagTab]||'小岛')+'；拖回背包取消'}</p>${content}<div class="bag-footer"><span>松手应用 · 自动保存</span><button id="undoPaint" ${paintUndo?'':'disabled'}>撤销上次修改</button></div>`;
    refreshInventoryDots();
  }
  function renderCollection(){
    const current=growthStage();
    $('panelBody').innerHTML='<p class="muted-note">五段成长，从小店到真实第一单。<br>关卡成果确认后成长，首单核验通过才成为破零卖家。</p>'+G.STAGES.map((s,i)=>`<div class="stage-item ${i===current?'current':''}"><img src="assets/game/shop-${i+1}.png" alt="${s.name}" loading="lazy"><div><b>Lv.${i+1} ${s.name}</b><p>${window.EmcJourney.GROWTH[i]}<br>${i===0?'L1 定方向 · L2 会选品':['','完成 L2','完成 L4','完成 L5 · L6 复盘','真实第一单核验通过'][i]}</p></div><span class="stage-state">${i===current?'当前店铺':i<current?'已达成':'待成长'}</span></div>`).join('')+'<p class="muted-note">建筑等级代表教学成长，不是平台成交或正式认证。</p>';
  }
  function accountSettings(){
    const me=window.EmcSession?.current(),logged=me?.authenticated;
    return `<section class="account-settings" aria-label="玩家账号"><p class="field-label">玩家账号</p>${logged?`<b>${escape(me.player.display_name)}</b>${me.player.email?`<p class="account-email">${escape(me.player.email)}</p>`:''}<button type="button" class="small-button" data-account-action="logout">退出登录</button>`:`<p class="muted-note">登录 Acos Connect，使用统一玩家身份。教学和装修可以继续体验。</p><button type="button" class="small-button gold" data-account-action="login">登录 / 注册</button>`}<p class="muted-note">教学进度与装修仍保存在当前浏览器，登录不会将它们转为云存档或正式认证。</p></section>`;
  }
  function renderPartnerName(){
    const name=partnerName();$('npcInteract').querySelector('span').textContent=name;$('npcInteract').title=name;$('npcInteract').setAttribute('aria-label','和伙伴'+name+'对话');
    $('npcBubble').querySelector('header b').textContent=name;$('npcBubble').querySelector('header b').title=name;$('npcBubble').setAttribute('aria-label',name+'的消息');
    $('copilotProfile').setAttribute('aria-label','查看'+name+'的角色面板');$('copilotProfile').title=name+' · 我的伙伴';
    $('copilotInput').placeholder='问问'+name+'，下一步怎么做…';$('copilotInput').setAttribute('aria-label','给'+name+'发消息');updateChatAvailability();
  }
  function partnerField(){return `<label for="partnerNameInput">伙伴名称</label><input id="partnerNameInput" maxlength="24" value="${escape(partnerName())}" autocomplete="off" aria-describedby="partnerNameHint partnerNameError"><p class="muted-note" id="partnerNameHint">1—12 个中英文字或数字，也可用空格、·、_、-。以后可以修改。</p><p id="partnerNameError" class="muted-note" role="status"></p>`;}
  function partnerSettings(){return `<section class="setting-field" aria-label="伙伴设置">${partnerField()}<button class="small-button gold" id="savePartnerName">保存伙伴名称</button><p class="muted-note">伙伴会用这个名字陪你对话，名字也会传给 AI。</p></section>`;}
  function renderPartnerSetup(){
    $('panelBody').innerHTML=`<p class="quest-question">开店的路上，有个伙伴陪你一起。你想怎么称呼 TA？</p><div class="setting-field">${partnerField()}<button class="small-button gold" id="confirmPartnerName">${continueLogin?'保存并继续登录 / 注册':'认识我的伙伴'}</button></div><p class="muted-note">伙伴名称保存在本浏览器的教学存档中，与账号昵称分开。</p>`;
  }
  function savePartnerName(setup){
    const name=C.validName($('partnerNameInput').value);if(!name){$('partnerNameError').textContent='请输入 1—12 个有效字符。';$('partnerNameInput').setAttribute('aria-invalid','true');$('partnerNameInput').focus();return;}
    finishConversation();const previous={name:game.companion_name,named:game.companion_named};game.companion_name=name;game.companion_named=true;
    if(!save()){game.companion_name=previous.name;game.companion_named=previous.named;$('partnerNameError').textContent='暂时没能保存，请重试后再继续。';return;}
    renderPartnerName();const proceed=continueLogin;
    if(setup){closePanel();if(proceed){proceed();return;}}else renderSettings();
    toast('伙伴名称已保存：'+name);
  }
  document.addEventListener('emc:before-login',e=>{
    if(game.companion_named)return;e.preventDefault();openPanel('partner');continueLogin=e.detail.proceed;renderPartnerSetup();$('partnerNameInput').focus();
  });
  $('panelBody').addEventListener('input',e=>{if(e.target.id==='partnerNameInput'){$('partnerNameError').textContent='';e.target.removeAttribute('aria-invalid');}});
  function audioSettings(){
    const a=audio.state();
    return `<section class="setting-field audio-settings" aria-label="音乐与音效"><p class="field-label">音乐与音效</p><p class="muted-note">开张冲冲冲 · 128 BPM 原创街机循环</p>${[['music','背景音乐','musicVolume'],['sfx','互动音效','sfxVolume']].map(([key,label,volume])=>`<div class="audio-row"><span>${label}</span><button class="small-button" data-audio-toggle="${key}" aria-label="${label}" aria-pressed="${a[key]}" ${a.available?'':'disabled'}>${a[key]?'开启':'关闭'}</button></div><label class="audio-volume" for="${volume}"><span>音量 <output id="${volume}Value">${Math.round(a[volume]*100)}%</output></span><input id="${volume}" data-audio-volume="${volume}" aria-label="${label}音量" type="range" min="0" max="100" step="5" value="${Math.round(a[volume]*100)}" ${a.available?'':'disabled'}></label>`).join('')}<p class="muted-note">${a.available?'首次点击后播放，切到后台时暂停。':'当前浏览器暂不支持声音播放。'}</p></section>`;
  }
  function graphicsSettings(){return `<section class="setting-field" aria-label="画面质量"><p class="field-label">画面质量</p><div class="setting-actions">${[['auto','自动适配'],['smooth','流畅优先'],['detail','精细画面']].map(([id,name])=>`<button class="small-button" data-graphics-quality="${id}" aria-pressed="${game.graphics_quality===id}">${name}</button>`).join('')}</div><p class="muted-note">自动适配会为手机和较低配置使用轻量模型。感觉卡顿时，可以选择流畅优先；切换画质会重新加载小岛。</p></section>`;}
  function renderSettings(){
    $('panelBody').innerHTML=accountSettings()+partnerSettings()+audioSettings()+graphicsSettings()+`<div class="setting-field"><label for="shopNameInput">给你的小店起个名字</label><input id="shopNameInput" maxlength="12" value="${escape(game.shop_name)}" autocomplete="off"><p class="muted-note">最多 12 个字，保存后同步更新店铺招牌。</p><button class="small-button gold" id="saveName">保存店名</button></div><div class="setting-field"><p class="field-label">日夜模式</p><div class="setting-actions">${[['auto','跟随时间'],['day','固定白天'],['night','固定夜晚']].map(([v,n])=>`<button class="small-button" data-theme-option="${v}" aria-pressed="${game.theme===v}">${n}</button>`).join('')}</div><p class="muted-note">跟随本地时间经过晨光、晚霞与夜色；固定模式把日月留在右上角。</p></div><p class="muted-note">伙伴设置、装修和旧版练习保存在本浏览器。真实经营成果及确认进度登录后保存到云端。<br><br>完成任务后交回真实成果，确认通过才解锁后续关卡；提交文件不会自动视作通关。</p><button class="small-button" id="exportSave">导出教学存档</button><p class="muted-note">五级店铺与悬浮岛已接入 Tripo 3D 模型。在背包里长按配色，拖到墙面、招牌或屋顶即可更换。</p>`;
  }
  function openMission(entry,level){if(mail.state().opening)return;closePanel();mail.open(()=>{openPanel('journey','start');if(level)journey.openLevel(level);else journey.open(entry);$('drawer').setAttribute('role','dialog');$('drawer').setAttribute('aria-modal','true');});}
  function startMain(){openMission();}

  function showTask(id){
    const t=[...G.MAIN,...G.SIDE].find(t=>t.id===id);if(!t)return;
    activeTask=t;answer=null;feedback=null;
    if(t.level!=='side'&&!game.main.includes(id)&&G.current(game)?.id!==id)feedback={ok:false,message:'可以先了解题目；经验会在完成前面的主线后发放。'};
    renderQuests();
  }
  function submit(){
    if(!activeTask)return;
    const done=(activeTask.level==='side'?game.side:game.main).includes(activeTask.id);
    if(done){activeTask=activeTask.level==='side'?null:G.current(game);answer=null;feedback=null;renderQuests();return;}
    const before=growthStage(),result=G.complete(game,activeTask.id,answer);
    feedback={ok:result.ok,message:result.ok?result.why:result.reason};
    if(result.ok){
      save();render();
      const after=growthStage();audio.play(after>before?'upgrade':'reward');juice.burst($('sideButton'));toast(after>before?'小店升级！现在是 Lv.'+(after+1)+' '+G.STAGES[after].name:'支线挑战完成'+(result.reward?' · '+G.DECOR.find(d=>d.id===result.reward).name+' 已放入背包':''),after>before);
    }else{audio.play('wrong');renderQuests();}
  }
  function npcAvailable(){return !!npcState?.visible&&homeScene?.presentable&&!$('scene').dataset.loading;}
  function updateChatAvailability(){
    const available=npcAvailable(),ready=available&&!sending&&!paintDrag?.active;
    $('copilotInput').disabled=!ready;$('copilotSend').disabled=!ready||!$('copilotInput').value.trim();
    const text=!homeScene?.presentable?partnerName()+'正在上岛…':!available?(npcState?.occluded?partnerName()+'被店铺挡住了，转一转小岛再聊':'转一转小岛，让'+partnerName()+'回到视野里'):sending?partnerName()+'正在回应…':typeof window.EmcCopilotTransport==='function'?partnerName()+' · AI 副驾':partnerName()+' · 本地教学演示';
    if($('copilotStatus').textContent!==text)$('copilotStatus').textContent=text;
    document.querySelector('.copilot-dock').classList.toggle('npc-unavailable',!available);
    if(panel==='companion'){
      const presence=$('panelBody').querySelector('.companion-presence');if(presence){const label=available?'就在岛上，随时聊聊':'转动小岛，让我回到视野';if(presence.textContent!==label)presence.textContent=label;presence.classList.toggle('away',!available);}
      $('panelBody').querySelectorAll('[data-companion-talk]').forEach(button=>{if(button.disabled!==!ready)button.disabled=!ready;});
    }
  }
  function fitNpcCloud(){
    const bubble=$('npcBubble');if(bubble.hidden)return;
    $('npcScrollHint').hidden=$('npcSpeech').scrollHeight<=$('npcSpeech').clientHeight+1;
    const width=bubble.offsetWidth,height=bubble.offsetHeight,key=width+':'+height;
    if(bubble.dataset.cloudSize===key)return;bubble.dataset.cloudSize=key;
    // 顶部与底部使用固定弧度，只延长云朵中段，长回复不会把云边拉入文字区。
    const h=Math.max(180,height*300/width),svg=bubble.querySelector('.npc-cloud');
    svg.setAttribute('viewBox',`0 0 300 ${h}`);
    svg.querySelector('path').setAttribute('d',`M42 ${h-26}C17 ${h-25} 5 ${h-41} 10 ${h-57}C-1 ${h-74} 5 87 21 80C9 56 26 36 48 39C55 16 80 10 99 23C117 3 147 6 162 21C183 7 211 16 216 36C249 23 278 35 280 57C295 60 305 83 289 102C305 ${h-52} 286 ${h-29} 261 ${h-30}C251 ${h-9} 224 ${h-2} 205 ${h-14}C185 ${h+5} 155 ${h-2} 145 ${h-12}C128 ${h+2} 102 ${h-3} 92 ${h-16}C71 ${h-1} 46 ${h-5} 42 ${h-26}Z`);
  }
  function updateNpcFrame(state){
    npcState=state;
    const available=npcAvailable(),anchor=$('npcAnchor');anchor.hidden=!available;
    if(available){anchor.style.left=state.screen.x+'px';anchor.style.top=state.screen.y+'px';const width=$('npcBubble').offsetWidth||(innerWidth<=370?200:innerWidth<=700?230:270);const offset=Math.max(width/2+12,Math.min(innerWidth-width/2-12,state.screen.x))-state.screen.x;$('npcBubble').style.left=offset+'px';$('npcBubble').style.setProperty('--tail-x',Math.max(12,Math.min(width-22,width/2-offset-5))+'px');if(innerWidth<=700){const bubble=$('npcBubble'),speech=$('npcSpeech'),chrome=bubble.hidden?138:bubble.offsetHeight-speech.clientHeight,ceiling=document.querySelector('.player-card').getBoundingClientRect().bottom+8;const limit=Math.max(40,Math.min(140,Math.floor((state.screen.y-40-ceiling-chrome)/20)*20));bubble.style.setProperty('--npc-text-max',limit+'px');}else $('npcBubble').style.removeProperty('--npc-text-max');}
    else if(conversation||!$('npcBubble').hidden){finishConversation();}
    fitNpcCloud();updateChatAvailability();
  }
  function finishConversation(){
    speechEpoch++;conversation=false;homeScene?.guide?.setTalking(false);$('npcBubble').hidden=true;bubbleUntil=0;bubbleKind=null;
  }
  function startConversation(){
    if(!npcAvailable()||!homeScene?.guide?.setTalking(true))return false;
    conversation=true;return true;
  }
  function speak(text,kind='reply',source){
    if(!npcAvailable())return;
    audio.play('message');
    bubbleKind=kind;bubbleUntil=performance.now()+(kind==='reminder'?6500:Math.max(12000,Math.min(24000,text.length*150)));
    $('npcSpeech').textContent=text;$('npcSpeech').scrollTop=0;$('npcReplySource').textContent=source||(typeof window.EmcCopilotTransport==='function'?'AI 副驾':'本地教学演示');$('npcBubble').hidden=false;
    $('npcContinue').hidden=kind==='reminder';$('npcTask').hidden=kind!=='reminder';$('npcMissionActions').hidden=!journey||!['reply','mission'].includes(kind);fitNpcCloud();
  }
  let visibleCompanionScope='',visibleCompanionLevel='';
  function currentCompanionTask(){const task=journey?.progress().current;return task?{...task,name:task.title,required_evidence:task.slots.filter(s=>s.required).map(s=>s.label)}:null;}
  function readCompanion(){
    const scope=companionScope();if(scope!==visibleCompanionScope){visibleCompanionScope=scope;companionFeedback=null;companionQuote='';perkExpanded=false;}
    const level=currentCompanionTask()?.id||'first_order';if(level!==visibleCompanionLevel){visibleCompanionLevel=level;companionFeedback=null;companionQuote='';perkExpanded=false;}
    const previous=companionStore.read(),next=M.enter(previous,level);if(previous.level!==next.level)companionSaveOk=companionStore.save(next);return next;
  }
  function openCompanion(introduce=false){
    openPanel('companion');
    if(introduce&&npcAvailable()&&startConversation()){
      const task=currentCompanionTask(),text=M.brief(task,task?.status,partnerName());companionQuote=text;speak(text,'mission','本地任务引导');
      if(game.npc_chat.at(-1)?.text!==text)appendChat('assistant',text,'local-guide');renderCompanion();
    }
  }
  function askCompanion(text,send=false){
    const prompt=String(text).slice(0,240);guidedPrompts.add(prompt);if(guidedPrompts.size>30)guidedPrompts.delete(guidedPrompts.values().next().value);
    $('copilotInput').value=prompt;updateChatAvailability();
    if(!npcAvailable()){toast('转一转小岛，让'+partnerName()+'回到视野里再聊。');return;}
    $('copilotInput').focus({preventScroll:true});if(send)$('copilotForm').requestSubmit();
  }
  function renderCompanion(){
    const body=$('panelBody'),scroll=body.scrollTop,state=readCompanion(),task=currentCompanionTask(),name=escape(partnerName()),available=npcAvailable(),owned=state.perks.includes(task?.id),last=companionFeedback;
    const status={ready:'一起开始',draft:'整理成果',pending:'成果确认中',rejected:'补齐材料'}[task?.status]||'准备最终试炼';
    const btn=(action,text,primary=false,talk=false)=>`<button type="button" class="${primary?'primary':'small-button'}" data-companion-action="${action}" ${talk?'data-companion-talk':''} ${talk&&!available?'disabled':''}>${text}</button>`;
    const meter=(id,label,value,description)=>`<div class="companion-meter ${id}"><label>${label}<b>${value}<small>/100</small></b></label><div class="companion-track" role="progressbar" aria-label="${label}" aria-valuenow="${value}" aria-valuemin="0" aria-valuemax="100"><i style="width:${value}%"></i></div><p>${description}</p></div>`;
    body.innerHTML=`<section class="companion-hero"><img class="companion-portrait" src="assets/game/characters/xiaoshang-portrait-v1.webp" alt="经营伙伴${name}的形象"><div class="companion-identity"><small>一起冲第一单</small><h3>${name}</h3><p>${M.relationship(state)}</p><span class="companion-presence ${available?'':'away'}">${available?'就在岛上，随时聊聊':'转动小岛，让我回到视野'}</span></div></section><div class="companion-meters">${meter('affinity','好感度',state.affinity,'每一次认真交流，都会更了解彼此。')}${meter('patience','耐心值',state.patience,state.patience<45?'先聚焦一件小事，基础问题也可以问。':'给出目标和依据，我陪你想得更深。')}</div><blockquote class="companion-quote">${escape(companionQuote||M.brief(task,task?.status,partnerName()))}</blockquote>${last?`<div class="companion-turn-note" role="status"><b>${last.assessment.high_quality?'这一问，有目标也有依据。':'我们先把问题说具体。'}</b><br>好感度 ${last.state.last.affinity_delta>=0?'+':''}${last.state.last.affinity_delta} · 耐心值 ${last.state.last.patience_delta>=0?'+':''}${last.state.last.patience_delta}<div class="companion-dimensions">${last.assessment.dimensions.map(d=>`<span class="${d.met?'met':''}">${d.met?'✓':'＋'} ${d.label}</span>`).join('')}</div></div>`:''}<section class="companion-section"><span class="companion-current">${task?escape(task.id+' · '+task.topic):'最终试炼'} / ${status}</span><h4 class="companion-mission-title">${escape(task?.name||'卖出真实第一单')}</h4><p>${task?'这一步要交回：'+escape(task.deliverable):'六环节已完成。首单核验开放后，用真实订单完成最后的试炼。'}</p><div class="companion-actions">${btn('talk','一起拆这一步 →',true,true)}${btn('card','回看任务卡')}</div><div class="companion-actions">${btn('kit','打开本关锦囊')}${btn('deliver',task?.status==='pending'?'查看确认进度':'我来交成果')}</div></section><section class="companion-section"><h4>把问题交给我，一起往前走</h4><p>先说目标，再补充你知道的事实、范围和已经试过的办法。不必一次说全，我会接着问。</p><div class="companion-prompts">${btn('clarify','我拿不定主意，先问我最关键的信息。',false,true)}${btn('reason','帮我分清：哪些有依据，哪些还要验证？',false,true)}</div></section><section class="companion-section"><h4>藏着一份本关验证锦囊</h4><div class="companion-streak"><div><strong>${owned?'3':state.streak}/3</strong><br><small>${owned?'本关福利已解锁':'连续三次有目标、有依据的提问'}</small></div><div class="companion-seals" aria-hidden="true">${[1,2,3].map(n=>`<i class="${n<=(owned?3:state.streak)?'active':''}">✦</i>`).join('')}</div></div><p>在清楚的目标外，补足事实、范围、已尝试的动作中的两项。换个环节，伙伴重新就位。</p><div class="companion-perk"><b>${owned?'已解锁 · 本关验证锦囊':'未解锁 · 把判断变成可验证的下一步'}</b>${owned?`<div class="companion-actions">${btn('perk',perkExpanded?'收起锦囊':'打开专属锦囊')}</div>${perkExpanded?M.perk(task).map(item=>`<article><b>${escape(item.title)}</b><p>${escape(item.text)}</p></article>`).join(''):''}`:'<p>解锁后，会多一份拆假设、做对照、整理证据的检查清单。</p>'}</div></section><p class="companion-local-note">伙伴成长试运行 · ${companionSaveOk?'当前浏览器、当前账号与项目分别保存':'本地保存暂不可用，刷新可能丢失进度'}。提问质量暂按本地练习规则识别，尚未接入真实 AI 评估；不会发放正式经验或替代成果核验。快捷提问和重复问题不重复计分。耐心值较低时会先拆小问题，不会关闭基础答疑或主线任务。</p>`;
    body.scrollTop=scroll;
  }
  document.addEventListener('click',e=>{
    const action=e.target.closest('[data-companion-action]')?.dataset.companionAction;if(!action)return;
    if(['talk','clarify','reason','perk'].includes(action))audio.play('click');
    if(action==='card')openMission();
    else if(action==='kit')openMission('kit');
    else if(action==='deliver')openMission('submit');
    else if(action==='perk'){perkExpanded=!perkExpanded;if(panel==='missions')renderMissionList();if(panel==='companion')renderCompanion();}
    else if(['talk','clarify','reason'].includes(action)){
      if(panel!=='companion')openCompanion();const task=currentCompanionTask();
      askCompanion(action==='talk'?'我们开始「'+(task?.name||'真实第一单')+'」，先帮我拆成一个能执行的小步骤。':action==='clarify'?'我在做「'+(task?.name||'当前任务')+'」，还拿不定主意，请先问我最关键的信息。':'我在做「'+(task?.name||'当前任务')+'」，请帮我分清已有事实、假设和下一步验证办法。',true);
    }
  });
  function renderChatHistory(){
    const messages=game.npc_chat;
    $('panelBody').innerHTML='<p class="muted-note">对话保存在当前浏览器。演示回复会单独标记。</p><div class="chat-log">'+(messages.length?messages.map(m=>`<article class="chat-message ${m.role}"><header><b>${m.role==='user'?'你':escape(partnerName())}</b><small>${m.role==='assistant'?(m.source==='ai'?'AI 副驾':'本地教学演示'):'玩家'}${m.time?' · '+new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}):''}</small></header><p>${escape(m.text)}</p></article>`).join(''):'<div class="chat-empty">还没有聊过天。<br>在底部向'+escape(partnerName())+'打个招呼吧。</div>')+'</div>';
    $('panelBody').scrollTop=$('panelBody').scrollHeight;
  }
  function renderSocialChat(){
    const host=$('socialMessages');if(!host)return;const state=readCompanion(),name=partnerName();
    $('socialName').textContent=name;$('socialAffinity').textContent=state.affinity+'/100';$('socialPatience').textContent=state.patience+'/100';$('companionAvatar').setAttribute('aria-label','查看'+name+'的详情');
    const rows=C.history(game.npc_chat).slice(-30),nearBottom=host.scrollHeight-host.scrollTop-host.clientHeight<60;
    const markup=rows.length?rows.map(row=>`<article class="social-message ${row.role==='user'?'mine':'theirs'}"><small>${row.role==='user'?'我':escape(name)}</small><p>${escape(row.text).replaceAll('\n','<br>')}</p></article>`).join(''):`<article class="social-message theirs"><small>${escape(name)}</small><p>${escape(M.brief(currentCompanionTask(),currentCompanionTask()?.status,name))}</p></article>`;
    if(host.innerHTML!==markup){host.innerHTML=markup;if(nearBottom)host.scrollTop=host.scrollHeight;}
  }
  function appendChat(role,text,source){game.npc_chat=C.history([...game.npc_chat,{role,text,source,time:Date.now()}]);save();renderSocialChat();if(panel==='history')renderChatHistory();}
  $('copilotInput').addEventListener('input',updateChatAvailability);
  $('copilotInput').addEventListener('focus',()=>{if(!npcAvailable())return;if(panel!=='companion')closePanel();startConversation();});
  $('copilotInput').addEventListener('blur',()=>{if(!sending&&$('npcBubble').hidden)finishConversation();});
  $('npcInteract').onclick=()=>{if(npcAvailable())openCompanion(true);};
  const placeSocialChat=()=>{const nav=document.querySelector('.quest-peek').getBoundingClientRect(),dock=document.querySelector('.copilot-dock');dock.style.setProperty('--social-top',(nav.bottom+16)+'px');dock.style.setProperty('--social-right',(innerWidth-nav.right)+'px');dock.style.setProperty('--social-width',nav.width+'px');};
  new ResizeObserver(placeSocialChat).observe(document.querySelector('.quest-peek'));window.addEventListener('resize',placeSocialChat);placeSocialChat();
  $('companionAvatar').onclick=()=>openCompanion();
  $('copilotProfile').onclick=()=>{if(panel==='companion')closePanel();else openCompanion();};
  $('closeNpcBubble').onclick=$('npcContinue').onclick=()=>{finishConversation();$('copilotInput').blur();lastReminderAt=performance.now();};
  $('npcBubble').addEventListener('pointerenter',()=>{if(bubbleKind==='reminder'&&npcAvailable())homeScene.guide.setTalking(true);});
  $('npcBubble').addEventListener('pointerleave',()=>{if(!conversation&&!sending)homeScene?.guide?.setTalking(false);});
  $('npcTask').onclick=()=>{finishConversation();startMain();};
  $('closeMobileChat').onclick=()=>{document.querySelector('.copilot-dock').classList.remove('mobile-chat-open');$('copilotHistory').setAttribute('aria-expanded','false');};
  $('copilotHistory').setAttribute('aria-label','打开伙伴对话');
  $('copilotHistory').onclick=()=>{if(innerWidth<=700){const dock=document.querySelector('.copilot-dock'),opening=!dock.classList.contains('mobile-chat-open');closePanel();dock.classList.toggle('mobile-chat-open',opening);$('copilotHistory').setAttribute('aria-expanded',String(opening));renderSocialChat();if(opening)$('socialMessages').scrollTop=$('socialMessages').scrollHeight;}else if(panel==='history')closePanel();else openPanel('history');};
  $('copilotForm').addEventListener('submit',async e=>{
    e.preventDefault();const message=$('copilotInput').value.trim().slice(0,240);
    if(sending||!message||paintDrag?.active)return;
    npcState=homeScene?.guide?.status(true)||null;if(!npcAvailable()||!startConversation()){updateChatAvailability();return;}
    if(panel!=='companion')closePanel();startConversation();sending=true;const scene=homeScene,epoch=speechEpoch,scope=companionScope();appendChat('user',message,'local-guide');$('copilotInput').value='';updateChatAvailability();speak('让我看看你现在的进度…','waiting');
    const controller=replyController=new AbortController();let timer;
    try{
      const assessment=M.assess(message),practice=readCompanion(),guided=guidedPrompts.has(message);
      const context={...(journey?.context()||{}),companion:{affinity:practice.affinity,patience:practice.patience,advice_depth:M.depth(practice,assessment),question_dimensions:assessment.dimensions,source:'local-practice'},companion_name:partnerName(),stage:growthStage()+1,xp:journey?journey.progress().xp:G.xp(game),task:journey?.context().task||mainTask(),history:C.history(game.npc_chat).slice(-12)};
      if(!journey?.isDemo()&&typeof window.EmcCopilotTransport==='function'&&journey)Object.assign(context,await journey.prepareContext());
      if(journey){context.task=currentCompanionTask();context.journey={...context.journey,status:context.task?.status||'complete'};}
      const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('回复超时'));},20000);});
      const result=await Promise.race([C.reply(message,context,{transport:journey?.isDemo()?undefined:window.EmcCopilotTransport,signal:controller.signal}),timeout]);
      if(scope!==companionScope())throw new Error('COMPANION_SCOPE_CHANGED');
      const change=M.record(practice,message,{level:context.task?.id||'first_order',guided});companionSaveOk=companionStore.save(change.state);if(!companionSaveOk)toast('伙伴进度暂时无法保存，刷新可能丢失本次变化。');companionFeedback=change.changed?change:null;companionQuote=result.text;
      appendChat('assistant',result.text,result.source);
      if(panel==='missions')renderMissionList();if(panel==='companion')renderCompanion();
      if(change.unlocked){audio.play('reward');toast('连问三次有依据的问题 · 本关验证锦囊已解锁');}

      if(homeScene===scene&&npcAvailable()&&speechEpoch===epoch){startConversation();speak(result.text,'reply',result.source==='ai'?'AI 副驾':'本地教学演示');}
    }catch(error){
      if(scope!==companionScope()){toast('账号或经营项目已切换，请重新发起对话。');return;}
      $('copilotInput').value=message;
      if(homeScene===scene&&npcAvailable()&&speechEpoch===epoch)speak('暂时没能接通。消息已保留，可以稍后重试。','reply','连接失败');
      else toast('对话暂时没能接通，输入内容已保留。');
    }finally{clearTimeout(timer);if(replyController===controller)replyController=null;sending=false;updateChatAvailability();}
  });
  setInterval(()=>{
    const now=performance.now();
    if(bubbleUntil&&now>bubbleUntil){$('npcBubble').hidden=true;bubbleUntil=0;bubbleKind=null;if(document.activeElement!==$('copilotInput')&&!sending)finishConversation();}
    if(!document.hidden&&!panel&&!sending&&!conversation&&!paintDrag&&npcAvailable()&&now-lastReminderAt>35000){lastReminderAt=now;const task=mainTask();speak(M.brief(currentCompanionTask(),currentCompanionTask()?.status,partnerName()),'reminder');}
  },500);
  function inBackpack(e){const r=$('drawer').getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;}
  function cancelPaint(){
    if(!paintDrag)return;
    clearTimeout(paintDrag.timer);const {button,pointerId}=paintDrag;paintDrag=null;
    if(button.hasPointerCapture(pointerId))button.releasePointerCapture(pointerId);
    homeScene?.previewPart(null);homeScene?.clearDecorPreview();if(homeScene)homeScene.controls.enabled=true;
    $('paintGhost').hidden=true;document.body.classList.remove('painting');
    if(panel==='inventory'&&$('bagHint'))$('bagHint').textContent=bagTab==='decor'?'长按物品拖到岛上；拖回背包取消':'长按配色，拖到'+partNames[bagTab]+'；拖回背包取消';
  }
  function movePaint(e){
    const drag=paintDrag;if(!drag||drag.pointerId!==e.pointerId)return;
    if(!drag.active){if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>12)cancelPaint();return;}
    e.preventDefault();const ghost=$('paintGhost');ghost.style.left=e.clientX+'px';ghost.style.top=e.clientY+'px';
    const targetName=drag.part==='decor'?'小岛':partNames[drag.part],back=inBackpack(e),isDecor=drag.part==='decor',hit=back?null:(isDecor?homeScene?.decorDrop(e,drag.id):homeScene?.paintHit(e));drag.valid=isDecor?!!hit:hit===drag.part;
    if(isDecor){if(drag.valid)homeScene.previewDecoration(drag.id,hit);else homeScene.clearDecorPreview();}
    homeScene?.previewPart(drag.valid&&drag.part!=='decor'?drag.part:null);ghost.classList.toggle('valid',drag.valid);
    ghost.querySelector('b').textContent=back?'移出背包，拖到'+targetName:drag.valid?'松手'+(isDecor?'摆放装饰':'更换'+targetName):'拖到'+targetName+' · 此处不可放置';
    ghost.style.left=Math.max(ghost.offsetWidth/2+8,Math.min(innerWidth-ghost.offsetWidth/2-8,e.clientX))+'px';
    $('bagHint').textContent=back?'松手取消，不会修改':drag.valid?'绿色区域已选中，松手应用':'拖到对应部位，出现绿色后松手';
  }
  $('panelBody').addEventListener('pointerdown',e=>{
    const button=e.target.closest('[data-paint-part],[data-decor-id]');if(!button||e.button!==0||!homeScene?.presentable||paintDrag)return;if(button.dataset.decorId&&!rewardOwned(button.dataset.decorId))return;viewInventoryItem(button);finishConversation();
    const drag=paintDrag={button,pointerId:e.pointerId,part:button.dataset.paintPart||'decor',id:button.dataset.decorId,color:button.dataset.color||G.DECOR.find(d=>d.id===button.dataset.decorId)?.color,x:e.clientX,y:e.clientY,active:false,valid:false};
    button.setPointerCapture(e.pointerId);
    drag.timer=setTimeout(()=>{if(paintDrag!==drag)return;drag.active=true;audio.play('pick');homeScene.controls.enabled=false;document.body.classList.add('painting');const ghost=$('paintGhost');ghost.hidden=false;ghost.querySelector('span').style.background=drag.color;movePaint(e);},280);
  });
  document.addEventListener('pointermove',movePaint,{passive:false});
  document.addEventListener('pointerup',e=>{
    if(!paintDrag||paintDrag.pointerId!==e.pointerId)return;
    const drag=paintDrag,placement=drag.part==='decor'?homeScene?.decorDrop(e,drag.id):null,apply=drag.active&&!inBackpack(e)&&(drag.part==='decor'?!!placement:homeScene?.paintHit(e)===drag.part);
    cancelPaint();if(!apply){if(drag.active)audio.play('cancel');return;}audio.play('place');
    if(drag.part==='decor'){const previous=game.placements.find(p=>p.id===drag.id);if(previous)Object.assign(previous,placement);else game.placements.push({id:drag.id,...placement});homeScene.sync();const saved=save();renderInventory();toast(saved?'装饰已摆放并保存':'装饰已摆放，保存失败，请重试');return;}
    paintUndo={part:drag.part,color:game[drag.part+'_color']};game[drag.part+'_color']=drag.color;homeScene.sync();const saved=save();renderInventory();toast(saved?partNames[drag.part]+'配色已保存':'配色已应用，保存失败，请重试');
  });
  document.addEventListener('click',e=>{if(selected&&!e.target.closest('#homeCanvas'))homeScene?.select(null);});
  document.addEventListener('pointercancel',e=>{if(paintDrag?.pointerId===e.pointerId)cancelPaint();});
  document.addEventListener('lostpointercapture',e=>{if(paintDrag?.pointerId===e.pointerId)cancelPaint();});
  window.addEventListener('blur',cancelPaint);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelPaint();});
  $('panelBody').addEventListener('focusin',e=>viewInventoryItem(e.target.closest('[data-inventory-key]')));
  $('panelBody').addEventListener('contextmenu',e=>{if(e.target.closest('[data-paint-part],[data-decor-id]'))e.preventDefault();});
  $('themeAuto').onclick=()=>setTheme('auto');$('themeDay').onclick=()=>setTheme('day');$('themeNight').onclick=()=>setTheme('night');$('saveRetry').onclick=save;
  $('retryScene').onclick=()=>{homeStage=0;homeReady=syncHome();};
  document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>openPanel(b.dataset.panel));
  document.querySelector('.brand').onclick=e=>{e.preventDefault();closePanel();};
  $('panelBody').addEventListener('input',e=>{const key=e.target.dataset.audioVolume;if(key){audio.set(key,Number(e.target.value)/100);const output=$(key+'Value');if(output)output.textContent=e.target.value+'%';}});
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!b.disabled&&!b.matches('[data-panel],#closePanel,#continueButton,#sideButton,#submitAnswer,[data-audio-toggle],#copilotSend,#copilotProfile,#npcInteract,#npcTask,[data-companion-action],[data-j-action],[data-j-level],[data-j-remove]'))audio.play('click');});
  window.addEventListener('pagehide',e=>{if(!e.persisted){audio.dispose();juice.dispose();}});
  document.querySelector('.quest-peek').onclick=()=>openPanel('missions');$('missionBackdrop').onclick=closePanel;
  $('closePanel').onclick=closePanel;$('continueButton').onclick=startMain;$('sideButton').onclick=()=>{tab='side';openPanel('quests');};
  $('panelBody').onclick=e=>{
    const b=e.target.closest('button');if(!b)return;viewInventoryItem(b);
    if(b.dataset.accountAction){$(b.dataset.accountAction==='login'?'emcLoginBtn':'emcLogoutBtn')?.click();}
    else if(b.dataset.tab){tab=b.dataset.tab;activeTask=null;feedback=null;renderQuests();}
    else if(b.dataset.task)showTask(b.dataset.task);
    else if(b.dataset.answer!==undefined){answer=Number(b.dataset.answer);feedback=null;renderQuests();}
    else if(b.id==='submitAnswer')submit();
    else if(b.dataset.side){tab='side';openPanel('quests');}
    else if(b.dataset.bagTab){cancelPaint();bagTab=b.dataset.bagTab;renderInventory();}
    else if(b.id==='undoPaint'&&paintUndo){game[paintUndo.part+'_color']=paintUndo.color;paintUndo=null;homeScene?.sync();save();renderInventory();}
    else if(b.id==='savePartnerName')savePartnerName(false);
    else if(b.id==='confirmPartnerName')savePartnerName(true);
    else if(b.dataset.audioToggle){const key=b.dataset.audioToggle;audio.set(key,!audio.state()[key]);audio.play('click');renderSettings();}
    else if(b.dataset.graphicsQuality){game.graphics_quality=b.dataset.graphicsQuality;save();homeStage=0;render();}
    else if(b.dataset.themeOption){setTheme(b.dataset.themeOption);renderSettings();}
    else if(b.id==='saveName'){game.shop_name=$('shopNameInput').value.trim().slice(0,12)||'我的小店';const saved=save();render();toast(saved?'店名与招牌已保存':'店名暂存在当前页面，请重试保存');}
    else if(b.id==='exportSave'){
      const blob=new Blob([JSON.stringify(tutorial,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='first-order-tutorial.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }
  };
  document.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.id==='partnerNameInput'){e.preventDefault();savePartnerName(panel==='partner');return;}
    if(e.key==='Escape'&&mail.state().visible){closePanel();return;}
    if(e.key==='Tab'&&panel==='journey'){const nodes=Array.from($('drawer').querySelectorAll('button:not([disabled]),a[href],input,textarea,select')).filter(n=>n.getClientRects().length);if(nodes.length&&e.shiftKey&&document.activeElement===nodes[0]){e.preventDefault();nodes.at(-1).focus();}else if(nodes.length&&!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}}
    if(e.key==='Escape'){if(document.querySelector('.mobile-chat-open')){$('closeMobileChat').click();return;}if(paintDrag)cancelPaint();else if(!$('npcBubble').hidden){finishConversation();$('copilotInput').blur();}else closePanel();}
    if(selected&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)&&!['INPUT','TEXTAREA'].includes(e.target.tagName)){
      const p=game.placements.find(p=>p.id===selected);if(!p)return;e.preventDefault();p.x=Math.max(-4,Math.min(4,p.x+(e.key==='ArrowLeft'?-.2:e.key==='ArrowRight'?.2:0)));p.z=Math.max(-3.5,Math.min(3.5,p.z+(e.key==='ArrowUp'?-.2:e.key==='ArrowDown'?.2:0)));homeScene?.sync();save();
    }
  });
  window.render_game_to_text=()=>JSON.stringify({mail:mail.state(),mode:'business_journey',companion:{...readCompanion(),source:'local-practice',relationship:M.relationship(readCompanion()),feedback:companionFeedback?.assessment||null},journey:journey?.summary(),audio:audio.state(),feedback:juice.state(),theme:theme(),sky:{mode:skyState.mode,phase:skyState.phase,local_hour:skyState.local_hour,sun:skyState.sun,moon:skyState.moon,daylight:skyState.daylight},panel,stage:growthStage()+1,xp:journey?journey.progress().xp:G.xp(game),shop_name:game.shop_name,companion_name:partnerName(),companion_named:game.companion_named,sign_text:homeScene?.shopSign?homeScene.shopName:null,sign_fits:homeScene?.signFits??null,main_completed:journey?journey.progress().levels.filter(l=>l.status==='approved').map(l=>l.id):game.main,side_completed:game.side,inventory_unread:G.unreadInventory(game),current_task:journey?mainTask().id:activeTask?.id||G.current(game)?.id,formal_verification:journey?.progress().certified?'approved':'not_certified',account:{authenticated:window.EmcSession?.isLoggedIn()||false,status:window.EmcSession?.status()||'idle'},editing:false,selected_decoration:selected,selection_visible:homeScene?.selection.visible||false,placements:game.placements,wall_color:game.wall_color,sign_color:game.sign_color,roof_color:game.roof_color,npc:npcState?{visible:npcAvailable(),occluded:npcState.occluded,onscreen:npcState.onscreen,talking:npcState.talking,holding_letter:npcState.holding_letter,position:npcState.position,heading:npcState.heading,screen:npcState.screen}:null,chat:{sending,conversation,history_count:game.npc_chat.length,reply_source:typeof window.EmcCopilotTransport==='function'?'ai':'local-guide',bubble:$('npcBubble').hidden?null:$('npcSpeech').textContent},paint_drag:paintDrag?.active?{part:paintDrag.part,id:paintDrag.id||null,color:paintDrag.color,valid:paintDrag.valid}:null,preview_part:homeScene?.previewPartName||null,camera:homeScene?.camera.position.toArray(),decoration_targets:homeScene?.screenTargets()||[],grounding:homeScene?.grounding||null,coordinates:'3D: X left/right, Y up, Z front/back; roof anchor Y relative to shop',scene_status:$('sceneLoader').hidden?'ready':$('sceneLoader').dataset.state,model_textures:homeScene?.textureStatus||null,graphics:homeScene?.performanceSummary()||null,model_source:$('scene').dataset.loading?'loading':homeScene?.source||'unavailable',save_status:$('saveStatus').textContent});
  window.shopDecorTargets=id=>homeScene?.decorTargets(id)||[];
  window.shopPaintTargets=()=>homeScene?.paintTargets()||[];
  window.advanceTime=async ms=>{await homeReady;homeScene?.controls.update();homeScene?.render(true);};
  if(window.visualViewport){const keyboardLayout=()=>{const offset=innerWidth<=700?Math.max(0,innerHeight-visualViewport.height-visualViewport.offsetTop):0;document.documentElement.style.setProperty('--keyboard-offset',offset+'px');document.body.classList.toggle('keyboard-open',offset>120);};visualViewport.addEventListener('resize',keyboardLayout);visualViewport.addEventListener('scroll',keyboardLayout);keyboardLayout();}
  // 登录只恢复浏览位置；不自动提交任务、不重放经营操作。
  window.toast=toast;
  document.addEventListener('emc:route-restore',e=>{
    e.preventDefault();const view=e.detail.view==='level'?'quests':e.detail.view;
    if(['journey','missions','quests','inventory','collection','settings','history','companion'].includes(view)){openPanel(view);if(view==='journey')journey?.open();}
  });
  document.addEventListener('emc:session-changed',()=>{void journey?.refresh();if(panel==='settings'){const section=$('panelBody').querySelector('.account-settings');if(section)section.outerHTML=accountSettings();}});
  let lastSessionRefresh=Date.now();
  function refreshAccount(){if(!document.hidden&&Date.now()-lastSessionRefresh>30000){lastSessionRefresh=Date.now();window.EmcSession?.getMe({force:true});}}
  document.addEventListener('visibilitychange',refreshAccount);window.addEventListener('focus',refreshAccount);
  window.addEventListener('pageshow',e=>{if(e.persisted)window.EmcSession?.getMe({force:true});});
  journey=window.EmcJourneyUI.create({container:$('panelBody'),isOpen:()=>panel==='journey',shopName:()=>game.shop_name,partnerName:()=>game.companion_name,sound:name=>audio.play(name),celebrate:()=>juice.burst($('panelBody').querySelector('.j-reward-seal')),onProfile:p=>{game.shop_name=p.shop_name;game.companion_name=p.partner_name;game.companion_named=true;save();},onUpdate:()=>{if(journey?.summary().project_id)game.shop_name=journey.profile().shop_name;render();},openCompanion:()=>openCompanion(),ask:text=>{openCompanion();askCompanion(text);}});
  render();saveStatus(futureGame?'unsupported':loaded.status);
  window.EmcAccountUI?.start();
})();
