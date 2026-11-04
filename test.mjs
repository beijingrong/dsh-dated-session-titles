import assert from 'node:assert/strict';
import {
	composeBody,
	composeTitle,
	fitBytes,
	firstLineOf,
	isWellFormedTitle,
	localIsoDate,
	resolveConfig,
	sessionDateText,
	systemPrompt,
	Config,
} from './index.mjs';

const date = '2026-11-04';

assert.equal(composeTitle('开发：修复登录问题', date), '2026-11-04 开发：修复登录问题');
assert.equal(composeTitle('修复登录问题', date), '2026-11-04 其他：修复登录问题');
assert.equal(composeTitle('**设置：改标题格式**', date), '2026-11-04 设置：改标题格式');
assert.equal(composeTitle('"闲聊：你好"', date), '2026-11-04 闲聊：你好');
assert.equal(composeTitle('2026-11-04 开发：x', date), '2026-11-04 开发：x');
assert.equal(composeTitle('其他：闲聊：打招呼寒暄', date), '2026-11-04 闲聊：打招呼寒暄');
assert.equal(composeTitle('开发：修复：登录问题', date), '2026-11-04 开发：修复·登录问题');
assert.equal(composeTitle('闲聊:打招呼', date), '2026-11-04 闲聊：打招呼');
assert.equal(composeTitle('前端：登录页', date), '2026-11-04 前端：登录页');
assert.equal(composeTitle('   ', date), '2026-11-04 其他：新会话');
assert.equal(composeTitle('开发：修复', date, false), '开发：修复');
assert.equal(composeBody('数据：统计口径'), '数据：统计口径');
assert.equal(localIsoDate(new Date(2026, 10, 4)), '2026-11-04');

const resolved = resolveConfig({});
assert.equal(resolved.datePrefix, true);
assert.equal(resolved.backfill, true);
assert.equal(resolved.execution.maxInputBytes, 4096);
assert.throws(() => resolveConfig({ provider: 'x' }), /provider and model/);
assert.throws(() => resolveConfig({ timeoutMs: 0 }), /positive integer/);

const schema = Config({});
assert.equal(schema.datePrefix, true);
assert.equal(schema.backfill, true);

const prompt = systemPrompt(resolved);
assert.match(prompt, /no fixed list/);
assert.match(prompt, /开发、排查/);

assert.equal(isWellFormedTitle('2026-11-02 闲聊：问候'), true);
assert.equal(isWellFormedTitle('问候'), false);
assert.equal(isWellFormedTitle('2026-11-02 闲聊问候'), false);
assert.equal(isWellFormedTitle('2026-11-02 其他：闲聊：打招呼'), false);

const sessionWithTitle = {
	snapshotEvents: () => [{ seq: 1, type: 'user/message', time: new Date(2026, 10, 2).getTime(), data: { source: { kind: 'user' } } }],
};
assert.equal(
	sessionDateText({ sessionTitle: { get: () => ({ title: '2026-09-09 开发：x' }) } }, sessionWithTitle),
	'2026-09-09',
);
assert.equal(
	sessionDateText({ sessionTitle: { get: () => undefined } }, sessionWithTitle),
	'2026-11-02',
);

assert.equal(firstLineOf({ finish: { kind: 'stop' }, blocks: [{ type: 'text', text: '开发：x\n多余' }] }), '开发：x');
assert.throws(() => firstLineOf({ finish: { kind: 'tool-calls' }, blocks: [] }), /text only/);
assert.throws(() => firstLineOf({ finish: { kind: 'max-tokens' }, blocks: [] }), /maxOutputTokens/);
assert.throws(() => firstLineOf({ finish: { kind: 'stop' }, blocks: [] }), /no text/);

const long = '2026-11-04 ' + '开'.repeat(100);
assert.ok(Buffer.byteLength(fitBytes(long)) <= 80);

console.log('all tests passed');
