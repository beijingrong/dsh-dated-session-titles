/**
 * Session naming: register the session-title provider that names a session
 * `YYYY-MM-DD category：short summary`.
 *
 * The provider replaces the shipped first-prompt LLM provider (the title
 * service accepts one provider at a time). It reads the eligible human
 * messages the service passes in, asks the current session route for one small
 * JSON answer, and assembles the final title itself so the date prefix is
 * exact even when the model returns something else.
 */

/** Registered provider identity and the services this plugin needs. */
const PROVIDER_ID = 'session-title-dated';
const TOOL_NAME = 'set_session_title';
const inject = ['sessionTitle', 'llm'];

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function optionalText(value) {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text.length > 0 ? text : undefined;
}

/**
 * Validate the plugin configuration, keeping every field optional with a
 * usable default.
 * @param {unknown} input - the row's raw configuration.
 * @returns resolved provider policy.
 */
function resolveConfig(input) {
  const raw = input !== null && typeof input === 'object' ? input : {};
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map(optionalText).filter((item) => item !== undefined)
    : [];
  const targetCjkCharacters = positiveInteger(raw.targetCjkCharacters, 8);
  const provider = optionalText(raw.provider);
  const model = optionalText(raw.model);
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error('session-title-dated: provider and model must be supplied together');
  }
  return {
    automatic: raw.automatic === 'first-prompt' ? 'first-prompt' : 'all-prompts',
    datePrefix: raw.datePrefix !== false,
    // Empty by default: the model names the category from the conversation.
    categories,
    targetCjkCharacters,
    maxCjkCharacters: positiveInteger(raw.maxCjkCharacters, targetCjkCharacters + 2),
    maxInputBytes: positiveInteger(raw.maxInputBytes, 8192),
    maxOutputTokens: positiveInteger(raw.maxOutputTokens, 1500),
    timeoutMs: positiveInteger(raw.timeoutMs, 45000),
    maxMessages: positiveInteger(raw.maxMessages, 6),
    messageCharLimit: positiveInteger(raw.messageCharLimit, 600),
    fallbackCategory: optionalText(raw.fallbackCategory) ?? '其他',
    timeZone: optionalText(raw.timeZone),
    provider,
    model,
  };
}

/**
 * Format one instant as `YYYY-MM-DD` in the configured or host time zone.
 * @param {number} createdAt - session creation time in epoch milliseconds.
 * @param {string | undefined} timeZone - IANA time zone, or undefined for the host's.
 * @returns the date prefix.
 */
function sessionDate(createdAt, timeZone) {
  const instant = new Date(Number.isFinite(createdAt) ? createdAt : Date.now());
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
    const take = (type) => parts.find((part) => part.type === type)?.value;
    const year = take('year');
    const month = take('month');
    const day = take('day');
    if (year !== undefined && month !== undefined && day !== undefined) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fall back to the host clock below when the time zone is invalid.
  }
  const pad = (value) => String(value).padStart(2, '0');
  return `${instant.getFullYear()}-${pad(instant.getMonth() + 1)}-${pad(instant.getDate())}`;
}

const byteEncoder = new TextEncoder();

function utf8Bytes(text) {
  return byteEncoder.encode(text).length;
}

/** Shorten one message so a single huge prompt cannot dominate the request. */
function clipText(text, limit) {
  const characters = Array.from(text.trim());
  if (characters.length <= limit) return characters.join('');
  return `${characters.slice(0, limit).join('')}…`;
}

/**
 * Choose the messages that best describe the session under the input budget:
 * the first message for origin plus the most recent ones for the current topic.
 * @param {readonly {seq: number, text: string}[]} messages - eligible human messages.
 * @param {ReturnType<typeof resolveConfig>} config - resolved policy.
 * @returns the selected messages, oldest first.
 */
function selectMessages(messages, config) {
  const clipped = messages.map((message) => ({
    seq: message.seq,
    text: clipText(message.text, config.messageCharLimit),
  }));
  const keep = Math.max(2, config.maxMessages);
  let selected = clipped.length <= keep ? [...clipped] : [clipped[0], ...clipped.slice(-(keep - 1))];
  const budget = Math.max(512, config.maxInputBytes - 512);
  const measure = (list) => utf8Bytes(JSON.stringify(list.map((item) => item.text)));
  while (selected.length > 1 && measure(selected) > budget) {
    selected = [selected[0], ...selected.slice(2)];
  }
  while (selected.length > 0 && measure(selected) > budget && selected[0].text.length > 64) {
    selected[0] = { ...selected[0], text: `${selected[0].text.slice(0, Math.floor(selected[0].text.length / 2))}…` };
  }
  return selected;
}

/** Provider-owned system instruction for the naming request. */
function systemPrompt(config) {
  const categoryRule =
    config.categories.length > 0
      ? `1. category 优先从下列类别中选一个：${config.categories.join('、')}；都不合适时可以自拟 2-4 个字的类别。`
      : '1. category 由你根据会话内容自拟：2-4 个汉字，具体、一眼能归类，例如「品牌」「偏好」「排查」「财务」「学习」「命名」。不要用「杂项」「其他」这类空泛词，除非确实无法归类。';
  return [
    '你是 AI 编程助手的会话命名助手。阅读用户消息，为这次会话生成一个标题，只返回一个 JSON 对象：',
    '{"category":"类别","description":"简短描述"}',
    '规则：',
    categoryRule,
    `2. description 概括会话主题，用名词短语，越短越好：${Math.max(4, config.targetCjkCharacters - 4)}-${config.targetCjkCharacters} 个字最理想，最多 ${config.maxCjkCharacters} 个汉字（CJK 字符），不要为凑字加修饰。`,
    '3. 消息是中文就用中文写 description，否则用消息的主要语言。',
    '4. description 里不要出现日期、【】、冒号、引号、句号或 Markdown。',
    '5. 不要复述整句，也不要写"用户想…"这类描述，直接给主题，例如「称呼约定」「记账与开销」「海水咸度成因」。',
    '6. 如果已有标题已经准确概括了会话，请原样返回它的 category 与 description，不要为了不同而改写。',
    '只输出 JSON，不要代码块、解释或任何多余文字。',
  ].join('\n');
}

/** Frame the selected messages as JSON so user text cannot break the envelope. */
function userInput(config, date, selected, currentTitle) {
  const lines = [`今天是 ${date}。请为下面这次会话生成标题。`];
  if (currentTitle !== undefined) lines.push(`现有标题：${currentTitle}`);
  lines.push(`用户消息（JSON 字符串数组，按时间顺序）：${JSON.stringify(selected.map((item) => item.text))}`);
  return lines.join('\n');
}

/** Remove decoration a model may wrap around a title or one of its fields. */
function cleanField(value) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/```[a-zA-Z]*/gu, '')
    .replace(/[\u0000-\u001f\u007f]/gu, ' ')
    .replace(/^[\s"'“”‘’*`#>-]+/u, '')
    .replace(/[\s"'“”‘’*`]+$/u, '')
    .trim();
}

function normalizeCategory(value, config) {
  const category = cleanField(value)
    .replace(/[【】\[\]：:]/gu, '')
    .trim();
  if (category.length === 0 || category.length > 6) return config.fallbackCategory;
  return category;
}

function normalizeDescription(value, config) {
  const description = cleanField(value)
    .replace(/^(?:【[^】]*】\s*[：:]\s*)/u, '')
    .replace(/^(?:\d{4}-\d{2}-\d{2})\s*/u, '')
    .replace(/[。．.!！；;，,、]+$/u, '')
    .trim();
  const characters = Array.from(description);
  const limit = config.maxCjkCharacters;
  return characters.length <= limit ? description : characters.slice(0, limit).join('');
}

/**
 * Interpret model output as category and description, tolerating a JSON object,
 * a full `YYYY-MM-DD 【category】：description` line, or one bare line.
 * @param {string} text - assembled model text.
 * @param {ReturnType<typeof resolveConfig>} config - resolved policy.
 * @returns the parsed category and description.
 */
function parseTitle(text, config) {
  const cleaned = String(text ?? '').replace(/```[a-zA-Z]*\n?/gu, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      const description = normalizeDescription(parsed?.description, config);
      if (description.length > 0) {
        return { category: normalizeCategory(parsed?.category, config), description };
      }
    } catch {
      // Fall through to the line-based interpretations below.
    }
  }
  const line = cleaned
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .find((item) => item.length > 0) ?? '';
  const titled = /^(?:\d{4}-\d{2}-\d{2}\s*)?【(?<category>[^】]{1,12})】\s*[：:]\s*(?<description>.+)$/u.exec(line);
  if (titled?.groups !== undefined) {
    const description = normalizeDescription(titled.groups.description, config);
    if (description.length > 0) {
      return { category: normalizeCategory(titled.groups.category, config), description };
    }
  }
  const description = normalizeDescription(line, config);
  return { category: config.fallbackCategory, description };
}

/** Resolve the explicit route pair or the exact route the session logged. */
function resolveRoute(config, request) {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model };
  }
  if (request.route !== undefined) return request.route;
  throw new Error('session-title-dated: no request route is logged yet; configure provider and model together');
}

/** Combine caller cancellation with the auxiliary request deadline. */
function requestSignal(signal, timeoutMs) {
  const signals = [signal];
  if (timeoutMs > 0 && typeof AbortSignal.timeout === 'function') {
    signals.push(AbortSignal.timeout(timeoutMs));
  }
  if (signals.length === 1) return signals[0];
  return typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : signals[0];
}

/**
 * Call the session route once and assemble its text.
 * @returns {Promise<{text: string}>} the assembled assistant text.
 */
async function generateText(ctx, config, request, prepared) {
  const route = resolveRoute(config, request);
  const signal = requestSignal(request.signal, config.timeoutMs);
  const call = await ctx.llm.prepareCall({ ...route, maxTokens: config.maxOutputTokens }, signal, (controls, model) => {
    const effort = model?.reasoning?.efforts?.[0]?.id;
    return effort === undefined ? controls : { ...controls, reasoningEffort: effort };
  });
  const messages = [{ role: 'user', content: [{ type: 'text', text: prepared.input }] }];
  const options = {
    ...call.config,
    messages,
    system: prepared.system,
    sessionId: request.session.id,
    signal,
  };
  // Best-effort audit record of the exact auxiliary request, mirroring the
  // shipped provider's log-only event. A failure here must not lose the title.
  try {
    request.session.append('session/title-llm-request', {
      titleProvider: PROVIDER_ID,
      messageSeqs: [...prepared.messageSeqs],
      route,
      system: prepared.system,
      messages,
      maxTokens: config.maxOutputTokens,
      ...(call.config.reasoningEffort === undefined ? {} : { reasoningEffort: call.config.reasoningEffort }),
    });
  } catch {
    // Audit logging is optional; naming continues without it.
  }
  let text = '';
  let finish;
  let sawToolCall = false;
  for await (const chunk of call.stream(options)) {
    if (chunk.type === 'text-delta') text += chunk.text;
    else if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') sawToolCall = true;
    else if (chunk.type === 'finish') finish = chunk.reason;
  }
  signal.throwIfAborted();
  if (finish === undefined) throw new Error('session-title-dated: the title request ended without a finish reason');
  if (finish.kind === 'error' || finish.kind === 'aborted') {
    throw new Error(`session-title-dated: ${finish.failure?.message ?? 'the title request failed'}`);
  }
  if (finish.kind === 'max-tokens') throw new Error('session-title-dated: the title output reached maxOutputTokens');
  if (sawToolCall || finish.kind === 'tool-calls') throw new Error('session-title-dated: the title output must contain text only');
  return { text };
}

/**
 * Build the on-demand rename tool: the agent calls it when the user asks to
 * change or regenerate the current session title.
 * @param {object} ctx - context exposing session-title.
 * @param {ReturnType<typeof resolveConfig>} config - resolved policy.
 */
function titleToolDefinition(ctx, config) {
  return {
    name: TOOL_NAME,
    description: [
      '修改当前会话的标题。用户要求改标题、修标题或重新起名时调用。',
      '标题格式是「YYYY-MM-DD 类别：简短描述」，日期前缀会自动补上。',
      '可以给 title（完整标题，可省略日期）；也可以给 category + description 由你自拟类别；',
      '两个都不给则按当前对话重新生成一次。',
      '注意：调用后标题会被用户意图钉住，本会话不再自动改名。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        title: { type: 'string', description: '完整新标题，例如「设置：改会话标题」。缺日期时自动补。' },
        category: { type: 'string', description: '你自拟的短类别，例如「开发」「排查」「设置」，与 description 搭配。' },
        description: { type: 'string', description: '会话的简短描述，用用户的语言。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { title: { type: 'string' } },
        required: ['title'],
      },
      render: (_args, value) => [{ type: 'text', text: `会话标题已更新：${value?.title ?? ''}` }],
    },
    async execute(args, exec) {
      const session = exec?.agent?.session;
      if (session === undefined) throw new Error(`${TOOL_NAME} 需要会话上下文`);
      const date = sessionDate(session.header?.createdAt, config.timeZone);
      const value = args !== null && typeof args === 'object' ? args : {};
      const fullTitle = optionalText(value.title);
      if (fullTitle !== undefined) {
        const next = /^\d{4}-\d{2}-\d{2}/u.test(fullTitle) ? fullTitle : `${date} ${fullTitle}`;
        return { title: ctx.sessionTitle.rename(session, next).title };
      }
      const description = normalizeDescription(value.description, config);
      if (description.length > 0) {
        const category = cleanField(value.category).replace(/[【】\[\]：:]/gu, '').trim() || config.fallbackCategory;
        const body = `${category}：${description}`;
        return { title: ctx.sessionTitle.rename(session, config.datePrefix ? `${date} ${body}` : body).title };
      }
      const snapshot = await ctx.sessionTitle.refresh(session);
      const current = ctx.sessionTitle.get(session);
      return { title: snapshot?.title ?? current?.title ?? '' };
    },
  };
}

/**
 * Register the naming provider on the session-title service.
 * @param {object} ctx - context exposing session-title and llm services.
 * @param {unknown} config - the row's configuration.
 */
function apply(ctx, config) {
  const resolved = resolveConfig(config);
  const tools = ctx.get('tools');
  if (tools !== undefined) {
    ctx.effect(() => tools.register(titleToolDefinition(ctx, resolved)));
  }
  ctx.effect(() =>
    ctx.sessionTitle.register({
      id: PROVIDER_ID,
      automatic: resolved.automatic,
      async generate(request) {
        const date = sessionDate(request.session?.header?.createdAt, resolved.timeZone);
        const messages = Array.isArray(request.messages) ? request.messages : [];
        const selected = selectMessages(messages, resolved);
        if (selected.length === 0) throw new Error('session-title-dated: no eligible human message');
        const current = request.currentTitle;
        const currentTitle = current?.source?.kind === 'provider' ? current.title : undefined;
        const input = userInput(resolved, date, selected, currentTitle);
        const { text } = await generateText(ctx, resolved, request, {
          input,
          system: systemPrompt(resolved),
          messageSeqs: selected.map((item) => item.seq),
        });
        const parsed = parseTitle(text, resolved);
        if (parsed.description.length === 0) throw new Error('session-title-dated: the model produced no usable title');
        return {
          title: resolved.datePrefix ? `${date} ${parsed.category}：${parsed.description}` : `${parsed.category}：${parsed.description}`,
          messageSeqs: selected.map((item) => item.seq),
          model: resolveRoute(resolved, request),
        };
      },
    }),
  );
}

export {
  apply,
  inject,
  PROVIDER_ID as name,
  TOOL_NAME,
  resolveConfig,
  sessionDate,
  parseTitle,
  systemPrompt,
  selectMessages,
  userInput,
  normalizeCategory,
  normalizeDescription,
  titleToolDefinition,
};
