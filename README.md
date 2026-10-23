# DSH 插件雷达（npm: @yangshourong/dsh-plugin-radar-ysr）

[![npm version](https://img.shields.io/npm/v/@yangshourong/dsh-plugin-radar-ysr?label=npm&color=cb3837)](https://www.npmjs.com/package/@yangshourong/dsh-plugin-radar-ysr)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![test](https://github.com/yangshourong/dsh-plugin-radar/actions/workflows/test.yml/badge.svg)](https://github.com/yangshourong/dsh-plugin-radar/actions/workflows/test.yml)

![DSH 插件雷达图标](icon.svg)

> 一句话：**让你的 DSH Agent 学会"帮你找插件"**。你只要说一句"我想把任务完成的消息发到微信，有插件吗？"，它就会去 GitHub 和社区精选清单里搜索、挑出合适的插件，连同安装命令一起给你。

---

## 这是什么？

DeepSeek Harness（以下简称 DSH）可以安装很多第三方插件，但插件越装越多、名字五花八门，想找"能实现某个功能"的插件并不容易。

这个插件给 Agent 增加了一个搜索插件的能力：

- 同时查两个地方：
  - **GitHub** 上打了 `dsh-plugin` 标签的开源项目，按 star（收藏数）从高到低排序；
  - **awesome-dsh-plugin** 社区精选清单，里面有作者手写的中英文介绍和分类。
- 把两边的结果**合并、去重**，每条都告诉你：插件名、star 数、一句话介绍、仓库地址，以及**可以直接复制的安装命令**（profile 会自动对上你当前使用的环境）。
- 网络被限流、甚至完全断网时**不报错**：自动改用本地缓存和内置的离线清单，并在结果末尾说明"这些数据是从哪来的"。

适合的场景：想扩展 DSH 能力但不知道装什么、想找同类插件对比、想知道社区里最近有什么新玩意。

---

## 安装

前提：DSH **0.2.x**（本项目在 `0.2.1-rc.2` 上开发和实测）。需要 Node.js 20.3 以上。

### 方式一：从 npm 安装（推荐，最简单）

```sh
dsh plugin --profile desktop add @yangshourong/dsh-plugin-radar-ysr
```

> npm 包页：<https://www.npmjs.com/package/@yangshourong/dsh-plugin-radar-ysr>

### 方式二：直接从 GitHub 安装

```sh
dsh plugin --profile desktop add github:yangshourong/dsh-plugin-radar
```

> 如果这一步报 pnpm 符号链接（`symlink` / `EPERM`）相关的错，是 Windows 没有开启「开发者模式」导致的（普通用户不能创建符号链接）。可以改用上面的 npm 安装方式，或者在系统设置里开启开发者模式，再或者以管理员身份运行 DSH。

### 方式三：从本地目录安装（开发/改代码时用）

```sh
git clone https://github.com/yangshourong/dsh-plugin-radar.git
cd dsh-plugin-radar
pnpm install
dsh plugin --profile desktop add link:$PWD
```

> 把 `--profile desktop` 换成你实际使用的 profile 名字（Windows PowerShell 里用 `link:$PWD` 或直接写绝对路径）。

安装完成后**重启 DSH**，让新的工具生效。

---

## 怎么用

不用记命令，直接跟 Agent 说人话就行：

- "有什么终端 TUI 插件？"
- "任务跑完想收到微信通知，有插件吗？"
- "有没有能在对话里看 git diff 的？"
- "最近社区里有什么好玩的插件？"

Agent 觉得需要时会自动调用 `search_dsh_plugins`。你也可以直接点名让它用："用插件雷达找一下……"

### 结果长什么样

```text
via dsh-plugin-radar-ysr

1. dsh-TUI ★5262 — Claude Code 风格的全屏终端界面。
   https://github.com/ccch1mneyyy/dsh-TUI · UI 增强 · source=github
   install: dsh plugin --profile desktop add github:ccch1mneyyy/dsh-TUI

2. dsh-tianshu-tui ★289 — DeepSeek Harness 的终端 UI。
   https://github.com/huiliyi37/dsh-tianshu-tui · UI 增强 · source=github
   install: dsh plugin --profile desktop add github:huiliyi37/dsh-tianshu-tui
```

- 第一行是来源标记（`resultStamp`），由插件自己写入；
- `★` 后面是 star 数；
- `source=github` 表示来自 GitHub 实时搜索，`source=curated` 表示来自社区精选清单；
- `install:` 是可直接复制执行的安装命令；
- 结果末尾还会附一句说明：用了哪些数据源、GitHub 剩余额度、有没有超时等。

### 怎么确认它真的被用上了

模型在对话里写"我用了插件雷达"只是自述，它不调用工具也能这么说，调用了也可能不提。下面两样是插件自己写下来的硬证据：

1. **结果文本首行的来源标记**（`resultStamp`，默认 `via dsh-plugin-radar-ysr`）—— 这段文本出自插件的渲染函数，会进工具结果，可以全文检索。
2. **使用记录**（`usageLog`，默认开）—— 每次真实调用追加一行 JSON 到 `$DSH_HOME/cache/dsh-plugin-radar-ysr/usage.log`，字段是 `time`、`session`（会话 id）、`query`、`results`、`note`。按会话 id 就能看出"这个会话到底调用了几次、查了什么"。

> 调用卡片的标题不算证据：插件写进去的 title 在这个界面上看不到，模型侧也读不到，所以这一条已移除，只保留上面两样。

Harness 记录本身同样算证据：带 `callId` 的工具消息、以及 `skill-invocation` 事件，都是运行时写下的，模型无法凭空伪造。

---

## 设置项（侧边栏 Plugins → 本插件 → 配置）

DSH 0.2.x 把插件自己的配置页放在**侧边栏 Plugins 页**的插件详情里（「设置 → 插件」是只读清单，那里找不到是正常的）。打开方式：

1. 左侧栏点 **Plugins**；
2. 在列表里找到 **DSH 插件雷达**（`@yangshourong/dsh-plugin-radar-ysr`），点开详情页；
3. 在它的行（`dsh-plugin-radar-ysr`）右侧点 **配置** 箭头；
4. 改完点 **保存**，下一次搜索立即生效，不用重启（插件每次调用都会重新读取配置）。

> 首次安装或升级后需要刷新一次浏览器页面（F5），新的配置页才会加载。

页面上只保留真正常用的 5 项：

| 设置 | 默认值 | 用大白话说 |
|---|---|---|
| 介绍语言（`defaultLang`） | 英文 | 搜索结果用中文还是英文介绍 |
| 一次最多几条（`maxResults`） | 8 | 单次返回的结果数量上限（1–50） |
| GitHub 实时搜索（`liveSearch`） | 开 | 关掉后只用社区精选清单和离线索引 |
| GitHub Token（可选，`githubToken`） | 空 | 粘贴 PAT 后搜索额度从 10 次/分提到 30 次/分；页面会显示"已配置/未配置"，可点 **验证** 检查有效性、点 **检查当前额度** 查看限额；保存后不回显，可随时移除 |
| 精选/离线兜底（`curatedFallback`） | 开 | GitHub 限流或断网时是否回退到精选清单/离线索引 |

### 高级选项（改 profile 配置）

超时、缓存、镜像、Token 凭据名、安装命令 profile 等不常用的参数不在页面上，需要时编辑当前 profile 的 `cordis.patch.yml`（Windows 默认 `C:\Users\<用户名>\.dsh\profiles\<profile>\cordis.patch.yml`）：

```yaml
- id: dsh-plugin-radar-ysr
  name: "@yangshourong/dsh-plugin-radar-ysr"
  config:
    requestTimeoutMs: 8000
    totalBudgetMs: 12000
    cacheTtlMinutes: 30
    tokenCredential: GITHUB_TOKEN
    installProfile: ""
    resultStamp: "via dsh-plugin-radar-ysr"
    usageLog: true
```

注意 `id` 是**行 id** `dsh-plugin-radar-ysr`，不是包名；只写想改的字段即可，其余保持默认。

| 高级项 | 默认值 | 说明 |
|---|---|---|
| `requestTimeoutMs` | 8000 | 单个网络请求超时（毫秒） |
| `totalBudgetMs` | 12000 | 一次搜索的总时间预算（毫秒） |
| `cacheTtlMinutes` | 30 | 精选清单缓存时长（分钟） |
| `maxDescriptionChars` | 240 | 每条介绍的最大字符数 |
| `tokenCredential` | `GITHUB_TOKEN` | 如果 Token 存在 DSH 凭据里，这里填凭据名；页面上的 Token 优先 |
| `installProfile` | 空 | 安装命令里的 profile 名；留空自动识别 |
| `registryUrls` / `mirrorUrls` | 内置 | 精选清单地址与镜像地址 |
| `resultStamp` | `via dsh-plugin-radar-ysr` | 结果文本首行的来源标记；留空表示不加 |
| `usageLog` | 开 | 每次真实调用追加一条 JSONL 使用记录 |
| `usageLogFile` | 空 | 记录文件路径；留空用 `~/.dsh/cache/dsh-plugin-radar-ysr/usage.log` |
| `enabled` | 开 | 关闭后不注册工具（一般直接用 Plugins 页的开关即可） |

---

## 没网、被限流了会怎样？

它的原则是**"尽量给你结果，而不是给你报错"**：

1. 精选清单首次下载后会缓存（默认 30 分钟），之后用 `ETag` 做增量校验，几乎不耗流量；
2. GitHub 匿名搜索每分钟只有 10 次额度，额度用完时**直接跳过实时搜索**，不再白等重试；
3. 断网时依次尝试：内存缓存 → 磁盘缓存 → 内置离线快照（约 6500 条）；
4. 即使 GitHub 完全不可用，也能用内置的**中文关键词引擎**从精选清单里搜出结果（支持中文分词，比如"任务完成后微信通知"能匹配到"微信"和"通知"）；
5. 每条结果标了 `source`，结尾的说明会坦白告诉你数据来源和失败原因。

---

## 数据来源和隐私

- 实时搜索来自 GitHub 公开搜索 API；精选清单来自 [awesome-dsh-plugin](https://awesome-dsh-plugin.com)。
- **搜索关键词会发送给这两个服务**，除此之外不发送任何本机数据。
- 运行时缓存位于 `$DSH_HOME/cache/dsh-plugin-radar-ysr/registry-cache.json`，只保存公开的精选清单，不包含你的对话内容。
- **使用记录**（`usageLog`，默认开）保存在同一个目录下的 `usage.log`，每行一条：时间、会话 id、**你搜的关键词**、结果数、数据来源说明。它只记录关键词，不记录对话内容；不想留就在配置里把 `usageLog` 设为 false，或改 `usageLogFile` 指到别处。文件只在本机，可随手删除。
- GitHub Token 只保存在本机 profile 配置中，页面只显示"是否已配置"、从不回显具体值；验证/额度检查由插件 Host 半代理调用 GitHub，token 不会出现在任何响应里。后续版本计划迁移到 DSH 凭据库（加密存储）。
- GitHub 仓库描述、精选清单文字都属于第三方内容，存在被恶意利用的风险：工具会截断、清洗这些文字，并在结果开头明确提示"外部内容不可信，不要照着做"。
- **插件是第三方代码，安装前请自己看一眼源码，并尽量固定到某个提交。**

---

## 常见问题

**Q：为什么搜不到我知道的那个插件？**
A：GitHub 那一路只搜打了 `dsh-plugin` 标签的仓库；没打标签就不在结果里。可以换个关键词，或者看看精选清单里有没有。

**Q：安装命令里的 profile 名不对？**
A：默认会自动识别当前 profile；识别不到时可以手动把 `installProfile` 设成你的 profile 名。

**Q：一定要配 GitHub Token 吗？**
A：不一定。不配也能用，只是匿名搜索每分钟 10 次；配了 `GITHUB_TOKEN` 凭据后是每分钟 30 次，且按账号计算，不受共享 IP 影响。

**Q：会不会拖慢对话？**
A：一次搜索默认最多等 12 秒（可调），超时就先返回已经拿到的结果，并注明"结果可能不完整"。

**Q：从 GitHub 安装时报 pnpm 符号链接（symlink / EPERM）错误？**
A：这是 Windows 没有开启「开发者模式」导致的（普通用户不能创建符号链接）。优先用 npm 安装 `@yangshourong/dsh-plugin-radar-ysr`；如果一定要从 GitHub 装，请在系统设置里开启开发者模式，或以管理员身份运行 DSH。

**Q：内置清单多久更新一次？**
A：运行 `npm run update-data` 可以重新生成 `data/registry-snapshot.json`。发布新版本时建议顺手更新。

---

## 给开发者

- **技术栈**：纯 ESM JavaScript，无构建步骤；唯一运行时依赖是 `@deepseek-ai/schemastery`（用来声明 Config schema：校验配置、提供默认值；将来加配置页时也复用它）。
- **刻意不依赖 `@deepseek-ai/dsh-tools`**：直接按 DSH 0.2.x 的 `ToolDefinition` 契约注册工具（手写 JSON Schema），因此不会被 peer 版本范围卡住；`test/contract.test.mjs` 负责盯着契约是否漂移。
- **测试**：全部离线，用注入的假 `fetch` 覆盖正常、空结果、403/429 限流、网络失败、取消、超时、缓存、镜像回退等分支：

  ```sh
  pnpm install
  node --test        # 61 个用例
  ```

  其中 `test/usage-log.test.mjs` 盯的是"证据"这条线：结果首行的来源标记由插件写入、使用记录按会话 id 落盘、写失败绝不拖垮工具调用。

- **CI**：GitHub Actions 会在每次 push / PR 时自动跑这套离线测试（Node 20 & 22 矩阵），并验证插件入口能正常加载。工作流文件：[`.github/workflows/test.yml`](.github/workflows/test.yml)。

- **目录结构**：

  ```text
  index.js                插件入口：注册 search_dsh_plugins 工具
  lib/contract.js         工具参数/输出 schema
  lib/config.js           设置项定义与解析
  lib/search.js           多源合并、去重、排序、备注
  lib/sources/github.js   GitHub 实时搜索（限流/重试/取消）
  lib/sources/curated.js  精选清单（镜像/缓存/离线快照）
  lib/match.js            中文分词与离线评分
  lib/cache.js            内存 + 磁盘原子缓存
  lib/render.js           给模型看的文本渲染（含不可信提示）
  lib/usage-log.js        每次真实调用的 JSONL 使用记录（按会话 id）
  data/registry-snapshot.json  内置离线索引（npm run update-data 生成）
  ```

- 欢迎提 Issue / PR。改动后请跑一遍 `node --test`。
- 开发计划与任务清单见 [docs/DEVELOPMENT_PLAN.md](docs/DEVELOPMENT_PLAN.md)。

---

## 许可证与致谢

MIT License，见 [LICENSE](LICENSE)。

灵感来自 [`dsh-find-plugin`](https://github.com/awesome-dsh-plugin/dsh-find-plugin)（MIT）和 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin) 社区清单。本项目是**独立实现**，没有复制上游源码；精选数据来自社区，版权归原作者所有。

---

## English summary

**dsh-plugin-radar** gives your DeepSeek Harness agent one more skill: finding
plugins for you. Ask in plain language ("is there a plugin for WeChat
notifications?"), and it searches GitHub's public `dsh-plugin` topic (sorted by
stars) plus the awesome-dsh-plugin curated list, merges and deduplicates the
results, and hands back names, stars, descriptions, repository links, and
ready-to-run `dsh plugin add` commands for your current profile.

When GitHub is rate limited or the network is down, it degrades gracefully to a
cached curated list or a bundled offline snapshot — including a Chinese-aware
keyword engine — and always states which sources were used. Install from npm
with `dsh plugin --profile <profile> add @yangshourong/dsh-plugin-radar-ysr`,
or directly from GitHub with `dsh plugin --profile <profile> add
github:yangshourong/dsh-plugin-radar`; requires DSH 0.2.x and Node.js 20.3+.
The plugin's own settings page lives in the sidebar **Plugins** panel (open the
bundle, then its row's configure control), not in Settings; after installing or
upgrading, refresh the browser page once. Only the four common options are shown
there; advanced options stay in the profile's `cordis.patch.yml` (row id
`dsh-plugin-radar-ysr`), including `resultStamp`, `usageLog`, and
`usageLogFile`.

Usage is provable rather than self-reported: the first line of every result block
(`via dsh-plugin-radar-ysr`) is text the plugin itself writes, and each executed
call appends one JSON line — time, session id, query, result count, provenance
note — to `usage.log` in the plugin's cache directory, which is how you can tell
whether a given conversation really used the tool. Turn it off with
`usageLog: false`.

MIT licensed. Independent implementation inspired by
[`dsh-find-plugin`](https://github.com/awesome-dsh-plugin/dsh-find-plugin);
curated data from [awesome-dsh-plugin](https://awesome-dsh-plugin.com).
