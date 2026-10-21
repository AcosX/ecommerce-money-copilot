/*!
 * EmcRoute: 把当前位置编码进 URL hash，使登录往返后能回到原视图 / 关卡（无依赖）。
 *
 * hash 格式：#view=<视图名>[&lv=<1-6>][&gate=<受限操作名>]，其余未知参数原样保留。
 *   view  对应页面里 id="view-<名>" 的视图（town / level / verify ...）
 *   lv    仅 view=level 时记录，值取自 #lvTag 当前显示的关卡号
 *   gate  登录前点击的受限操作，回来后只用于提示，不会自动执行
 *
 * 公开接口（window.EmcRoute）：
 *   initial           页面加载时解析出的 {view, lv, gate}（只读快照）
 *   read()            解析当前 hash
 *   set(patch)        更新 hash（history.replaceState，不新增历史记录）；值为 null 表示删除该参数
 *   returnTo(patch?)  当前 path+query+合并 patch 后的 hash，供 EmcSession.login() 使用，不修改地址栏
 *   onView(view)      页面 go() 切换视图时调用
 *   restore(goFn?)    按 initial 恢复视图；先派发可取消事件 emc:route-restore {view, lv, gate}，
 *                     关卡层 / 适配层可在监听里 preventDefault() 并自行切到对应关卡；
 *                     无人处理时：视图存在则 go(view)；level 且 lv 与当前展示的关卡不一致则回到 town
 */
(function (global) {
  'use strict';
  var doc = global.document;
  var loc = global.location;
  var LV_MAX = 6;
  var VIEW_RE = /^[a-z][a-z0-9_-]{0,23}$/;

  function cleanText(s, max) {
    return String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max || 24);
  }

  function parse(hash) {
    var p = new URLSearchParams(String(hash || '').replace(/^#/, ''));
    var view = p.get('view');
    var lv = parseInt(p.get('lv'), 10);
    var gate = cleanText(p.get('gate'));
    return {
      view: view && VIEW_RE.test(view) ? view : null,
      lv: lv >= 1 && lv <= LV_MAX ? lv : null,
      gate: gate || null
    };
  }

  var initial = Object.freeze(parse(loc.hash));

  function build(patch) {
    var p = new URLSearchParams(String(loc.hash || '').replace(/^#/, ''));
    if (patch) {
      if ('view' in patch) {
        if (patch.view && VIEW_RE.test(patch.view)) p.set('view', patch.view); else p.delete('view');
      }
      if ('lv' in patch) {
        var n = parseInt(patch.lv, 10);
        if (n >= 1 && n <= LV_MAX) p.set('lv', String(n)); else p.delete('lv');
      }
      if ('gate' in patch) {
        var g = cleanText(patch.gate);
        if (g) p.set('gate', g); else p.delete('gate');
      }
    }
    var s = p.toString();
    return s ? '#' + s : '';
  }

  function shownLevel() {
    var tag = doc.getElementById('lvTag');
    var m = tag && /(\d+)/.exec(tag.textContent);
    return m ? parseInt(m[1], 10) : null;
  }

  function set(patch) {
    try {
      global.history.replaceState(global.history.state, '', loc.pathname + loc.search + build(patch));
    } catch (e) { /* 受限环境下不记录位置即可 */ }
  }

  function restore(goFn) {
    var r = initial;
    if (!r.view) return false;
    var ev = new CustomEvent('emc:route-restore', { cancelable: true, detail: { view: r.view, lv: r.lv, gate: r.gate } });
    if (!doc.dispatchEvent(ev)) return true;
    var go = goFn || global.go;
    if (typeof go !== 'function' || !doc.getElementById('view-' + r.view)) return false;
    if (r.view === 'level' && r.lv && r.lv !== shownLevel()) {
      go('town');
      return false;
    }
    go(r.view);
    return true;
  }

  global.EmcRoute = {
    initial: initial,
    read: function () { return parse(loc.hash); },
    set: set,
    returnTo: function (patch) { return loc.pathname + loc.search + build(patch); },
    onView: function (view) { set({ view: view, lv: view === 'level' ? shownLevel() : null }); },
    restore: restore
  };
})(window);
