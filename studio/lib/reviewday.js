// 홈 '오늘 리뷰' 카드를 사람이 직접 고친 값. 리뷰 답글 도우미 기록(자동)보다 이 값이 먼저 보인다.
// data/plans/review-day.json = {"YYYY-MM-DD": {"플레르가구": {total, low, replied, by_hand_at}}} (plans 폴더라 백업에 같이 들어간다)
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store.js";

const FILE = path.join(DATA_DIR, "plans", "review-day.json");
const BRANDS = ["플레르가구", "가즈다가구"];

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return {};
  }
}
function write(d) {
  // 오래된 날짜는 60일만 남긴다
  const keep = Object.keys(d).sort().slice(-60);
  const out = Object.fromEntries(keep.map((k) => [k, d[k]]));
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(out, null, 1));
  fs.renameSync(FILE + ".tmp", FILE);
}
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const n = (v) => Math.max(0, Math.min(9999, Math.round(Number(v) || 0)));

export function get(date) {
  if (!okDate(date)) throw new Error("날짜가 올바르지 않아요");
  return read()[date] || {};
}

// clear: true 이면 직접 고친 값을 지우고 자동 값으로 되돌린다
export function set(date, brand, { total, low, replied, clear }) {
  if (!okDate(date)) throw new Error("날짜가 올바르지 않아요");
  if (!BRANDS.includes(brand)) throw new Error("브랜드를 골라 주세요");
  const d = read();
  d[date] ||= {};
  if (clear) delete d[date][brand];
  else {
    const t = n(total), l = Math.min(n(low), t);
    d[date][brand] = { total: t, low: l, replied: !!replied, by_hand_at: new Date().toISOString() };
  }
  if (!Object.keys(d[date]).length) delete d[date];
  write(d);
  return d[date] || {};
}
