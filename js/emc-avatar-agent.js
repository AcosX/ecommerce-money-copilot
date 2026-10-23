/* One island companion, one chat, with an optional real Xingyun avatar. */
(function (global) {
  'use strict';
  const doc=global.document;
  const agentState={presetId:'yingyi',presetSelected:false,pose:'idle',mode:'island',lastSpeechText:'',muted:false,sdk:null,connecting:null,autoAttempted:false,generation:0,lastError:null,messages:[]};
  const els={};
  const ownerKey=()=>global.EmcSession?.current()?.player?.id||'guest';
  function make(tag,cls,text){const n=doc.createElement(tag);if(cls)n.className=cls;if(text!=null)n.textContent=text;return n;}
  function status(text){if(els.status)els.status.textContent=text;}
  function setPose(pose){agentState.pose=pose;const sdk=agentState.sdk;if(agentState.mode!=='rtc')return;try{if(pose==='think')sdk.think?.();else if(pose==='listen')sdk.listen?.();else if(pose==='idle')sdk.idle?.();}catch(_){}}
  function setBubble(text){status(text);}
  function speech(text){return global.EmcMarkdown?.plain(text)||String(text||'');}
  function applyVolume(){try{agentState.sdk?.setVolume?.(agentState.muted?0:1);}catch(_){}}
  function setMuted(muted){agentState.muted=Boolean(muted);applyVolume();if(els.mute){els.mute.setAttribute('aria-pressed',String(agentState.muted));els.mute.setAttribute('aria-label',agentState.muted?'取消静音':'静音');els.mute.title=agentState.muted?'取消静音':'静音';els.mute.dataset.muted=String(agentState.muted);}return agentState.muted;}
  function speakText(text){agentState.lastSpeechText=speech(text);agentState.pose='speak';if(agentState.mode==='rtc')try{applyVolume();agentState.sdk.speak(agentState.lastSpeechText,true,true);}catch(_){status('语音暂时不可用，文字对话可以继续。');}}
  function interruptSpeech(){try{agentState.sdk?.interrupt?.();}catch(_){}setPose('idle');}
  function openCopilotPanel(){return global.EmcOpenCompanionChat?.('',{send:false});}
  function closeCopilotPanel(){doc.getElementById('closeMobileChat')?.click();}
  function openFormalWorkbench(){global.EmcOpenCompanionChat?.('我想查看当前关卡的成果要求',{send:true});}
  function requestBackendChat(message){global.EmcOpenCompanionChat?.(message,{send:true});return Promise.resolve({delegated:true});}
  function loadSdk(){if(global.XingyunAvatarAgent)return Promise.resolve();return new Promise((resolve,reject)=>{const script=doc.createElement('script');script.src='js/vendor/xingyunAvatarAgent.8d03fe57.js';script.onload=resolve;script.onerror=()=>{script.remove();reject(new Error('数字人资源加载失败'));};doc.head.append(script);});}
  async function disconnect(){await stopVoice();agentState.generation++;const sdk=agentState.sdk,grant=agentState.grant;agentState.sdk=null;agentState.grant=null;agentState.nativeError=null;agentState.mode='island';els.stage.hidden=true;els.stage.classList.remove('connecting');els.screen.hidden=true;els.connect.textContent='连接数字人';if(sdk)try{await sdk.destroy('web_client_disconnect');}catch(_){}if(grant)try{await global.EmcApi.delete('/api/agent/xingyun/web-sessions/'+grant.id);}catch(_){}els.mount.replaceChildren();}
  function connectXingyunSession(presetId){
    if(agentState.connecting)return agentState.connecting;
    if(agentState.mode==='rtc')return Promise.resolve(agentState.sdk);
    const generation=++agentState.generation,connectionOwner=ownerKey();
    agentState.connecting=(async()=>{
      agentState.lastError=null;agentState.messages=[];els.connect.disabled=true;status('正在邀请数字人小商…');
      let sdk,timer;
      try{
        const config=await global.EmcApi.get('/api/agent/config');if(generation!==agentState.generation)return null;
        if(!config.xingyun?.app_id)throw new Error('数字人暂未准备好');
        await loadSdk();if(generation!==agentState.generation)return null;
        agentState.presetId=presetId||config.xingyun.default_preset||'yingyi';els.select.value=agentState.presetId;
        els.stage.hidden=false;els.stage.classList.add('connecting');els.screen.hidden=false;
        const grant=await global.EmcApi.post('/api/agent/xingyun/web-sessions',{});
        if(generation!==agentState.generation)return null;
        if(connectionOwner!==ownerKey())throw new Error('账号已切换，请重新连接数字人');
        agentState.grant={...grant,owner:connectionOwner,expiresAt:Date.now()+grant.expires_in*1000};
        sdk=new global.XingyunAvatarAgent({container:els.mount,containerId:'#emcXingyunSdkMount',appId:config.xingyun.app_id,appSecret:'',gatewayServer:'/api/agent/xingyun/e2e-session?grant_id='+encodeURIComponent(grant.id)+'&preset='+encodeURIComponent(agentState.presetId),enableLogger:false,
          onMessage:message=>{agentState.messages.push({code:message.code,message:String(message.message||'').slice(0,200)});agentState.messages=agentState.messages.slice(-20);},
          agentCallbacks:{
            onLLMResponse:event=>{if(generation===agentState.generation&&event.event==='done')agentState.nativeReplies=(agentState.nativeReplies||0)+1;},
            onError:()=>{if(generation===agentState.generation){agentState.nativeError=new Error('数字人会话暂时不可用');void stopVoice();}},
            onASRResult:event=>{if(generation===agentState.generation&&agentState.recording&&event.isFinal&&event.text?.trim()){const input=doc.getElementById('copilotInput');if(input&&!input.disabled){input.value=event.text.trim().slice(0,2000);input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}void stopVoice();status('已转为文字，确认后点击发送。');}},
            onAgentStateChange:state=>{if(generation===agentState.generation)agentState.nativeState=state;},
            onSpeakStateChange:event=>{if(generation===agentState.generation){agentState.pose=event.state==='speak_start'?'speak':'idle';if(event.state==='speak_start')agentState.nativeSpeechStarts=(agentState.nativeSpeechStarts||0)+1;}}
          }
        });
        agentState.sdk=sdk;
        await Promise.race([sdk.init(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('数字人连接超时')),30000);})]);
        if(generation!==agentState.generation){await sdk.destroy('superseded');return null;}
        if(sdk.getAgentState()!=='running')throw new Error('数字人会话尚未就绪');
        agentState.mode='rtc';els.stage.classList.remove('connecting');applyVolume();els.connect.textContent='断开数字人';status('数字人已连接，可使用静音图标控制声音。');
        return sdk;
      }catch(error){agentState.lastError={name:error?.name||'ConnectionError',message:error?.message||'数字人连接失败'};if(generation===agentState.generation){await disconnect();status('小商继续在岛上陪你，数字人暂时没连上，可以重试。');}return null;}
      finally{clearTimeout(timer);agentState.connecting=null;els.connect.disabled=false;}
    })();return agentState.connecting;
  }
  function autoConnect(){if(agentState.autoAttempted)return agentState.connecting||Promise.resolve(agentState.sdk);agentState.autoAttempted=true;return connectXingyunSession(agentState.presetSelected?agentState.presetId:undefined);}
  async function nativeReply(body,{signal}={}){
    if(signal?.aborted)throw new Error('对话已取消');
    if(agentState.grant&&(agentState.grant.owner!==ownerKey()||agentState.grant.expiresAt<Date.now()+30000)){
      await disconnect();agentState.autoAttempted=false;
    }
    const sdk=await autoConnect();
    if(!sdk)return null; // failed before dispatch: the ordinary text transport can continue
    if(signal?.aborted)throw new Error('对话已取消');
    const generation=agentState.generation,owner=ownerKey(),grant=agentState.grant;
    if(!grant||grant.owner!==owner)throw new Error('账号已切换，请重新发送');
    const turn=await global.EmcApi.post('/api/agent/xingyun/web-sessions/'+grant.id+'/turns',{...body,preset_id:agentState.presetId},{signal});
    agentState.nativeError=null;
    const abort=()=>{try{sdk.interrupt('user');}catch(_){}};
    signal?.addEventListener('abort',abort,{once:true});
    try{
      await sdk.ask(body.message+"\n["+turn.ticket+"]");
      const deadline=Date.now()+35000;
      while(Date.now()<deadline){
        if(signal?.aborted||generation!==agentState.generation||owner!==ownerKey())throw new Error('对话已取消');
        const data=await global.EmcApi.get('/api/agent/xingyun/web-sessions/'+grant.id+'/turns/'+turn.id,{signal});
        if(data.state==='done')return {...data.result,avatar_spoken:true};
        if(data.state==='failed'||agentState.nativeError)throw new Error('这条消息未能完成，请重试');
        await new Promise(resolve=>setTimeout(resolve,600));
      }
      // Never repeat a dispatched request through another model/transport.
      throw new Error('小商仍在处理这条消息，请稍后重试');
    }catch(error){await disconnect();agentState.autoAttempted=false;throw error;}finally{signal?.removeEventListener('abort',abort);}
  }
  async function stopVoice(){
    clearTimeout(agentState.voiceTimer);
    if(!agentState.recording)return;
    agentState.recording=false;
    els.voice?.setAttribute('aria-pressed','false');els.voice?.setAttribute('aria-label','语音输入');
    try{await agentState.sdk?.stopASR();}catch(_){}
  }
  async function toggleVoice(){
    if(agentState.recording){await stopVoice();return;}
    const input=doc.getElementById('copilotInput');if(!input||input.disabled)return;
    els.voice.disabled=true;
    try{
      const sdk=await autoConnect();if(!sdk)throw new Error('语音暂时不可用，可以继续打字。');
      await sdk.interrupt('user');
      agentState.recording=true;
      await sdk.startASR();
      els.voice.setAttribute('aria-pressed','true');els.voice.setAttribute('aria-label','结束语音输入');
      status('正在听，识别完成后请确认文字再发送。');
      agentState.voiceTimer=setTimeout(()=>{void stopVoice();},30000);
    }catch(_){await stopVoice();status('未能开启语音，请检查浏览器麦克风权限，也可以继续打字。');}
    finally{els.voice.disabled=false;}
  }
  async function setPreset(id){if(!['yingyi','xingya','huahua'].includes(id))return;agentState.presetSelected=true;const connected=agentState.mode==='rtc'||Boolean(agentState.connecting),pending=agentState.connecting;await disconnect();if(pending)await pending;agentState.presetId=id;if(connected)await connectXingyunSession(id);}
  function start(){
    if(els.stage)return;
    const dock=doc.querySelector('.copilot-dock');if(!dock)return;
    const footer=make('div','copilot-companion-tools');footer.setAttribute('aria-label','伙伴与常用操作');
    const settings=make('details','avatar-settings');settings.append(make('summary','','语音与形象'));
    const select=make('select');select.id='emcAvatarPresetSelect';select.setAttribute('aria-label','数字人形象');[['yingyi','盈怡 · 带教伙伴'],['xingya','星芽 · 元气学姐'],['huahua','花花 · 陪伴萌宠']].forEach(([id,name])=>{const option=make('option','',name);option.value=id;select.append(option);});select.onchange=()=>setPreset(select.value);settings.append(select);
    const connect=make('button','avatar-connect','连接数字人');connect.id='emcAvatarConnect3dBtn';connect.type='button';connect.onclick=()=>agentState.mode==='rtc'?disconnect().then(()=>status('小商继续在岛上陪你。')):connectXingyunSession(els.select.value);settings.append(connect);
    const line=make('p','avatar-status','开始聊天后，小商会自动尝试连接数字人。');line.setAttribute('role','status');settings.append(line);footer.append(settings);
    const stage=make('section','emc-avatar-stage');stage.id='emcAvatarStage';stage.hidden=true;stage.setAttribute('aria-label','小商数字人');
    const screen=make('div','avatar-screen');screen.hidden=true;const mount=make('div');mount.id='emcXingyunSdkMount';screen.append(mount);stage.append(screen);
    const mute=make('button','avatar-mute');mute.type='button';mute.id='emcAvatarMuteBtn';mute.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4Z"/><path class="volume-on" d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/><path class="volume-off" d="m16 9 6 6m0-6-6 6"/></svg>';mute.onclick=()=>setMuted(!agentState.muted);stage.append(mute);footer.append(stage);
    const voice=make('button','copilot-voice');voice.type='button';voice.id='emcVoiceInput';voice.setAttribute('aria-label','语音输入');voice.setAttribute('aria-pressed','false');voice.title='语音输入';voice.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';voice.onclick=()=>{void toggleVoice();};doc.getElementById('copilotForm')?.insertBefore(voice,doc.getElementById('copilotSend'));
    dock.insertBefore(footer,doc.getElementById('copilotStatus'));
    Object.assign(els,{stage,screen,mount,connect,status:line,select,mute,voice});setMuted(agentState.muted);
    doc.addEventListener('visibilitychange',()=>{if(!doc.hidden)setTimeout(applyVolume,0);});
    global.addEventListener('emc:companion-reply',event=>{const answer=event.detail?.text;if(answer&&!event.detail?.avatar_spoken)speakText(answer);});
    global.addEventListener('emc:companion-thinking',()=>{void stopVoice();interruptSpeech();setPose('think');});
    global.EmcSession?.onChange?.(()=>{if(agentState.grant&&agentState.grant.owner!==ownerKey()){agentState.autoAttempted=false;void disconnect();}});
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
    if (!hasRoi && !hasArtifact && !hasCitations) return null;

    var card = make('details', 'emc-agent-card');
    card.setAttribute('data-emc-agent-card', '');

    var head = make('summary', 'emc-agent-card-head');
    head.appendChild(make('span', '', '参考与计算'));
    var prov = make('span', 'emc-agent-card-source', resp.provider === 'verified_calculation' ? '工具验算' : resp.provider === 'ai_gateway' || resp.provider === 'ai_gateway_live' ? 'AI 回复' : '本地辅助');
    head.appendChild(prov);
    card.appendChild(head);

    if (hasTools && hasArtifact) {
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
      var profit = r.unit_profit != null ? r.unit_profit : r.estimated_net_profit_yuan;
      var marginPct = r.margin_rate_pct != null ? r.margin_rate_pct : r.gross_margin_pct;
      roiBox.textContent =
        '【选品算账】售价 ¥' + retail +
        ' / 已知成本 ¥' + (r.total_cost != null ? r.total_cost : supply) +
        ' → 单笔差额 ¥' + profit +
        '（毛利率 ' + marginPct + '%）· ' + (r.verdict || ('保本 ROI ' + (r.breakeven_roi ?? '无法保本')));
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
        'AI 预审完成：' + (data.recommendation_label || data.status || data.recommendation || '') + '。' + (data.summary || data.feedback || ''),
        data.recommendation === 'approve_candidate' ? 'happy' : 'think'
      );
      if (containerEl) {
        var old = containerEl.querySelector('[data-emc-ai-review-result]');
        if (old) old.remove();
        var box = make('div', 'emc-ai-review-box');
        box.setAttribute('data-emc-ai-review-result', submissionId);
        var head = make('div', 'emc-ai-review-head');
        head.appendChild(make('span', '', '小商 AI 预审结论：' + (data.recommendation_label || data.status || data.recommendation)));

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


  global.EmcAvatarAgent={start,nativeReply,stopVoice,setPreset,setPose,setMuted,speakText,interrupt:interruptSpeech,connectXingyunSession,autoConnect,disconnect,askBackend:requestBackendChat,runDeliverablePreReview,buildAgentCardElement,openCopilot:openCopilotPanel,closeCopilot:closeCopilotPanel,openFormalWorkbench,_state:agentState};
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start);else start();
})(window);
