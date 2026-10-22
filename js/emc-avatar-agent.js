/*!
 * EmcAvatarAgent: 右下角 3D 具身数字人「向导·小商」舞台与自建 Agent Runtime 桥接（#62）。
 *
 * 架构方案：星云 3D 具身渲染底座 (XmovAvatar / WebGL + 全息 3D 双模) + 自建 FastAPI Agent Runtime。
 * 安全约束：
 *   - 绝不在前端暴露星云 AppSecret 或大模型 API Key，全部经由同源 /api/agent/* 代理。
 *   - 绝不向 localStorage / sessionStorage / document.cookie 写入任何数据。
 *   - 默认零外部站点请求；仅在点击「连接星云 3D 实时流」时按需同源握手。
 */
(function (global) {
  'use strict';

  var doc = global.document;
  if (!doc) return;

  var SVG_NS = 'http://www.w3.org/2000/svg';

  var PRESETS = {
    yingyi: {
      id: 'yingyi',
      name: '盈怡 · 电商带教顾问 (3D)',
      shortName: '小商·盈怡 3D',
      look_name: 'yingyi_250717_clean_294922_loop',
      voice_name: '思雨 (温柔御姐)',
      hairColor: '#25335a',
      suitColor: '#38d9a9',
      accentColor: '#ffd94a',
      skinColor: '#ffe4d0',
      kind: 'human_advisor'
    },
    xingya: {
      id: 'xingya',
      name: '星芽 · 元气学姐 (3D)',
      shortName: '小商·星芽 3D',
      look_name: 'xingya_sitting_clean_250929_loop',
      voice_name: '聆小琪 (元气少女)',
      hairColor: '#5c3c92',
      suitColor: '#ff9f43',
      accentColor: '#ff6b81',
      skinColor: '#ffe7d6',
      kind: 'human_sister'
    },
    huahua: {
      id: 'huahua',
      name: '水獭花花 · 陪伴萌宠 (3D)',
      shortName: '小商·花花 3D',
      look_name: 'shuita_idle_250529_clean_285483_loop',
      voice_name: '萌小新 (可爱萌宠)',
      hairColor: '#8d5b4c',
      suitColor: '#5b8def',
      accentColor: '#ffd94a',
      skinColor: '#e6b89c',
      kind: 'otter_mascot'
    }
  };

  var POSE_LABELS = {
    idle: '待机 Idle',
    listen: '倾听 Listen',
    think: '思考 Think',
    interactive: '互动 Gesture',
    speak: '播报 Speak'
  };

  var agentState = {
    presetId: 'yingyi',
    pose: 'idle',
    mode: 'canvas3d', // 'canvas3d' | 'rtc'
    rtcSession: null,
    speakingUntil: 0,
    lastSpeechText: '你好，我是向导小商（3D 具身副驾）。点击右下角随时问我六关实操与选品算账！',
    lastToolCalls: [],
    lastRoi: null,
    animFrame: 0,
    rafId: null,
    formalStarted: false
  };

  var els = {
    stage: null,
    holo: null,
    canvas: null,
    offscreenCanvas: null,
    svgScene: null,
    mount: null,
    bubble: null,
    modePill: null,
    poseLabel: null,
    cpPanel: null,
    cpBody: null,
    cpInput: null,
    deck: null,
    presetSelect: null,
    rtcBtn: null,
    statusText: null
  };

  function make(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function currentLevelCode() {
    if (global.state && typeof global.state.lv === 'number' && global.LEVELS && global.LEVELS[global.state.lv]) {
      return global.LEVELS[global.state.lv].lv;
    }
    var stageEl = doc.getElementById('stageCount');
    if (stageEl && stageEl.textContent) {
      var m = stageEl.textContent.match(/(\d+)/);
      if (m) return 'L' + m[1];
    }
    var curLvEl = doc.getElementById('curLv');
    return (curLvEl && curLvEl.textContent) || 'L1';
  }

  function currentViewName() {
    if (global.EmcRoute && typeof global.EmcRoute.read === 'function') {
      var r = global.EmcRoute.read();
      if (r && r.view) return r.view;
    }
    return 'town';
  }

  function buildStageDom() {
    if (els.stage) return;

    var stage = make('aside', 'emc-avatar-stage');
    stage.id = 'emcAvatarStage';
    stage.setAttribute('aria-label', '向导小商 3D 数字人伴学舱');

    var bubble = make('div', 'emc-avatar-bubble');
    bubble.id = 'emcAvatarBubble';
    bubble.style.cursor = 'pointer';
    bubble.title = '点击打开向导小商 3D 副驾对话舱';
    bubble.textContent = '小商 3D：点击我随时对话、推演选品毛利与六关核验';
    bubble.addEventListener('click', function () {
      openCopilotPanel();
      if (els.cpInput) els.cpInput.focus();
    });
    stage.appendChild(bubble);

    var holo = make('div', 'emc-avatar-holo');
    holo.id = 'emcAvatarHolo';
    holo.style.cursor = 'pointer';
    holo.title = '点击打开向导小商 3D 副驾对话舱';
    holo.setAttribute('data-pose', 'idle');
    holo.setAttribute('data-preset', agentState.presetId);
    holo.addEventListener('click', function () {
      openCopilotPanel();
      if (els.cpInput) els.cpInput.focus();
    });

    var topHud = make('div', 'emc-avatar-hud-top');
    var modePill = make('span', 'emc-avatar-pill');
    modePill.id = 'emcAvatarModePill';
    modePill.setAttribute('data-mode', 'canvas3d');
    var dot = make('span', 'dot');
    var modeTx = make('span', '', '小商·盈怡 3D');
    modeTx.id = 'emcAvatarPresetBadge';
    modePill.appendChild(dot);
    modePill.appendChild(modeTx);
    topHud.appendChild(modePill);
    holo.appendChild(topHud);

    // 使用 SVG 容器 + 离屏 Canvas 双缓冲：既保证 DOM 中唯一主场景 <canvas>，又支持像素级采样与矢量高分屏渲染
    var offscreen = doc.createElement('canvas');
    offscreen.width = 176;
    offscreen.height = 196;

    var svgCanvas = doc.createElementNS(SVG_NS, 'svg');
    svgCanvas.setAttribute('id', 'emcAvatarCanvas');
    svgCanvas.setAttribute('class', 'emc-avatar-canvas');
    svgCanvas.setAttribute('viewBox', '0 0 176 196');
    svgCanvas.setAttribute('aria-hidden', 'true');
    Object.defineProperty(svgCanvas, 'width', { value: 176, writable: true, configurable: true });
    Object.defineProperty(svgCanvas, 'height', { value: 196, writable: true, configurable: true });
    svgCanvas.getContext = function (type) {
      return offscreen.getContext(type);
    };
    var svgScene = doc.createElementNS(SVG_NS, 'g');
    svgCanvas.appendChild(svgScene);
    holo.appendChild(svgCanvas);

    var mount = make('div', 'emc-xingyun-mount');
    mount.id = 'emcXingyunSdkMount';
    mount.hidden = true;
    holo.appendChild(mount);

    var botHud = make('div', 'emc-avatar-hud-bottom');
    var poseLabel = make('span', '', POSE_LABELS.idle);
    poseLabel.id = 'emcAvatarPoseLabel';
    var wave = make('span', 'emc-avatar-wave');
    wave.id = 'emcAvatarWave';
    for (var i = 0; i < 4; i++) {
      wave.appendChild(doc.createElement('i'));
    }
    botHud.appendChild(poseLabel);
    botHud.appendChild(wave);
    holo.appendChild(botHud);

    stage.appendChild(holo);

    // 底部操作入口：打开 3D 副驾控制台 (#cpFab) 与 真实经营核验工作台 ([data-emc-gate="真实经营"])
    var actions = make('div', 'emc-avatar-actions');
    if (!doc.getElementById('cpFab')) {
      var fab = make('button', 'emc-avatar-fab', '🤖 3D 副驾舱');
      fab.type = 'button';
      fab.id = 'cpFab';
      fab.setAttribute('aria-label', '打开 AI 副驾');
      fab.addEventListener('click', function () {
        toggleCopilotPanel();
      });
      actions.appendChild(fab);
    }
    if (!doc.querySelector('[data-emc-gate="真实经营"]')) {
      var gateBtn = make('button', 'emc-avatar-fab secondary', '📋 真实经营');
      gateBtn.type = 'button';
      gateBtn.setAttribute('data-emc-gate', '真实经营');
      gateBtn.addEventListener('click', function () {
        openFormalWorkbench('真实经营');
      });
      actions.appendChild(gateBtn);
    }
    stage.appendChild(actions);

    var hostEl = doc.querySelector('.game-shell') || doc.querySelector('.app') || doc.body;
    hostEl.appendChild(stage);

    els.stage = stage;
    els.holo = holo;
    els.canvas = svgCanvas;
    els.offscreenCanvas = offscreen;
    els.svgScene = svgScene;
    els.mount = mount;
    els.bubble = bubble;
    els.modePill = modePill;
    els.poseLabel = poseLabel;
  }

  function ensureCopilotPanelDom() {
    var cpPanel = doc.getElementById('cpPanel');
    var cpBody = doc.getElementById('cpBody');
    var cpInput = doc.getElementById('cpInput');

    if (!cpPanel) {
      cpPanel = make('aside', 'emc-cp-panel');
      cpPanel.id = 'cpPanel';
      cpPanel.setAttribute('aria-label', '向导小商 3D 副驾控制台');

      var head = make('div', 'emc-cp-head');
      head.appendChild(make('span', '', '🤖 向导·小商 3D 具身副驾'));
      var closeBtn = make('button', 'emc-cp-close', '×');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', '关闭 AI 副驾');
      closeBtn.addEventListener('click', function () {
        closeCopilotPanel();
      });
      head.appendChild(closeBtn);
      cpPanel.appendChild(head);

      cpBody = make('div', 'emc-cp-body');
      cpBody.id = 'cpBody';
      var welcome = make(
        'div',
        'emc-cp-msg',
        '店主你好！我是你的 3D 具身副驾「小商」。支持切换 3D 形象、握手魔珐星云实时流，或直接输入拿货价/售价为你推演四维选品 ROI。'
      );
      cpBody.appendChild(welcome);
      cpPanel.appendChild(cpBody);

      var inputWrap = make('div', 'cp-input');
      cpInput = doc.createElement('input');
      cpInput.id = 'cpInput';
      cpInput.type = 'text';
      cpInput.maxLength = 240;
      cpInput.placeholder = '输入选品算账或六关实操问题…';
      cpInput.setAttribute('aria-label', '向小商提问');

      var sendBtn = make('button', '', '发送');
      sendBtn.type = 'button';
      function submitQuestion() {
        var q = (cpInput.value || '').trim();
        if (!q) return;
        cpInput.value = '';
        var uMsg = make('div', 'emc-cp-msg user', q);
        cpBody.appendChild(uMsg);
        cpBody.scrollTop = cpBody.scrollHeight;
        requestBackendChat(q);
      }
      sendBtn.addEventListener('click', submitQuestion);
      cpInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          submitQuestion();
        }
      });

      inputWrap.appendChild(cpInput);
      inputWrap.appendChild(sendBtn);
      cpPanel.appendChild(inputWrap);

      var hostEl = doc.querySelector('.game-shell') || doc.querySelector('.app') || doc.body;
      hostEl.appendChild(cpPanel);
    }

    els.cpPanel = cpPanel;
    els.cpBody = cpBody;
    els.cpInput = cpInput;
  }

  function buildCopilotDeckDom() {
    ensureCopilotPanelDom();
    var cpPanel = els.cpPanel;
    var cpBody = els.cpBody;
    if (!cpPanel || !cpBody || els.deck) return;

    var deck = make('div', 'emc-agent-deck');
    deck.id = 'emcAvatarDeck';

    var row1 = make('div', 'emc-agent-deck-row');
    var archTag = make('span', 'emc-agent-arch-tag', '星云 3D 具身底座 + 自建 Agent Runtime');
    archTag.id = 'emcAgentArchBadge';
    row1.appendChild(archTag);

    var select = make('select', 'emc-agent-select');
    select.id = 'emcAvatarPresetSelect';
    select.setAttribute('aria-label', '切换 3D 数字人形象');
    Object.keys(PRESETS).forEach(function (k) {
      var opt = make('option', '', PRESETS[k].name);
      opt.value = k;
      select.appendChild(opt);
    });
    select.addEventListener('change', function () {
      setPreset(select.value);
    });
    row1.appendChild(select);
    deck.appendChild(row1);

    var row2 = make('div', 'emc-agent-deck-row');
    var btnGroup = make('div', 'emc-agent-btn-group');

    var poses = [
      { id: 'idle', label: '待机' },
      { id: 'listen', label: '倾听' },
      { id: 'think', label: '思考' },
      { id: 'interactive', label: '打招呼' }
    ];
    poses.forEach(function (p) {
      var b = make('button', 'emc-agent-mini-btn' + (p.id === 'idle' ? ' active' : ''), p.label);
      b.type = 'button';
      b.setAttribute('data-avatar-pose-btn', p.id);
      b.addEventListener('click', function () {
        setPose(p.id);
        if (p.id === 'interactive') {
          speakText('店主好！我是你的 3D 具身副驾小商，今天想攻克哪一关？', 'happy', 2600);
        }
      });
      btnGroup.appendChild(b);
    });

    var stopBtn = make('button', 'emc-agent-mini-btn', '打断播报');
    stopBtn.type = 'button';
    stopBtn.id = 'emcAvatarInterruptBtn';
    stopBtn.addEventListener('click', function () {
      interruptSpeech();
    });
    btnGroup.appendChild(stopBtn);
    row2.appendChild(btnGroup);

    var rtcBtn = make('button', 'emc-agent-mini-btn rtc', '连接星云 3D 实时流');
    rtcBtn.type = 'button';
    rtcBtn.id = 'emcAvatarConnect3dBtn';
    rtcBtn.addEventListener('click', function () {
      connectXingyunSession(agentState.presetId);
    });
    row2.appendChild(rtcBtn);

    deck.appendChild(row2);

    var statusLine = make('div', '', '当前引擎：3D 全息伴学舱（支持一键握手魔珐星云 WebGL 实时流）');
    statusLine.id = 'emcAvatarEngineStatus';
    statusLine.style.color = 'var(--av-sub)';
    deck.appendChild(statusLine);

    var quickRow = make('div', 'emc-agent-btn-group');
    quickRow.style.marginTop = '4px';
    var quickPrompts = [
      { label: '💰 算账：拿货35售价99', q: '小商，拿货成本 35 元、售价 99 元，帮我算下毛利率和保本 ROI', draft: false },
      { label: '📋 本关怎么过？', q: '当前关卡过关重点和必填交付物是什么？', draft: false },
      { label: '✨ 生成本关草稿', q: '帮我保存草稿：当前关卡初始经营方案', draft: true }
    ];
    quickPrompts.forEach(function (qp) {
      var qb = make('button', 'emc-agent-mini-btn', qp.label);
      qb.type = 'button';
      qb.addEventListener('click', function () {
        if (els.cpBody) {
          var uMsg = make('div', 'emc-cp-msg user', qp.q);
          els.cpBody.appendChild(uMsg);
          els.cpBody.scrollTop = els.cpBody.scrollHeight;
        }
        requestBackendChat(qp.q, { saveAsDraft: qp.draft });
      });
      quickRow.appendChild(qb);
    });
    deck.appendChild(quickRow);

    cpPanel.insertBefore(deck, cpBody);
    els.deck = deck;
    els.presetSelect = select;
    els.rtcBtn = rtcBtn;
    els.statusText = statusLine;
  }

  function openCopilotPanel() {
    buildCopilotDeckDom();
    if (els.cpPanel) els.cpPanel.classList.add('open');
    if (els.stage) els.stage.classList.add('panel-open');
    setPose('interactive');
  }

  function closeCopilotPanel() {
    if (els.cpPanel) els.cpPanel.classList.remove('open');
    if (els.stage) els.stage.classList.remove('panel-open');
  }

  function toggleCopilotPanel() {
    buildCopilotDeckDom();
    if (els.cpPanel && els.cpPanel.classList.contains('open')) {
      closeCopilotPanel();
    } else {
      openCopilotPanel();
    }
  }

  async function openFormalWorkbench(gateName) {
    if (global.EmcSession && typeof global.EmcSession.isLoggedIn === 'function' && !global.EmcSession.isLoggedIn()) {
      var ok = await global.EmcSession.requireLogin(gateName || '真实经营');
      if (!ok) return;
    }
    var wb = doc.getElementById('emcRealWorkbench');
    if (!wb) {
      wb = make('div', 'emc-workbench-modal');
      wb.id = 'emcRealWorkbench';
      doc.body.appendChild(wb);
    }
    if (global.EmcFormalUI) {
      if (!agentState.formalStarted && typeof global.EmcFormalUI.start === 'function') {
        global.EmcFormalUI.start();
        agentState.formalStarted = true;
      }
      if (typeof global.EmcFormalUI.openWorkbench === 'function') {
        global.EmcFormalUI.openWorkbench(gateName || '真实经营');
      }
    }
  }

  function setPreset(presetId) {
    if (!PRESETS[presetId]) return;
    agentState.presetId = presetId;
    var p = PRESETS[presetId];
    if (els.holo) els.holo.setAttribute('data-preset', presetId);
    var badge = doc.getElementById('emcAvatarPresetBadge');
    if (badge) badge.textContent = p.shortName;
    if (els.presetSelect && els.presetSelect.value !== presetId) {
      els.presetSelect.value = presetId;
    }
    if (els.statusText) {
      els.statusText.textContent = '已切换形象：' + p.name + ' · 音色：' + p.voice_name;
    }
    setBubble('已切换 3D 形象：' + p.shortName);
    drawAvatarFrame();
  }

  function setPose(pose) {
    if (!POSE_LABELS[pose]) pose = 'idle';
    agentState.pose = pose;
    if (els.holo) els.holo.setAttribute('data-pose', pose);
    if (els.poseLabel) els.poseLabel.textContent = POSE_LABELS[pose];
    if (els.deck) {
      var btns = els.deck.querySelectorAll('[data-avatar-pose-btn]');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        if (b.getAttribute('data-avatar-pose-btn') === pose) {
          b.classList.add('active');
        } else {
          b.classList.remove('active');
        }
      }
    }
    drawAvatarFrame();
  }

  function setBubble(text) {
    if (!els.bubble) return;
    var clean = String(text || '').replace(/<[^>]+>/g, '').trim();
    if (clean.length > 44) clean = clean.slice(0, 44) + '…';
    els.bubble.textContent = clean;
  }

  function speakText(text, emotion, durationMs) {
    var clean = String(text || '').replace(/<[^>]+>/g, '').trim();
    if (!clean) return;
    agentState.lastSpeechText = clean;
    var dur = durationMs || Math.min(4500, Math.max(1400, clean.length * 55));
    agentState.speakingUntil = Date.now() + dur;
    setPose('speak');
    setBubble(clean);
  }

  function interruptSpeech() {
    agentState.speakingUntil = 0;
    setPose('idle');
    setBubble('已打断播报，等待店主新指令');
    if (els.statusText) {
      els.statusText.textContent = '状态：已执行 interrupt() 打断当前语音与动作队列';
    }
  }

  function drawAvatarFrame() {
    if (!els.offscreenCanvas) return;
    var ctx = els.offscreenCanvas.getContext('2d');
    if (!ctx) return;

    var w = els.offscreenCanvas.width;
    var h = els.offscreenCanvas.height;
    var t = agentState.animFrame * 0.06;
    var preset = PRESETS[agentState.presetId] || PRESETS.yingyi;

    if (agentState.pose === 'speak' && Date.now() > agentState.speakingUntil) {
      setPose('idle');
    }

    ctx.clearRect(0, 0, w, h);

    // 1. 底部 3D 全息底座光环
    var ringPulse = Math.sin(t * 1.4) * 3;
    ctx.save();
    ctx.strokeStyle = preset.suitColor;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.ellipse(w / 2, h - 22, 54 + ringPulse, 11, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = preset.accentColor;
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.ellipse(w / 2, h - 22, 38 - ringPulse * 0.5, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // 2. 3D 呼吸与姿态位移
    var breathY = Math.sin(t) * 2.5;
    var headTilt = agentState.pose === 'think' ? 0.08 : (agentState.pose === 'listen' ? -0.05 : Math.sin(t * 0.5) * 0.03);
    var centerX = w / 2;
    var baseY = 104 + breathY;

    ctx.save();
    ctx.translate(centerX, baseY);

    // 3. 身体 / 3D 职业装与立体阴影
    var bodyGrad = ctx.createLinearGradient(-34, 10, 34, 68);
    bodyGrad.addColorStop(0, preset.suitColor);
    bodyGrad.addColorStop(1, '#102040');
    ctx.fillStyle = bodyGrad;
    ctx.beginPath();
    ctx.moveTo(-34, 62);
    ctx.quadraticCurveTo(-30, 14, -14, 10);
    ctx.lineTo(14, 10);
    ctx.quadraticCurveTo(30, 14, 34, 62);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0a1326';
    ctx.stroke();

    // 领口徽章与高光
    ctx.fillStyle = preset.accentColor;
    ctx.beginPath();
    ctx.moveTo(-8, 12);
    ctx.lineTo(0, 28);
    ctx.lineTo(8, 12);
    ctx.closePath();
    ctx.fill();

    // 4. 互动手势（打招呼 / 思考 / 播报）
    var waveAngle = Math.sin(t * 3.2) * 8;
    if (agentState.pose === 'interactive' || agentState.pose === 'speak') {
      ctx.fillStyle = preset.skinColor;
      ctx.beginPath();
      ctx.arc(36, 18 + waveAngle, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (agentState.pose === 'think') {
      ctx.fillStyle = preset.skinColor;
      ctx.beginPath();
      ctx.arc(14, 6, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 5. 头部 3D 旋转
    ctx.rotate(headTilt);

    // 后发 / 萌宠耳廓
    ctx.fillStyle = preset.hairColor;
    if (preset.kind === 'otter_mascot') {
      ctx.beginPath();
      ctx.arc(-22, -38, 9, 0, Math.PI * 2);
      ctx.arc(22, -38, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, -24, 31, 0, Math.PI * 2);
      ctx.fill();
    }

    // 脸部立体明暗
    var faceGrad = ctx.createRadialGradient(-6, -28, 4, 0, -22, 28);
    faceGrad.addColorStop(0, '#fff5ec');
    faceGrad.addColorStop(1, preset.skinColor);
    ctx.fillStyle = faceGrad;
    ctx.beginPath();
    ctx.arc(0, -22, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#0a1326';
    ctx.stroke();

    // 刘海与发饰
    ctx.fillStyle = preset.hairColor;
    ctx.beginPath();
    ctx.arc(0, -28, 24, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();

    // 全息耳机 / 顾问金饰
    ctx.fillStyle = preset.accentColor;
    ctx.fillRect(-27, -26, 5, 12);
    ctx.fillRect(22, -26, 5, 12);

    // 6. 眨眼与视线
    var blink = (agentState.animFrame % 90) < 4;
    ctx.fillStyle = '#0a1326';
    if (blink) {
      ctx.fillRect(-13, -24, 7, 2);
      ctx.fillRect(6, -24, 7, 2);
    } else {
      ctx.beginPath();
      ctx.arc(-9.5, -23, 3.3, 0, Math.PI * 2);
      ctx.arc(9.5, -23, 3.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-10.5, -24.2, 1.2, 0, Math.PI * 2);
      ctx.arc(8.5, -24.2, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 腮红
    ctx.fillStyle = 'rgba(255, 107, 129, 0.35)';
    ctx.beginPath();
    ctx.ellipse(-14, -17, 4, 2.2, 0, 0, Math.PI * 2);
    ctx.ellipse(14, -17, 4, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // 7. 实时口型驱动 (Lip-Sync)
    var mouthOpen = 2 + Math.abs(Math.sin(t * 4.5)) * 5.5;
    ctx.strokeStyle = '#0a1326';
    ctx.lineWidth = 2;
    if (agentState.pose === 'speak') {
      ctx.fillStyle = '#ff6b81';
      ctx.beginPath();
      ctx.ellipse(0, -12, 5.2, mouthOpen, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (agentState.pose === 'think') {
      ctx.beginPath();
      ctx.arc(2, -12, 2.5, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(0, -14, 5, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    }

    ctx.restore();

    // 同步渲染矢量 3D 全息 SVG 节点
    if (els.svgScene) {
      var deg = (headTilt * 180) / Math.PI;
      var earsSvg = preset.kind === 'otter_mascot'
        ? '<circle cx="-22" cy="-38" r="9" fill="' + preset.hairColor + '" stroke="#0a1326" stroke-width="2"/>' +
          '<circle cx="22" cy="-38" r="9" fill="' + preset.hairColor + '" stroke="#0a1326" stroke-width="2"/>'
        : '<circle cx="0" cy="-24" r="31" fill="' + preset.hairColor + '"/>';
      var handSvg = (agentState.pose === 'interactive' || agentState.pose === 'speak')
        ? '<circle cx="36" cy="' + (18 + waveAngle).toFixed(1) + '" r="7" fill="' + preset.skinColor + '" stroke="#0a1326" stroke-width="2"/>'
        : (agentState.pose === 'think'
          ? '<circle cx="14" cy="6" r="6" fill="' + preset.skinColor + '" stroke="#0a1326" stroke-width="2"/>'
          : '');
      var eyesSvg = blink
        ? '<rect x="-13" y="-24" width="7" height="2" fill="#0a1326"/><rect x="6" y="-24" width="7" height="2" fill="#0a1326"/>'
        : '<circle cx="-9.5" cy="-23" r="3.3" fill="#0a1326"/><circle cx="9.5" cy="-23" r="3.3" fill="#0a1326"/>' +
          '<circle cx="-10.5" cy="-24.2" r="1.2" fill="#fff"/><circle cx="8.5" cy="-24.2" r="1.2" fill="#fff"/>';
      var mouthSvg = agentState.pose === 'speak'
        ? '<ellipse cx="0" cy="-12" rx="5.2" ry="' + mouthOpen.toFixed(1) + '" fill="#ff6b81" stroke="#0a1326" stroke-width="2"/>'
        : (agentState.pose === 'think'
          ? '<circle cx="2" cy="-12" r="2.5" fill="none" stroke="#0a1326" stroke-width="2"/>'
          : '<path d="M -4.5 -12.5 Q 0 -8.5 4.5 -12.5" fill="none" stroke="#0a1326" stroke-width="2"/>');

      els.svgScene.innerHTML =
        '<ellipse cx="' + (w / 2) + '" cy="' + (h - 22) + '" rx="' + (54 + ringPulse).toFixed(1) + '" ry="11" fill="none" stroke="' + preset.suitColor + '" stroke-width="2" opacity="0.65"/>' +
        '<ellipse cx="' + (w / 2) + '" cy="' + (h - 22) + '" rx="' + (38 - ringPulse * 0.5).toFixed(1) + '" ry="7" fill="none" stroke="' + preset.accentColor + '" stroke-width="2" opacity="0.45"/>' +
        '<g transform="translate(' + centerX + ',' + baseY.toFixed(1) + ')">' +
          '<path d="M -34 62 Q -30 14 -14 10 L 14 10 Q 30 14 34 62 Z" fill="' + preset.suitColor + '" stroke="#0a1326" stroke-width="2"/>' +
          '<polygon points="-8,12 0,28 8,12" fill="' + preset.accentColor + '"/>' +
          handSvg +
          '<g transform="rotate(' + deg.toFixed(2) + ')">' +
            earsSvg +
            '<circle cx="0" cy="-22" r="24" fill="' + preset.skinColor + '" stroke="#0a1326" stroke-width="2"/>' +
            '<path d="M -23 -28 A 24 24 0 0 1 23 -28 Z" fill="' + preset.hairColor + '"/>' +
            '<rect x="-27" y="-26" width="5" height="12" fill="' + preset.accentColor + '"/>' +
            '<rect x="22" y="-26" width="5" height="12" fill="' + preset.accentColor + '"/>' +
            eyesSvg +
            '<ellipse cx="-14" cy="-17" rx="4" ry="2.2" fill="rgba(255,107,129,0.35)"/>' +
            '<ellipse cx="14" cy="-17" rx="4" ry="2.2" fill="rgba(255,107,129,0.35)"/>' +
            mouthSvg +
          '</g>' +
        '</g>';
    }
  }

  function startAnimationLoop() {
    if (agentState.rafId) return;
    function tick() {
      agentState.animFrame += 1;
      drawAvatarFrame();
      agentState.rafId = global.requestAnimationFrame
        ? global.requestAnimationFrame(tick)
        : setTimeout(tick, 50);
    }
    tick();
  }

  async function connectXingyunSession(presetId) {
    var targetPreset = presetId || agentState.presetId || 'yingyi';
    if (els.statusText) {
      els.statusText.textContent = '正在向同源后端请求星云 3D 签名会话 (/api/agent/xingyun/session)…';
    }
    setPose('think');
    try {
      var res = await global.fetch('/api/agent/xingyun/session', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'startSession',
          preset_id: targetPreset
        })
      });
      var data = await res.json();
      agentState.rtcSession = data;
      var detail = (data && data.data) || {};
      var sessionId = detail.session_id || 'xy_live_session';
      agentState.mode = 'rtc';
      if (els.modePill) els.modePill.setAttribute('data-mode', 'rtc');
      if (els.statusText) {
        els.statusText.textContent =
          '星云 3D 会话已就绪：session_id=' + sessionId.slice(0, 24) +
          ' · look=' + (PRESETS[targetPreset] ? PRESETS[targetPreset].look_name : targetPreset);
      }
      speakText(
        '星云 3D 具身会话已握手成功！当前加载形象：' +
          (PRESETS[targetPreset] ? PRESETS[targetPreset].name : targetPreset),
        'happy',
        2600
      );
      return data;
    } catch (e) {
      if (els.statusText) {
        els.statusText.textContent = '星云 3D 实时流已自动降级为本地 3D 全息伴学舱';
      }
      setPose('idle');
      return null;
    }
  }

  function appendAgentCard(resp) {
    ensureCopilotPanelDom();
    var body = els.cpBody || doc.getElementById('cpBody');
    if (!body || !resp) return;

    if (resp.reply) {
      var replyEl = make('div', 'emc-cp-msg', resp.reply);
      body.appendChild(replyEl);
    }

    var toolList = Array.isArray(resp.tool_calls)
      ? resp.tool_calls
      : (Array.isArray(resp.tool_traces) ? resp.tool_traces : []);
    var hasTools = toolList.length > 0;
    var hasRoi = resp.roi_calculation && typeof resp.roi_calculation === 'object';
    var hasArtifact = resp.saved_artifact && resp.saved_artifact.id;
    if (!hasTools && !hasRoi && !hasArtifact) {
      body.scrollTop = body.scrollHeight;
      return;
    }

    var card = make('div', 'emc-agent-card');
    card.setAttribute('data-emc-agent-card', '');

    var head = make('div', 'emc-agent-card-head');
    head.appendChild(make('span', '', '小商 Agent 工具链与推演'));
    var prov = make('span', '', (resp.provider === 'ai_gateway' ? 'AI 大模型' : 'Copilot 引擎') + ' · ' + (resp.model || 'xiaoshang-v1'));
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
      var artBox = make('div', 'emc-agent-roi');
      artBox.setAttribute('data-emc-saved-draft', resp.saved_artifact.id);
      artBox.textContent = '已自动保存正式草稿：' + resp.saved_artifact.title + ' (' + resp.saved_artifact.id + ')';
      card.appendChild(artBox);
    }

    body.appendChild(card);
    body.scrollTop = body.scrollHeight;
  }

  function buildLocalFallbackResponse(question) {
    var lv = currentLevelCode();
    var q = String(question || '').trim();
    var nums = q.match(/\d+(?:\.\d+)?/g);
    var roiCalc = null;
    if (nums && nums.length >= 2 && /拿货|进货|成本|售价|卖|定价|毛利|算账|利润|roi/i.test(q)) {
      var a = parseFloat(nums[0]);
      var b = parseFloat(nums[1]);
      var price = Math.max(a, b);
      var cost = Math.min(a, b);
      var profit = +(price - cost).toFixed(2);
      var margin = price > 0 ? +(profit / price * 100).toFixed(1) : 0;
      var roi = margin > 0 ? +(100 / margin).toFixed(2) : 99.9;
      roiCalc = {
        retail_price_yuan: price,
        supply_price_yuan: cost,
        estimated_net_profit_yuan: profit,
        margin_rate_pct: margin,
        breakeven_roi: roi,
        score_4d: { weighted_total: margin >= 40 ? 84.5 : 62.0 },
        verdict: margin >= 40 ? '毛利率充足（≥40%），推荐小步测款' : '毛利偏薄，建议优化供应链或组合提客单'
      };
    }
    var reply = roiCalc
      ? ('小商帮你把账算好啦：售价 ¥' + roiCalc.retail_price_yuan + '、综合成本 ¥' + roiCalc.supply_price_yuan +
         '，单笔毛利 ¥' + roiCalc.estimated_net_profit_yuan + '（毛利率 ' + roiCalc.margin_rate_pct +
         '%），保本 ROI = ' + roiCalc.breakeven_roi + '。' + roiCalc.verdict)
      : ('店主你好！当前聚焦 ' + lv + ' 阶段。建议先明确细分人群痛点与保本 ROI（公式：保本 ROI = 1 ÷ 毛利率），' +
         '你也可以直接发我「拿货 35 售价 99 帮我算账」或点击下方「真实经营」提交成果认证！');
    return {
      reply: reply,
      emotion: 'happy',
      pose: 'speak',
      provider: 'local_copilot',
      model: 'xiaoshang-fallback-v1',
      tool_calls: [{ tool: 'get_level_guide', summary: '已加载 ' + lv + ' 阶段实操指南' }],
      roi_calculation: roiCalc
    };
  }

  async function requestBackendChat(question, opts) {
    opts = opts || {};
    setPose('think');
    try {
      var headers = { 'Content-Type': 'application/json' };
      if (global.EmcSession) {
        var me = typeof global.EmcSession.current === 'function' ? global.EmcSession.current() : null;
        if (!me && typeof global.EmcSession.getMe === 'function') {
          try { me = await global.EmcSession.getMe(); } catch (_) {}
        }
        if (me && me.csrf_token) headers['X-CSRF-Token'] = me.csrf_token;
      }
      var payloadStr = JSON.stringify({
        message: question,
        level_id: currentLevelCode(),
        current_level: currentLevelCode(),
        current_view: currentViewName(),
        mood: (global.state && typeof global.state.mood === 'number') ? global.state.mood : 0,
        preset_id: agentState.presetId,
        save_as_draft: Boolean(opts.saveAsDraft)
      });
      var res = await global.fetch('/api/agent/chat', {
        method: 'POST',
        credentials: 'same-origin',
        headers: headers,
        body: payloadStr
      });
      if (res.status === 403 && global.EmcSession && typeof global.EmcSession.getMe === 'function') {
        var freshMe = await global.EmcSession.getMe({ force: true });
        if (freshMe && freshMe.csrf_token) {
          headers['X-CSRF-Token'] = freshMe.csrf_token;
        } else {
          delete headers['X-CSRF-Token'];
        }
        res = await global.fetch('/api/agent/chat', {
          method: 'POST',
          credentials: 'same-origin',
          headers: headers,
          body: payloadStr
        });
      }
      if (!res.ok) {
        var fallback = buildLocalFallbackResponse(question);
        speakText(fallback.reply, fallback.emotion);
        appendAgentCard(fallback);
        return fallback;
      }
      var data = await res.json();
      agentState.lastToolCalls = data.tool_calls || data.tool_traces || [];
      agentState.lastRoi = data.roi_calculation || null;
      speakText(data.reply || '', data.emotion || 'happy');
      appendAgentCard(data);
      return data;
    } catch (e) {
      var offlineData = buildLocalFallbackResponse(question);
      speakText(offlineData.reply, offlineData.emotion);
      appendAgentCard(offlineData);
      return offlineData;
    }
  }

  async function runDeliverablePreReview(submissionId, containerEl) {
    if (!submissionId) return null;
    setPose('think');
    setBubble('正在执行六关成果 AI 预审：' + submissionId);
    try {
      var data = await global.EmcApi.post('/api/agent/reviews/' + submissionId, {});
      speakText(
        'AI 预审完成：' + (data.recommendation_label || '') + '（得分 ' + data.score + ' 分）。' + (data.summary || ''),
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
        box.appendChild(make('div', '', data.summary || ''));
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

  function hookCopilotFunctions() {
    var origSay = global.copilotSay;
    if (typeof origSay === 'function' && !origSay._emcWrapped) {
      var wrappedSay = function (text, kind) {
        origSay(text, kind);
        speakText(text, kind || 'happy');
      };
      wrappedSay._emcWrapped = true;
      global.copilotSay = wrappedSay;
    }

    var origHandleAI = global.handleAI;
    if (typeof origHandleAI === 'function' && !origHandleAI._emcWrapped) {
      var wrappedHandleAI = function (q) {
        origHandleAI(q);
        requestBackendChat(q);
      };
      wrappedHandleAI._emcWrapped = true;
      global.handleAI = wrappedHandleAI;
    }

    var origOpen = global.openCopilot;
    if (typeof origOpen === 'function' && !origOpen._emcWrapped) {
      var wrappedOpen = function () {
        buildCopilotDeckDom();
        origOpen();
        if (els.stage) els.stage.classList.add('panel-open');
        setPose('interactive');
      };
      wrappedOpen._emcWrapped = true;
      global.openCopilot = wrappedOpen;
    } else if (typeof global.openCopilot !== 'function') {
      global.openCopilot = openCopilotPanel;
    }

    var origClose = global.closeCopilot;
    if (typeof origClose === 'function' && !origClose._emcWrapped) {
      var wrappedClose = function () {
        origClose();
        if (els.stage) els.stage.classList.remove('panel-open');
      };
      wrappedClose._emcWrapped = true;
      global.closeCopilot = wrappedClose;
    } else if (typeof global.closeCopilot !== 'function') {
      global.closeCopilot = closeCopilotPanel;
    }

    // 与浮岛版 #copilotForm 联动动作表情（不篡改 EmcCopilotTransport 默认契约）
    var dockForm = doc.getElementById('copilotForm');
    var dockInput = doc.getElementById('copilotInput');
    if (dockForm && !dockForm._emcAvatarBound) {
      dockForm._emcAvatarBound = true;
      dockForm.addEventListener('submit', function () {
        var msg = dockInput && dockInput.value ? dockInput.value.trim() : '';
        if (msg) {
          speakText('正在结合小店进度为你分析：' + msg, 'think', 1800);
        }
      }, true);
    }
  }

  function start() {
    buildStageDom();
    buildCopilotDeckDom();
    hookCopilotFunctions();
    drawAvatarFrame();
    startAnimationLoop();
  }

  if (doc.readyState === 'loading') {
    doc.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }

  global.EmcAvatarAgent = {
    start: start,
    setPreset: setPreset,
    setPose: setPose,
    speakText: speakText,
    interrupt: interruptSpeech,
    connectXingyunSession: connectXingyunSession,
    askBackend: requestBackendChat,
    runDeliverablePreReview: runDeliverablePreReview,
    openCopilot: openCopilotPanel,
    closeCopilot: closeCopilotPanel,
    openFormalWorkbench: openFormalWorkbench,
    _state: agentState
  };
})(window);
