# Galley Goldmine

[简体中文](README.zh-CN.md)

Galley Goldmine is a local-first CLI for adapting published Galley articles for WeChat Official Accounts and Toutiao. Wechatsync handles draft delivery in the planned v0.1 workflow.

## Quick start

Use Node.js 22.13 or later and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm goldmine init --galley-url https://blog.example.com
pnpm goldmine doctor
```

Replace the example URL with your Galley site, or omit `--galley-url` to use full article URLs. The workspace lives in `~/.goldmine`. Use `--data-dir` or `GOLDMINE_HOME` for a different location. Rerunning initialization preserves existing configuration.

See the [requirements](docs/requirements.md), [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development guide](docs/development.md). Licensed under [MIT](LICENSE).
