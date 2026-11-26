# Docker Compose 部署

Goldmine 可以和 Galley 同机部署。Compose 用同一个镜像运行网页后台和 CLI，把 SQLite、配置、快照、素材和构建保存在 `goldmine-data` 卷的 `/data` 目录。镜像包含 Wechatsync CLI、中文字体，以及供 Mermaid 渲染使用的 Chromium。

## 启动网页后台

### Docker Compose

在仓库目录新建或更新 `.env`。可以参考 `.env.example`。

- `GOLDMINE_ADMIN_PASSWORD` 是管理员密码，填写 12 到 256 个字符。
- 首次创建工作区时，用 `GOLDMINE_GALLEY_URL` 指定 Galley 站点，例如 `https://chenrg.com`。已有工作区使用 `config.json` 中的 `galley.baseUrl`。
- 正式同步草稿时，在 `WECHATSYNC_TOKEN` 中填入与浏览器扩展一致的桥接 Token。

```sh
docker compose up --build -d goldmine
```

### 本机运行

安装 Node.js 22.13 或更高版本和 pnpm 11。执行 `read` 后输入自选的管理员密码并回车。首次启动用 `--galley-url` 设置实际站点，已有工作区可省略该参数。

```sh
pnpm install --frozen-lockfile
pnpm build
read -r -s GOLDMINE_ADMIN_PASSWORD
export GOLDMINE_ADMIN_PASSWORD
pnpm goldmine serve --galley-url https://chenrg.com
```

需要在本机渲染 Mermaid 时，运行 `pnpm exec playwright install --only-shell chromium`。同步命令使用本机的 Wechatsync CLI。

### 登录与操作

在 [http://127.0.0.1:8787](http://127.0.0.1:8787) 使用账号 `admin` 和设置的密码登录。导入公开文章后，选择公众号或头条并生成预览。核对正文与封面，审核通过后可同步草稿。登录会话有效期为 8 小时，服务重启后需要重新登录。

后台和桥接端口默认发布到服务器回环地址。从自己的电脑访问远程服务器时，可同时转发网页和桥接端口。

```sh
ssh -N -L 127.0.0.1:8787:127.0.0.1:8787 \
  -L 127.0.0.1:9527:127.0.0.1:9527 user@server
```

扩展的桥接地址使用 `ws://127.0.0.1:9527`。更改 Compose 的 `GOLDMINE_WEB_PORT` 时，网页隧道两端使用相同的新端口。更改 `GOLDMINE_BRIDGE_PORT` 时，更新桥接隧道的服务器目标端口。用反向代理提供网页入口时，把 `GOLDMINE_WEB_ORIGIN` 设为实际 HTTPS origin，保留浏览器的 `Host`，并允许至少 13 MiB 的请求体以支持封面上传。

## 使用命令行生成预览

在服务器的仓库目录运行以下命令，替换站点地址和文章 slug。

```sh
docker compose build goldmine
docker compose run --rm goldmine init --galley-url https://blog.example.com
docker compose run --rm goldmine doctor
docker compose run --rm goldmine import article-slug
docker compose run --rm -v "$PWD/cover.png:/inputs/cover.png:ro" \
  goldmine build article-slug --platform wechat --cover /inputs/cover.png
docker compose run --rm goldmine build article-slug --platform toutiao
```

公众号构建可使用指定封面或正文首张可用的原图。把以下命令里的 `BUILD_ID` 替换为对应的构建 ID。

```sh
build_id=BUILD_ID
docker compose run --rm goldmine preview "$build_id"
docker compose run --rm goldmine sync "$build_id" --dry-run
docker compose run --rm -T --entrypoint tar goldmine \
  -C /data -cf - "builds/$build_id" assets > "$build_id-preview.tar"
```

把归档包下载到本机，在独立目录解包后打开 `builds/BUILD_ID/preview.html`。归档包保留了预览页与素材的相对路径，可以离线审核。用 `docker compose run --rm goldmine status article-slug` 查看进度。

## 使用命令行同步草稿

在本机 Chrome 的 Wechatsync 扩展中开启同步桥接，并登录目标平台。从本机终端建立 SSH 隧道，保持该终端运行。

```sh
ssh -N -L 127.0.0.1:9527:127.0.0.1:9527 user@server
```

扩展的桥接地址使用 `ws://127.0.0.1:9527`。在扩展和服务器的同步终端配置一致的 `WECHATSYNC_TOKEN`。服务器的桥接端口发布在 `127.0.0.1`。如果服务器的 9527 已占用，在运行 Compose 的环境中设置 `GOLDMINE_BRIDGE_PORT`，并把 SSH 转发的服务器目标端口改为该值。[Wechatsync 远程桥接文档](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/README.md#远程桥接)

确认预览后，审核者在服务器执行对应平台构建的命令。若网页后台已启动，可在页面同步。若要用一次性容器同步，先执行 `docker compose stop goldmine` 释放桥接端口。

```sh
docker compose run --rm goldmine review "$build_id" --approve
docker compose run --rm --service-ports goldmine sync "$build_id" --json
```

`--service-ports` 为这次同步发布桥接端口。同步后在平台草稿箱核对正文、图片、封面和摘要。结果为 `unknown` 时，在核对草稿箱后执行 `docker compose run --rm goldmine resolve ATTEMPT_ID --succeeded --note "已核对草稿箱"`，或用 `--failed` 记录明确失败的结果。[Compose 单次运行说明](https://docs.docker.com/reference/cli/docker/compose/run/)

## 升级和迁移

升级时继续使用原 Compose 项目和数据卷。网页后台用 `docker compose up --build -d goldmine` 更新，启动时会应用工作区迁移。只用命令行时，先执行 `docker compose build goldmine`，再执行 `docker compose run --rm goldmine init`。备份和迁移使用完整工作区。将本机工作区迁入容器时，把 `config.json` 中的 `publisher.command` 设置为容器内的 `wechatsync`。
