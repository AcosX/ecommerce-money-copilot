/*!
 * EmcFormalUI: 真实经营内嵌工作台与状态展示（#36, #41）。
 * 严格区分：
 *   - 教学通关（仅前端本地模拟，不代表正式认证）
 *   - 草稿（draft，含 origin="tutorial_copy" 标注「来自教学模拟」）
 *   - 待审核（submitted / pending，已冻结快照并绑定证据）
 *   - 正式认证通过（approved，人工审核通过）
 *   - 已驳回（rejected，显示驳回原因，修改后可再次提交）
 *
 * 所有业务接口均通过同源 EmcApi (/api/*) 调用，不写入 localStorage / sessionStorage / document.cookie。
 */
(function (global) {
  'use strict';
  var Api = global.EmcApi;
  var S = global.EmcSession;
  var doc = global.document;
  if (!Api || !S) return;

  var wb = null;
  var state = {
    projects: [],
    artifacts: [],
    verifications: [],
    selectedProjectId: null,
    selectedArtifactId: null,
    busy: false
  };

  var STATUS_META = {
    tutorial: { text: '教学通关（仅前端本地）', cls: 'tutorial' },
    draft: { text: '草稿', cls: 'draft' },
    submitted: { text: '待审核', cls: 'pending' },
    pending: { text: '待审核', cls: 'pending' },
    approved: { text: '正式认证通过', cls: 'approved' },
    rejected: { text: '已驳回', cls: 'rejected' }
  };

  function toast(msg) {
    if (typeof global.toast === 'function') global.toast(msg);
  }

  function make(tag, cls, text) {
    var n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function badge(status) {
    var m = STATUS_META[status] || STATUS_META.draft;
    var b = make('span', 'emc-badge ' + m.cls, m.text);
    b.setAttribute('data-emc-status-badge', status);
    return b;
  }

  function currentSummaryStatus() {
    var i;
    for (i = 0; i < state.verifications.length; i++) {
      if (state.verifications[i].status === 'approved') return 'approved';
    }
    for (i = 0; i < state.verifications.length; i++) {
      if (state.verifications[i].status === 'pending') return 'pending';
    }
    for (i = 0; i < state.verifications.length; i++) {
      if (state.verifications[i].status === 'rejected') return 'rejected';
    }
    for (i = 0; i < state.artifacts.length; i++) {
      var st = state.artifacts[i].status;
      if (st === 'approved' || st === 'submitted' || st === 'rejected' || st === 'draft') return st;
    }
    return 'draft';
  }

  function ensureWorkbenchDom() {
    if (!wb) wb = doc.getElementById('emcRealWorkbench');
    if (!wb || wb.children.length) return wb;

    var head = make('div', 'emc-wb-head');
    var titleWrap = make('div', 'emc-wb-title');
    titleWrap.appendChild(make('span', '', '正式经营工作台'));
    var curBadge = badge(currentSummaryStatus());
    curBadge.id = 'emcWbCurrentStatus';
    titleWrap.appendChild(curBadge);
    head.appendChild(titleWrap);

    var me = S.current();
    if (me && Array.isArray(me.roles) && me.roles.indexOf('reviewer') !== -1) {
      var adminLink = make('a', 'emc-wb-admin-link', '进入人工审核台 (/admin/)');
      adminLink.id = 'emcWbAdminLink';
      adminLink.href = '/admin/';
      head.appendChild(adminLink);
    }
    wb.appendChild(head);

    var form = make('div', 'emc-wb-form');
    var nameInput = make('input', 'emc-wb-input');
    nameInput.id = 'emcWbProjectName';
    nameInput.type = 'text';
    nameInput.maxLength = 80;
    nameInput.value = '女装细分类目破零项目';
    nameInput.setAttribute('aria-label', '经营项目名称');
    form.appendChild(nameInput);

    var noteInput = make('input', 'emc-wb-input');
    noteInput.id = 'emcWbVerifyNote';
    noteInput.type = 'text';
    noteInput.maxLength = 200;
    noteInput.value = '附上真实选品与订单核验凭证，申请人工认证';
    noteInput.setAttribute('aria-label', '认证说明');
    form.appendChild(noteInput);
    wb.appendChild(form);

    var actions = make('div', 'emc-wb-actions');
    var btnLoad = make('button', 'px-btn ghost sm', '同步云端状态');
    btnLoad.type = 'button';
    btnLoad.id = 'emcWbLoadBtn';
    btnLoad.addEventListener('click', function () { syncAll(); });

    var btnProj = make('button', 'px-btn sm', '新建经营项目');
    btnProj.type = 'button';
    btnProj.id = 'emcWbCreateProjectBtn';
    btnProj.addEventListener('click', function () { createProject(); });

    var btnFormal = make('button', 'px-btn sm', '新建正式选品单');
    btnFormal.type = 'button';
    btnFormal.id = 'emcWbCreateFormalBtn';
    btnFormal.addEventListener('click', function () { createArtifact('formal'); });

    var btnCopy = make('button', 'px-btn ghost sm', '复制教学结果为草稿');
    btnCopy.type = 'button';
    btnCopy.id = 'emcWbCopyTutorialBtn';
    btnCopy.addEventListener('click', function () { createArtifact('tutorial_copy'); });

    var btnSubmit = make('button', 'px-btn mint sm', '上传凭证并提交认证');
    btnSubmit.type = 'button';
    btnSubmit.id = 'emcWbSubmitVerifyBtn';
    btnSubmit.addEventListener('click', function () { submitVerification(); });

    actions.appendChild(btnLoad);
    actions.appendChild(btnProj);
    actions.appendChild(btnFormal);
    actions.appendChild(btnCopy);
    actions.appendChild(btnSubmit);
    wb.appendChild(actions);

    var listBox = make('div', 'emc-wb-list');
    listBox.id = 'emcWbList';
    wb.appendChild(listBox);

    renderLists();
    return wb;
  }

  function renderLists() {
    if (!wb || !wb.children.length) return;
    var cur = doc.getElementById('emcWbCurrentStatus');
    if (cur) {
      var nextBadge = badge(currentSummaryStatus());
      nextBadge.id = 'emcWbCurrentStatus';
      cur.replaceWith(nextBadge);
    }
    var box = doc.getElementById('emcWbList');
    if (!box) return;
    box.textContent = '';

    state.artifacts.forEach(function (art) {
      var row = make('div', 'emc-wb-item');
      row.setAttribute('data-artifact-id', art.id);
      var h = make('div', 'emc-wb-item-head');
      h.appendChild(badge(art.status || 'draft'));
      if (art.origin === 'tutorial_copy') {
        var ob = make('span', 'emc-badge origin-copy', art.origin_label || '来自教学模拟');
        ob.setAttribute('data-emc-origin-badge', 'tutorial_copy');
        h.appendChild(ob);
      }
      h.appendChild(make('span', '', art.title || art.artifact_type));
      row.appendChild(h);
      row.appendChild(make('div', '', '类型：' + art.artifact_type + ' · 版本 v' + (art.version || 1)));
      box.appendChild(row);
    });

    state.verifications.forEach(function (v) {
      var row = make('div', 'emc-wb-item');
      row.setAttribute('data-verification-id', v.id);
      var h = make('div', 'emc-wb-item-head');
      h.appendChild(badge(v.status || 'pending'));
      h.appendChild(make('span', '', '认证申请 ' + v.id));
      row.appendChild(h);
      if (v.note) row.appendChild(make('div', '', '说明：' + v.note));
      var reason = v.rejection_reason;
      if (!reason && Array.isArray(v.reviews)) {
        for (var i = v.reviews.length - 1; i >= 0; i--) {
          if (v.reviews[i].reason) { reason = v.reviews[i].reason; break; }
        }
      }
      if (v.status === 'rejected' && reason) {
        var r = make('div', 'emc-wb-reason', '驳回原因：' + reason);
        r.setAttribute('data-emc-rejection-reason', '');
        row.appendChild(r);
      }
      box.appendChild(row);
    });
  }

  async function syncAll() {
    if (state.busy || !S.isLoggedIn()) return;
    state.busy = true;
    try {
      var pRes = await Api.get('/api/projects');
      state.projects = (pRes && pRes.items) || [];
      if (state.projects.length && !state.selectedProjectId) {
        state.selectedProjectId = state.projects[0].id;
      }
      var aRes = await Api.get('/api/artifacts');
      state.artifacts = (aRes && aRes.items) || [];
      if (state.artifacts.length && !state.selectedArtifactId) {
        state.selectedArtifactId = state.artifacts[0].id;
      }
      var vRes = await Api.get('/api/verifications');
      state.verifications = (vRes && vRes.items) || [];
      renderLists();
      toast('已同步云端经营与认证状态');
    } catch (e) {
      toast((e && e.message) || '同步失败，请稍后重试');
    } finally {
      state.busy = false;
    }
  }

  async function ensureProject() {
    if (state.selectedProjectId) return state.selectedProjectId;
    var nameEl = doc.getElementById('emcWbProjectName');
    var name = (nameEl && nameEl.value.trim()) || '女装细分类目破零项目';
    var p = await Api.post('/api/projects', {
      name: name,
      platform: 'xiaohongshu',
      category: 'womenswear'
    });
    state.projects.unshift(p);
    state.selectedProjectId = p.id;
    return p.id;
  }

  async function createProject() {
    if (state.busy || !S.isLoggedIn()) return;
    state.busy = true;
    try {
      state.selectedProjectId = null;
      await ensureProject();
      renderLists();
      toast('经营项目已创建');
    } catch (e) {
      toast((e && e.message) || '创建项目失败');
    } finally {
      state.busy = false;
    }
  }

  async function createArtifact(origin) {
    if (state.busy || !S.isLoggedIn()) return;
    state.busy = true;
    try {
      var pid = await ensureProject();
      var payload = origin === 'tutorial_copy'
        ? {
            project_id: pid,
            artifact_type: 'business_plan',
            schema_version: 1,
            title: 'L1 经营方案（练习复制草稿）',
            origin: 'tutorial_copy',
            source_level_id: 'L1',
            content: {
              niche: '通勤半身裙',
              platform: 'xiaohongshu',
              differentiation: '小个子高腰显瘦实拍',
              first_order_goal: { sku_count: 3, target_price_yuan: 79, window_days: 14 }
            }
          }
        : {
            project_id: pid,
            artifact_type: 'product_selection',
            schema_version: 1,
            title: 'L2 正式选品单',
            origin: 'formal',
            content: {
              items: [
                {
                  name: '高腰A字半身裙',
                  source_platform: '1688',
                  target_platform: 'xiaohongshu',
                  supply_price_yuan: 32,
                  retail_price_yuan: 79,
                  scores: { heat: 85, competition: 72, growth: 80, margin: 88 }
                }
              ]
            }
          };
      var art = await Api.post('/api/artifacts', payload);
      state.artifacts.unshift(art);
      state.selectedArtifactId = art.id;
      renderLists();
      toast(origin === 'tutorial_copy' ? '已从教学模拟复制为正式草稿（需提交证据审核）' : '已生成正式选品单草稿');
    } catch (e) {
      toast((e && e.message) || '创建成果草稿失败');
    } finally {
      state.busy = false;
    }
  }

  async function uploadSampleEvidence() {
    var me = S.current();
    var csrf = me && me.csrf_token;
    var pngBytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
      0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
      0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
      0x42, 0x60, 0x82
    ]);
    var fd = new FormData();
    fd.append('file', new Blob([pngBytes], { type: 'image/png' }), 'order-evidence.png');
    var headers = { 'Idempotency-Key': Api.newIdempotencyKey() };
    if (csrf) headers['X-CSRF-Token'] = csrf;
    var res = await global.fetch('/api/evidence', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: fd
    });
    var data = await res.json();
    if (!res.ok) {
      var err = (data && data.error) || {};
      throw new Api.EmcApiError({
        status: res.status,
        code: err.code || 'http_error',
        message: err.message || '上传证据失败'
      });
    }
    return data;
  }

  async function submitVerification() {
    if (state.busy || !S.isLoggedIn()) return;
    state.busy = true;
    try {
      if (!state.artifacts.length) {
        state.busy = false;
        await createArtifact('formal');
        state.busy = true;
      }
      var target = state.artifacts[0];
      var ev = await uploadSampleEvidence();
      var noteEl = doc.getElementById('emcWbVerifyNote');
      var note = (noteEl && noteEl.value.trim()) || '申请人工核验';
      var sub = await Api.post('/api/verifications', {
        artifact_id: target.id,
        artifact_version: target.version || 1,
        evidence_ids: [ev.id],
        note: note
      });
      target.status = 'submitted';
      target.version = (target.version || 1) + 1;
      state.verifications.unshift(sub);
      renderLists();
      toast('已提交人工审核，当前状态：待审核');
    } catch (e) {
      toast((e && e.message) || '提交认证失败');
    } finally {
      state.busy = false;
    }
  }

  function openWorkbench(gateName) {
    var box = ensureWorkbenchDom();
    if (!box) return;
    box.hidden = false;
    toast('已打开「' + (gateName || '真实经营') + '」工作台');
  }

  function closeWorkbench() {
    if (!wb) wb = doc.getElementById('emcRealWorkbench');
    if (!wb) return;
    wb.hidden = true;
    wb.textContent = '';
    state.projects = [];
    state.artifacts = [];
    state.verifications = [];
    state.selectedProjectId = null;
    state.selectedArtifactId = null;
  }

  function onRealActionClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('.emc-real-actions [data-emc-gate]') : null;
    if (!t || e.defaultPrevented || !S.isLoggedIn()) return;
    openWorkbench(t.getAttribute('data-emc-gate'));
  }

  function onSessionChanged(e) {
    var d = e.detail || {};
    if (!d.authenticated) closeWorkbench();
  }

  function start() {
    wb = doc.getElementById('emcRealWorkbench');
    doc.addEventListener('click', onRealActionClick);
    doc.addEventListener('emc:session-changed', onSessionChanged);
  }

  global.EmcFormalUI = {
    start: start,
    openWorkbench: openWorkbench,
    syncAll: syncAll,
    _state: state,
    _renderLists: renderLists
  };
})(window);
