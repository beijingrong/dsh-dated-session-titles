import assert from 'node:assert/strict';
import { apply, TOOL_NAME } from './index.mjs';

let tool;
let currentTitle = { title: '2026-11-02 闲聊：问候', source: { kind: 'provider' } };
const renames = [];
const refreshes = [];

const session = {
	id: 'session-test',
	snapshotEvents: () => [
		{ seq: 8, type: 'user/message', time: new Date(2026, 10, 2, 23, 13, 56).getTime(), data: { source: { kind: 'user' } } },
	],
};

const ctx = {
	sessionTitle: {
		register: () => () => {},
		get: () => currentTitle,
		rename(s, title) {
			renames.push([s.id, title]);
			return { title };
		},
		refresh(s) {
			refreshes.push(s.id);
			return Promise.resolve({ title: '2026-11-02 闲聊：重新生成' });
		},
	},
	sessions: { list: () => [] },
	tools: {
		register(definition) {
			tool = definition;
			return () => {};
		},
	},
	logger: { warn() {} },
};

apply(ctx, {});
assert.equal(tool.name, TOOL_NAME);
assert.equal(typeof tool.execute, 'function');
assert.equal(typeof tool.output.render, 'function');

const exec = { agent: { session } };

const full = await tool.execute({ title: '设置：改会话标题' }, exec);
assert.deepEqual(renames.at(-1), ['session-test', '2026-11-02 设置：改会话标题']);
assert.equal(full.title, '2026-11-02 设置：改会话标题');

await tool.execute({ title: '2026-11-05 开发：接口联调' }, exec);
assert.deepEqual(renames.at(-1), ['session-test', '2026-11-05 开发：接口联调']);

await tool.execute({ category: '排查', description: '登录问题' }, exec);
assert.deepEqual(renames.at(-1), ['session-test', '2026-11-02 排查：登录问题']);

await tool.execute({ description: '随手聊聊' }, exec);
assert.deepEqual(renames.at(-1), ['session-test', '2026-11-02 其他：随手聊聊']);

const regenerated = await tool.execute({}, exec);
assert.deepEqual(refreshes, ['session-test']);
assert.equal(regenerated.title, '2026-11-02 闲聊：重新生成');

// Date falls back to the first user message when the current title has no date.
currentTitle = { title: '问候', source: { kind: 'provider' } };
await tool.execute({ title: '闲聊：打招呼' }, exec);
assert.deepEqual(renames.at(-1), ['session-test', '2026-11-02 闲聊：打招呼']);

await assert.rejects(() => tool.execute({ title: 'x' }, {}), /owning agent session/);
console.log('tool tests passed');
