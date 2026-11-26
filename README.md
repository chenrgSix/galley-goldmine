# Galley Goldmine

[简体中文](README.zh-CN.md)

Galley Goldmine keeps local snapshots of published Galley articles and builds versions for WeChat Official Accounts and Toutiao. Each build has an offline preview, a review history, and a record of draft delivery through Wechatsync.

## Quick start

Use Node.js 22.13 or later and pnpm 11.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm goldmine init --galley-url https://blog.example.com
pnpm goldmine doctor
pnpm goldmine import https://blog.example.com/posts/article-slug
pnpm goldmine build article-slug --platform wechat --cover ./cover.png
pnpm goldmine preview BUILD_ID
pnpm goldmine sync BUILD_ID --dry-run
```

Replace the example site, article, cover, and `BUILD_ID` with your own values. Use `--platform toutiao` for Toutiao. For Mermaid articles, run `pnpm exec playwright install --only-shell chromium`. Draft delivery and dry runs use the Wechatsync executable from `publisher.command` in the workspace's `config.json`.

Open the file printed by `preview` to review the metadata, cover, body, and warnings. The operator runs `goldmine review BUILD_ID --approve`, then runs `goldmine sync BUILD_ID` with the signed-in browser extension. Use `goldmine status` to see the result. For an `unknown` attempt, check the platform's draft box and run `goldmine resolve ATTEMPT_ID` with `--succeeded` or `--failed` and a `--note`.

The workspace defaults to `~/.goldmine`. Set `--data-dir` or `GOLDMINE_HOME` to use a different directory. Running `init` again upgrades the workspace and preserves snapshots. Core commands support `--json`. Agents can follow the [Goldmine skill](skills/goldmine/SKILL.md).

See the [requirements](docs/requirements.md), [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [development guide](docs/development.md). Licensed under [MIT](LICENSE).
