// 홈 캘린더에 팀이 직접 넣는 일정(연차·촬영·회식 등). 출시·기획전 일정은 각 화면 자료에서 자동으로 그린다.
// data/plans/events.json = {items: [{id, title, start, end, color, memo}], deleted: [...]} (plans 폴더라 백업에 같이 들어간다)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.js";

const FILE = path.join(DATA_DIR, "plans", "events.json");
const okDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ""));
const okColor = (c) => /^#[0-9a-f]{6}$/i.test(String(c || ""));

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return { items: j.items || [], deleted: j.deleted || [] };
  } catch {
    return { items: [], deleted: [] };
  }
}
function write(d) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(d, null, 1));
  fs.renameSync(FILE + ".tmp", FILE);
}
function clean(b, base) {
  const o = { ...base };
  if (b.title !== undefined) o.title = String(b.title).trim().slice(0, 60);
  if (b.start !== undefined) o.start = String(b.start);
  if (b.end !== undefined) o.end = String(b.end || "");
  if (b.color !== undefined) o.color = String(b.color);
  if (b.memo !== undefined) o.memo = String(b.memo).trim().slice(0, 500);
  if (!o.title) throw new Error("일정 이름을 넣어 주세요");
  if (!okDate(o.start)) throw new Error("날짜를 골라 주세요");
  if (!okDate(o.end) || o.end < o.start) o.end = o.start;
  if (!okColor(o.color)) o.color = "#2f5bea";
  return o;
}

export const list = () => read().items;

export function create(body) {
  const d = read();
  const it = { id: crypto.randomBytes(4).toString("hex"), ...clean(body || {}, { title: "", start: "", end: "", color: "", memo: "" }), created_at: new Date().toISOString() };
  d.items.push(it);
  write(d);
  return it;
}

export function update(id, body) {
  const d = read();
  const i = d.items.findIndex((x) => x.id === id);
  if (i < 0) throw new Error("일정을 찾지 못했어요");
  d.items[i] = { ...clean(body || {}, d.items[i]), updated_at: new Date().toISOString() };
  write(d);
  return d.items[i];
}

// 지운 일정은 deleted에 남겨 둔다 (실수로 지웠을 때 되살릴 수 있게)
export function remove(id) {
  const d = read();
  const i = d.items.findIndex((x) => x.id === id);
  if (i < 0) throw new Error("일정을 찾지 못했어요");
  d.deleted.push({ ...d.items[i], deleted_at: new Date().toISOString() });
  d.deleted = d.deleted.slice(-100);
  d.items.splice(i, 1);
  write(d);
  return { ok: true };
}
