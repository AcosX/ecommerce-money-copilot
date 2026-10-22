/*!
 * EmcAccountUI: 顶栏账号指示、受限操作的登录提示、登录往返后的位置恢复。
 * 依赖 emc-api.js / emc-session.js，emc-route.js 可选。由页面在初始化末尾调用 EmcAccountUI.start()。
 *
 * 受限操作的接入方式（任选其一）：
 *   1. 在按钮上加 data-emc-gate="操作名"：游客点击时会被拦截并弹出登录提示（捕获阶段拦截，
 *      该按钮自己的 click 处理函数不会执行）；已登录则原样放行。
 *      再加 data-emc-placeholder 表示功能尚未接入，已登录点击时只给出 toast，接入后去掉该属性即可。
 *   2. 在代码里：if (!(await EmcSession.requireLogin('操作名'))) return;
 *
 * 登录往返：提示里的登录按钮会把 EmcRoute.returnTo({gate}) 作为 return_to；回到页面后只恢复视图并提示，
 * 不会自动重放任何操作。
 */
(function (global) {
  'use strict';
  var S = global.EmcSession;
  var R = global.EmcRoute;
  var doc = global.document;
  if (!S) return;

  var acct = null;
  var prompt = null;       // {root, dialog, title, body, primary, close}
  var ctx = null;          // 当前提示：{action, reason, opener, retryFailed}
  var pendingOpener = null;
  var busy = false;
  var started = false;

  function toast(msg) {
    if (typeof global.toast === 'function') global.toast(msg);
  }

  function returnTo(action) {
    return R ? R.returnTo(action ? { gate: action } : undefined) : undefined;
  }

  function make(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ===== 顶栏账号指示 ===== */
  function renderAcct() {
    if (!acct) return;
    var hadFocus = acct.contains(doc.activeElement);
    var me = S.current();
    var logged = !!(me && me.authenticated);
    var primary;
    acct.textContent = '';
    if (logged) {
      var name = make('span', 'emc-acct-name');
      name.appendChild(make('span', 'emc-sr', '已登录：'));
      name.appendChild(doc.createTextNode(me.player.display_name));
      name.title = me.player.display_name;
      primary = make('button', 'px-btn ghost sm', '退出');
      primary.type = 'button';
      primary.id = 'emcLogoutBtn';
      primary.setAttribute('aria-label', '退出登录');
      acct.appendChild(name);
      acct.appendChild(primary);
    } else {
      primary = make('button', 'px-btn sm', '登录 / 注册');
      primary.type = 'button';
      primary.id = 'emcLoginBtn';
      acct.appendChild(primary);
    }
    if (hadFocus) primary.focus();

    var label = doc.getElementById('modeLabel');
    var tag = doc.getElementById('guestTag');
    var banner = doc.getElementById('guestBanner');
    if (banner) banner.hidden = logged;
    if (label) label.textContent = logged ? '已登录' : '游客';
    if (tag) tag.textContent = logged ? '可进真实经营' : '可玩教学';
  }

  /* ===== 登录 / 退出 ===== */
  async function startLogin(action, opener) {
    var me = await S.getMe({ force: S.status() === 'unavailable' });
    if (me.authenticated) return;
    if (!S.current()) {
      openPrompt({ action: action, reason: 'unavailable', opener: opener });
      return;
    }
    S.login(returnTo(action));
  }

  async function doLogout() {
    var ok = await S.logout();
    toast(ok ? '已退出登录' : '退出失败，请稍后重试');
  }

  /* ===== 登录提示（对话框） ===== */
  function buildPrompt() {
    var root = doc.createElement('div');
    root.className = 'emc-modal';
    root.id = 'emcLoginPrompt';
    root.hidden = true;
    root.innerHTML =
      '<div class="emc-modal-backdrop"></div>' +
      '<div class="emc-dialog" role="dialog" aria-modal="true" aria-labelledby="emcPromptTitle" aria-describedby="emcPromptBody" tabindex="-1">' +
        '<div class="emc-dialog-head"><span class="emc-ava"><img src="assets/npc.png" alt=""></span>' +
        '<h2 id="emcPromptTitle" class="emc-dialog-title"></h2></div>' +
        '<p id="emcPromptBody" class="emc-dialog-body" aria-live="polite"></p>' +
        '<div class="emc-dialog-actions">' +
          '<button type="button" id="emcPromptPrimary" class="px-btn mint"></button>' +
          '<button type="button" id="emcPromptClose" class="px-btn ghost">先继续教学</button>' +
        '</div>' +
      '</div>';
    doc.body.appendChild(root);
    prompt = {
      root: root,
      dialog: root.querySelector('.emc-dialog'),
      title: root.querySelector('#emcPromptTitle'),
      body: root.querySelector('#emcPromptBody'),
      primary: root.querySelector('#emcPromptPrimary'),
      close: root.querySelector('#emcPromptClose')
    };
    root.querySelector('.emc-modal-backdrop').addEventListener('click', function () { closePrompt(); });
    prompt.close.addEventListener('click', function () { closePrompt(); });
    prompt.primary.addEventListener('click', onPrimary);
  }

  function fillPrompt() {
    var unavailable = ctx.reason === 'unavailable';
    prompt.title.textContent = unavailable ? '登录服务暂时不可用' : '需要先登录';
    if (unavailable) {
      prompt.body.textContent = ctx.retryFailed
        ? '仍然连接不上登录服务，请稍后再试。教学关卡不受影响。'
        : '暂时连接不上登录服务，稍后重试即可。教学关卡不受影响，可以继续玩。';
    } else {
      prompt.body.textContent = ctx.action
        ? '「' + ctx.action + '」属于真实经营操作，需要先登录。教学关卡不受影响，可以继续玩。'
        : '登录后可以进入真实经营。教学关卡无需登录。';
    }
    prompt.primary.textContent = unavailable ? '重试' : '登录 / 注册';
  }

  function setInert(on) {
    var app = doc.querySelector('.app, .game-shell');
    if (!app) return;
    if (on) app.setAttribute('inert', ''); else app.removeAttribute('inert');
  }

  function openPrompt(opts) {
    if (!prompt) buildPrompt();
    var wasOpen = !prompt.root.hidden;
    ctx = {
      action: opts.action || null,
      reason: opts.reason === 'unavailable' ? 'unavailable' : 'unauthenticated',
      opener: wasOpen && ctx ? ctx.opener : (opts.opener || doc.activeElement),
      retryFailed: !!opts.retryFailed
    };
    fillPrompt();
    if (!wasOpen) {
      prompt.root.hidden = false;
      setInert(true);
    }
    prompt.primary.focus();
  }

  function closePrompt() {
    if (!prompt || prompt.root.hidden) return;
    prompt.root.hidden = true;
    setInert(false);
    var opener = ctx && ctx.opener;
    ctx = null;
    if (opener && opener.isConnected && opener !== doc.body && typeof opener.focus === 'function') {
      opener.focus();
    } else if (acct) {
      var fallback = acct.querySelector('button');
      if (fallback) fallback.focus();
    }
  }

  async function onPrimary() {
    if (!ctx || busy) return;
    busy = true;
    prompt.dialog.setAttribute('aria-busy', 'true');
    try {
      if (ctx.reason === 'unavailable') {
        var me = await S.getMe({ force: true });
        if (!ctx) return;               // 重试期间已被关闭
        if (!S.current()) {
          ctx.retryFailed = true;
          fillPrompt();
        } else if (!me.authenticated) {
          ctx.reason = 'unauthenticated';
          ctx.retryFailed = false;
          fillPrompt();
        }                                // 已登录的情况由 session-changed 关闭提示
      } else {
        var destination = returnTo(ctx.action);
        closePrompt();
        S.login(destination);
      }
    } finally {
      busy = false;
      if (prompt) prompt.dialog.removeAttribute('aria-busy');
    }
  }

  function onKeydown(e) {
    if (!prompt || prompt.root.hidden) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePrompt();
      return;
    }
    if (e.key !== 'Tab') return;
    var first = prompt.primary;
    var last = prompt.close;
    var active = doc.activeElement;
    if (!prompt.dialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === prompt.dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /* ===== 受限操作拦截 ===== */
  function onGateClickCapture(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-emc-gate]') : null;
    if (!t || t.disabled || t.getAttribute('aria-disabled') === 'true') return;
    if (S.isLoggedIn()) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    pendingOpener = t;
    S.requireLogin(t.getAttribute('data-emc-gate')).then(function (ok) {
      pendingOpener = null;
      if (ok && t.isConnected) t.click();   // 点击发生时登录态尚未确认，确认已登录后补上用户这一次点击
    });
  }

  function onPlaceholderClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-emc-gate][data-emc-placeholder]') : null;
    if (!t || e.defaultPrevented || !S.isLoggedIn()) return;
    toast('已登录：「' + t.getAttribute('data-emc-gate') + '」功能正在接入中');
  }

  function onLoginRequired(e) {
    e.preventDefault();
    var d = e.detail || {};
    openPrompt({ action: d.action, reason: d.reason, opener: pendingOpener });
    pendingOpener = null;
  }

  function onSessionChanged(e) {
    renderAcct();
    var d = e.detail || {};
    if (d.authenticated && prompt && !prompt.root.hidden) {
      closePrompt();
      toast('已登录');
    }
    if (d.reason === 'expired') toast('登录已失效，教学不受影响，需要时请重新登录');
  }

  /* ===== 启动 ===== */
  function start() {
    if (started) return;
    started = true;
    acct = doc.getElementById('emcAcct');
    if (acct) {
      renderAcct();
      acct.addEventListener('click', function (e) {
        var b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        if (b.id === 'emcLoginBtn') startLogin(null, b);
        else if (b.id === 'emcLogoutBtn') doLogout();
      });
    }
    doc.addEventListener('click', onGateClickCapture, true);
    doc.addEventListener('click', onPlaceholderClick);
    doc.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('emc:login-required', onLoginRequired);
    doc.addEventListener('emc:session-changed', onSessionChanged);

    if (R) R.restore();
    S.getMe().then(function () {
      var gate = R && R.initial.gate;
      if (!gate) return;
      R.set({ gate: null });
      if (S.isLoggedIn()) toast('已登录，可以继续「' + gate + '」了');
    });
  }

  global.EmcAccountUI = { start: start };
})(window);
