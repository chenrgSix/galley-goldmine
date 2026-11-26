# Galley Goldmine

[简体中文](README.zh-CN.md)

Galley Goldmine imports published Galley articles into a local workspace and keeps a version history. The v0.1 roadmap adds conversion, review, and draft delivery to WeChat Official Accounts and Toutiao through Wechatsync.

## Quick start

Use Node.js 22.13 or later and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm goldmine init --galley-url https://blog.example.com
pnpm goldmine doctor
pnpm goldmine import https://blog.example.com/posts/article-slug
pnpm goldmine list
```

Replace the examples with your Galley site and an article URL. With a configured site, `import` also accepts a slug. Set `--data-dir` or `GOLDMINE_HOME` to change the workspace location from `~/.goldmine`. Rerunning initialization preserves existing configuration and snapshots.

The importer captures article metadata, rendered body HTML, and image URLs. Repeat imports of identical content reuse the current snapshot. Use `import --json` and `list --json` for structured output. Agents can follow the [Goldmine skill](skills/goldmine/SKILL.md).

See the [requirements](docs/requirements.md), [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development guide](docs/development.md). Licensed under [MIT](LICENSE).
