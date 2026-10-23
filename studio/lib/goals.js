// 홈 '월간 목표 매출' 카드: 브랜드·채널별 월 목표(주간 업무 계획표 '월간목표매출' 시트에서 받거나 직접 입력) + 이번 달 실적(주간 매출 통계 파일)
// 목표는 data/plans/goals.json = {"YYYY-MM": {"플레르가구": {스마트스토어, 쿠팡, 오늘의집}, ...}} (plans 폴더라 백업에 같이 들어간다)
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT } from "./store.js";
import { weeklyDir } from "./weekly.js";

export const BRANDS = ["플레르가구", "가즈다가구"];
export const CHANNELS = ["스마트스토어", "쿠팡", "오늘의집"];
const FILE = path.join(DATA_DIR, "plans", "goals.json");
const okMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ""));

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}
function write(g) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(g, null, 1));
  fs.renameSync(FILE + ".tmp", FILE);
}

// 계획표 엑셀에서 읽은 목표({브랜드: {월: {채널: 원}}})를 덮어쓴다. 엑셀이 팀의 기준이라 올릴 때마다 맞춘다
export function importFromPlan(goals) {
  if (!goals || !Object.keys(goals).length) return;
  const g = read();
  for (const [brand, months] of Object.entries(goals)) {
    if (!BRANDS.includes(brand)) continue;
    for (const [m, chs] of Object.entries(months || {})) {
      if (!okMonth(m)) continue;
      const t = ((g[m] ||= {})[brand] ||= {});
      for (const c of CHANNELS) if (chs[c] > 0) t[c] = Math.round(chs[c]);
    }
  }
  write(g);
}

export function setTargets(month, brand, targets) {
  if (!okMonth(month)) throw new Error("월이 올바르지 않아요");
  if (!BRANDS.includes(brand)) throw new Error("브랜드를 골라 주세요");
  const g = read();
  const t = ((g[month] ||= {})[brand] ||= {});
  for (const c of CHANNELS) {
    const v = Math.round(Number(String(targets?.[c] ?? "").replace(/[^\d.]/g, "")) || 0);
    if (v > 0) t[c] = v;
    else delete t[c];
  }
  write(g);
  return g[month];
}

// 실적은 파이썬으로 엑셀 여러 개를 읽어 느리니 잠깐 기억해 둔다 (새 주간 파일이 생기면 몇 분 안에 반영)
const cache = new Map();
function actual(month) {
  const hit = cache.get(month);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.p;
  const p = new Promise((resolve) => {
    const py = process.platform === "win32" ? "python" : "python3";
    execFile(py, [path.join(PLUGIN_ROOT, "scripts", "month_sales.py"), weeklyDir().dir, month], { encoding: "utf8", timeout: 90000, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true }, (err, out) => {
      try {
        const r = JSON.parse(String(out || "").trim().split("\n").pop());
        resolve(r.error ? { actual: {}, through: {}, error: r.error } : r);
      } catch {
        resolve({ actual: {}, through: {}, error: "주간 매출 파일을 읽지 못했어요" });
      }
    });
  });
  cache.set(month, { at: Date.now(), p });
  return p;
}

export async function get(month) {
  if (!okMonth(month)) throw new Error("월이 올바르지 않아요");
  const a = await actual(month);
  return { month, channels: CHANNELS, targets: read()[month] || {}, actual: a.actual || {}, through: a.through || {}, error: a.error || "" };
}
