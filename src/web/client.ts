export const styles = `
:root {
  color-scheme: light;
  --canvas: #f6f5f1;
  --paper: #fff;
  --ink: #232820;
  --muted: #5c6257;
  --line: #dcdfd5;
  --accent: #294b3e;
  --accent-hover: #1a382c;
  --warm: #f4ecd9;
  font: 1rem/1.55 system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  background: var(--canvas);
  color: var(--ink);
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
body { margin: 0; }
h1, h2, h3, p, ul, ol { margin: 0; }
h1 { font-size: clamp(1.75rem, 1.4rem + 1.4vw, 2.5rem); line-height: 1.3; letter-spacing: -.035em; }
h2 { font-size: 1.125rem; line-height: 1.4; }
h3 { font-size: 1rem; }
a { color: var(--accent); text-underline-offset: .18em; }
:focus-visible { outline: 3px solid #9b661d; outline-offset: 3px; }
.muted { color: var(--muted); }
.shell { width: min(100% - 3rem, 70rem); margin-inline: auto; }
.topbar { background: var(--paper); border-block-end: 1px solid var(--line); }
.topbar .shell { min-height: 4.375rem; display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.brand { display: inline-flex; align-items: center; gap: .625rem; color: var(--ink); text-decoration: none; font: 700 1.3rem Georgia, serif; }
.brand-mark { display: grid; place-items: center; width: 2rem; height: 2rem; border-radius: .5rem; color: #fae0a5; background: var(--accent); font-size: 1rem; }
.page { padding-block: clamp(1.75rem, 1rem + 3vw, 3.75rem); }
.intro { display: grid; gap: .5rem; margin-block-end: 1.75rem; overflow-wrap: anywhere; }
.dashboard { display: grid; grid-template-columns: minmax(0, 1fr) 18rem; gap: 1.5rem; align-items: start; }
.stack { display: grid; gap: 1.25rem; min-width: 0; }
.panel { padding: clamp(1rem, .65rem + 1vw, 1.625rem); border: 1px solid var(--line); border-radius: .875rem; background: var(--paper); min-width: 0; }
.panel > h2 { margin-block-end: 1rem; }
.workflow { background: #f1efe6; border-color: #ded9ca; }
.workflow ol { padding-inline-start: 1.25rem; display: grid; gap: 1rem; }
.workflow li::marker { color: #765123; font-weight: 700; }
.workflow li { padding-inline-start: .25rem; }
.workflow p, .hint { color: var(--muted); font-size: .875rem; }
.workflow p { margin-block-start: .25rem; }
.field { display: grid; gap: .375rem; min-width: 0; }
label, legend { font-weight: 650; }
fieldset { border: 0; margin: 0; padding: 0; min-width: 0; }
legend { margin-block-end: .5rem; padding: 0; }
.radios { display: flex; flex-wrap: wrap; gap: .25rem 1.125rem; }
.radios label { display: inline-flex; align-items: center; gap: .4rem; min-height: 3rem; font-weight: 500; }
input { font: inherit; accent-color: var(--accent); }
input:not([type=radio], [type=hidden]), textarea {
  font: inherit; font-size: max(1rem, 1em); width: 100%; min-height: 3rem; padding: .55rem .75rem;
  border: 1px solid #808676; border-radius: .5rem; background: var(--paper); color: var(--ink);
}
input[type=file] { padding: .3rem; color: var(--muted); }
input::file-selector-button { font: inherit; padding: .325rem .625rem; border: 0; border-radius: .25rem; margin-inline-end: .5rem; background: #edf1e9; color: var(--ink); cursor: pointer; }
input:user-invalid { border-color: #943936; }
textarea { resize: vertical; }
.form-row { display: flex; flex-wrap: wrap; align-items: start; gap: .625rem; }
.form-row > input { flex: 1 1 15rem; min-width: 0; }
button, .button {
  min-height: 3rem; display: inline-flex; align-items: center; justify-content: center; gap: .375rem;
  padding: .5rem .875rem; border: 1px solid transparent; border-radius: .5rem;
  font: inherit; font-weight: 650; text-decoration: none; cursor: pointer;
  color: #fff; background: var(--accent);
}
button:hover, .button:hover { background: var(--accent-hover); }
.secondary { border-color: #b4beb2; color: var(--accent); background: var(--paper); }
.secondary:hover { background: #edf1e9; }
.quiet { color: var(--muted); background: transparent; font-size: .875rem; }
.quiet:hover { background: #edf1e9; color: var(--ink); }
.password-field { display: flex; align-items: stretch; gap: .5rem; }
.password-field input { min-width: 0; }
.password-field button { flex: none; }
.signin { display: grid; justify-items: center; align-content: start; min-height: calc(100dvh - 4.375rem); padding-block: clamp(2rem, 12dvh, 7rem); }
.signin .panel { width: min(100%, 26rem); }
.signin h1 { font-size: 1.75rem; margin-block-end: 1.25rem; }
.signin .stack > button { width: 100%; }
.articles { list-style: none; padding: 0; }
.articles li { border-block-start: 1px solid var(--line); }
.articles a { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .625rem; padding-block: .875rem; text-decoration: none; }
.articles a:hover strong { text-decoration: underline; }
.articles strong, .articles small { display: block; overflow-wrap: anywhere; }
.articles small { color: var(--muted); }
.empty { padding: 1.25rem; border: 1px dashed #b9c1b3; border-radius: .625rem; color: var(--muted); }
.back { display: inline-flex; min-height: 3rem; align-items: center; }
.build-form { display: flex; flex-wrap: wrap; align-items: end; gap: 1rem; }
.build-form > .field { flex: 1 1 17rem; }
#cover-hint { margin-block-start: .5rem; }
.versions { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr)); gap: 1.25rem; align-items: start; }
.version { display: grid; gap: .875rem; }
.version > h2 { margin: 0; }
.version-head, .actions { display: flex; align-items: center; flex-wrap: wrap; gap: .5rem; }
.version-head { justify-content: space-between; }
.pill { padding: .2rem .65rem; border-radius: 2rem; background: #e8eee5; color: #2e4d3a; font-size: .875rem; }
.pill.attention { background: var(--warm); color: #5e3c16; }
.notice { padding: .75rem .875rem; border-inline-start: .2rem solid #946925; background: var(--warm); border-radius: .25rem; overflow-wrap: anywhere; }
.notice.error { border-inline-start-color: #943936; background: #f8e8e5; color: #74312e; }
.notes { padding-inline-start: 1.25rem; font-size: .875rem; overflow-wrap: anywhere; }
.details { border-block-start: 1px solid var(--line); padding-block-start: .75rem; }
.details summary { display: list-item; min-height: 2rem; font-weight: 650; cursor: pointer; }
.details form { padding-block-start: .5rem; }
.job { max-width: 37rem; }
.job .actions { margin-block-start: .25rem; }
@media (max-width: 52rem) {
  .dashboard { grid-template-columns: 1fr; gap: 1.25rem; }
}
@media (max-width: 36rem) {
  .shell { width: calc(100% - 1.5rem); }
  .form-row > button, .build-form > button { width: 100%; }
}
`;

export const script = `
const showPassword = document.querySelector("#show-password");
if (showPassword) {
  const input = document.querySelector("#password");
  showPassword.hidden = false;
  showPassword.addEventListener("click", () => {
    const visible = input.type === "password";
    input.type = visible ? "text" : "password";
    showPassword.setAttribute("aria-pressed", String(visible));
  });
}

const progress = document.querySelector("[data-job-status]");
if (progress) {
  const refresh = document.querySelector("#job-refresh");
  const next = document.querySelector("#job-next");
  async function update() {
    try {
      const response = await fetch(progress.dataset.jobStatus);
      if (!response.ok || response.redirected) return;
      const job = await response.json();
      progress.textContent = job.message;
      if (job.state === "running") {
        window.setTimeout(update, 1200);
        return;
      }
      progress.classList.toggle("error", job.state === "failed");
      next.href = job.href;
      next.hidden = job.href === "/";
      refresh.hidden = true;
    } catch {
      progress.textContent = "连接暂时中断。刷新进度可查看结果。";
    }
  }
  window.setTimeout(update, 700);
}
`;
