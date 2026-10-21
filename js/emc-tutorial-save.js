/* 教学本地存档 V1。无身份、令牌、正式成果或认证字段；只用于教学/模拟。
 * schema_version: 数据格式版本；mode 固定 tutorial。
 * position: 当前关卡与视图；levels: L1—L6 的任务、练习结果、教学完成状态。
 * companion: 模拟亲密度与已领取福利；updated_at: ISO 8601 UTC。
 * 浏览器：window.EmcTutorialSave；Node 测试：require()。不依赖框架或构建。
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EmcTutorialSave = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KEY = 'emc.tutorial.guest';
  const LEVEL_IDS = Object.freeze(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
  const L1_TASK_IDS = Object.freeze(['opportunity', 'positioning', 'first_order_goal']);
  const MAX_BYTES = 65536;
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const bytes = text => new TextEncoder().encode(text).length;
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  function invalid() { throw new Error('invalid_tutorial_save'); }

  function createDefault() {
    return {
      schema_version: 1,
      mode: 'tutorial',
      updated_at: new Date().toISOString(),
      position: { level_id: 'L1', view: 'town' },
      levels: Object.fromEntries(LEVEL_IDS.map(id => [id, {
        completed: false,
        task_checks: id === 'L1' ? Object.fromEntries(L1_TASK_IDS.map(task => [task, false])) : {},
        exercise_result: {}
      }])),
      companion: { mood: 0, perk_claimed: false }
    };
  }

  function checkResult(value, depth) {
    if (depth > 8) invalid();
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (Array.isArray(value)) { value.forEach(item => checkResult(item, depth + 1)); return; }
    if (!isObject(value)) invalid();
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid();
      checkResult(child, depth + 1);
    }
  }

  // 白名单重建数据，忽略未登记的 envelope 字段，绝不读取客户端认证标记。
  function normalize(input) {
    if (!isObject(input) || input.schema_version !== 1 || input.mode !== 'tutorial') invalid();
    if (typeof input.updated_at !== 'string' || !Number.isFinite(Date.parse(input.updated_at))) invalid();
    if (!isObject(input.position) || !LEVEL_IDS.includes(input.position.level_id) ||
        !['town', 'level', 'verify'].includes(input.position.view)) invalid();
    if (!isObject(input.levels) || !isObject(input.companion)) invalid();
    if (!Number.isInteger(input.companion.mood) || input.companion.mood < -2 || input.companion.mood > 6 ||
        typeof input.companion.perk_claimed !== 'boolean') invalid();
    const output = createDefault();
    output.updated_at = new Date(input.updated_at).toISOString();
    output.position = { level_id: input.position.level_id, view: input.position.view };
    output.companion = { mood: input.companion.mood, perk_claimed: input.companion.perk_claimed };
    for (const id of LEVEL_IDS) {
      const level = input.levels[id];
      if (!isObject(level) || typeof level.completed !== 'boolean' || !isObject(level.task_checks) ||
          !isObject(level.exercise_result) || Object.keys(level.task_checks).length > 100) invalid();
      const checks = Object.entries(level.task_checks);
      if (checks.some(([key, value]) => !/^[a-z][a-z0-9_]{0,63}$/.test(key) ||
          ['constructor', 'prototype'].includes(key) || typeof value !== 'boolean')) invalid();
      if (id === 'L1' && L1_TASK_IDS.some(task => !own(level.task_checks, task))) invalid();
      if (id === 'L1' && level.completed && !L1_TASK_IDS.every(task => level.task_checks[task])) invalid();
      checkResult(level.exercise_result, 0);
      output.levels[id] = {
        completed: level.completed,
        task_checks: Object.fromEntries(checks),
        exercise_result: JSON.parse(JSON.stringify(level.exercise_result))
      };
    }
    if (bytes(JSON.stringify(output)) > MAX_BYTES) invalid();
    return output;
  }

  function decode(raw) {
    if (raw === null) return { status: 'empty' };
    try {
      if (bytes(raw) > MAX_BYTES) return { status: 'corrupt' };
      const parsed = JSON.parse(raw);
      if (isObject(parsed) && Number.isInteger(parsed.schema_version) && parsed.schema_version > 1) {
        return { status: 'unsupported' };
      }
      return { status: 'restored', data: normalize(parsed) };
    } catch (_) { return { status: 'corrupt' }; }
  }

  function createStore(getStorage) {
    function load() {
      try {
        const storage = getStorage();
        const primary = decode(storage.getItem(KEY));
        if (primary.status === 'restored') return primary;
        if (primary.status === 'unsupported') return { status: 'unsupported', data: createDefault() };
        const backup = decode(storage.getItem(KEY + '.backup'));
        if (backup.status === 'restored') return { status: 'recovered', data: backup.data };
        return { status: primary.status, data: createDefault() };
      } catch (_) { return { status: 'unavailable', data: createDefault() }; }
    }

    function save(input) {
      let data;
      try { data = normalize(input); } catch (_) { return { status: 'invalid' }; }
      data.updated_at = new Date().toISOString();
      try {
        const storage = getStorage();
        const raw = storage.getItem(KEY);
        const previous = decode(raw);
        if (previous.status === 'unsupported') return { status: 'unsupported' };
        if (previous.status === 'corrupt') {
          // 先保留原始损坏数据；备份失败时不覆盖主存档。
          const recovery = storage.getItem(KEY + '.recovery');
          if (recovery !== null && recovery !== raw) return { status: 'recovery_full' };
          storage.setItem(KEY + '.recovery', raw);
        }
        if (previous.status === 'restored') storage.setItem(KEY + '.backup', raw);
        storage.setItem(KEY, JSON.stringify(data));
        return { status: 'saved', data };
      } catch (_) { return { status: 'unavailable' }; }
    }
    return Object.freeze({ load, save });
  }
  return Object.freeze({ KEY, LEVEL_IDS, L1_TASK_IDS, MAX_BYTES, createDefault, normalize, decode, createStore });
});
