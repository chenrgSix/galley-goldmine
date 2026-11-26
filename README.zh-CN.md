# Galley Goldmine

[English](README.md)

Galley Goldmine 是 Galley 的本地内容分发工具。v0.1 面向微信公众号和今日头条，计划由 Goldmine 转换已发布文章，经人工审核后通过 Wechatsync 同步草稿。

## 快速开始

使用 Node.js 22.13 或更高版本和 pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm goldmine init --galley-url https://blog.example.com
pnpm goldmine doctor
```

将示例地址替换为自己的 Galley 站点。省略 `--galley-url` 时可以使用完整文章地址。数据默认存放在 `~/.goldmine`，可通过 `--data-dir` 或 `GOLDMINE_HOME` 指定。重复初始化会保留已有配置。

参见[需求](docs/requirements.md)、[架构](docs/architecture.md)、[路线图](docs/roadmap.md)和[开发说明](docs/development.md)。项目采用 [MIT](LICENSE) 许可。
