# Galley Goldmine

[English](README.md)

Galley Goldmine 可将 Galley 的公开文章导入本地并保留版本。v0.1 后续将支持文章转换、人工审核，以及通过 Wechatsync 同步微信公众号和今日头条草稿。

## 快速开始

使用 Node.js 22.13 或更高版本和 pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm goldmine init --galley-url https://blog.example.com
pnpm goldmine doctor
pnpm goldmine import https://blog.example.com/posts/article-slug
pnpm goldmine list
```

将示例替换为你的 Galley 站点和文章地址。配置站点后，`import` 也接受文章 slug。数据默认存放在 `~/.goldmine`，可通过 `--data-dir` 或 `GOLDMINE_HOME` 指定。重复初始化会保留已有配置和快照。

每份快照包含文章元数据、渲染后的正文 HTML 和图片 URL。文章内容相同时会复用当前快照。`import` 和 `list` 支持 `--json`。Agent 可使用 [Goldmine Skill](skills/goldmine/SKILL.md)。

参见[需求](docs/requirements.md)、[架构](docs/architecture.md)、[路线图](docs/roadmap.md)和[开发说明](docs/development.md)。项目采用 [MIT](LICENSE) 许可。
