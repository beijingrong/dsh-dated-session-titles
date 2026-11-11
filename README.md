# dsh-dated-session-titles

给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的会话标题加上日期和分类：

```
2026-11-02 设置：会话标题规则
2026-11-04 排查：登录页报错
2026-11-10 记账：月度固定开销估算
```

分类**不是固定清单**，由模型按对话内容自己拟（2-4 个汉字）；日期前缀由插件计算，不交给模型。

## 特性

- **自动命名** —— 替换内置的 first-prompt 标题 provider，默认在每条用户消息后重算标题，话题变了标题就跟着变；
- **日期可靠** —— 前缀取会话创建日（宿主时区），插件自己拼，模型写错也没关系；
- **分类自由** —— 没有预设词表，模型给 `设置`、`记账`、`科普` 这类具体标签；
- **短描述** —— 目标 8 个汉字、硬上限 10 个，不带标点、引号和括号；
- **随时改名** —— 注册 agent 工具 `set_session_title`，你说「把标题改成……」我就能改；
- **可审计** —— 每次命名请求都记进会话日志（`session/title-llm-request`），标题不对劲可以直接查现场；
- **不阻塞** —— 命名是旁路异步请求，失败就留着兜底标题，绝不影响主对话。

## 环境要求

- DSH `0.2.x`（在 `0.2.2-rc.1` 上验证）
- 以 **bundle** 形式安装：不需要复制文件、不需要手工改 patch、不需要给插件软链 `node_modules`（本插件不 import 任何 `@deepseek-ai/*` 运行时模块）

## 安装

```bash
git clone https://github.com/beijingrong/dsh-dated-session-titles
```

然后在 DSH 里任选一种：

- **Web 界面**：设置 → 插件 → 从本地目录安装，选中这个目录；
- **让 agent 装**：把目录路径给我，用 `plugin_manager` 的 `install_bundle` 安装；
- **命令行**：`dsh plugin --profile <profile> install <本地目录或 npm 包名>`。

安装后立即生效（HMR），无需重启；新会话、以及已有会话的下一条消息都会按新格式命名。

## 配置

所有字段可选。默认值如下（`cordis.patch.yml` 里就是这一套）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `automatic` | `all-prompts` | 每条消息后重命名；设为 `first-prompt` 则只在首条消息后定名一次，更省调用 |
| `datePrefix` | `true` | 是否加 `YYYY-MM-DD ` 前缀 |
| `targetCjkCharacters` | `8` | 描述的理想字数 |
| `maxCjkCharacters` | `10` | 描述硬上限，超出直接截断 |
| `maxMessages` | `6` | 取名时参考「首条 + 最近几条」用户消息 |
| `messageCharLimit` | `600` | 单条消息引用上限，避免超长输入 |
| `maxInputBytes` | `8192` | 命名请求输入字节上限 |
| `maxOutputTokens` | `1500` | 命名请求输出上限 |
| `timeoutMs` | `45000` | 命名请求超时 |
| `timeZone` | 宿主时区 | 日期前缀使用的 IANA 时区 |
| `provider` / `model` | 沿用会话路由 | 想用别的模型取名时成对指定 |
| `categories` | 空（自由） | 填了则退化为「优先从词表里选」模式 |
| `fallbackCategory` | `其他` | 模型输出无法解析时的兜底类别 |

## 行为细节

- **命名节奏**：默认每条用户消息触发一次很小的旁路请求（deepseek-flash 通常 1-2 秒），不占用主回复的 token 和时延；觉得标题变动太频繁就切 `first-prompt`。
- **钉住**：手动改名（无论是你还是 `set_session_title` 工具）会把标题标记为用户来源，本会话不再自动改名。
- **失败**：超时、模型输出非法、路由不存在都只保留兜底标题（首条消息前几个字），不会重试、不会报错。
- **长度**：整条标题一般 30 字以内，远低于标题服务的 80 字节默认上限；本 bundle 把它调到了 120 字节。

## agent 工具：`set_session_title`

| 参数 | 说明 |
|---|---|
| `title` | 完整新标题，可省略日期前缀（自动补） |
| `category` + `description` | 也可让 agent 自拟类别和描述，日期同样自动补 |
| 都不传 | 按当前对话重新生成一次标题 |

调用后标题被钉住，本会话不再自动改名。

## 与 0.1.x 的差异

| | 0.1.x | 0.2.x |
|---|---|---|
| 安装 | `install.sh` 复制到 profile 并手搓 `node_modules` 软链 | bundle，`plugin_manager` / Web 插件页直接装 |
| 运行时依赖 | import `@deepseek-ai/dsh-session-title-llm` 等核心包 | 零 import，只走 `ctx` 服务，升级 DSH 不会因内部 API 变动而挂 |
| 命名节奏 | 只在首条消息后命名 | 默认每条消息后重算，可切回 `first-prompt` |
| 类别 | 自由 | 自由（相同），但提示词不再暗示固定列表，字数收紧到 2-4 |
| 旧会话回填 | 激活时把所有旧会话补成新格式 | **移除**：新包每条消息都会重命名，回填会让每个历史会话都白烧一次模型调用 |
| 审计 | 无 | 每次请求记录 `session/title-llm-request` |

## 开发

```bash
npm test                       # 单元测试
npm pack --dry-run             # 看会发布哪些文件、多大
```

测试覆盖日期计算、模型输出解析（JSON / 整行 / 裸行 / 带括号）、长度截断、消息选择与输入字节预算、配置覆盖，以及 `set_session_title` 的改名拼装。

### 本地迭代

插件以 bundle 形式链接安装时，改完代码重新装一次就生效，不用重启 DSH：

```bash
# 让 agent 执行，或在 Web 插件页先卸载再装本地目录
plugin_manager remove_bundle  dsh-dated-session-titles
plugin_manager install_bundle /abs/path/to/dsh-dated-session-titles
```

想验证实际标题效果，起一个子会话聊两句即可——每条用户消息后都会重新命名。

### 发版清单

```bash
npm test                                  # 1. 测试全绿
npm pack --dry-run                        # 2. 确认发布内容（8 个文件左右）
npm version patch --no-git-tag-version    # 3. 升版本（minor / major 同理）
git add -A && git commit -m "0.2.x: ..."  # 4. 提交
git tag -a v0.2.x -m "0.2.x: ..."         # 5. 打标签
git push origin main --follow-tags        # 6. 推送代码和标签
npm login                                 # 7. 首次发布需登录
npm publish                               # 8. 发布（无 scope 包默认 public）
npm view dsh-dated-session-titles version # 9. 确认线上版本
```

发布后说明：npm 11.19+ 默认走**分阶段发布（staged publishing）**。终端会引导你在浏览器里完成 2FA，之后 registry 先出现一个 `0.0.0-stage` 占位版本，真正的版本通常 1-3 分钟后才生效——这期间 `npm view` 只看到占位版是正常现象，别以为发失败了。

```bash
# 等一两分钟再确认
npm view dsh-dated-session-titles version    # 变成 0.2.x 即成功
curl -s https://registry.npmjs.org/dsh-dated-session-titles | grep -o '"latest":"[^"]*"'
```

几点约束：

- **同版本号不能覆盖发布**，任何改动都要先升版本；
- 市场收录看 `package.json` 的 `repository`（指回本仓库）和 `engines.dsh`，两个字段别手滑删掉；
- dshfind 每天扫一次 npm，发布后到出现在 Discover 里可能隔一天，不需要手动提交；
- `version` 字段同时决定 npm 版本和 `plugin_manager` 显示的可升级版本，别只改 tag 不改 `package.json`。

## 许可

MIT，见 [LICENSE](LICENSE)。
