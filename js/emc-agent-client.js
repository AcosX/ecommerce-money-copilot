/* Agent HTTP adapter: no DOM or game rules. Reuses session/CSRF/error handling in EmcApi. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.EmcAgentClient = api;
    if (!root.EmcCopilotTransport) root.EmcCopilotTransport = api.transport;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const cache = new Map(), loading = new Map(), pending = new Map(), activities = new Map(), busy = new Set();
  const observed = new Set(), resumed = new Map();
  const identity = () => root.EmcSession?.current()?.player?.id || 'guest';
  const scope = id => identity() + ':' + id;
  let guestEnabled=false, guestSession=null, guestLoading=null, guestContextKey='', contextProvider=()=>({});
  const endpoint=id=>id==='guest'?'/api/agent/guest':'/api/agent/projects/'+encodeURIComponent(id);
  async function prepare(id) {
    if(id!=='guest')return {};
    const context=contextProvider()||{}, candidate=context.task?.id||context.level||'L1';
    const body={platform:context.platform==='pinduoduo'?'pinduoduo':'xiaohongshu',category:String(context.category||'').slice(0,64),level:/^(L[1-6]|first_order)$/.test(candidate)?candidate:'L1'};
    const contextKey=JSON.stringify(body);
    if(guestSession&&contextKey===guestContextKey)return {headers:{'X-CSRF-Token':guestSession.csrf_token}};
    if(guestLoading){await guestLoading;return prepare(id);}
    guestLoading=root.EmcApi.post('/api/agent/guest/session',body).then(data=>{guestSession=data;guestContextKey=contextKey;cache.delete(scope(id));}).finally(()=>{guestLoading=null;});
    await guestLoading;return {headers:{'X-CSRF-Token':guestSession.csrf_token}};
  }
  async function call(id,method,suffix,body,options={}) {
    const guestOptions=await prepare(id);
    try{return method==='get'?await root.EmcApi.get(endpoint(id)+suffix,{...options,...guestOptions}):await root.EmcApi.post(endpoint(id)+suffix,body,{...options,...guestOptions});}
    catch(error){if(error.code==='agent_guest_expired'){guestSession=null;cache.delete(scope(id));}throw error;}
  }
  if(root.document&&root.EmcApi)root.EmcApi.get('/api/agent/capabilities').then(data=>{guestEnabled=Boolean(data.guest_enabled);root.dispatchEvent(new Event('emc-agent-ready'));}).catch(()=>{});
  const normalized = state => ({ ...state, version: 1, server_version: state.version,
    seen: [], source: 'server' });
  function snapshot(id) { return cache.get(scope(id)) || null; }
  async function sync(id, { signal, force = false } = {}) {
    const key = scope(id);
    if (!force && cache.has(key)) return cache.get(key);
    if (loading.has(key)) return loading.get(key);
    const work = call(id,'get','/state',null,{signal}).then(state => {
      const view = normalized(state); cache.set(key, view); return view;
    }).finally(() => loading.delete(key));
    loading.set(key, work); return work;
  }
  async function history(id, { before, signal } = {}) {
    return call(id,'get','/history'+(before?'?before='+before:''),null,{signal});
  }
  async function activity(id, { signal } = {}) {
    const key = scope(id);
    if (busy.has(key)) return snapshot(id);
    if (activities.has(key)) return activities.get(key);
    const stamp = resumed.get(key) || 0, reset = !observed.has(key) || stamp > 0;
    const work = call(id,'post','/activity',{reset_clock:reset},{signal}).then(state => {
      observed.add(key);if(reset&&(resumed.get(key)||0)===stamp)resumed.delete(key);
      // 生成回合期间不让迟到的心跳覆盖最新回复状态。
      const existing = cache.get(key);
      if (!existing || state.version >= existing.server_version) cache.set(key, normalized(state));
      return cache.get(key);
    }).finally(() => activities.delete(key));
    activities.set(key, work); return work;
  }
  function pause(id) { if(id){const key=scope(id);resumed.set(key,(resumed.get(key)||0)+1);} }
  async function transport({ message, context = {} }, { signal } = {}) {
    const id = context.project_id;
    if (!id || (id !== 'guest' && !root.EmcSession?.isLoggedIn())) {
      return { text: root.EmcCopilot.localReply(message, context), source: 'local-guide' };
    }
    const key = scope(id), state = await sync(id, { signal });
    const body = { message, version: state.server_version,
      companion_name: context.companion_name || '小商',
      page_context: { page: context.page_context?.page || 'shop', selected_item: context.page_context?.selected_item || null } };
    // 超时/断网后复用原请求体及幂等键：服务端可能已经成功提交。
    let operation = pending.get(key);
    if (!operation || operation.body.message !== message ||
        operation.body.companion_name !== body.companion_name) {
      operation = { body, id: root.EmcApi.newIdempotencyKey() }; pending.set(key, operation);
    }
    try {
      busy.add(key);
      const result = await call(id,'post','/messages',operation.body,
        { signal, idempotencyKey: operation.id, timeoutMs: 35000 });
      cache.set(key, normalized(result.state)); pending.delete(key);
      return result;
    } catch (error) {
      if (error.code === 'version_conflict') {
        pending.delete(key); await sync(id, { signal, force: true });
      } else if (error.status && error.status < 500) pending.delete(key);
      throw error;
    } finally { busy.delete(key); }
  }
  return {snapshot,sync,history,activity,pause,transport,guestAvailable:()=>guestEnabled,configure:options=>{if(options?.contextProvider)contextProvider=options.contextProvider;}};
});
