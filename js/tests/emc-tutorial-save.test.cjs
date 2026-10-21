'use strict';
// 运行：node --test js/tests/emc-tutorial-save.test.cjs（无需安装依赖）。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Save = require('../emc-tutorial-save.js');

function memoryStorage() {
  const items = new Map();
  return {
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => items.set(key, String(value)),
    removeItem: key => items.delete(key)
  };
}
function fixture() {
  const storage = memoryStorage();
  return { storage, store: Save.createStore(() => storage) };
}

test('新存档含六关独立进度，且只有教学数据', () => {
  const { store } = fixture();
  const result = store.load();
  assert.equal(result.status, 'empty');
  assert.deepEqual(Object.keys(result.data.levels), Save.LEVEL_IDS);
  assert.equal(result.data.mode, 'tutorial');
  result.data.levels.L1.task_checks.opportunity = true;
  assert.deepEqual(result.data.levels.L2.task_checks, {});
  assert.equal(Save.createDefault().levels.L1.task_checks.opportunity, false);
});

test('重新创建存储实例后，任务、视图、练习结果和模拟奖励均可恢复', () => {
  const { storage, store } = fixture();
  const data = Save.createDefault();
  data.position.view = 'level';
  data.levels.L1.task_checks.opportunity = true;
  data.levels.L2.exercise_result = { choices: ['product-a'], score: 2 };
  data.companion = { mood: 4, perk_claimed: true };
  assert.equal(store.save(data).status, 'saved');
  const loaded = Save.createStore(() => storage).load().data;
  assert.equal(loaded.position.view, 'level');
  assert.equal(loaded.levels.L1.task_checks.opportunity, true);
  assert.deepEqual(loaded.levels.L2.exercise_result, { choices: ['product-a'], score: 2 });
  assert.deepEqual(loaded.companion, data.companion);
});

test('只接受布尔任务，不把字符串 false 当成完成', () => {
  const { storage, store } = fixture();
  const data = Save.createDefault();
  data.levels.L1.task_checks.opportunity = 'false';
  assert.equal(store.save(data).status, 'invalid');
  assert.equal(storage.getItem(Save.KEY), null);
});

test('白名单过滤客户端身份、认证和未知关卡字段', () => {
  const data = Save.createDefault();
  data.verified = true;
  data.roles = ['reviewer'];
  data.token = 'not-a-real-token';
  data.levels.L1.approved = true;
  data.levels.L7 = { approved: true };
  const normalized = Save.normalize(data);
  assert.equal(normalized.verified, undefined);
  assert.equal(normalized.roles, undefined);
  assert.equal(normalized.token, undefined);
  assert.equal(normalized.levels.L1.approved, undefined);
  assert.equal(normalized.levels.L7, undefined);
});

test('错误关卡、正式模式、非法亲密度、缺失关卡不能进入教学存档', () => {
  for (const mutate of [
    data => { data.position.level_id = 'L7'; },
    data => { data.mode = 'formal'; },
    data => { data.companion.mood = 100; },
    data => { delete data.levels.L3; },
    data => { data.updated_at = 'yesterday'; },
    data => { data.levels.L1.completed = true; }
  ]) {
    const data = Save.createDefault();
    mutate(data);
    assert.throws(() => Save.normalize(data));
  }
});

test('完整勾选后可保存教学完成，但仍没有正式认证字段', () => {
  const { store } = fixture();
  const data = Save.createDefault();
  Save.L1_TASK_IDS.forEach(id => { data.levels.L1.task_checks[id] = true; });
  data.levels.L1.completed = true;
  assert.equal(store.save(data).status, 'saved');
  assert.equal(store.load().data.levels.L1.completed, true);
  assert.equal(store.load().data.verified, undefined);
});

test('损坏主存档从最近一次有效备份恢复，读取不覆盖原文', () => {
  const { store, storage } = fixture();
  const data = Save.createDefault();
  data.position.view = 'level';
  store.save(data);
  data.levels.L1.task_checks.opportunity = true;
  store.save(data);
  storage.setItem(Save.KEY, '{broken');
  const recovered = store.load();
  assert.equal(recovered.status, 'recovered');
  assert.equal(recovered.data.position.view, 'level');
  assert.equal(storage.getItem(Save.KEY), '{broken');
  assert.equal(store.save(recovered.data).status, 'saved');
  assert.equal(storage.getItem(Save.KEY + '.recovery'), '{broken');
});

test('无有效备份时保留损坏数据，再写入新教学进度', () => {
  const { store, storage } = fixture();
  storage.setItem(Save.KEY, 'not-json');
  assert.equal(store.load().status, 'corrupt');
  assert.equal(store.save(Save.createDefault()).status, 'saved');
  assert.equal(storage.getItem(Save.KEY + '.recovery'), 'not-json');
  assert.equal(store.load().status, 'restored');
});

test('恢复槽已存在不同损坏数据时停止保存，避免丢掉任意原始副本', () => {
  const { store, storage } = fixture();
  storage.setItem(Save.KEY, 'broken-again');
  storage.setItem(Save.KEY + '.recovery', 'previous-broken');
  assert.equal(store.save(Save.createDefault()).status, 'recovery_full');
  assert.equal(storage.getItem(Save.KEY), 'broken-again');
  assert.equal(storage.getItem(Save.KEY + '.recovery'), 'previous-broken');
});

test('未来版本不能降级覆盖，即使备份可读', () => {
  const { store, storage } = fixture();
  store.save(Save.createDefault());
  storage.setItem(Save.KEY + '.backup', storage.getItem(Save.KEY));
  const future = JSON.stringify({ schema_version: 2, mode: 'tutorial', extra: 'keep' });
  storage.setItem(Save.KEY, future);
  assert.equal(store.load().status, 'unsupported');
  assert.equal(store.save(Save.createDefault()).status, 'unsupported');
  assert.equal(storage.getItem(Save.KEY), future);
});

test('localStorage getter 被浏览器禁用时不崩溃', () => {
  const store = Save.createStore(() => { throw new Error('SecurityError'); });
  assert.equal(store.load().status, 'unavailable');
  assert.equal(store.save(Save.createDefault()).status, 'unavailable');
});

test('写入超额不覆盖旧主存档，释放容量后可重试成功', () => {
  const { store, storage } = fixture();
  const data = Save.createDefault();
  store.save(data);
  const before = storage.getItem(Save.KEY);
  const write = storage.setItem;
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  data.levels.L1.task_checks.positioning = true;
  assert.equal(store.save(data).status, 'unavailable');
  assert.equal(storage.getItem(Save.KEY), before);
  storage.setItem = write;
  assert.equal(store.save(data).status, 'saved');
  assert.equal(store.load().data.levels.L1.task_checks.positioning, true);
});

test('主存档写入失败后仍有上一份有效主存档和备份', () => {
  const { store, storage } = fixture();
  const data = Save.createDefault();
  store.save(data);
  const before = storage.getItem(Save.KEY);
  const write = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === Save.KEY) throw new Error('write failed');
    write(key, value);
  };
  assert.equal(store.save(data).status, 'unavailable');
  assert.equal(storage.getItem(Save.KEY), before);
  assert.equal(storage.getItem(Save.KEY + '.backup'), before);
});

test('深度或 UTF-8 容量超限、危险对象键不能写入', () => {
  const data = Save.createDefault();
  data.levels.L1.exercise_result = { text: '中'.repeat(Save.MAX_BYTES / 2) };
  assert.throws(() => Save.normalize(data));
  data.levels.L1.exercise_result = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => Save.normalize(data));
  let nested = {};
  for (let i = 0; i < 10; i++) nested = { child: nested };
  data.levels.L1.exercise_result = nested;
  assert.throws(() => Save.normalize(data));
  assert.equal({}.polluted, undefined);
});

test('读取和白名单标准化不会修改传入数据', () => {
  const data = Save.createDefault();
  data.levels.L2.exercise_result = { values: [1] };
  const normalized = Save.normalize(data);
  normalized.levels.L2.exercise_result.values.push(2);
  assert.deepEqual(data.levels.L2.exercise_result.values, [1]);
});
