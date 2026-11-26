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
