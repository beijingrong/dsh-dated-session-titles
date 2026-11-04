import assert from 'node:assert/strict';
import { apply } from './index.mjs';

const calls = [];
const sessions = [
	{ id: 'dated', title: { title: '2026-11-04 开发：x', source: { kind: 'provider' } } },
	{ id: 'malformed', title: { title: '2026-11-02 其他：闲聊：打招呼', source: { kind: 'provider' } } },
	{ id: 'old', title: { title: '问候', source: { kind: 'provider' } } },
	{ id: 'pinned', title: { title: '客户项目 A', source: { kind: 'user' } } },
	{ id: 'empty', title: undefined },
];
const ctx = {
	sessionTitle: {
		register() {},
		get: (session) => session.title,
		refresh(session) {
			calls.push(session.id);
			return Promise.resolve();
		},
	},
	sessions: { list: () => sessions },
	tools: { register: () => () => {} },
	logger: { warn() {} },
};

apply(ctx, {});
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(calls, ['malformed', 'old']);

calls.length = 0;
apply(ctx, { backfill: false });
await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(calls, []);
console.log('backfill tests passed');
