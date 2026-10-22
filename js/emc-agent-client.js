/* Bridge the six-level island companion to the production #62 FastAPI Agent.
 * No second agent backend, schema, migration, or client-supplied system prompt.
 * The production service saves registered-player conversation in AuditEvent,
 * while guest chat is read-only and local companion practice stays on-device.
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {
    root.EmcAgentClient = api;
    root.EmcCopilotTransport = api.transport;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';
  const cache = new Map(), loading = new Map();
  const identity = () => root.EmcSession?.current()?.player?.id || 'guest';
  const loggedIn = () => Boolean(root.EmcSession?.isLoggedIn() && identity() !== 'guest');
  const keyFor = id => identity() + ':' + String(id || 'guest');
  const clamp = v => Math.max(0, Math.min(100, Number(v) || 0));
  function snapshot(id) { return cache.get(keyFor(id)) || null; }
  function view(memory) {
    const score = clamp(memory?.intimacy_score ?? 20);
    return {
      version: 1, source: 'server', server_version: Number(memory?.interactions_count || 0),
      affinity: score, patience: 80, streak: 0, perks: [],
      level: memory?.current_focus_level || 'L1', emotion: null
    };
  }
  async function sync(id, { signal, force = false } = {}) {
    const key = keyFor(id);
    if (!loggedIn()) return snapshot(id);
    if (!force && cache.has(key)) return cache.get(key);
    if (loading.has(key)) return loading.get(key);
    const work = root.EmcApi.get('/api/agent/memory', { signal }).then(result => {
      if (key === keyFor(id)) cache.set(key, view(result.memory));
      return cache.get(key) || null;
    }).finally(() => loading.delete(key));
    loading.set(key, work);
    return work;
  }
  async function history(id, { signal } = {}) {
    if (!loggedIn()) return { items: [], next_before: null };
    const requester = keyFor(id);
    const data = await root.EmcApi.get('/api/agent/memory', { signal });
    if (requester !== keyFor(id)) return { items: [], next_before: null };
    cache.set(requester, view(data.memory));
    const rows = (data.recent_conversation || []).filter(turn => turn.session_id === id);
    return {
      items: rows.map(turn => ({
        message: turn.user_message || '',
        reply: { text: turn.reply || '', source: 'local-guide' },
        time: turn.occurred_at
      })),
      next_before: null
    };
  }
  async function activity(id, { signal } = {}) {
    // #62 does not implement activity/decay; never fabricate a server heartbeat.
    return snapshot(id) || sync(id, { signal });
  }
  function pause() { /* no server activity clock */ }
  async function transport({ message, context = {} }, { signal } = {}) {
    if (typeof message !== 'string' || !message.trim()) throw new Error('请输入聊天内容');
    const project = typeof context.project_id === 'string' ? context.project_id : null;
    const level = String(context.task?.id || context.level || 'L1');
    const levelId = /^L[1-6]$/.test(level) ? level : 'L1';
    const session = loggedIn() && project && project.length <= 64 ? project : 'island-guest';
    const body = {
      message: message.trim().slice(0, 2000),
      level_id: levelId,
      session_id: session,
      client_context: {
        current_view: String(context.page_context?.page || 'shop').slice(0, 32),
        source: 'island-companion',
        companion_name: String(context.companion_name || '小商').slice(0, 24),
        platform: String(context.platform || '').slice(0, 32),
        category: String(context.category || '').slice(0, 64),
        active_project: project && loggedIn() ? {
          id: project,
          platform: String(context.platform || '').slice(0, 32),
          category: String(context.category || '').slice(0, 64)
        } : null
      }
    };
    const requester = keyFor(project);
    const result = await root.EmcApi.post('/api/agent/chat', body, { signal, timeoutMs: 35000 });
    if (!result || typeof result.reply !== 'string' || !result.reply.trim()) throw new Error('Agent 没有返回可显示的内容');
    if (requester !== keyFor(project)) throw new Error('账号或经营项目已切换');
    const old = cache.get(requester);
    if (old) cache.set(requester, { ...old, affinity: Math.min(100, old.affinity + 3), server_version: old.server_version + 1 });
    return {
      text: result.reply,
      source: result.provider === 'ai_gateway_live' ? 'ai' : 'local-guide',
      provider: result.provider || 'unknown',
      // The server does not have a project-level patience/perks model.
      // Leave result.state absent so UI keeps the local practice state.
    };
  }
  return {
    snapshot, sync, history, activity, pause, transport,
    // Guest chat works via /api/agent/chat, but there is no persistent guest
    // project state; the UI should keep local chat history for guests.
    guestAvailable: () => false,
    configure: () => {}
  };
});
