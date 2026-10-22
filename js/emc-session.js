/*!
 * EmcSession: 登录态（只读缓存 /api/me）与登录 / 退出入口。依赖 emc-api.js。
 * 登录凭证只在服务端 HttpOnly Cookie 中；这里不读写 localStorage / sessionStorage。
 *
 * 公开接口（window.EmcSession）：
 *   getMe({force})        -> Promise<me>，永不 reject。
 *                            me = {authenticated, player:{id,display_name,email}|null, roles[], csrf_token|null}
 *                            /api/me 失败（网络 / 5xx / 后端未部署）时返回匿名态，且不缓存失败结果
 *   isLoggedIn()          -> boolean（同步，读缓存；首次请求返回前为 false）
 *   current()             -> 缓存的 me 或 null
 *   hasRole(role)         -> boolean
 *   status()              -> 'idle' | 'loading' | 'ready' | 'unavailable'
 *   lastError()           -> 最近一次 /api/me 的 EmcApiError 或 null
 *   login(returnTo?)      -> 跳转 /auth/login?return_to=...；returnTo 缺省为当前 path+query+hash，
 *                            非同源相对路径一律回退到当前位置
 *   loginUrl(returnTo?)   -> 同上，只返回 URL 字符串
 *   logout()              -> Promise<boolean>，POST /auth/logout（带 CSRF），成功后清缓存并通知；不 reject
 *   requireLogin(label)   -> Promise<boolean>；已登录 true；未登录 false，并派发 emc:login-required
 *                            （页面 UI 会弹出提示；无人处理时直接 login()）
 *   safeReturnTo(path)    -> 合法的同源相对路径或 null
 *   onChange(fn)          -> unsubscribe；fn(detail) 同 emc:session-changed 的 detail
 *   ACTIONS               -> 受限操作名称：REAL_OPS 真实经营 / FORMAL_SELECTION 生成正式选品单 / SUBMIT_VERIFICATION 提交认证
 *
 * 事件（document 上）：
   *   emc:before-login cancelable，detail.proceed() 继续跳转；用于游戏伙伴设置，不改变认证参数
 *   emc:session-changed  detail {authenticated, me, status, reason}
 *   emc:login-required   cancelable，detail {action, reason: 'unauthenticated' | 'unavailable'}
 *
 * 用法示例（受限操作入口）：
 *   button.addEventListener('click', async () => {
 *     if (!(await EmcSession.requireLogin(EmcSession.ACTIONS.SUBMIT_VERIFICATION))) return;
 *     // ...已登录，继续业务
 *   });
 *   API 调用中收到 err.needsLogin 时同样调用 EmcSession.requireLogin(...)。
 */
(function (global) {
  'use strict';
  var Api = global.EmcApi;
  if (!Api) return;
  var doc = global.document;

  var ACTIONS = Object.freeze({
    REAL_OPS: '真实经营',
    FORMAL_SELECTION: '生成正式选品单',
    SUBMIT_VERIFICATION: '提交认证'
  });
  var ANON = Object.freeze({ authenticated: false, player: null, roles: Object.freeze([]), csrf_token: null });

  var cache = null;
  var inflight = null;
  var state = 'idle';       // idle | ready | unavailable
  var lastError = null;
  var logoutInflight = null;

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || raw.authenticated !== true) return ANON;
    var p = raw.player && typeof raw.player === 'object' ? raw.player : {};
    var name = typeof p.display_name === 'string' && p.display_name.trim() ? p.display_name.trim() : '玩家';
    return Object.freeze({
      authenticated: true,
      player: Object.freeze({
        id: typeof p.id === 'string' ? p.id : null,
        display_name: name,
        email: typeof p.email === 'string' ? p.email : null
      }),
      roles: Object.freeze(Array.isArray(raw.roles) ? raw.roles.filter(function (r) { return typeof r === 'string'; }) : ['player']),
      csrf_token: typeof raw.csrf_token === 'string' ? raw.csrf_token : null
    });
  }

  function isLoggedIn() { return !!(cache && cache.authenticated); }

  function status() { return inflight ? 'loading' : state; }

  function signature() {
    return [isLoggedIn(), cache && cache.player && cache.player.id, state].join('|');
  }

  function detail(reason) {
    return { authenticated: isLoggedIn(), me: cache, status: status(), reason: reason || null };
  }

  function update(nextCache, nextState, reason) {
    var before = signature();
    if (nextCache !== undefined) cache = nextCache;
    if (nextState) state = nextState;
    if (signature() !== before) {
      doc.dispatchEvent(new CustomEvent('emc:session-changed', { detail: detail(reason) }));
    }
  }

  function getMe(opts) {
    var force = !!(opts && opts.force);
    if (!force && cache) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = Api.get('/api/me').then(function (raw) {
      lastError = null;
      update(normalize(raw), 'ready', 'refresh');
      return cache;
    }, function (err) {
      lastError = err;
      if (err && err.status === 401) {
        update(ANON, 'ready', 'unauthenticated');
        return cache;
      }
      update(undefined, 'unavailable', 'unavailable');
      return cache || ANON;
    }).then(function (me) {
      inflight = null;
      return me;
    });
    return inflight;
  }

  Api.configure({
    csrfProvider: function () {
      if (cache) return cache.csrf_token;
      return getMe().then(function (me) { return me.csrf_token; });
    }
  });
  Api.onUnauthenticated(function () {
    if (isLoggedIn()) update(ANON, 'ready', 'expired');
  });

  function safeReturnTo(p) {
    if (typeof p !== 'string' || p.length === 0 || p.length > 2000) return null;
    if (p.charAt(0) !== '/' || p.charAt(1) === '/' || p.indexOf('\\') !== -1) return null;
    if (/[\u0000-\u001f\u007f]/.test(p)) return null;
    try {
      if (new URL(p, global.location.origin).origin !== global.location.origin) return null;
    } catch (e) {
      return null;
    }
    return p;
  }

  function loginUrl(returnTo) {
    var loc = global.location;
    var rt = safeReturnTo(returnTo) || safeReturnTo(loc.pathname + loc.search + loc.hash) || '/';
    return '/auth/login?return_to=' + encodeURIComponent(rt);
  }

  function login(returnTo) {
    var url = loginUrl(returnTo), proceeded = false;
    function proceed() { if (!proceeded) { proceeded = true; global.location.assign(url); } }
    // 游戏可在跳转统一认证前完成伙伴设置；没有监听者时保持原来的直接登录行为。
    var event = new CustomEvent('emc:before-login', { cancelable: true, detail: { proceed: proceed } });
    if (doc.dispatchEvent(event)) proceed();
  }

  function logout() {
    if (logoutInflight) return logoutInflight;
    function attempt() { return Api.post('/auth/logout'); }
    logoutInflight = (async function () {
      try {
        await attempt();
      } catch (err) {
        if (err.code === 'unauthenticated') {
          // 会话已失效，等同于已退出
        } else if (err.code === 'csrf_failed') {
          var me = await getMe({ force: true });
          if (me.authenticated) {
            try { await attempt(); } catch (err2) { lastError = err2; return false; }
          }
        } else {
          lastError = err;
          return false;
        }
      }
      update(ANON, 'ready', 'logout');
      return true;
    })().then(function (ok) {
      logoutInflight = null;
      return ok;
    });
    return logoutInflight;
  }

  function cleanLabel(label) {
    var s = String(label == null ? '' : label).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24);
    return s || ACTIONS.REAL_OPS;
  }

  async function requireLogin(actionLabel) {
    var label = cleanLabel(actionLabel);
    var me = cache || (state === 'unavailable' ? ANON : await getMe());
    if (me.authenticated) return true;
    var reason = !cache && state === 'unavailable' ? 'unavailable' : 'unauthenticated';
    var ev = new CustomEvent('emc:login-required', { cancelable: true, detail: { action: label, reason: reason } });
    var unhandled = doc.dispatchEvent(ev);
    if (unhandled && reason === 'unauthenticated') login();
    return false;
  }

  global.EmcSession = {
    ACTIONS: ACTIONS,
    getMe: getMe,
    isLoggedIn: isLoggedIn,
    current: function () { return cache; },
    hasRole: function (role) { return !!(cache && cache.roles.indexOf(role) !== -1); },
    status: status,
    lastError: function () { return lastError; },
    login: login,
    loginUrl: loginUrl,
    logout: logout,
    requireLogin: requireLogin,
    safeReturnTo: safeReturnTo,
    onChange: function (fn) {
      function handler(e) { fn(e.detail); }
      doc.addEventListener('emc:session-changed', handler);
      return function () { doc.removeEventListener('emc:session-changed', handler); };
    }
  };
})(window);
