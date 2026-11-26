# 开发

使用 Node.js 22.13 或更高版本和 pnpm 11。

```sh
pnpm install --frozen-lockfile
pnpm check
```

用临时工作区检查构建产物。

```sh
goldmine_test_dir="$(mktemp -d)"
pnpm goldmine --data-dir "$goldmine_test_dir" init
pnpm goldmine --data-dir "$goldmine_test_dir" doctor
```

CLI 安装后的命令名是 `goldmine`。在源代码仓库中使用 `pnpm goldmine` 调用构建产物。

SQLite 使用 `better-sqlite3` 驱动。数据库结构变更需同时更新 `src/core/db/schema.ts`，在 `drizzle/` 添加 SQL，并在 `src/core/db/client.ts` 注册迁移。

`tests/fixtures/published-article.html` 记录了 Galley 生产页的组件和流式片段结构。测试使用本地 HTTP 服务、临时 SQLite 和模拟的分发命令。

验证 Mermaid 前可运行 `pnpm exec playwright install --only-shell chromium`，然后通过 `doctor` 检查。验证分发预演时使用 Wechatsync CLI（已核对 npm 包 `@wechatsync/cli@1.1.0`）。在测试工作区的 `config.json` 中可用 `publisher.command` 指定可执行文件。
