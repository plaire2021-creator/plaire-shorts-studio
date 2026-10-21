// 주간 매출 통계: 원본 엑셀을 받아 run_weekly.py(집계 → 원본 검증 → 통합파일 → 구글 시트 교체·전 칸 대조)를 돌린다.
// 계산은 전부 파이썬 스크립트가 하고, 여기서는 파일 보관·실행·진행 표시·결과 정리만 한다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT, loadConfig } from "./store.js";

const PY = process.platform === "win32" ? "python" : "python3";
const RUNS_DIR = path.join(DATA_DIR, "weekly-runs");
export const COMPANIES = ["플레르가구", "가즈다가구"];
export const SHEETS = {
  플레르가구: "https://docs.google.com/spreadsheets/d/1caviDCetj3RsdhRmgqRarfK7y6ee8Kt7t9mDe08VmU4",
  가즈다가구: "https://docs.google.com/spreadsheets/d/1VoCNP7TJ01JTa0uR8XDM1jcuumyU4ts6A0yrXfJhXgo",
};

// 매출 통계 상위 폴더: 설정 > OneDrive의 'PLAIRE AI'(다른 PC들과 통합파일 공유) > 이 PC 전용 폴더
// 월간 스크립트가 옆 폴더의 주간 엔진(주간 매출 통계\generate_weekly_sales.py)을 쓰므로 둘은 같은 상위 폴더에 둔다.
export function salesRoot() {
  const set = loadConfig().sales_root;
  if (set && fs.existsSync(path.join(set, "주간 매출 통계", "run_weekly.py"))) return { root: set, shared: true };
  const home = os.homedir();
  for (const r of [home, path.join(home, "Desktop"), path.join(home, "OneDrive"), path.join(home, "OneDrive", "Desktop"), path.join(home, "OneDrive", "바탕 화면")]) {
    const d = path.join(r, "PLAIRE AI");
    if (fs.existsSync(path.join(d, "주간 매출 통계", "run_weekly.py"))) return { root: d, shared: true };
  }
  const root = path.join(DATA_DIR, "매출 통계");
  const old = path.join(DATA_DIR, "weekly"); // 예전 위치에서 옮김
  if (fs.existsSync(old) && !fs.existsSync(path.join(root, "주간 매출 통계"))) {
    fs.mkdirSync(root, { recursive: true });
    fs.renameSync(old, path.join(root, "주간 매출 통계"));
  }
  // 이 PC 전용 폴더는 플러그인의 최신 스크립트로 맞춘다 (엑셀·CSV·통합파일은 그대로)
  for (const [sub, from] of [["주간 매출 통계", "weekly"], ["월간 매출 통계", "monthly"]]) {
    const d = path.join(root, sub);
    fs.mkdirSync(d, { recursive: true });
    const src = path.join(PLUGIN_ROOT, from);
    for (const f of fs.readdirSync(src)) if (f.endsWith(".py")) fs.copyFileSync(path.join(src, f), path.join(d, f));
  }
  fs.mkdirSync(path.join(root, "주간 매출 통계", "통합"), { recursive: true });
  return { root, shared: false };
}
export function weeklyDir() {
  const { root, shared } = salesRoot();
  return { dir: path.join(root, "주간 매출 통계"), shared };
}

export const env = () => ({ ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" });

export function checkSetup() {
  const { dir, shared } = weeklyDir();
  const r = spawnSync(PY, ["-u", "run_weekly.py", "--check"], { cwd: dir, env: env(), encoding: "utf8", timeout: 60000 });
  const out = (r.stdout || "") + (r.stderr || "");
  // 지금 들어 있는 마지막 통합파일 주차 (회사별)
  const latest = {};
  for (const c of COMPANIES) {
    const files = fs.existsSync(path.join(dir, "통합")) ? fs.readdirSync(path.join(dir, "통합")).filter((f) => f.startsWith("2026_" + c) && !f.startsWith("~$")) : [];
    const key = (f) => (f.match(/\((\d+)월\s*(\d+)주차\)/) || []).slice(1).map(Number);
    files.sort((a, b) => { const [m1, d1] = key(a), [m2, d2] = key(b); return m1 - m2 || d1 - d2; });
    latest[c] = files.length ? (files.at(-1).match(/\(([^)]*주차)\)/) || [])[1] : null;
  }
  return { ok: r.status === 0, dir, shared, output: out.trim(), latest };
}

// ---------- 실행 기록 ----------
const runs = new Map(); // id → child
export const anyRunning = () => runs.size > 0;
const runFile = (id) => path.join(RUNS_DIR, id, "run.json");
export const loadRun = (id) => {
  try {
    return JSON.parse(fs.readFileSync(runFile(id), "utf8"));
  } catch {
    return null;
  }
};
const saveRun = (r) => (fs.mkdirSync(path.dirname(runFile(r.id)), { recursive: true }), fs.writeFileSync(runFile(r.id), JSON.stringify(r, null, 2)), r);
export function listRuns(company) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .sort()
    .reverse()
    .map(loadRun)
    .filter((r) => r && (!company || r.company === company))
    .slice(0, 10)
    .map(({ log, ...r }) => ({ ...r, running: runs.has(r.id) }));
}
export const runDir = (id) => path.join(RUNS_DIR, id);
export const isBusy = (company) => [...runs.keys()].some((id) => loadRun(id)?.company === company);

// 출력에서 요약·오류율·완료 파일명을 뽑는다
function parse(out) {
  const lines = out.split(/\r?\n/);
  const res = { summary: null, errors: [], file: null, week: null, stop: null };
  const i = lines.findIndex((l) => l.startsWith("[요약]"));
  if (i >= 0) {
    const head = lines[i].replace("[요약]", "").split("|").map((s) => s.trim());
    res.summary = { cols: head.slice(1), rows: [] };
    for (const l of lines.slice(i + 1)) {
      if (!l.includes("|")) break;
      const [label, ...vals] = l.split("|").map((s) => s.trim());
      res.summary.rows.push({ label, values: vals.map((v) => (v === "-" ? null : Number(v.replace(/,/g, "")))) });
    }
  }
  res.errors = lines.filter((l) => /오류율/.test(l)).map((l) => l.trim());
  const done = out.match(/완료:\s*(.+?\.xlsx)/);
  if (done) res.file = done[1].trim();
  const wk = out.match(/주차:\s*(\d+월\s*\d+주차)\s*\(([^)]+)\)/);
  if (wk) res.week = { label: wk[1], range: wk[2] };
  const s = out.indexOf("[중단]");
  if (s >= 0) res.stop = out.slice(s + 4).trim();
  return res;
}

export function startRun({ id, company, files, noCafe24 }) {
  if (!COMPANIES.includes(company)) throw new Error("회사를 골라 주세요");
  if (isBusy(company)) throw new Error(`${company} 집계가 이미 진행 중이에요. 끝난 뒤에 다시 해 주세요`);
  const { dir } = weeklyDir();
  const args = ["-u", "run_weekly.py", "--company", company, ...files, ...(noCafe24 ? ["--no-cafe24"] : [])];
  const run = saveRun({ id, company, status: "running", started_at: new Date().toISOString(), files: files.map((f) => path.basename(f)), log: [], dir });
  const child = spawn(PY, args, { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  runs.set(id, child);
  let out = "";
  let buf = "";
  let saveTimer = null;
  const flush = () => {
    saveTimer = null;
    const r = loadRun(id);
    if (r) saveRun({ ...r, log: out.split(/\r?\n/).filter((l) => l.trim() && !/warn/i.test(l)).slice(-400) });
  };
  const onData = (d) => {
    out += d;
    buf += d;
    if (!saveTimer) saveTimer = setTimeout(flush, 500);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", (code) => {
    runs.delete(id);
    clearTimeout(saveTimer);
    const p = parse(out);
    const file = p.file ? path.join(dir, "통합", p.file) : null;
    saveRun({
      ...loadRun(id),
      status: code === 0 ? "done" : "failed",
      finished_at: new Date().toISOString(),
      log: out.split(/\r?\n/).filter((l) => l.trim() && !/warn/i.test(l)).slice(-400),
      summary: p.summary,
      error_rates: p.errors,
      week: p.week,
      stop: p.stop || (code === 0 ? null : `중간에 멈췄어요 (종료 코드 ${code})`),
      master: file && fs.existsSync(file) ? file : null,
    });
  });
  return run;
}
