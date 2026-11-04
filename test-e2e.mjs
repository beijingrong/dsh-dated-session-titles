import assert from 'node:assert/strict';
import { apply } from './index.mjs';

let appended = [];
let registered;
const ctx = {
	sessionTitle: {
		register(provider) {
			registered = provider;
			return () => {};
		},
		get: () => undefined,
	},
	sessions: { list: () => [] },
	tools: { register: () => () => {} },
	logger: { warn() {} },
	llm: {
		async prepareCall(route, signal, mapControls) {
			const controls = mapControls({}, { reasoning: { efforts: [{ id: 'low' }] } });
			return {
				config: { provider: route.provider, model: route.model, maxTokens: 4096, ...controls },
				async *stream() {
					yield { type: 'text-delta', index: 0, text: '排查：登录页报错' };
					yield { type: 'finish', reason: { kind: 'stop' } };
				},
			};
		},
	},
};

apply(ctx, {});
assert.equal(registered.automatic, 'first-prompt');
assert.equal(registered.id, 'session-title-dated');

const firstMessageTime = new Date(2026, 10, 2, 23, 13, 56).getTime();
const session = {
	id: 'session-test',
	append(type, data) {
		appended.push({ type, data });
	},
	snapshotEvents() {
		return [{ seq: 7, type: 'user/message', time: firstMessageTime, data: { source: { kind: 'user' } } }];
	},
};

const result = await registered.generate({
	messages: [{ seq: 7, text: '帮我修一下登录页的 bug' }],
	route: { provider: 'fake', model: 'fake-model' },
	session,
	signal: new AbortController().signal,
});

assert.equal(result.title, '2026-11-02 排查：登录页报错');
assert.deepEqual(result.messageSeqs, [7]);
assert.equal(result.model.provider, 'fake');
assert.equal(appended.some((event) => event.type === 'session/title-llm-request'), true);
console.log('e2e pipeline passed:', result.title);
