import assert from 'node:assert';
import { rmSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { GlmClient } from '../src/glm.ts';
import {
  MemoryStore,
  parseExtracted,
  similarity,
  extractMemories,
} from '../src/memory.ts';

const testDir = 'data/memory-test';
rmSync(testDir, { recursive: true, force: true });

// ── 相似度 ──
assert.ok(similarity('用户喜欢吃橡木蛋糕卷', '用户喜欢吃橡木蛋糕卷') === 1);
assert.ok(similarity('用户喜欢橡木蛋糕卷', '用户讨厌下雨天') < 0.4);
assert.ok(similarity('user likes cake', 'likes cake') > 0.5);

// ── 存储：新增 / 去重 / 检索 / 删除 / 淘汰 / 重启恢复 ──
const store = new MemoryStore({ dir: testDir, maxPerUser: 3 });
assert.equal(store.add('user', 1001, '用户名叫小明'), true);
assert.equal(store.add('user', 1001, '用户名叫小明（重复）'), false); // 高相似去重
assert.equal(store.add('user', 1001, '用户喜欢吃橡木蛋糕卷'), true);
assert.equal(store.add('user', 1001, '用户下周三要考试'), true);
assert.equal(store.add('user', 1001, '用户养了一只猫'), true); // 超容量，淘汰命中最少且最旧的
assert.equal(store.add('group', 809, '群里约好周末开黑'), true);
assert.equal(store.add('user', 2002, '另一个用户的记忆'), true); // 不同用户互不影响

const hits = store.search('蛋糕卷 好吃', { userRef: 1001, groupRef: null }, 8);
assert.ok(hits.some((m) => m.content.includes('蛋糕卷')), '应检索到蛋糕卷记忆');
assert.ok(hits.every((m) => m.ref === 1001 || m.ref === 809 || m.ref !== 2002), '不该检索到别人');
const user1001 = store.list({ userRef: 1001, groupRef: null }, 50);
assert.ok(user1001.length <= 3, '容量上限生效');

const removed = store.removeMatching('蛋糕卷', { userRef: 1001, groupRef: null });
assert.equal(removed, 1);
assert.equal(store.removeMatching('不存在的内容', { userRef: 1001, groupRef: null }), 0);

// 重新实例化模拟重启，验证持久化
const reloaded = new MemoryStore({ dir: testDir, maxPerUser: 3 });
assert.ok(
  reloaded.list({ userRef: 1001, groupRef: null }, 50).length === user1001.length - removed,
  '重启后记忆保留',
);
console.log('存储层测试全部通过 ✓');

// ── 提取输出解析（宽容模式）──
const refs = { userRef: 1001, groupRef: 809 };
assert.deepEqual(parseExtracted('[]', refs), []);
assert.deepEqual(parseExtracted('```json\n[{"scope":"user","content":"用户名叫小明"}]\n```', refs), [
  { scope: 'user', content: '用户名叫小明' },
]);
assert.deepEqual(parseExtracted('前置废话 [{"scope":"group","content":"群里周末开黑"}] 后置废话', refs), [
  { scope: 'group', content: '群里周末开黑' },
]);
assert.deepEqual(parseExtracted('完全不是 JSON', refs), []);
console.log('解析测试全部通过 ✓');

// ── 真实 GLM 提取 ──
const config = loadConfig();
const glm = new GlmClient(config.glm);
const extracted = await extractMemories(
  glm,
  [
    { user: '我叫小萤，最喜欢吃橡木蛋糕卷了', assistant: '嘿嘿，橡木蛋糕卷确实很好吃呢' },
    { user: '对了，我下周三有钢琴考级，好紧张', assistant: '我会为你加油的…一定没问题的' },
    { user: '今天天气哈哈哈', assistant: '哈哈，是呀' },
  ],
  refs,
);
console.log('真实提取结果:', JSON.stringify(extracted, null, 2));
assert.ok(Array.isArray(extracted));
assert.ok(extracted.some((m) => m.content.includes('橡木蛋糕卷') || m.content.includes('钢琴')), '应提取出关键事实');

rmSync(testDir, { recursive: true, force: true });
console.log('全部测试通过 ✓（测试目录已清理）');
