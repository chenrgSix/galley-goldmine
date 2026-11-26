# Galley Goldmine

[English](README.md)

Galley Goldmine 为 Galley 的公开文章保留本地快照，生成微信公众号和今日头条的文章版本。每个版本都有离线预览、人工审核记录和 Wechatsync 草稿同步状态。

## 网页后台

在浏览器登录后，可按页面提示导入文章、生成平台预览、审核并同步草稿。参见[网页后台启动说明](docs/deployment.md#启动网页后台)，支持本机运行和 Docker Compose。

## 命令行快速开始

使用 Node.js 22.13 或更高版本和 pnpm 11。

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

将站点、文章、封面和 `BUILD_ID` 替换为实际值。头条构建使用 `--platform toutiao`。文章含 Mermaid 时，运行 `pnpm exec playwright install --only-shell chromium` 安装渲染环境。预演和同步使用 Wechatsync CLI，可在工作区的 `config.json` 设置 `publisher.command`。

打开 `preview` 输出的文件核对标题、摘要、封面、正文和警告。确认后由使用者执行 `goldmine review BUILD_ID --approve`，再使用已登录的浏览器扩展执行 `goldmine sync BUILD_ID`。用 `goldmine status` 查看结果。遇到 `unknown` 时，在草稿箱核对后用 `goldmine resolve ATTEMPT_ID --succeeded` 或 `--failed`，并附上 `--note`。

数据默认放在 `~/.goldmine`，可通过 `--data-dir` 或 `GOLDMINE_HOME` 指定。再次执行 `init` 会升级现有工作区并保留快照。核心命令支持 `--json`。Agent 的操作范围见 [Goldmine Skill](skills/goldmine/SKILL.md)。

服务器可按 [Docker Compose 部署](docs/deployment.md)配置持久工作区和浏览器桥接。

参见[需求](docs/requirements.md)、[架构](docs/architecture.md)、[路线图](docs/roadmap.md)和[开发说明](docs/development.md)。项目采用 [MIT](LICENSE) 许可。
