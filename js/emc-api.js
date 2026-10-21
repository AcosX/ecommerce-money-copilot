/*!
 * EmcApi: 同源 API 的薄封装（无依赖，不保存任何令牌）。
 *
 * 公开接口（window.EmcApi）：
 *   EmcApi.get(path, opts)                 -> Promise<json|null>
 *   EmcApi.post(path, body, opts)          put / patch 同 post
 *   EmcApi.delete(path, opts)
 *   EmcApi.request(method, path, opts)
 *     opts: { body, headers, idempotencyKey, signal, timeoutMs }
 *       - path 只接受以单个 "/" 开头的同源相对路径，否则 reject invalid_path
 *       - body 为 FormData 时原样发送（上传），否则按 JSON 序列化
 *       - 非 GET/HEAD/OPTIONS 自动带 X-CSRF-Token（来自 EmcSession 缓存的 /api/me）
 *       - idempotencyKey：1-128 字符；同一次业务操作重试时请复用同一个 key
 *   EmcApi.newIdempotencyKey()             -> string
 *   EmcApi.onUnauthenticated(fn)           -> unsubscribe；收到 401 unauthenticated 时调用 fn(err)
 *   EmcApi.configure({ timeoutMs, csrfProvider })   由 EmcSession 注册，一般不需要手动调用
 *   EmcApi.EmcApiError
 *
 * 失败时统一 reject EmcApiError：
 *   { name, status, code, message, requestId, details, needsLogin, isNetworkError }
 *   - 后端错误按约定的 {"error": {code, message, request_id, details}} 解析
 *   - 网络异常 / 超时：status 0，code 为 network_error / timeout / aborted
 *   - 非约定格式的错误响应：code 为 http_error
 *   - 401 unauthenticated 时会先清除 EmcSession 的登录缓存；调用方可据 err.needsLogin
 *     决定是否调用 EmcSession.requireLogin(...)。
 */
(function (global) {
  'use strict';

  var SAFE_METHODS = { GET: true, HEAD: true, OPTIONS: true };
  var config = { timeoutMs: 10000, csrfProvider: null };
  var unauthHandlers = [];

  class EmcApiError extends Error {
    constructor(info) {
      super(info.message || '请求失败');
      this.name = 'EmcApiError';
      this.status = info.status || 0;
      this.code = info.code || 'unknown_error';
      this.requestId = info.requestId || null;
      this.details = info.details || {};
    }
    get needsLogin() { return this.status === 401 && this.code === 'unauthenticated'; }
    get isNetworkError() { return this.status === 0; }
  }

  function localError(code, message) {
    return new EmcApiError({ status: 0, code: code, message: message });
  }

  function checkPath(path) {
    if (typeof path !== 'string' || path.charAt(0) !== '/' || path.charAt(1) === '/' ||
        path.indexOf('\\') !== -1 || /[\u0000-\u001f\u007f]/.test(path)) {
      throw localError('invalid_path', '只允许同源相对路径');
    }
  }

  function newIdempotencyKey() {
    var c = global.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.prototype.map.call(bytes, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  }

  function notifyUnauthenticated(err) {
    unauthHandlers.slice().forEach(function (fn) {
      try { fn(err); } catch (e) { /* 订阅者异常不影响调用方 */ }
    });
  }

  async function request(method, path, opts) {
    opts = opts || {};
    checkPath(path);
    method = String(method || 'GET').toUpperCase();

    var headers = { 'Accept': 'application/json' };
    var body;
    if (opts.body !== undefined && opts.body !== null) {
      if (typeof FormData !== 'undefined' && opts.body instanceof FormData) {
        body = opts.body;
      } else {
        body = JSON.stringify(opts.body);
        headers['Content-Type'] = 'application/json';
      }
    }
    if (!SAFE_METHODS[method] && config.csrfProvider) {
      var token = await config.csrfProvider();
      if (token) headers['X-CSRF-Token'] = token;
    }
    if (opts.idempotencyKey !== undefined && opts.idempotencyKey !== null) {
      var key = String(opts.idempotencyKey);
      if (key.length < 1 || key.length > 128) {
        throw localError('invalid_idempotency_key', 'Idempotency-Key 长度需为 1-128 字符');
      }
      headers['Idempotency-Key'] = key;
    }
    if (opts.headers) {
      Object.keys(opts.headers).forEach(function (k) { headers[k] = opts.headers[k]; });
    }

    var ctrl = new AbortController();
    var timedOut = false;
    var callerAborted = false;
    var ms = opts.timeoutMs > 0 ? opts.timeoutMs : config.timeoutMs;
    var timer = setTimeout(function () { timedOut = true; ctrl.abort(); }, ms);
    if (opts.signal) {
      if (opts.signal.aborted) { callerAborted = true; ctrl.abort(); }
      else opts.signal.addEventListener('abort', function () { callerAborted = true; ctrl.abort(); }, { once: true });
    }

    try {
      var res, text;
      try {
        res = await fetch(path, {
          method: method,
          headers: headers,
          body: body,
          credentials: 'same-origin',
          cache: 'no-store',
          signal: ctrl.signal
        });
        text = await res.text();
      } catch (e) {
        if (timedOut) throw localError('timeout', '请求超时，请稍后重试');
        if (callerAborted) throw localError('aborted', '请求已取消');
        throw localError('network_error', '网络异常，请稍后重试');
      }

      var requestId = res.headers.get('X-Request-ID');
      var data = null;
      var parsable = true;
      if (text) {
        try { data = JSON.parse(text); } catch (e) { parsable = false; }
      }

      if (res.ok) {
        if (!parsable) {
          throw new EmcApiError({ status: res.status, code: 'invalid_response', message: '服务返回了无法识别的内容', requestId: requestId });
        }
        return data;
      }

      var env = parsable && data && typeof data === 'object' && data.error && typeof data.error === 'object' ? data.error : null;
      var err = new EmcApiError({
        status: res.status,
        code: env && typeof env.code === 'string' ? env.code : 'http_error',
        message: env && typeof env.message === 'string' ? env.message : '请求失败（HTTP ' + res.status + '）',
        requestId: (env && typeof env.request_id === 'string' && env.request_id) || requestId,
        details: env && env.details && typeof env.details === 'object' ? env.details : {}
      });
      if (err.needsLogin) notifyUnauthenticated(err);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  global.EmcApi = {
    request: request,
    get: function (path, opts) { return request('GET', path, opts); },
    post: function (path, body, opts) { return request('POST', path, Object.assign({}, opts, { body: body })); },
    put: function (path, body, opts) { return request('PUT', path, Object.assign({}, opts, { body: body })); },
    patch: function (path, body, opts) { return request('PATCH', path, Object.assign({}, opts, { body: body })); },
    delete: function (path, opts) { return request('DELETE', path, opts); },
    newIdempotencyKey: newIdempotencyKey,
    onUnauthenticated: function (fn) {
      unauthHandlers.push(fn);
      return function () {
        var i = unauthHandlers.indexOf(fn);
        if (i !== -1) unauthHandlers.splice(i, 1);
      };
    },
    configure: function (opts) {
      if (!opts) return;
      if (opts.timeoutMs > 0) config.timeoutMs = opts.timeoutMs;
      if (opts.csrfProvider !== undefined) config.csrfProvider = opts.csrfProvider;
    },
    EmcApiError: EmcApiError
  };
})(window);
