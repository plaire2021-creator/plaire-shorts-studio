// 리뷰 답글 작성 도우미: 스마트스토어 리뷰 엑셀 → (바로) 5점 미만 '리뷰 수정요청' 엑셀 + (Claude) review-reply 스킬로 답글 페이지
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT } from "./store.js";
import { findClaude } from "./generate.js";

const PY = process.platform === "win32" ? "python" : "python3";
const RUNS_DIR = path.join(DATA_DIR, "review-runs");
const SKILL = path.join(PLUGIN_ROOT, "skills", "review-reply");
export const BRANDS = ["플레르가구", "가즈다가구"];

const running = new Map(); // id → child
export const runDir = (id) => path.join(RUNS_DIR, id);
const runFile = (id) => path.join(runDir(id), "run.json");
export const loadRun = (id) => {
  try {
    return JSON.parse(fs.readFileSync(runFile(id), "utf8"));
  } catch {
    return null;
  }
};
const saveRun = (r) => (fs.mkdirSync(runDir(r.id), { recursive: true }), fs.writeFileSync(runFile(r.id), JSON.stringify(r, null, 2)), r);
const log = (id, m) => {
  const r = loadRun(id);
  if (r) saveRun({ ...r, log: [...(r.log || []), m].slice(-300) });
};
export const isRunning = (id) => running.has(id);
export const anyRunning = () => running.size > 0;
export function listRuns(brand) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .sort()
    .reverse()
    .map(loadRun)
    .filter((r) => r && (!brand || r.brand === brand))
    .slice(0, 10)
    .map(({ log, ...r }) => ({ ...r, running: running.has(r.id) }));
}

const describe = (u) => {
  const i = u.input || {};
  if (u.name === "Bash") return i.description || String(i.command || "").slice(0, 80);
  if (u.name === "Read") return "읽는 중: " + path.basename(String(i.file_path || ""));
  if (u.name === "Write" || u.name === "Edit") return "작성 중: " + path.basename(String(i.file_path || ""));
  return u.name;
};

export function startRun({ id, brand, xlsx }) {
  if (!BRANDS.includes(brand)) throw new Error("브랜드를 골라 주세요");
  const dir = runDir(id);
  // 1) 5점 미만 리스트는 바로 만든다 (답글을 기다릴 필요 없음)
  const low = spawnSync(PY, ["-X", "utf8", path.join(SKILL, "scripts", "low_reviews.py"), xlsx, brand, dir], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
  if (low.status !== 0) throw new Error((low.stderr || low.stdout || "엑셀을 읽지 못했어요").trim().split(/\r?\n/).pop());
  const lowInfo = JSON.parse(low.stdout.trim().split(/\r?\n/).pop());
  const run = saveRun({ id, brand, source: path.basename(xlsx), status: "running", server_pid: process.pid, started_at: new Date().toISOString(), total: lowInfo.total, low: lowInfo.low, low_file: lowInfo.file, log: ["5점 미만 리뷰 리스트를 만들었어요", "답글 쓰기를 시작했어요"] });
  if (!lowInfo.total) {
    return saveRun({ ...run, status: "done", finished_at: new Date().toISOString(), result: { total: 0, notes: ["리뷰가 0건이에요"] } });
  }

  // 2) 답글은 Claude가 review-reply 스킬(스튜디오 모드)로 쓴다
  const exe = findClaude();
  if (!exe) return saveRun({ ...run, status: "failed", error: "Claude Code를 찾지 못했어요" });
  const work = path.join(dir, "work");
  fs.mkdirSync(work, { recursive: true });
  const short = brand === "플레르가구" ? "플레르" : "가즈다";
  const day = (path.basename(xlsx).match(/review_(\d{8})/) || [])[1] || new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const page = path.join(dir, `리뷰답변_${short}_${day}.html`);
  const resultPath = path.join(dir, "result.json");
  const prompt = [
    `${path.join(SKILL, "SKILL.md")} 를 읽고 그 스킬을 스튜디오 모드로 실행해.`,
    `스킬 폴더: ${SKILL}`,
    `브랜드: ${brand}`,
    `리뷰 엑셀: ${xlsx}`,
    `작업 폴더: ${work}`,
    `저장 경로(build_page -Out): ${page}`,
    `result.json: ${resultPath}`,
    "질문하지 말고 끝까지 진행해. 명령은 Bash 도구로 실행해.",
    "진행 상황 메모와 명령 설명은 담당자가 화면에서 읽으니 한국어로 짧게 써.",
  ].join("\n");
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", "Bash Read Write Edit Glob Grep", "--add-dir", PLUGIN_ROOT];
  const child = spawn(exe, args, { cwd: work, env: { ...process.env, PYTHONUTF8: "1" }, stdio: ["ignore", "pipe", "pipe"] });
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
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (ev.type !== "assistant") continue;
      for (const c of ev.message?.content || []) {
        if (c.type === "text" && c.text.trim()) log(id, c.text.trim().slice(0, 300));
        if (c.type === "tool_use") log(id, "· " + describe(c));
      }
    }
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr = (stderr + d).slice(-2000)));
  child.on("close", (code) => {
    clearTimeout(timer);
    running.delete(id);
    const r = loadRun(id);
    if (!r) return; // 지워짐
    let result = null;
    try {
      result = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    } catch {}
    const pagePath = result?.page && fs.existsSync(result.page) ? result.page : fs.existsSync(page) ? page : null;
    if (pagePath && !result?.error) saveRun({ ...r, status: "done", finished_at: new Date().toISOString(), page: pagePath, result, log: [...r.log, "답글을 다 썼어요"] });
    else saveRun({ ...r, status: "failed", finished_at: new Date().toISOString(), error: result?.error || `답글 페이지가 만들어지지 않았어요 (종료 코드 ${code}) ${stderr.slice(-200)}` });
  });
  return run;
}

export function stopRun(id) {
  const child = running.get(id);
  if (!child) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}
