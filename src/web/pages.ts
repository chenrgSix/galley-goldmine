import type { Platform } from "../core/db/schema.js";
import { httpUrl } from "../core/http.js";
import type { SnapshotEntry } from "../importer/snapshots.js";
import type { distributionStatus } from "../review/status.js";
import { escapeHtml } from "../transform/formats.js";

type Article = ReturnType<typeof distributionStatus>[number];
type Attempt = Article["builds"][number]["attempts"][number];

export interface JobView {
  id: string;
  title: string;
  state: "running" | "done" | "failed";
  message: string;
  href: string;
}

export const platformNames: Record<Platform, string> = { wechat: "微信公众号", toutiao: "今日头条" };
const reviewNames = {
  unreviewed: "待审核", approved: "已审核", rejected: "已退回", invalid: "审核已失效", superseded: "需重新构建",
};
const attemptNames = { pending: "进行中", succeeded: "已成功", failed: "失败", unknown: "待核对" };

export function articleHref(sourceUrl: string) {
  return `/article?source=${encodeURIComponent(sourceUrl)}`;
}

function hidden(name: string, value: string | number) {
  return `<input type="hidden" name="${name}" value="${escapeHtml(String(value))}">`;
}

function documentPage(title: string, body: string, csrf?: string, className = "page") {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · Goldmine</title>
  <link rel="stylesheet" href="/app.css">
  <script src="/app.js" defer></script>
</head>
<body>
  <header class="topbar"><div class="shell">
    <a class="brand" href="/"><span class="brand-mark" aria-hidden="true">G</span>Goldmine</a>
    ${csrf ? `<form method="post" action="/logout">${hidden("csrf", csrf)}<button type="submit" class="quiet">退出登录</button></form>` : ""}
  </div></header>
  <main class="shell ${className}">${body}</main>
</body>
</html>`;
}

export function loginPage(message?: string) {
  return documentPage("登录", `
<section class="panel">
  <h1 id="login-heading">登录内容分发后台</h1>
  <form method="post" action="/login" class="stack" aria-labelledby="login-heading">
    ${message ? `<p class="notice error" role="alert">${escapeHtml(message)}</p>` : ""}
    <div class="field">
      <label for="username">账号</label>
      <input id="username" name="username" autocomplete="username" autocorrect="off" autocapitalize="none"
        spellcheck="false" enterkeyhint="next" maxlength="80" value="admin" required>
    </div>
    <div class="field">
      <label for="password">密码</label>
      <div class="password-field">
        <input id="password" name="password" type="password" autocomplete="current-password" enterkeyhint="done" maxlength="256" required>
        <button id="show-password" type="button" class="secondary" aria-pressed="false" hidden>显示密码</button>
      </div>
    </div>
    <button type="submit">登录</button>
  </form>
</section>`, undefined, "signin");
}

function activeNotice(job?: JobView) {
  if (job?.state !== "running") return "";
  return `<p class="notice">${escapeHtml(job.message)} <a href="/jobs/${job.id}">查看进度</a></p>`;
}

export function dashboardPage(articles: SnapshotEntry[], galleyOrigin: string | null, csrf: string, job?: JobView) {
  const rows = articles.map((article) => `
    <li><a href="${articleHref(article.sourceUrl)}">
      <span><strong>${escapeHtml(article.title)}</strong><small>${escapeHtml(article.slug)}</small></span>
      <span class="pill">快照 v${article.version}</span>
    </a></li>`).join("");
  return documentPage("文章工作区", `
<header class="intro"><h1>文章工作区</h1><p class="muted">导入 Galley 文章，生成公众号或头条草稿。</p></header>
<div class="dashboard">
  <div class="stack">
    ${activeNotice(job)}
    <section class="panel">
      <h2 id="import-heading">导入文章</h2>
      ${galleyOrigin ? `<form class="field" method="post" action="/import" aria-labelledby="import-heading">
        ${hidden("csrf", csrf)}
        <label for="source">公开文章链接或 slug</label>
        <div class="form-row">
          <input id="source" name="source" placeholder="${escapeHtml(galleyOrigin)}/posts/article-slug"
            aria-describedby="source-hint" autocapitalize="none" spellcheck="false" maxlength="2048" required>
          <button type="submit">导入</button>
        </div>
        <p id="source-hint" class="hint">从 ${escapeHtml(galleyOrigin)} 读取文章。同一链接可以再次导入以更新快照。</p>
      </form>` : `<p class="notice">设置工作区的 Galley 站点后即可导入。首次启动可用 <code>serve --galley-url</code>，已有工作区可更新配置中的 <code>galley.baseUrl</code>。</p>`}
    </section>
    <section class="panel" aria-labelledby="articles-heading">
      <h2 id="articles-heading">已导入文章</h2>
      ${rows ? `<ul class="articles">${rows}</ul>` : `<p class="empty">还没有文章。先导入一篇 Galley 的公开文章。</p>`}
    </section>
  </div>
  <aside class="panel workflow" aria-labelledby="workflow-heading">
    <h2 id="workflow-heading">发布流程</h2>
    <ol>
      <li><strong>导入文章</strong><p>复制公开文章链接，保存一个快照。</p></li>
      <li><strong>构建并预览</strong><p>选择平台，核对正文、封面和构建提示。</p></li>
      <li><strong>审核并同步草稿</strong><p>确认预览后批准版本。打开 Wechatsync 桥接，登录目标平台后同步草稿。</p></li>
    </ol>
  </aside>
</div>`, csrf);
}

function attemptLine(label: string, attempt: Attempt | undefined) {
  if (!attempt) return "";
  const draft = attempt.draftUrl && httpUrl(attempt.draftUrl);
  return `<p>${label} · ${attemptNames[attempt.status]}${draft
    ? ` · <a href="${escapeHtml(draft.href)}" target="_blank" rel="noreferrer">打开平台草稿</a>` : ""}</p>
    ${attempt.outputExcerpt && attempt.status !== "succeeded"
      ? `<p class="hint">${escapeHtml(attempt.outputExcerpt)}</p>` : ""}`;
}

function resolutionForm(attempt: Attempt, csrf: string) {
  return `<details class="details">
    <summary>记录草稿箱核对结果</summary>
    <form class="field" method="post" action="/resolve" aria-label="记录草稿箱核对结果">
      ${hidden("csrf", csrf)}${hidden("attempt", attempt.id)}
      <label for="resolution-${attempt.id}">核对备注</label>
      <textarea id="resolution-${attempt.id}" name="note" rows="2" maxlength="500" required></textarea>
      <div class="actions">
        <button type="submit" name="resolution" value="succeeded">已找到草稿</button>
        <button type="submit" name="resolution" value="failed" class="secondary">确认未创建</button>
      </div>
    </form>
  </details>`;
}

function platformCard(article: Article, platform: Platform, csrf: string) {
  const builds = article.builds.filter((build) => build.platform === platform);
  const label = platformNames[platform];
  const build = builds[0];
  if (!build) return `<section class="panel version"><h2>${label}</h2><p class="muted">尚未构建。选择该平台后生成预览。</p></section>`;

  const current = build.reviewState !== "superseded";
  const approved = build.reviewState === "approved";
  const blocked = build.warnings.some((issue) => issue.severity === "blocking");
  const dryRun = build.attempts.find((attempt) => attempt.mode === "dry_run");
  const attempts = builds.flatMap((item) => item.attempts);
  const unresolved = attempts.find((attempt) =>
    attempt.mode === "sync" && (attempt.status === "unknown" || attempt.status === "pending"));
  const alreadySynced = attempts.find((attempt) =>
    attempt.mode === "sync" && attempt.status === "succeeded" && attempt.bundleSha256 === build.bundleSha256);
  const formal = build.attempts.find((attempt) => attempt.mode === "sync") ?? alreadySynced;
  const warnings = build.warnings.map((warning) => `<li>${warning.severity === "blocking" ? "阻断" : "提示"} · ${escapeHtml(warning.message)}</li>`);
  const buildFormFields = hidden("csrf", csrf) + hidden("build", build.id);
  return `<section class="panel version">
    <div class="version-head"><h2>${label}</h2><span class="pill${approved ? "" : " attention"}">${reviewNames[build.reviewState]}</span></div>
    <p class="hint">快照 v${build.version} · 构建 ${build.revision}</p>
    ${warnings.length ? `<ul class="notes">${warnings.join("")}</ul>` : ""}
    <div class="actions">
      <a class="button secondary" href="/builds/${encodeURIComponent(build.id)}/preview.html" target="_blank" rel="noopener"
        aria-label="打开${label}预览">打开预览</a>
      ${current && !blocked ? `<form method="post" action="/review" class="actions" aria-label="审核${label}版本">
        ${buildFormFields}
        ${approved ? "" : `<button type="submit" name="decision" value="approved">审核通过</button>`}
        ${build.reviewState === "rejected" ? "" : `<button type="submit" name="decision" value="rejected" class="secondary">退回</button>`}
      </form>` : ""}
    </div>
    ${current ? `<form method="post" action="/sync" class="actions" aria-label="同步${label}版本">
      ${buildFormFields}
      <button type="submit" name="mode" value="dry-run" class="secondary">同步预演</button>
      ${approved && !blocked && !unresolved && !alreadySynced
        ? `<button type="submit" name="mode" value="draft">同步到草稿箱</button>` : ""}
    </form>` : ""}
    ${blocked ? `<p class="notice">解决阻断项后重新构建。公众号缺少封面时可上传一张封面。</p>` : ""}
    ${attemptLine("预演", dryRun)}
    ${attemptLine("草稿同步", formal)}
    ${unresolved && unresolved.id !== formal?.id ? attemptLine("之前版本的草稿同步", unresolved) : ""}
    ${unresolved?.status === "unknown" ? resolutionForm(unresolved, csrf) : ""}
  </section>`;
}

export function articlePage(article: Article, csrf: string, job?: JobView) {
  const source = httpUrl(article.sourceUrl);
  return documentPage(article.title, `
<a class="back" href="/">← 文章工作区</a>
<header class="intro">
  <h1>${escapeHtml(article.title)}</h1>
  <p class="muted">快照 v${article.version}${source
    ? ` · <a href="${escapeHtml(source.href)}" target="_blank" rel="noreferrer">打开源文章</a>` : ""}</p>
</header>
<div class="stack">
  ${activeNotice(job)}
  <section class="panel">
    <h2 id="build-heading">构建平台版本</h2>
    <form method="post" action="/build" enctype="multipart/form-data" class="build-form" aria-labelledby="build-heading">
      ${hidden("csrf", csrf)}${hidden("source", article.sourceUrl)}
      <fieldset>
        <legend>目标平台</legend>
        <div class="radios">
          <label><input type="radio" name="platform" value="wechat" checked> 微信公众号</label>
          <label><input type="radio" name="platform" value="toutiao"> 今日头条</label>
        </div>
      </fieldset>
      <div class="field">
        <label for="cover">封面（选填）</label>
        <input type="file" id="cover" name="cover" accept="image/png,image/jpeg,image/gif,image/webp" aria-describedby="cover-hint">
      </div>
      <button type="submit">生成预览</button>
    </form>
    <p id="cover-hint" class="hint">封面不超过 12 MiB。公众号可用正文首张可用图片作封面。</p>
  </section>
  <div class="versions">${platformCard(article, "wechat", csrf)}${platformCard(article, "toutiao", csrf)}</div>
  <p class="hint">正式同步前，在 Wechatsync 扩展中登录对应平台并打开桥接。同步后请在平台草稿箱核对内容。</p>
</div>`, csrf);
}

export function jobPage(job: JobView, csrf: string) {
  return documentPage(job.title, `<section class="panel stack job">
    <h1>${escapeHtml(job.title)}</h1>
    <p class="notice${job.state === "failed" ? " error" : ""}" role="status"
      ${job.state === "running" ? `data-job-status="/jobs/${job.id}?status=1"` : ""}>${escapeHtml(job.message)}</p>
    <div class="actions">
      <a id="job-next" class="button" href="${escapeHtml(job.href)}"${job.state === "running" || job.href === "/" ? " hidden" : ""}>打开文章</a>
      ${job.state === "running" ? `<a id="job-refresh" class="button secondary" href="/jobs/${job.id}">刷新进度</a>` : ""}
      <a href="/">文章工作区</a>
    </div>
  </section>`, csrf);
}

export function errorPage(message: string, csrf?: string) {
  return documentPage("无法完成操作", `<section class="panel stack job">
    <h1>无法完成操作</h1>
    <p class="notice error" role="alert">${escapeHtml(message)}</p>
    <div><a class="button secondary" href="${csrf ? "/" : "/login"}">${csrf ? "返回工作区" : "返回登录"}</a></div>
  </section>`, csrf);
}
