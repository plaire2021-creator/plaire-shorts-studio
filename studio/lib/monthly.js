// 월간 매출 통계: 한 달치 원본 엑셀을 받아 run_monthly.py(생성 → 검증 A → 연간 통합파일 → 검증 B)를 돌린다.
// 계산은 전부 파이썬 스크립트가 하고, 여기서는 파일 보관·실행·진행 표시·결과 정리만 한다.
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { DATA_DIR } from "./store.js";
import { COMPANIES, env, salesRoot, weeklyDir } from "./weekly.js";

const PY = process.platform === "win32" ? "python" : "python3";
const RUNS_DIR = path.join(DATA_DIR, "monthly-runs");

export const monthlyDir = () => path.join(salesRoot().root, "월간 매출 통계");

// 지금 들어 있는 마지막 통합파일 달 (회사별)
export function latest() {
  const dir = monthlyDir();
  const out = {};
  for (const c of COMPANIES) {
    const ms = fs.existsSync(dir) ? fs.readdirSync(dir).map((f) => (f.match(new RegExp(`^${c}_\\d{4}_(\\d+)월_매출통계\\.xlsx$`)) || [])[1]).filter(Boolean).map(Number) : [];
    out[c] = ms.length ? `${Math.max(...ms)}월` : null;
  }
  return out;
}

const running = new Map();
const runFile = (id) => path.join(RUNS_DIR, id, "run.json");
export const runDir = (id) => path.join(RUNS_DIR, id);
export const loadRun = (id) => {
  try {
    return JSON.parse(fs.readFileSync(runFile(id), "utf8"));
  } catch {
    return null;
  }
};
const saveRun = (r) => (fs.mkdirSync(path.dirname(runFile(r.id)), { recursive: true }), fs.writeFileSync(runFile(r.id), JSON.stringify(r, null, 2)), r);
export const isRunning = (id) => running.has(id);
// 두 회사가 같은 토탈 파일에 쓰므로 한 번에 하나만 돌린다
export const isBusy = () => running.size > 0;
export function listRuns(company) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .sort()
    .reverse()
    .map(loadRun)
    .filter((r) => r && (!company || r.company === company))
    .slice(0, 10)
    .map(({ log, ...r }) => ({ ...r, running: running.has(r.id) }));
}

// 출력에서 대상 달·요약·검증·결과 파일을 뽑는다
function parse(out) {
  const lines = out.split(/\r?\n/);
  const res = { month: null, summary: [], check: null, files: [], stop: null };
  const m = out.match(/대상:\s*(\d{4})년\s*(\d+)월/);
  if (m) res.month = { year: +m[1], month: +m[2], label: `${m[2]}월` };
  const i = lines.findIndex((l) => l.trim() === "[요약]");
  if (i >= 0)
    for (const l of lines.slice(i + 1)) {
      const t = l.match(/^\s+(네이버|쿠팡|오늘의집|자사몰|합계)\s+([\d,-]+)\s*$/);
      if (t) res.summary.push({ label: t[1], value: Number(t[2].replace(/,/g, "")) });
      else if (!l.trim() || l.trim().startsWith("[")) break;
    }
  res.check = lines.find((l) => l.startsWith("[검증]"))?.replace("[검증]", "").trim() || null;
  // [결과] 아래 줄들: 매출통계(통합) · 매출통계 토탈 · 월간판매데이터(중간 파일)
  const r = lines.findIndex((l) => l.startsWith("[결과]"));
  if (r >= 0)
    for (const l of [lines[r].replace("[결과]", ""), ...lines.slice(r + 1)]) {
      const f = l.trim();
      if (!f.endsWith(".xlsx")) break;
      res.files.push(f);
    }
  const s = out.indexOf("[중단]");
  if (s >= 0) res.stop = out.slice(s + 4).trim();
  return res;
}

// 지난달 매출(비교용): 월간파일 매출데이터에서 그 전 달 열을 읽는다
function prevMonth(company, year, month) {
  return new Promise((ok) => {
    const f = path.join(monthlyDir(), `${year}_${company} 월간판매데이터 (${month}월).xlsx`);
    if (!fs.existsSync(f)) return ok(null);
    const code = `
import json,sys,openpyxl
s=openpyxl.load_workbook(sys.argv[1],data_only=True)['매출데이터']
hdr=[c.value for c in s[3]]
want=sys.argv[2]
col=next((i for i,v in enumerate(hdr) if str(v).strip()==want),None)
out={}
if col is not None:
    for r in s.iter_rows(min_row=4,values_only=True):
        if r[0]: out[str(r[0]).strip()]=r[col]
print(json.dumps(out,ensure_ascii=False))`;
    const p = spawn(PY, ["-X", "utf8", "-c", code, f, `${month - 1}월`], { env: env() });
    let s = "";
    p.stdout.on("data", (d) => (s += d));
    p.on("close", () => {
      try {
        ok(JSON.parse(s));
      } catch {
        ok(null);
      }
    });
  });
}

// 자사몰 금액: 카페24 순매출을 따로 받지 않고 주문내역 CSV의 '총 결제금액' 합(쿠폰·할인 적용 후 실결제액,
// 결제 0원 = 취소 주문 제외)을 쓴다. 부분 환불은 CSV에 안 남아서 카페24 '순매출'보다 클 수 있다.
function cafe24OrderTotal(csv) {
  const code = "import sys,cafe24\ng,_=cafe24.parse(sys.argv[1],basis='paid')\nprint(int(round(g)))";
  const r = spawnSync(PY, ["-X", "utf8", "-c", code, csv], { cwd: weeklyDir().dir, env: env(), encoding: "utf8" });
  const n = Number((r.stdout || "").trim().split(/\r?\n/).pop());
  if (r.status !== 0 || !Number.isFinite(n)) throw new Error("자사몰 CSV를 읽지 못했어요: " + (r.stderr || r.stdout || "").trim().split(/\r?\n/).pop());
  return n;
}

export function startRun({ id, company, files, cafe24Net, noCafe24 }) {
  if (!COMPANIES.includes(company)) throw new Error("회사를 골라 주세요");
  if (isBusy()) throw new Error("월간 통계를 만드는 중이에요. 끝난 뒤에 다시 해 주세요 (두 회사가 같은 토탈 파일을 써서 하나씩 돌려요)");
  const dir = monthlyDir();
  let cafe24Basis = null;
  if (company === "플레르가구" && !noCafe24 && (cafe24Net == null || cafe24Net === "")) {
    const csv = files.find((f) => /\.csv$/i.test(f));
    if (!csv) noCafe24 = true; // 자사몰 파일이 없으면 그 달 자사몰 판매 없음(0원)
    else {
      cafe24Net = cafe24OrderTotal(csv);
      cafe24Basis = "paid";
    }
  }
  const args = ["-u", "run_monthly.py", "--company", company, ...files];
  if (noCafe24) args.push("--no-cafe24");
  else if (cafe24Net != null && cafe24Net !== "") args.push("--cafe24-net", String(cafe24Net));
  const run = saveRun({ id, company, status: "running", started_at: new Date().toISOString(), files: files.map((f) => path.basename(f)), cafe24_net: noCafe24 ? null : cafe24Net ?? null, cafe24_basis: noCafe24 ? "none" : cafe24Basis || "net", log: [], dir });
  const child = spawn(PY, args, { cwd: dir, env: env(), stdio: ["ignore", "pipe", "pipe"] });
  running.set(id, child);
  let out = "";
  let t = null;
  const clean = () => out.split(/\r?\n/).filter((l) => l.trim() && !/warn/i.test(l)).slice(-400);
  const flush = () => {
    t = null;
    const r = loadRun(id);
    if (r) saveRun({ ...r, log: clean() });
  };
  const onData = (d) => {
    out += d;
    if (!t) t = setTimeout(flush, 500);
  };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", onData);
  child.stderr.on("data", onData);
  child.on("close", async (code) => {
    clearTimeout(t);
    const p = parse(out);
    const prev = code === 0 && p.month ? await prevMonth(company, p.month.year, p.month.month) : null;
    running.delete(id);
    saveRun({
      ...loadRun(id),
      status: code === 0 ? "done" : "failed",
      finished_at: new Date().toISOString(),
      log: clean(),
      month: p.month,
      summary: p.summary.map((s) => ({ ...s, prev: prev?.[s.label] ?? null })),
      check: p.check,
      // 받을 파일: 매출통계 + 매출통계 토탈 (월간판매데이터는 중간 파일이라 빼고)
      outputs: p.files.filter((f) => !f.includes("월간판매데이터")).map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f)),
      stop: p.stop || (code === 0 ? null : `중간에 멈췄어요 (종료 코드 ${code})`),
    });
  });
  return run;
}
