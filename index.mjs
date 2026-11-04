/**
 * Dated session titles: `YYYY-MM-DD 分类：简短描述`.
 *
 * A session-title provider for @deepseek-ai/dsh-session-title. It replaces the
 * shipped first-prompt provider: the title model returns one `分类：描述` line
 * with a short category it chooses freely (no fixed list), and the plugin
 * prefixes the date of the session's first user message.
 *
 * The same plugin registers the global `set_session_title` tool so the agent
 * can retitle the current session at any time, on request. Activation also
 * backfills live sessions whose title is not in the dated format yet.
 */
import z from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { SessionTitleProviderId } from '@deepseek-ai/dsh-session-title';
import {
	executeSessionTitleLlm,
	resolveSessionTitleLlmConfig,
} from '@deepseek-ai/dsh-session-title-llm';

export const name = 'session-title-dated';

export const inject = ['sessionTitle', 'llm', 'sessions', 'tools'];

/** Category used only when model output cannot be split into `分类：描述`. */
export const FALLBACK_CATEGORY = '其他';

/** Full-width colon between category and description. */
export const COLON = '\uFF1A';

/** Tool name exposed to the agent. */
export const TOOL_NAME = 'set_session_title';

const MAX_CATEGORY_CHARS = 8;

export const Config = z.object({
	targetWords: z.number().step(1).min(1).default(5),
	targetCjkCharacters: z.number().step(1).min(1).default(10),
	maxInputBytes: z.number().step(1).min(1).default(4096),
	maxOutputTokens: z.number().step(1).min(1).default(4096),
	timeoutMs: z.number().step(1).min(1).default(60000),
	datePrefix: z.boolean().default(true),
	backfill: z.boolean().default(true),
});

const LEADING_DATE = /^\d{4}-\d{2}-\d{2}\s+/u;
const DATE_PREFIX = /^\d{4}-\d{2}-\d{2}/u;
const LABELED_LINE = /^([^：:]{1,12})[：:]\s*(.+)$/u;
const WRAPPED = /^(?:\*{1,3}|_{1,3}|["'`“‘])(.+?)(?:\*{1,3}|_{1,3}|["'`”’])$/u;

/** Validate one positive integer or apply a default. */
function positiveInteger(value, fallback, field) {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value <= 0) {
		throw new Error(`session-title-dated: ${field} must be a positive integer`);
	}
	return value;
}

/** Validate and normalize the loader configuration. */
export function resolveConfig(raw) {
	const config = raw !== null && typeof raw === 'object' ? raw : {};
	const hasProvider = config.provider !== undefined;
	const hasModel = config.model !== undefined;
	if (hasProvider !== hasModel) {
		throw new Error('session-title-dated: provider and model must be supplied together');
	}
	const execution = resolveSessionTitleLlmConfig({
		maxInputBytes: positiveInteger(config.maxInputBytes, 4096, 'maxInputBytes'),
		maxOutputTokens: positiveInteger(config.maxOutputTokens, 4096, 'maxOutputTokens'),
		timeoutMs: positiveInteger(config.timeoutMs, 60000, 'timeoutMs'),
		...(hasProvider ? { provider: config.provider, model: config.model } : {}),
	});
	return {
		execution,
		targetWords: positiveInteger(config.targetWords, 5, 'targetWords'),
		targetCjkCharacters: positiveInteger(config.targetCjkCharacters, 10, 'targetCjkCharacters'),
		datePrefix: config.datePrefix !== false,
		backfill: config.backfill !== false,
	};
}

/** Local calendar date as `YYYY-MM-DD` (host time zone). */
export function localIsoDate(now = new Date()) {
	const year = now.getFullYear();
	const month = String(now.getMonth() + 1).padStart(2, '0');
	const day = String(now.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

/** First human text message event of a session, when available. */
function firstUserMessageEvent(session) {
	try {
		return session.snapshotEvents().find(
			(event) => event.type === 'user/message' && event.data?.source?.kind === 'user',
		);
	} catch {
		return undefined;
	}
}

/**
 * Date used for the title prefix: the current title's date when it has one,
 * else the session's first user message, else the session's first event.
 * @param ctx context exposing sessionTitle.
 * @param session live session.
 * @returns `YYYY-MM-DD` in the host time zone.
 */
export function sessionDateText(ctx, session) {
	try {
		const current = ctx.sessionTitle.get(session);
		const match = current === undefined ? null : DATE_PREFIX.exec(current.title);
		if (match !== null) return match[0];
	} catch {
		// fall through to the session's own timestamps
	}
	const first = firstUserMessageEvent(session);
	if (typeof first?.time === 'number') return localIsoDate(new Date(first.time));
	try {
		const event = session.snapshotEvents()[0];
		if (typeof event?.time === 'number') return localIsoDate(new Date(event.time));
	} catch {
		// no readable log; use the current date
	}
	return localIsoDate();
}

/** Model instruction: one `分类：描述` line with a freely chosen category. */
export function systemPrompt(resolved) {
	return [
		'You name AI coding-assistant sessions.',
		'Choose one short category label that best fits the session, in the language of the messages: 1-6 characters (for Chinese, short labels such as 开发、排查、设置、文档、闲聊; for English, a short word such as debugging). There is no fixed list — pick whatever label fits best.',
		`Return exactly one line of the form 分类${COLON}简短描述 using the chosen category, then the full-width colon, then a short description.`,
		'Write the description in the language of the messages.',
		`Keep the description to about ${resolved.targetCjkCharacters} CJK characters or ${resolved.targetWords} words in other languages.`,
		'The line must contain exactly one colon: do not repeat the category or add another label inside the description.',
		'Return plain text only: no date, no quotes, no Markdown, no explanation, no code, no terminal control characters, no leading words such as Title.',
		'If the messages give little to name, still return a short best-effort line.',
	].join('\n');
}

/** Frame the first human message as JSON so its text cannot break delimiters. */
export function frameInput(messages) {
	return `Generate the session title from this JSON array of human messages:\n${JSON.stringify(messages)}`;
}

/** Strip one layer of wrapping emphasis or quotes. */
function unwrap(value) {
	let text = value.trim();
	for (let index = 0; index < 4 && text.length > 0; index += 1) {
		const match = WRAPPED.exec(text);
		if (match === null) break;
		text = match[1].trim();
	}
	return text;
}

/** Split one `label：rest` line when the label can serve as a category. */
function splitLabel(line) {
	const match = LABELED_LINE.exec(line);
	if (match === null) return undefined;
	const label = unwrap(match[1]).replace(/[：:]/gu, '').trim();
	if (label.length === 0 || label.length > MAX_CATEGORY_CHARS) return undefined;
	return { category: label, description: match[2].trim() };
}

/**
 * Compose the `分类：描述` body from one model line.
 *
 * Any short label before the first colon becomes the category. When the label
 * is the fallback (`其他`) and the description starts with another short
 * label, the inner label wins (models sometimes double-label). Remaining
 * colons inside the description become a middle dot so the title keeps
 * exactly one colon.
 * @param modelLine raw first line returned by the title model.
 * @returns the normalized body without a date.
 */
export function composeBody(modelLine) {
	const text = unwrap(String(modelLine).replace(LEADING_DATE, '').trim());
	let category = FALLBACK_CATEGORY;
	let description = text;
	const first = splitLabel(text);
	if (first !== undefined) {
		category = first.category;
		description = first.description;
		if (category === FALLBACK_CATEGORY) {
			const nested = splitLabel(description);
			if (nested !== undefined) {
				category = nested.category;
				description = nested.description;
			}
		}
	}
	description = unwrap(description).replace(/\s+/gu, ' ').replace(/[：:]/gu, '·').trim();
	if (description.length === 0) description = '新会话';
	return `${category}${COLON}${description}`;
}

/**
 * Compose the final displayed title.
 * @param modelLine raw first line returned by the title model.
 * @param dateText local `YYYY-MM-DD`.
 * @param datePrefix whether to prepend the date.
 * @returns `YYYY-MM-DD 分类：描述`, or the body alone when the date is off.
 */
export function composeTitle(modelLine, dateText, datePrefix = true) {
	const body = composeBody(modelLine);
	return datePrefix ? `${dateText} ${body}` : body;
}

/** Reject non-text finishes and take the first non-empty output line. */
export function firstLineOf(response) {
	switch (response.finish.kind) {
		case 'stop':
			break;
		case 'tool-calls':
			throw new Error('session-title-dated: title output must contain text only');
		case 'max-tokens':
			throw new Error('session-title-dated: title output reached maxOutputTokens');
		default:
			throw new Error(`session-title-dated: unexpected title finish ${String(response.finish.kind)}`);
	}
	if (response.blocks.some((block) => block.type === 'tool-call')) {
		throw new Error('session-title-dated: title output must contain text only');
	}
	const text = response.blocks
		.filter((block) => block.type === 'text')
		.map((block) => block.text)
		.join(' ');
	const line = text
		.split(/\r?\n/u)
		.map((item) => item.trim())
		.find((item) => item.length > 0);
	if (line === undefined) throw new Error('session-title-dated: title model produced no text');
	return line;
}

/** Keep the whole title within the service byte budget without splitting code points. */
export function fitBytes(title, maxBytes = 80) {
	if (Buffer.byteLength(title, 'utf8') <= maxBytes) return title;
	let used = 0;
	let output = '';
	for (const character of title) {
		const bytes = Buffer.byteLength(character, 'utf8');
		if (used + bytes > maxBytes) break;
		output += character;
		used += bytes;
	}
	return output.trimEnd();
}

/** Whether a title already looks like `YYYY-MM-DD 分类：描述` with one colon. */
export function isWellFormedTitle(title) {
	if (!DATE_PREFIX.test(title)) return false;
	const body = title.replace(LEADING_DATE, '');
	const match = /^[^：:]+[：:](.+)$/u.exec(body);
	if (match === null) return false;
	return !/[：:]/u.test(match[1]);
}

/**
 * Retitle live sessions that lack the dated prefix and were not renamed by
 * the user. Idempotent: a well-formed dated title is skipped.
 * @param ctx context exposing sessions, sessionTitle, and logger.
 */
function backfillTitles(ctx) {
	let sessions;
	try {
		sessions = ctx.sessions.list();
	} catch (error) {
		ctx.logger?.warn?.(`session-title-dated: cannot list sessions: ${String(error)}`);
		return;
	}
	for (const session of sessions) {
		let current;
		try {
			current = ctx.sessionTitle.get(session);
		} catch {
			continue;
		}
		if (current === undefined || current.source.kind === 'user') continue;
		if (isWellFormedTitle(current.title)) continue;
		Promise.resolve()
			.then(() => ctx.sessionTitle.refresh(session))
			.catch((error) => {
				ctx.logger?.warn?.(
					`session-title-dated: backfill failed for session "${session.id}": ${String(error)}`,
				);
			});
	}
}

/**
 * Register the global `set_session_title` tool.
 *
 * The agent calls it whenever the user asks to change or regenerate the
 * current session title; the tool keeps the `YYYY-MM-DD 分类：描述` shape and
 * never depends on a fixed category list.
 * @param ctx context exposing sessionTitle and tools.
 */
export function registerTitleTool(ctx) {
	ctx.tools.register(
		defineTool({
			name: TOOL_NAME,
			description:
				'Rename the current session (conversation) title. Use it whenever the user asks to change, fix, or regenerate the title. The title format is `YYYY-MM-DD 分类：简短描述`; the YYYY-MM-DD prefix is added automatically. Provide `title` (the date prefix is optional), or `category` plus `description`, or neither argument to regenerate automatically.',
			parameters: {
				title: {
					type: 'string',
					description:
						'Full new title, e.g. "设置：改会话标题". If it lacks a date, the session date is prepended.',
				},
				category: {
					type: 'string',
					description:
						'Short category label you choose for the conversation, e.g. 开发 / 排查 / 设置 / 闲聊. Used together with description.',
				},
				description: {
					type: 'string',
					description: "Short description of the conversation, in the user's language.",
				},
			},
			output: {
				schema: {
					type: 'object',
					additionalProperties: false,
					properties: {
						title: { type: 'string', required: true },
					},
				},
				render: (_args, value) => [{ type: 'text', text: `Session title is now: ${value.title}` }],
			},
			async execute(args, exec) {
				const agent = exec.agent;
				if (agent === undefined) throw new Error(`${TOOL_NAME} requires an owning agent session`);
				const session = agent.session;
				const dateText = sessionDateText(ctx, session);
				const title = typeof args.title === 'string' ? args.title.trim() : '';
				const description = typeof args.description === 'string' ? args.description.trim() : '';
				if (title.length > 0) {
					const next = DATE_PREFIX.test(title) ? title : `${dateText} ${title}`;
					return { title: ctx.sessionTitle.rename(session, next).title };
				}
				if (description.length > 0) {
					const rawCategory = typeof args.category === 'string' ? args.category.trim() : '';
					const category =
						rawCategory.length > 0
							? rawCategory.replace(/[：:]/gu, '').trim()
							: FALLBACK_CATEGORY;
					const next = `${dateText} ${category}${COLON}${description}`;
					return { title: ctx.sessionTitle.rename(session, next).title };
				}
				const snapshot = await ctx.sessionTitle.refresh(session);
				const fallback = ctx.sessionTitle.get(session);
				return { title: snapshot?.title ?? fallback?.title ?? '' };
			},
		}),
	);
}

/**
 * Register the dated title provider, the retitle tool, and backfill.
 * @param ctx context exposing sessionTitle, llm, sessions, and tools.
 * @param config loader configuration (all fields optional; defaults apply).
 */
export function apply(ctx, config) {
	const resolved = resolveConfig(config);
	const providerId = SessionTitleProviderId(name);
	ctx.sessionTitle.register({
		id: providerId,
		automatic: 'first-prompt',
		async generate(request) {
			const first = request.messages[0];
			if (first === undefined) {
				throw new Error('session-title-dated: requires one human message');
			}
			const event = firstUserMessageEvent(request.session);
			const dateText = localIsoDate(
				new Date(typeof event?.time === 'number' ? event.time : Date.now()),
			);
			const response = await executeSessionTitleLlm(ctx, resolved.execution, request, providerId, {
				system: systemPrompt(resolved),
				input: frameInput([first]),
				messageSeqs: [first.seq],
				selectReasoningEffort: (model) => model.reasoning?.efforts[0]?.id,
			});
			const title = composeTitle(firstLineOf(response), dateText, resolved.datePrefix);
			return {
				title: fitBytes(title),
				messageSeqs: [first.seq],
				model: response.model,
			};
		},
	});
	try {
		registerTitleTool(ctx);
	} catch (error) {
		ctx.logger?.warn?.(`session-title-dated: ${TOOL_NAME} tool unavailable: ${String(error)}`);
	}
	if (resolved.backfill) backfillTitles(ctx);
}
