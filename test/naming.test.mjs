import assert from 'node:assert/strict';
import {
  normalizeCategory,
  normalizeDescription,
  parseTitle,
  resolveConfig,
  selectMessages,
  sessionDate,
  systemPrompt,
  titleToolDefinition,
  userInput,
} from '../index.js';

const config = resolveConfig({});

// --- defaults -------------------------------------------------------------
assert.equal(config.automatic, 'all-prompts');
assert.equal(config.datePrefix, true);
assert.equal(config.targetCjkCharacters, 8);
assert.equal(config.maxCjkCharacters, 10);
assert.deepEqual(config.categories, []);

// --- date prefix ----------------------------------------------------------
assert.equal(sessionDate(Date.parse('2026-11-10T17:53:27+08:00'), 'Asia/Shanghai'), '2026-11-10');
assert.equal(sessionDate(Date.parse('2026-11-10T23:30:00+08:00'), 'UTC'), '2026-11-10');
assert.match(sessionDate(Date.parse('2026-11-10T17:53:27+08:00'), 'Not/AZone'), /^\d{4}-\d{2}-\d{2}$/);

// --- model output parsing -------------------------------------------------
assert.deepEqual(parseTitle('{"category":"偏好","description":"称呼约定"}', config), {
  category: '偏好',
  description: '称呼约定',
});
assert.deepEqual(parseTitle('```json\n{"category":"开发","description":"插件热更新。"}\n```', config), {
  category: '开发',
  description: '插件热更新',
});
assert.deepEqual(parseTitle('2026-11-10 【开发】：插件热更新排查', config), {
  category: '开发',
  description: '插件热更新排查',
});
assert.deepEqual(parseTitle('打招呼', config), { category: '其他', description: '打招呼' });
assert.equal(parseTitle('{"category":"","description":"小着 & meio 品牌视觉"}', config).category, '其他');

// --- length limits --------------------------------------------------------
assert.equal(normalizeDescription('海水咸度成因解释', config), '海水咸度成因解释');
assert.equal(Array.from(normalizeDescription('称呼约定与自动会话命名插件', config)).length, 10);
assert.equal(normalizeCategory('财务', config), '财务');
assert.equal(normalizeCategory('【命名】', config), '命名');
assert.equal(normalizeCategory('会话命名工具类', config), '其他');
assert.match(systemPrompt(config), /4-8 个字最理想，最多 10 个汉字/);

// --- message selection ----------------------------------------------------
const messages = Array.from({ length: 12 }, (_, index) => ({ seq: index + 1, text: `第${index + 1}条消息` }));
const selected = selectMessages(messages, resolveConfig({ maxMessages: 4 }));
assert.deepEqual(selected.map((item) => item.seq), [1, 10, 11, 12]);
const huge = Array.from({ length: 40 }, (_, index) => ({ seq: index + 1, text: '很长的消息'.repeat(400) }));
const tight = selectMessages(huge, resolveConfig({ maxMessages: 12, maxInputBytes: 2048 }));
assert.ok(new TextEncoder().encode(userInput(config, '2026-11-10', tight)).length <= 2048);

// --- configuration overrides ---------------------------------------------
assert.equal(resolveConfig({ datePrefix: false }).datePrefix, false);
assert.equal(resolveConfig({ targetCjkCharacters: 6 }).maxCjkCharacters, 8);
assert.equal(resolveConfig({ automatic: 'first-prompt' }).automatic, 'first-prompt');
assert.deepEqual(resolveConfig({ categories: ['财务', '学习'] }).categories, ['财务', '学习']);
assert.throws(() => resolveConfig({ provider: 'x' }), /provider and model must be supplied together/);

// --- tool definition ------------------------------------------------------
const renamed = [];
const fakeCtx = {
  sessionTitle: {
    rename: (_session, title) => {
      renamed.push(title);
      return { title };
    },
    refresh: async () => undefined,
    get: () => undefined,
  },
};
const tool = titleToolDefinition(fakeCtx, config);
assert.equal(tool.name, 'set_session_title');
assert.equal(typeof tool.execute, 'function');
assert.deepEqual(Object.keys(tool.parameters.properties), ['title', 'category', 'description']);
assert.equal(tool.output.schema.required[0], 'title');
assert.match(tool.description, /日期前缀会自动补上/);

// title-only rename keeps an explicit date, otherwise prepends the session date
const fakeExec = { agent: { session: { header: { createdAt: Date.parse('2026-11-10T09:00:00+08:00') } } } };
await tool.execute({ title: '设置：改会话标题' }, fakeExec);
await tool.execute({ title: '2026-10-01 旧日期：保留' }, fakeExec);
await tool.execute({ category: '排查', description: '登录页报错。' }, fakeExec);
assert.deepEqual(renamed, [
  '2026-11-10 设置：改会话标题',
  '2026-10-01 旧日期：保留',
  '2026-11-10 排查：登录页报错',
]);

console.log('naming.test.mjs: all assertions passed');
