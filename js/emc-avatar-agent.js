/* One island companion, one chat, with an optional real Xingyun avatar. */
(function (global) {
  'use strict';
  const doc=global.document;
  const agentState={presetId:'yingyi',pose:'idle',mode:'island',lastSpeechText:'',sdk:null,connecting:null,autoAttempted:false,generation:0,lastError:null,messages:[]};
  const els={};
  function make(tag,cls,text){const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  function status(text){if(els.status)els.status.textContent=text;}
  function setPose(pose){agentState.pose=pose;const sdk=agentState.sdk;if(agentState.mode!=='rtc')return;try{if(pose==='think')sdk.think?.();else if(pose==='listen')sdk.listen?.();else if(pose==='idle')sdk.idle?.();}catch(_){}}
  function setBubble(text){status(text);}
  function speech(text){return global.EmcMarkdown?.plain(text)||String(text||'');}
  function speakText(text){agentState.lastSpeechText=speech(text);agentState.pose='speak';if(agentState.mode==='rtc')try{agentState.sdk.speak(agentState.lastSpeechText,true,true);}catch(_){status('语音暂时不可用，文字对话可以继续。');}}
  function interruptSpeech(){try{agentState.sdk?.interrupt?.();}catch(_){}setPose('idle');}
  function openCopilotPanel(){return global.EmcOpenCompanionChat?.('',{send:false});}
  function closeCopilotPanel(){doc.getElementById('closeMobileChat')?.click();}
  function openFormalWorkbench(){global.EmcOpenCompanionChat?.('我想查看当前关卡的成果要求',{send:true});}
  function requestBackendChat(message){global.EmcOpenCompanionChat?.(message,{send:true});return Promise.resolve({delegated:true});}
  function loadSdk(){if(global.XmovAvatar)return Promise.resolve();return new Promise((resolve,reject)=>{const script=doc.createElement('script');script.src='js/vendor/xmovAvatar.min.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('数字人资源加载失败'));};doc.head.append(script);});}
  async function disconnect(){agentState.generation++;const sdk=agentState.sdk;agentState.sdk=null;agentState.mode='island';els.screen.hidden=true;els.connect.textContent='连接数字人';if(sdk)try{await sdk.destroy();}catch(_){}els.mount.replaceChildren();}
  function connectXingyunSession(presetId){
    if(agentState.connecting)return agentState.connecting;
    if(agentState.mode==='rtc')return Promise.resolve(agentState.sdk);
    const generation=++agentState.generation;
    agentState.connecting=(async()=>{
      agentState.lastError=null;agentState.messages=[];els.connect.disabled=true;status('正在邀请数字人小商…');
      let sdk,timer;
      try{
        const config=await global.EmcApi.get('/api/agent/config');
        if(!config.xingyun?.app_id)throw new Error('数字人暂未准备好');
        await loadSdk();if(generation!==agentState.generation)return null;
        agentState.presetId=presetId||config.xingyun.default_preset||'yingyi';els.select.value=agentState.presetId;
        els.screen.hidden=false;
        let ready,failed;
        const loaded=new Promise((resolve,reject)=>{ready=resolve;failed=reject;});
        timer=setTimeout(()=>failed(new Error('数字人连接超时')),30000);
        sdk=new global.XmovAvatar({containerId:'#emcXingyunSdkMount',appId:config.xingyun.app_id,appSecret:'',gatewayServer:'/api/agent/xingyun/session?preset='+encodeURIComponent(agentState.presetId),enableLogger:false,
          onMessage:message=>{agentState.messages.push({code:message.code,message:String(message.message||'').slice(0,200)});agentState.messages=agentState.messages.slice(-20);if([3101,3102,3103,3105,3504,3605,3606].includes(Number(message.code)))failed(new Error('数字人连接暂时不可用'));},
          onStateChange:pose=>{agentState.pose=pose;},onStatusChange:value=>{if([0,5].includes(value))ready();}
        });
        agentState.sdk=sdk;
        await Promise.all([sdk.init({onDownloadProgress:progress=>{if(generation!==agentState.generation)return;status('正在准备小商的形象… '+Math.round(progress)+'%');if(progress>=100)ready();}}),loaded]);
        if(generation!==agentState.generation){await sdk.destroy();return null;}
        agentState.mode='rtc';els.connect.textContent='断开数字人';status('数字人已连接 · 小商会为你读出回复。');
        if(agentState.lastSpeechText)speakText(agentState.lastSpeechText);
        return sdk;
      }catch(error){agentState.lastError={name:error?.name||'ConnectionError',message:error?.message||'数字人连接失败'};if(generation===agentState.generation){await disconnect();status('小商继续在岛上陪你，数字人暂时没连上，可以重试。');}return null;}
      finally{clearTimeout(timer);agentState.connecting=null;els.connect.disabled=false;}
    })();return agentState.connecting;
  }
  function autoConnect(){if(agentState.autoAttempted)return agentState.connecting;agentState.autoAttempted=true;return connectXingyunSession();}
  async function setPreset(id){if(!['yingyi','xingya','huahua'].includes(id))return;const connected=agentState.mode==='rtc';await disconnect();agentState.presetId=id;if(connected)await connectXingyunSession(id);}
  function start(){
    if(els.stage)return;
    const stage=make('section','emc-avatar-stage');stage.id='emcAvatarStage';stage.setAttribute('aria-label','小商数字人');
    const row=make('div','avatar-toolbar');row.append(make('b','','和小商一起经营'));
    const connect=make('button','','连接数字人');connect.id='emcAvatarConnect3dBtn';connect.type='button';connect.onclick=()=>agentState.mode==='rtc'?disconnect().then(()=>status('小商继续在岛上陪你。')):connectXingyunSession(els.select.value);row.append(connect);
    const stop=make('button','','暂停播报');stop.type='button';stop.id='emcAvatarInterruptBtn';stop.onclick=interruptSpeech;row.append(stop);stage.append(row);
    const screen=make('div','avatar-screen');screen.hidden=true;const mount=make('div');mount.id='emcXingyunSdkMount';screen.append(mount);stage.append(screen);
    const line=make('p','avatar-status','开始聊天后，小商会自动尝试连接数字人。');line.setAttribute('role','status');stage.append(line);
    const settings=make('details');settings.append(make('summary','','伙伴与常用操作'));
    const select=make('select');select.id='emcAvatarPresetSelect';select.setAttribute('aria-label','数字人形象');[['yingyi','盈怡 · 带教伙伴'],['xingya','星芽 · 元气学姐'],['huahua','花花 · 陪伴萌宠']].forEach(([id,name])=>{const option=make('option','',name);option.value=id;select.append(option);});select.onchange=()=>setPreset(select.value);settings.append(select);
    const actions=make('div','avatar-actions');[['这关怎么做','请帮我梳理当前关卡目标和下一步'],['帮我算账','请告诉我算利润需要哪些成本'],['查看成果要求','请打开当前关卡成果要求']].forEach(([label,prompt])=>{const b=make('button','',label);b.type='button';b.onclick=()=>requestBackendChat(prompt);actions.append(b);});settings.append(actions);stage.append(settings);
    doc.querySelector('.copilot-dock')?.insertBefore(stage,doc.getElementById('copilotStatus'));
    Object.assign(els,{stage,screen,mount,connect,status:line,select});
    global.addEventListener('emc:companion-reply',event=>{const answer=event.detail?.text;if(answer)speakText(answer);});
    global.addEventListener('emc:companion-thinking',()=>setPose('think'));
    global.addEventListener('pagehide',()=>{void disconnect();});
  }
  function buildAgentCardElement(resp) {
    if (!resp) return null;
    var toolList = Array.isArray(resp.tool_calls)
      ? resp.tool_calls
      : (Array.isArray(resp.tool_traces) ? resp.tool_traces : []);
    var hasTools = toolList.length > 0;
    var hasRoi = resp.roi_calculation && typeof resp.roi_calculation === 'object';
    var hasArtifact = resp.saved_artifact && (resp.saved_artifact.id || resp.saved_artifact.artifact_id);
    var hasCitations = Array.isArray(resp.knowledge_citations) && resp.knowledge_citations.length > 0;
    if (!hasTools && !hasRoi && !hasArtifact && !hasCitations) return null;

    var card = make('div', 'emc-agent-card');
    card.setAttribute('data-emc-agent-card', '');

    var head = make('div', 'emc-agent-card-head');
    head.appendChild(make('span', '', '小商的参考与计算'));
    var prov = make('span', '', resp.provider === 'ai_gateway' || resp.provider === 'ai_gateway_live' ? '经营建议' : '参考引导');
    head.appendChild(prov);
    card.appendChild(head);

    if (hasTools) {
      var toolsBox = make('div', 'emc-agent-tools');
      toolList.forEach(function (tc) {
        var chip = make('span', 'emc-agent-tool-chip', '⚙ ' + tc.tool + (tc.summary ? '：' + tc.summary : ''));
        chip.setAttribute('data-emc-tool-call', tc.tool);
        toolsBox.appendChild(chip);
      });
      card.appendChild(toolsBox);
    }

    if (hasCitations) {
      var kbBox = make('div', 'emc-agent-roi');
      kbBox.setAttribute('data-emc-kb-citations', '');
      var citeTitles = resp.knowledge_citations.slice(0, 2).map(function (c) {
        return '《' + c.title + '》(' + (c.platform || '通用') + '·' + (c.category || '实操') + ')';
      }).join(' / ');
      kbBox.textContent = '📚 知识库课程：' + citeTitles;
      card.appendChild(kbBox);
    }

    if (hasRoi) {
      var r = resp.roi_calculation;
      var roiBox = make('div', 'emc-agent-roi');
      roiBox.setAttribute('data-emc-roi-card', '');
      var retail = r.retail_price_yuan != null ? r.retail_price_yuan : r.selling_price;
      var supply = r.supply_price_yuan != null ? r.supply_price_yuan : r.total_cost;
      var netProfit = r.estimated_net_profit_yuan != null ? r.estimated_net_profit_yuan : r.unit_profit;
      var marginPct = r.margin_rate_pct != null ? r.margin_rate_pct : r.gross_margin_pct;
      var scoreTx = r.score_4d ? ' · 四维加权分 ' + r.score_4d.weighted_total : '';
      roiBox.textContent =
        '【选品算账】售价 ¥' + retail +
        ' / 拿货 ¥' + supply +
        ' → 预估净利 ¥' + netProfit +
        '（净利率 ' + marginPct + '%' + scoreTx + '）· ' + (r.verdict || ('保本 ROI ' + (r.breakeven_roi || '')));
      card.appendChild(roiBox);
    }

    if (hasArtifact) {
      var artId = resp.saved_artifact.id || resp.saved_artifact.artifact_id;
      var artBox = make('div', 'emc-agent-roi');
      artBox.setAttribute('data-emc-saved-draft', artId);
      artBox.setAttribute('data-emc-draft-card', artId);
      artBox.textContent = '已自动保存正式草稿：' + resp.saved_artifact.title + ' (' + artId + ')';
      card.appendChild(artBox);
    }

    return card;
  }

  async function runDeliverablePreReview(submissionId, containerEl) {
    if (!submissionId) return null;
    setPose('think');
    setBubble('正在执行六关成果 AI 预审：' + submissionId);
    try {
      var data = await global.EmcApi.post('/api/agent/reviews/' + submissionId, {});
      speakText(
        'AI 预审完成：' + (data.recommendation_label || data.recommendation || '') + '（得分 ' + data.score + ' 分）。' + (data.summary || data.feedback || ''),
        data.recommendation === 'approve_candidate' ? 'happy' : 'think'
      );
      if (containerEl) {
        var old = containerEl.querySelector('[data-emc-ai-review-result]');
        if (old) old.remove();
        var box = make('div', 'emc-ai-review-box');
        box.setAttribute('data-emc-ai-review-result', submissionId);
        var head = make('div', 'emc-ai-review-head');
        head.appendChild(make('span', '', '小商 AI 预审结论：' + (data.recommendation_label || data.recommendation)));
        head.appendChild(make('span', '', '得分 ' + data.score + ' / 100'));
        box.appendChild(head);
        box.appendChild(make('div', '', data.summary || data.feedback || ''));
        if (Array.isArray(data.rework_instructions) && data.rework_instructions.length) {
          box.appendChild(make('div', '', '整改建议：' + data.rework_instructions.join('；')));
        }
        containerEl.appendChild(box);
      }
      return data;
    } catch (e) {
      setPose('idle');
      if (typeof global.toast === 'function') {
        global.toast((e && e.message) || 'AI 预审调用失败');
      }
      return null;
    }
  }


  global.EmcAvatarAgent={start,setPreset,setPose,speakText,interrupt:interruptSpeech,connectXingyunSession,autoConnect,disconnect,askBackend:requestBackendChat,runDeliverablePreReview,buildAgentCardElement,openCopilot:openCopilotPanel,closeCopilot:closeCopilotPanel,openFormalWorkbench,_state:agentState};
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start);else start();
})(window);
