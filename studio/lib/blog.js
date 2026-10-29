// 블로그 작성 도우미: 제품명·상세페이지·제품 사진 → (Claude) blog-post 스킬로 주제·키워드 조사 + 구어체 글 + 3:2 사진 zip
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT } from "./store.js";
import { findClaude } from "./generate.js";

const RUNS_DIR = path.join(DATA_DIR, "blog-runs");
const SKILL = path.join(PLUGIN_ROOT, "skills", "blog-post");
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
export function listRuns() {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .sort()
    .reverse()
    .map(loadRun)
    .filter(Boolean)
    .slice(0, 10)
    .map(({ log, ...r }) => ({ ...r, running: running.has(r.id) }));
}

const describe = (u) => {
  const i = u.input || {};
  if (u.name === "Bash") return i.description || String(i.command || "").slice(0, 80);
  if (u.name === "Read") return "보는 중: " + path.basename(String(i.file_path || ""));
  if (u.name === "Write" || u.name === "Edit") return "작성 중: " + path.basename(String(i.file_path || ""));
  if (u.name === "WebSearch") return "검색: " + (i.query || "");
  if (u.name === "WebFetch") return "확인: " + String(i.url || "").slice(0, 60);
  return u.name;
};

// 브랜드별 고객 (글의 독자·상황을 여기에 맞춘다)
const TARGET = {
  플레르가구: "가정집 — 신혼부부·이사·입주 준비·아이 있는 집·홈카페/홈시네마 등 집에서 쓰는 사람",
  가즈다가구: "업소 — 카페·식당·사무실·학원·병원 대기실·매장 등을 운영하거나 꾸미는 사장님·담당자",
};
export function startRun({ id, brand, product_name, product_dir, topic = "" }) {
  if (!BRANDS.includes(brand)) throw new Error("브랜드를 골라 주세요");
  const exe = findClaude();
  if (!exe) throw new Error("Claude Code를 찾지 못했어요");
  const dir = runDir(id);
  const work = path.join(dir, "work");
  fs.mkdirSync(work, { recursive: true });
  const resultPath = path.join(dir, "result.json");
  const today = new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
  const prompt = [
    `${path.join(SKILL, "SKILL.md")} 를 읽고 그 스킬을 스튜디오 모드로 실행해.`,
    `플러그인 루트: ${PLUGIN_ROOT}`,
    `브랜드: ${brand}`,
    `타깃 고객: ${TARGET[brand]}`,
    `글쓴이: ${brand} 판매자(담당자) — 소비자·구매자 입장의 1인칭 경험담 금지, 판매자가 고객에게 알려 주는 시점으로`,
    topic ? `원하는 주제(담당자 요청 — 이 주제를 중심으로 쓰고, 그 안에서 검색 수요 큰 키워드를 고른다): ${topic}` : "원하는 주제: 없음 — 타깃 고객이 지금 많이 찾는 주제·키워드를 직접 조사해서 고른다",
    `제품명: ${product_name}`,
    `제품 폴더(제품 사진 + 상세페이지_등록): ${product_dir}`,
    `작업 폴더: ${work}`,
    `result.json: ${resultPath}`,
    `오늘 날짜: ${today} (요즘 화제를 고를 때 기준)`,
    "사진 zip과 함께 움직이는 이미지(GIF 2개 + 16:9 10초 영상)도 스킬 4-2단계대로 꼭 만든다.",
    "질문하지 말고 끝까지 진행해. 명령은 Bash 도구로 실행해.",
    "진행 상황 메모와 명령 설명은 담당자가 화면에서 읽으니 한국어로 짧게 써.",
  ].join("\n");
  const run = saveRun({ id, brand, product_name, topic, status: "running", server_pid: process.pid, started_at: new Date().toISOString(), log: ["자료를 받았어요. 주제·키워드를 찾아볼게요"] });
  const args = ["-p", prompt, "--output-format", "stream-json", "--verbose", "--allowedTools", "Bash Read Write Edit Glob Grep WebSearch WebFetch", "--add-dir", PLUGIN_ROOT];
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
    const zip = result?.zip && fs.existsSync(result.zip) ? result.zip : null;
    if (result && !result.error && result.body) saveRun({ ...r, status: "done", finished_at: new Date().toISOString(), result: { ...result, zip }, log: [...r.log, "글을 다 썼어요"] });
    else saveRun({ ...r, status: "failed", finished_at: new Date().toISOString(), error: result?.error || `글이 만들어지지 않았어요 (종료 코드 ${code}) ${stderr.slice(-200)}` });
  });
  return run;
}

// 결과 사진 파일 경로 (zip 옆 폴더)
export function imagePath(id, name) {
  const r = loadRun(id);
  const zip = r?.result?.zip;
  if (!zip || !/^(\d{2}\.jpg|움직임_\d\.gif|영상_16x9\.mp4)$/.test(name)) return null; // 사진·GIF·영상
  const p = path.join(zip.replace(/\.zip$/i, ""), name);
  return fs.existsSync(p) ? p : null;
}

export function stopRun(id) {
  const child = running.get(id);
  if (!child) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  else child.kill("SIGKILL");
}
