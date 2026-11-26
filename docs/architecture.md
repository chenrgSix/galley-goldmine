# 架构

Goldmine 是独立的 MIT 项目。CLI 负责处理参数与输出，核心模块负责工作区、数据模型和文章处理。Agent Skill 调用 CLI 组织工作流。第二个入口（本地界面或 MCP）出现前，编排逻辑留在各领域模块内，不单独设应用层。

## 上游接口

- Galley 的 `/posts/:slug` 使用公开文档加载器，服务端输出 `article.galley-article`。正文处于 `.galley-prose`，标题、分类和标签在文章外层。摘要使用页面元数据。[Galley 文章页](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/app/posts/%5Bslug%5D/page.tsx) · [Markdown 渲染](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/render/Markdown.tsx)
- Wechatsync CLI 支持 `platforms --auth` 和 `sync <file> -p <platform> --title <title> --cover <path> --dry-run`。Goldmine 将 `wechat` 映射为 `weixin`，头条使用 `toutiao`。草稿分发使用浏览器扩展的登录会话，默认桥接端口为 9527。CLI 退出码和草稿回执分别判断。[Wechatsync CLI 源码](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/src/index.ts) · [平台 ID](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/README.md)

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
- `platform_builds`：快照（`source_url` + `version`）、平台（`wechat`、`toutiao`）、修订号、标题、摘要、封面素材、HTML、Markdown 与 manifest 指纹、`bundle_sha256`、结构化警告、渲染器版本。
- `reviews`：构建、审核时的 `bundle_sha256`、结论（`approved`、`rejected`）、备注、时间。
- `sync_attempts`：构建、`bundle_sha256`、审核、模式（`dry_run`、`sync`）、状态、草稿链接、退出码、脱敏后的输出摘录、开始、截止与结束时间，以及人工核对的 `resolved_at` 和 `resolution_note`。

所有写入沿用现有顺序：先原子地写入完整文件，再用 SQLite 事务更新索引。中断后的重试可以复用已写入的文件。

## 导入

导入器使用 HTTP GET 获取同源公开文章，只解析元数据与正文容器。解析阶段保留相对正文链接，图片索引记录绝对 URL。抓取超时为 10 秒，单页上限为 12 MiB。相同 URL 的新内容会递增版本号，内容重复时复用文件。

本地 Galley 生产构建验证了冷启动和预热后的两种页面形态。导入器按页面中的插入标记还原延迟的正文片段，在 Mermaid 容器与组件序号一一对应时从公开的 React 数据中提取源码。整个过程使用静态解析。

## 转换

转换以快照为输入，正文 HTML 一律按不可信数据处理。

1. 解析正文并移除脚本、样式、iframe 和交互控件。知识块保留正文和出处，提示框保留类型，折叠块展开为带标题的静态块。相对链接按 `sourceUrl` 解析为绝对链接。
2. 正文图片写入 `assets/`。下载沿用导入器的协议、超时和大小限制，跨域下载及重定向只连接公网地址。图片无法读取时保留替代文字和阻断警告。
3. 公式从 KaTeX 的 `annotation[encoding="application/x-tex"]` 取 TeX 源码，用 MathJax 和 resvg 生成 PNG。Mermaid 通过可选的 Playwright 与 Chromium 生成 PNG。两种渲染器都按需加载，`doctor` 会检查 Mermaid 环境。渲染失败时保留源码和阻断警告。
4. 输出前按白名单清洗元素、属性和网址。无法静态化的交互组件保留可读内容并附提示。公众号使用内联样式，头条使用语义 HTML，两者均附带 Markdown。

静态化素材按「源码 + 渲染器版本 + 主题」生成缓存键，命中时复用已有 PNG。这样重复构建不会因图片字节变化而改变指纹。

## 标题、摘要和封面

`goldmine build` 通过 `--title`、`--summary`、`--cover` 覆写，最终值写入 manifest 和指纹。重建时沿用同一文章、同一平台上一次显式设置的值。默认标题和摘要随最新快照更新。

公众号默认选择正文第一张成功下载的原图。缺少封面时构建会提示使用 `--cover`，并阻断同步。头条可以不设封面。

同步时向 Wechatsync 传递标题、HTML 和封面文件。摘要写入 HTML 元数据和预览。已核对的公众号适配器自动生成摘要，草稿封面字段在该版本中留空。正式验收需要在登录后的草稿箱核对两平台的封面、摘要和排版。[Wechatsync 公众号适配器](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/core/src/adapters/platforms/weixin.ts)

## 审核

`bundle_sha256` 对以下内容的规范化 JSON 取 SHA-256：平台、标题、摘要、封面素材指纹、HTML 指纹、Markdown 指纹，以及按路径排序的素材指纹列表。

`preview.html` 只引用本地素材，并通过 CSP 禁止脚本。页面展示元数据、封面、素材清单和全部警告。

审核记录绑定 `bundle_sha256`。同步前从磁盘重新计算指纹，与最近一次审核比对。未审核、审核被拒或指纹不一致时，审核视为无效，禁止同步。重新导入、重新构建、修改文件和更换封面都会使审核失效。

## 分发

正式同步检查审核、构建指纹、阻断警告、同步历史和平台登录。通过后复制已验证的 HTML 和素材到临时目录，在事务内再次检查审核和同步历史并写入 `pending`，再调用 Wechatsync CLI。预演只验证文件并执行上游的 `--dry-run`。

- 目标平台返回草稿标识或可识别的草稿编辑链接时，记为 `succeeded`。
- 鉴权失败、参数错误等明确失败，记为 `failed`，可以重试。
- 超时、中断、素材传输不完整或缺少草稿证据时，记为 `unknown`。

同一文章和平台的相同指纹在成功后只能同步一次。较早构建的正在执行或待核对记录也会阻断该文章在该平台的同步。逾期的 `pending` 正式同步按 `unknown` 处理。用户在平台草稿箱核对后，用 `goldmine resolve` 保存结果、时间和备注。真实账号返回的草稿格式列入验收。

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

核心命令都支持 `--json`。CLI 强制校验指纹和重复提交。Agent Skill 把审核、正式同步和人工核对交给使用者。
