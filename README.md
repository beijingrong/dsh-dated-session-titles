# dsh-session-title-dated

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话标题加上日期和分类：

```
2026-11-02 设置：会话标题规则
2026-11-04 排查：登录页报错
```

一个插件，做三件事：

- **自动标题**：替换内置的 first-prompt 标题 provider，新会话第一条消息后由模型自由选一个短分类，生成 `YYYY-MM-DD 分类：描述`；
- **随时改标题**：注册全局 agent 工具 `set_session_title`，用户说「帮我改一下标题」时 agent 就能改名；
- **回填旧会话**：插件激活时把"还没有日期前缀"的存活会话标题补成新格式。

分类**不是固定列表**，由模型按对话内容动态决定。

## 环境要求

- DSH 0.2.x（在 `0.2.1-rc.5` 上开发验证）
- 目前只支持从 **profile patch** 安装（见下）；插件通过软链接复用当前 DSH 安装里的 `@deepseek-ai/*` 模块，避免重复加载核心包

## 安装

```bash
git clone <this-repo> dsh-session-title-dated
cd dsh-session-title-dated
./install.sh            # 默认装进 web profile；也可以 ./install.sh <profile>
```

脚本会：

1. 解析 `dsh` 的真实路径，找到 DSH 安装的 `node_modules`；
2. 把插件复制到 `~/.dsh/profiles/<profile>/plugins/dsh-session-title-dated/`，并在那里建立 `node_modules` 软链接；
3. 在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 末尾追加（带 `>>>`/`<<<` 标记，便于卸载）：
   - 禁用内置的 `session-title-llm`；
   - 插入 `session-title-dated-v2`。

web profile 开着 HMR，保存补丁后会自动热加载；否则重启 `dsh web`。新会话生效。

> 安装脚本只处理整体替换，不做依赖安装；升级时 `git pull && ./install.sh` 即可。

## 使用

**自动**：新会话发第一条消息后，侧边栏标题会自动变成 `YYYY-MM-DD 分类：描述`。

**手动**：直接对 agent 说：

- 「标题改成 排查：登录页报错」
- 「把这条会话标题改成设置类的」
- 「标题重新起一个」

agent 会调用 `set_session_title` 工具：

| 参数 | 说明 |
|---|---|
| `title` | 完整标题（`YYYY-MM-DD ` 可省略，会自动补） |
| `category` + `description` | 分别给分类和描述，拼成 `日期 分类：描述` |
| 都不给 | 让标题模型按会话首条消息重新生成 |

工具写入用户来源的标题事件，会钉住标题，后续自动生成不再覆盖。

## 配置

在 `cordis.patch.yml` 的 `config` 里调整：

| 字段 | 默认 | 说明 |
|---|---|---|
| `datePrefix` | `true` | 是否加 `YYYY-MM-DD ` 前缀 |
| `backfill` | `true` | 激活时回填没有日期前缀的存活会话 |
| `targetWords` / `targetCjkCharacters` | 5 / 10 | 描述长度提示 |
| `maxInputBytes` / `maxOutputTokens` / `timeoutMs` | 4096 / 4096 / 60000 | 标题辅助请求限制 |
| `provider` / `model` | 空 | 成对出现时标题请求走独立模型 |

## 卸载

```bash
./uninstall.sh          # 默认 web profile
```

会删掉补丁里的标记块和插件目录。也可以手动删。

## 工作原理

- 标题是 DSH 的 log-only 状态：每次接受标题都会向会话日志追加 `session/title` 事件，最新的生效；
- 插件注册一个 `sessionTitle` provider（cadence `first-prompt`），复用 DSH 的 `executeSessionTitleLlm` 发辅助请求；
- 工具通过 `ctx.tools.register` 全局注册，用 `exec.agent.session` 拿到当前会话，再调 `ctx.sessionTitle.rename()`；
- 回填在插件激活时遍历 `ctx.sessions.list()`（只覆盖当前存活的会话），对未带日期前缀且非用户改名的标题调 `refresh()`。

## 测试

```bash
node test.mjs && node test-e2e.mjs && node test-tool.mjs && node test-backfill.mjs
```

- `test.mjs`：解析、日期、截断、配置
- `test-e2e.mjs`：用假 `ctx.llm` 跑完整 `generate()` 管线
- `test-tool.mjs`：`set_session_title` 的三种调用方式
- `test-backfill.mjs`：回填逻辑

## 兼容性

- 依赖 DSH 内部模块 `@deepseek-ai/dsh-session-title`、`dsh-session-title-llm`、`dsh-tools`、`schemastery` 的现有接口；DSH 升级后如果这些接口变了，插件可能需要跟着改。
- DSH 或 Node 版本路径变化后，重跑 `install.sh` 会重建 `node_modules` 软链接。

## License

MIT
