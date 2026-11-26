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

`tests/fixtures/published-article.html` 提供可重复的公开页面导入测试。测试通过本地 HTTP 服务和临时 SQLite 数据库验证。
