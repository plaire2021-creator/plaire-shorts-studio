// 영상 생성: zip 풀기 → Claude Code를 백그라운드(-p)로 실행해 plaire-product-shorts 스킬(스튜디오 모드)을 돌린다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { PLUGIN_ROOT, jobDir, loadConfig, loadJob, saveJob } from "./store.js";

const PY = process.platform === "win32" ? "python" : "python3";
const SHORTS = path.join(PLUGIN_ROOT, "scripts", "shorts.py");
const running = new Map(); // job id -> child process

// Claude Code 실행 파일 찾기: 설정값 → PATH의 claude → 데스크톱 앱에 들어있는 최신 claude.exe
export function findClaude() {
  const c = loadConfig().claude_path;
  if (c && fs.existsSync(c)) return c;
  // 설치 키트가 깐 Claude Code (%USERPROFILE%\.local\bin\claude.exe)
  const native = path.join(os.homedir(), ".local", "bin", process.platform === "win32" ? "claude.exe" : "claude");
  if (fs.existsSync(native)) return native;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" });
  const hits = (which.stdout || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // 윈도에선 .cmd 는 바로 실행이 안 돼서 .exe 만 쓴다
  const hit = process.platform === "win32" ? hits.find((l) => /\.exe$/i.test(l)) : hits[0];
  if (which.status === 0 && hit) return hit;
  // 데스크톱 앱(스토어 설치)은 %LOCALAPPDATA%\Packages\Claude_*\LocalCache\Roaming\Claude 아래에 실제 파일이 있다
  const bases = [path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Claude", "claude-code")];
  const pkgs = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Packages");
  if (fs.existsSync(pkgs))
    for (const d of fs.readdirSync(pkgs).filter((d) => d.startsWith("Claude_"))) bases.push(path.join(pkgs, d, "LocalCache", "Roaming", "Claude", "claude-code"));
  const found = [];
  for (const base of bases.filter((b) => fs.existsSync(b))) {
    for (const ver of fs.readdirSync(base)) {
      const vdir = path.join(base, ver);
      if (!fs.statSync(vdir).isDirectory()) continue;
      for (const sub of fs.readdirSync(vdir)) {
        const exe = path.join(vdir, sub, "claude.exe");
        if (fs.existsSync(exe)) found.push({ ver, exe });
      }
    }
  }
  const cmp = (a, b) => b.ver.localeCompare(a.ver, undefined, { numeric: true });
  return found.sort(cmp)[0]?.exe ?? null;
}

// 로그인 여부 (API 호출 없이 빠르게)
export function claudeAuth() {
  const exe = findClaude();
  if (!exe) return { connected: false, found: false };
  const r = spawnSync(exe, ["auth", "status", "--json"], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  try {
    const d = JSON.parse(r.stdout);
    return { connected: !!d.loggedIn, found: true, account: d.email || d.account?.email || null };
  } catch {
    return { connected: false, found: true };
  }
}

// 버튼 한 번으로 로그인: 브라우저가 열리고, 로그인하면 끝. (브라우저가 안 열리면 출력된 주소를 화면에 보여줌)
let loginProc = null;
let loginUrl = null;
let loginOut = "";
export function startClaudeLogin() {
  const exe = findClaude();
  if (!exe) throw new Error("Claude 앱을 찾지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요");
  if (loginProc) return { url: loginUrl };
  loginUrl = null;
  loginProc = spawn(exe, ["auth", "login", "--claudeai"], { stdio: ["pipe", "pipe", "pipe"] });
  const grab = (d) => {
    const m = String(d).match(/https:\/\/\S+/);
    if (m && !loginUrl) loginUrl = m[0];
  };
  loginProc.stdout.on("data", grab);
  loginProc.stderr.on("data", grab);
  const done = () => (loginProc = null);
  loginProc.on("close", done);
  setTimeout(() => loginProc?.kill(), 10 * 60 * 1000);
  return { url: loginUrl };
}
export const claudeLoginUrl = () => (loginProc ? loginUrl : null);

// 브라우저 로그인 뒤 화면에 나온 코드를 붙여넣으면 로그인 과정에 전달한다
export function submitClaudeCode(code) {
  const proc = loginProc;
  if (!proc) throw new Error("로그인 창이 닫혔어요. 로그인 버튼을 다시 눌러 주세요");
  const c = String(code || "").trim();
  if (!c) throw new Error("코드를 붙여넣어 주세요");
  const before = loginOut.length;
  proc.stdin.write(c + "\n");
  return new Promise((ok, fail) => {
    const t = setTimeout(() => ok({ pending: true }), 20000);
    proc.on("close", (code) => {
      clearTimeout(t);
      const msg = loginOut.slice(before);
      if (code === 0 && !/fail/i.test(msg)) ok({ ok: true });
      else fail(new Error("로그인에 실패했어요. 로그인 버튼을 다시 눌러 새 코드로 해 주세요"));
    });
  });
}

// 계정 바꾸기: 지금 계정을 로그아웃하고 바로 로그인 창을 연다
export function switchClaudeAccount() {
  const exe = findClaude();
  if (!exe) throw new Error("Claude 앱을 찾지 못했어요. Claude 데스크톱 앱이 설치돼 있는지 확인해 주세요");
  loginProc?.kill();
  loginProc = null;
  spawnSync(exe, ["auth", "logout"], { encoding: "utf8", timeout: 20000, stdio: ["ignore", "pipe", "pipe"] });
  return startClaudeLogin();
}

// 로그인 여부 확인 (짧은 호출 1회)
export function claudeStatus() {
  const exe = findClaude();
  if (!exe) return { ok: false, message: "Claude Code를 찾지 못했어요" };
  const r = spawnSync(exe, ["-p", "ok", "--output-format", "json"], { encoding: "utf8", timeout: 90000, cwd: os.tmpdir(), stdio: ["ignore", "pipe", "pipe"] });
  try {
    const d = JSON.parse(r.stdout);
    if (d.is_error) return { ok: false, exe, message: d.result || "오류" };
    return { ok: true, exe };
  } catch {
    return { ok: false, exe, message: (r.stderr || r.stdout || "응답 없음").slice(0, 300) };
  }
}

function log(job, line) {
  job.log = [...(job.log || []), { t: new Date().toISOString(), m: line }].slice(-300);
  saveJob(job);
}

export function unzipInto(id, zipPath, dest = path.join(jobDir(id), "product")) {
  const r = spawnSync(PY, ["-X", "utf8", SHORTS, "unzip", zipPath, dest], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("압축 해제 실패: " + (r.stderr || r.stdout).slice(-500));
  return JSON.parse(r.stdout.trim().split(/\r?\n/).pop());
}

// 따로 올린 상세페이지 이미지 → <제품폴더>\상세페이지_등록 (올린 순서 유지)
export function saveDetailImages(productDir, files) {
  const r = spawnSync(PY, ["-X", "utf8", SHORTS, "detail", path.join(productDir, "상세페이지_등록"), ...files], { encoding: "utf8" });
  if (r.status !== 0) throw new Error("상세페이지 이미지를 읽지 못했어요: " + (r.stderr || r.stdout).slice(-300));
  const out = r.stdout.trim();
  return JSON.parse(out.slice(out.lastIndexOf("{"))); // 마지막 줄의 결과 JSON
}

const describeTool = (u) => {
  const i = u.input || {};
  if (u.name === "Bash") return i.description || String(i.command || "").slice(0, 80);
  if (u.name === "Read") return "읽는 중: " + path.basename(String(i.file_path || ""));
  if (u.name === "Write" || u.name === "Edit") return "작성 중: " + path.basename(String(i.file_path || ""));
  if (u.name === "Skill") return "스킬 실행: " + (i.skill || "");
  return u.name;
};

export function startGeneration(id, { revision } = {}) {
  const job = loadJob(id);
  const exe = findClaude();
  if (!exe) throw new Error("Claude Code를 찾지 못했어요. 설정에서 경로를 확인해 주세요.");
  if (running.has(id)) throw new Error("이미 만드는 중이에요");

  const product = job.product_dir;
  const resultPath = path.join(product, "숏츠_영상", "result.json");
  if (fs.existsSync(resultPath)) fs.renameSync(resultPath, resultPath + ".prev");

  const copyMode = job.kind === "copy"; // 이미 만든 영상: 영상은 그대로 두고 제목·설명글만
  const prompt = copyMode
    ? [
        "plaire-product-shorts 스킬을 문구 모드로 실행해. (영상은 이미 만들어져 있음 — 새로 만들거나 고치지 말 것)",
        `플러그인 루트: ${PLUGIN_ROOT}`,
        `제품 폴더: ${product}`,
        `올라온 영상: ${job.source_video}`,
        `상품명: ${job.product_name}`,
        revision ? `문구 수정 요청: ${revision}` : "",
        "질문하지 말고 끝까지 진행하고, 업로드는 하지 마. 명령은 Bash 도구로 실행해.",
        "진행 상황 메모와 명령 설명은 사장님이 화면에서 읽으니 한국어로 짧게 써.",
        `끝나면 ${resultPath} 를 스킬의 문구 모드 형식대로 저장해.`,
      ]
        .filter(Boolean)
        .join("\n")
    : [
    "plaire-product-shorts 스킬을 스튜디오 모드로 실행해.",
    `플러그인 루트: ${PLUGIN_ROOT}`,
    `제품 폴더: ${product}`,
    `상품명: ${job.product_name}`,
    revision ? `수정 요청: ${revision}` : "",
    "질문하지 말고 끝까지 진행하고, 업로드는 하지 마.",
    "진행 상황 메모와 명령 설명은 사장님이 화면에서 읽으니 한국어로 짧게 써.",
    `끝나면 ${resultPath} 를 스킬의 스튜디오 모드 형식대로 저장해.`,
  ]
        .filter(Boolean)
        .join("\n");

  job.status = "generating";
  job.server_pid = process.pid; // 어느 스튜디오가 만들고 있는지 (다른 창이 켜질 때 실패로 잘못 표시하지 않게)
  job.error = null;
  job.started_at = new Date().toISOString();
  log(job, revision ? `수정 요청으로 다시 만드는 중: ${revision}` : copyMode ? "제목·설명글 쓰기를 시작했어요" : "영상 만들기를 시작했어요");

  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", "Bash Read Write Edit Glob Grep Skill", "--add-dir", PLUGIN_ROOT];
  const child = spawn(exe, args, { cwd: jobDir(id), env: { ...process.env, PYTHONUTF8: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  running.set(id, child);
  const timer = setTimeout(() => child.kill(), 40 * 60 * 1000);

  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      const j = loadJob(id);
      if (!j) continue; // 작업이 지워짐
      if (ev.type === "assistant") {
        for (const c of ev.message?.content || []) {
          if (c.type === "text" && c.text.trim()) log(j, c.text.trim().slice(0, 400));
          if (c.type === "tool_use") log(j, "· " + describeTool(c));
        }
      } else if (ev.type === "result" && ev.is_error) {
        log(j, "Claude 오류: " + String(ev.result || "").slice(0, 300));
      }
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).replace(/\x1b\[[0-9;]*m/g, "").slice(-4000)));

  child.on("close", (code) => {
    clearTimeout(timer);
    running.delete(id);
    const j = loadJob(id);
    if (!j) return; // 작업이 지워짐
    let result = null;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    } catch {}
    if (result && !result.error && result.video && fs.existsSync(result.video)) {
      j.status = "ready";
      j.result = result;
      j.title = result.title;
      j.description = result.description;
      log(j, "완성됐어요");
    } else {
      j.status = "failed";
      j.error = result?.error || `영상 파일이 만들어지지 않았어요 (종료 코드 ${code}) ${stderr.slice(-300)}`;
      log(j, "실패: " + j.error);
    }
    saveJob(j);
  });
}

export const isRunning = (id) => running.has(id);

// 만드는 중인 영상을 멈춘다 (Claude가 띄운 렌더링 프로그램까지 함께 종료)
export function stopGeneration(id) {
  const child = running.get(id);
  if (!child) return Promise.resolve();
  return new Promise((ok) => {
    child.once("close", ok);
    if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    else child.kill("SIGKILL");
    setTimeout(ok, 10000);
  });
}
export const isRunningAny = () => running.size > 0;
