# Docker Compose 部署

Goldmine 可以和 Galley 同机部署。Compose 用一次性容器执行 CLI，把 SQLite、配置、快照、素材和构建保存在 `goldmine-data` 卷的 `/data` 目录。镜像包含 Wechatsync CLI、中文字体，以及供 Mermaid 渲染使用的 Chromium。

## 初始化并生成预览

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

## 正式同步草稿

在本机 Chrome 的 Wechatsync 扩展中开启同步桥接，并登录目标平台。从本机终端建立 SSH 隧道，保持该终端运行。

```sh
ssh -N -L 127.0.0.1:9527:127.0.0.1:9527 user@server
```

扩展的桥接地址使用 `ws://127.0.0.1:9527`。在扩展和服务器的同步终端配置一致的 `WECHATSYNC_TOKEN`。服务器的桥接端口发布在 `127.0.0.1`。如果服务器的 9527 已占用，在运行 Compose 的环境中设置 `GOLDMINE_BRIDGE_PORT`，并把 SSH 转发的服务器目标端口改为该值。[Wechatsync 远程桥接文档](https://github.com/wechatsync/Wechatsync/blob/1230678434e180697e288106d9a9a4e11d84a028/packages/cli/README.md#远程桥接)

确认预览后，审核者在服务器执行对应平台构建的命令。

```sh
docker compose run --rm goldmine review "$build_id" --approve
docker compose run --rm --service-ports goldmine sync "$build_id" --json
```

`--service-ports` 为这次同步发布桥接端口。同步后在平台草稿箱核对正文、图片、封面和摘要。结果为 `unknown` 时，在核对草稿箱后执行 `docker compose run --rm goldmine resolve ATTEMPT_ID --succeeded --note "已核对草稿箱"`，或用 `--failed` 记录明确失败的结果。[Compose 单次运行说明](https://docs.docker.com/reference/cli/docker/compose/run/)

## 升级和迁移

升级时在同一个 Compose 项目中重新执行 `docker compose build goldmine` 和 `docker compose run --rm goldmine init`，继续使用原数据卷。备份和迁移使用完整工作区。将本机工作区迁入容器时，把 `config.json` 中的 `publisher.command` 设置为容器内的 `wechatsync`。
