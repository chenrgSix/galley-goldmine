# 架构

Goldmine 是独立的 MIT 项目。CLI 负责处理参数与输出，核心模块负责工作区、数据模型和文章处理。Agent Skill 调用 CLI 组织工作流。

## 上游接口

- Galley 的 `/posts/:slug` 使用公开文档加载器，服务端输出 `article.galley-article`。正文处于 `.galley-prose`，标题、分类和标签在文章外层。摘要使用页面元数据。[Galley 文章页](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/app/posts/%5Bslug%5D/page.tsx) · [Markdown 渲染](https://github.com/codexiaoke/galley/blob/00fb35ab065ce2fa524c270526d56c6335e3f117/src/render/Markdown.tsx)
- Wechatsync CLI 支持 `platforms --auth` 和 `sync <file> -p <platform> --title <title> --cover <path> --dry-run`。草稿分发依赖浏览器扩展的登录会话，桥接默认端口为 9527。CLI 退出码和草稿结果需要分别判断。[Wechatsync CLI 源码](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/src/index.ts) · [CLI 文档](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/README.md)

## 数据

工作区默认在 `~/.goldmine`。配置存放在 `config.json`。后续工作流以 SQLite 管理文章、版本、审核与同步记录，文件系统保存正文及素材。内容转换从指定快照生成平台版本。
