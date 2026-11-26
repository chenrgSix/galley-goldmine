# 架构

Goldmine 是独立的 MIT 项目。CLI 负责处理参数与输出，核心模块负责工作区、数据模型和文章处理。Agent Skill 调用 CLI 组织工作流。

## 上游接口

- Galley 的 `/posts/:slug` 使用公开文档加载器，服务端输出 `article.galley-article`。正文处于 `.galley-prose`，标题、分类和标签在文章外层。摘要使用页面元数据。[Galley 文章页](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/app/posts/%5Bslug%5D/page.tsx) · [Markdown 渲染](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/render/Markdown.tsx)
- Wechatsync CLI 支持 `platforms --auth` 和 `sync <file> -p <platform> --title <title> --cover <path> --dry-run`。草稿分发依赖浏览器扩展的登录会话，桥接默认端口为 9527。CLI 退出码和草稿结果需要分别判断。[Wechatsync CLI 源码](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/src/index.ts) · [CLI 文档](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/README.md)

## 数据

工作区默认在 `~/.goldmine`。`config.json` 保存 Galley 站点和 Wechatsync CLI 路径。`goldmine.db` 使用 SQLite 与 Drizzle 保存文章和版本索引。`snapshots/<sha256>.json` 保存元数据、原始正文片段和图片引用。

导入器使用 HTTP GET 获取同源公开文章，只解析元数据与正文容器。解析阶段保留相对正文链接，图片索引记录绝对 URL。抓取超时为 10 秒，单页上限为 12 MiB。转换阶段需要对正文 HTML 做清洗和静态化处理，再用于预览或平台草稿。

相同 URL 的新内容会递增版本号，内容重复时复用文件。系统先原子地写入完整快照，再用 SQLite 事务更新索引。中断后的重试可以复用已写入的快照。迁移 SQL 位于 `drizzle/`，`goldmine init` 会在事务内应用迁移。
