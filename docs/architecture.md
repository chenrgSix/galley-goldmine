# 架构

Goldmine 是独立的 MIT 项目。CLI 负责处理参数与输出，核心模块负责工作区、数据模型和文章处理。Agent Skill 调用 CLI 组织工作流。第二个入口（本地界面或 MCP）出现前，编排逻辑留在各领域模块内，不单独设应用层。

## 上游接口

- Galley 的 `/posts/:slug` 使用公开文档加载器，服务端输出 `article.galley-article`。正文处于 `.galley-prose`，标题、分类和标签在文章外层。摘要使用页面元数据。[Galley 文章页](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/app/posts/%5Bslug%5D/page.tsx) · [Markdown 渲染](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/render/Markdown.tsx)
- Wechatsync CLI 支持 `platforms --auth` 和 `sync <file> -p <platform> --title <title> --cover <path> --dry-run`。草稿分发依赖浏览器扩展的登录会话，桥接默认端口为 9527。CLI 退出码和草稿结果需要分别判断。[Wechatsync CLI 源码](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/src/index.ts) · [CLI 文档](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/README.md)

## 模块

| 目录 | 职责 |
| --- | --- |
| `src/cli/` | 命令定义、文本与 `--json` 输出、退出码 |
| `src/core/` | 配置、工作区路径、原子写入、内容寻址素材、SQLite 与迁移 |
| `src/importer/` | 抓取公开文章并保存不可变快照 |
| `src/transform/` | 清洗正文、规范化 Galley 组件、静态化、素材本地化、平台适配 |
| `src/review/` | 计算构建指纹、生成预览、记录审核 |
| `src/publisher/` | 调用 Wechatsync CLI、判定结果、防止重复提交 |

## 数据

工作区默认在 `~/.goldmine`。

- `config.json` 保存 Galley 站点和 Wechatsync CLI 路径。
- `goldmine.db` 使用 SQLite 与 Drizzle 保存索引。迁移 SQL 位于 `drizzle/`，`goldmine init` 会在事务内应用迁移。
- `snapshots/<sha256>.json` 保存元数据、原始正文片段和图片引用。
- `assets/<sha256>.<ext>` 保存下载的图片、静态化图片和封面，跨文章复用。
- `builds/<build-id>/` 保存某个快照的一个平台版本：`article.html`、`article.md`、`manifest.json` 和 `preview.html`。构建目录写入完成后不再修改。

数据库在现有 `articles`、`article_snapshots` 之外新增四张表：

- `assets`：`sha256`、类型（`image`、`mermaid`、`katex`、`cover`）、来源、缓存键、MIME、字节数、宽高。
- `platform_builds`：快照（`source_url` + `version`）、平台（`wechat`、`toutiao`）、修订号、标题、摘要、封面素材、HTML 与 Markdown 指纹、`bundle_sha256`、结构化警告、渲染器版本。
- `reviews`：构建、审核时的 `bundle_sha256`、结论（`approved`、`rejected`）、备注、时间。
- `sync_attempts`：构建、`bundle_sha256`、审核、模式（`dry_run`、`sync`）、状态、草稿链接、退出码、脱敏后的输出摘录、开始与结束时间，以及人工核对的 `resolved_at` 和 `resolution_note`。

所有写入沿用现有顺序：先原子地写入完整文件，再用 SQLite 事务更新索引。中断后的重试可以复用已写入的文件。

## 导入

导入器使用 HTTP GET 获取同源公开文章，只解析元数据与正文容器。解析阶段保留相对正文链接，图片索引记录绝对 URL。抓取超时为 10 秒，单页上限为 12 MiB。相同 URL 的新内容会递增版本号，内容重复时复用文件。

## 转换

转换以快照为输入，正文 HTML 一律按不可信数据处理。

1. 白名单清洗：去除脚本、样式、iframe、事件属性和危险 URL。无法还原的组件记为警告，保留可读文本。
2. 规范化 Galley 组件：识别知识块、提示框、折叠内容、代码块、公式和 Mermaid。折叠内容展开为带标题的静态块。相对链接按 `sourceUrl` 解析为绝对链接。
3. 静态化：公式取 TeX 源码，用 MathJax 生成 SVG，再用 resvg 转为 PNG，不依赖浏览器。Mermaid 用 Playwright 渲染为 PNG。Playwright 是可选依赖，只在文章含 Mermaid 时加载，由 `doctor` 检查。渲染失败或依赖缺失时保留代码块并记录阻断警告。平台输出统一使用 PNG。
4. 素材本地化：下载正文图片，沿用导入器的协议、超时和大小限制，写入 `assets/`。
5. 平台适配：公众号输出内联样式的 HTML，头条输出简洁的语义 HTML，两者都附带 Markdown。

静态化素材按「源码 + 渲染器版本 + 主题」生成缓存键，命中时复用已有 PNG。这样重复构建不会因图片字节变化而改变指纹。

Galley 页面中公式、Mermaid、提示框和知识块的实际结构需要先用真实文章确认，再编写选择器。公式源码预计位于 KaTeX 的 `annotation[encoding="application/x-tex"]`。

## 标题、摘要和封面

`goldmine build` 通过 `--title`、`--summary`、`--cover` 覆写，最终值写入 manifest 和指纹。同一文章、同一平台重新构建时，未传入的项沿用上次构建的值；首次构建时标题和摘要取自快照。不使用单独的覆写文件。

公众号未指定封面时使用正文第一张图并记录警告，没有图片时禁止同步。头条可以不设封面。平台对封面尺寸和格式的要求需在接入时用已登录账号核实。

## 审核

`bundle_sha256` 对以下内容的规范化 JSON 取 SHA-256：平台、标题、摘要、封面素材指纹、HTML 指纹、Markdown 指纹，以及按路径排序的素材指纹列表。

`preview.html` 只引用本地素材，并通过 CSP 禁止脚本。页面展示元数据、封面、素材清单和全部警告。

审核记录绑定 `bundle_sha256`。同步前从磁盘重新计算指纹，与最近一次审核比对。未审核、审核被拒或指纹不一致时，审核视为无效，禁止同步。重新导入、重新构建、修改文件和更换封面都会使审核失效。

## 分发

同步前依次检查：审核有效、平台已登录、没有阻断警告、没有重复提交或未核对的同步记录。检查通过后，先写入 `pending` 记录，再调用 Wechatsync CLI。

- 输出中能确认草稿链接或成功标识时，记为 `succeeded`。
- 鉴权失败、参数错误等明确失败，记为 `failed`，可以重试。
- 超时、中断，或退出码为 0 却没有草稿证据，记为 `unknown`。

同一构建、同一指纹已有 `succeeded` 时拒绝重复提交。存在 `unknown` 时阻断同步，直到用户在平台草稿箱核对后用 `goldmine resolve` 将其改为 `succeeded` 或 `failed`，并写入核对时间和备注。Wechatsync 成功输出的具体格式需要接入时用真实账号确认。

`WECHATSYNC_TOKEN` 只从环境变量读取，仅传给需要鉴权的子进程，不写入数据库、日志或输出。

## 命令

| 命令 | 说明 |
| --- | --- |
| `init`、`doctor` | 初始化工作区；检查配置、数据库、Wechatsync CLI 和 Playwright |
| `import`、`list` | 导入公开文章快照；列出各文章的最新快照 |
| `build <article>` | 生成平台版本，支持 `--platform`、`--title`、`--summary`、`--cover` |
| `preview <build-id>` | 输出预览路径、警告和素材清单 |
| `review <build-id>` | `--approve` 或 `--reject`，可附 `--note` |
| `sync <build-id>` | 支持 `--dry-run`；正式同步需要有效审核 |
| `resolve <attempt-id>` | 将 `unknown` 核对为 `--succeeded`（可附 `--draft-url`）或 `--failed`，需附 `--note` |
| `status [article]` | 汇总快照、构建、审核有效性和同步状态 |

核心命令都支持 `--json`。CLI 能强制的是指纹校验和重复提交检查。审核、正式同步和人工核对属于人工确认步骤，由 Agent Skill 约定 Agent 不得代为执行。
