// 기획전 관리: 스마트스토어·쿠팡·오늘의집 기획전마다 기간·신청 상태·선정 제품·진행 메모.
// data/plans/promos.json = {items: [...], deleted: [...]} (plans 폴더라 백업에 같이 들어간다). 항목 하나씩 고쳐 저장해 서로 덮어쓰지 않게
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DATA_DIR } from "./store.js";

export const CHANNELS = ["스마트스토어", "쿠팡", "오늘의집"];
export const STATUSES = ["신청 전", "신청 완료", "선정", "미선정"];
const FILE = path.join(DATA_DIR, "plans", "promos.json");
const okDate = (d) => d === "" || /^\d{4}-\d{2}-\d{2}$/.test(String(d));

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

// 들어온 값 중 아는 칸만 골라 정리
function clean(b) {
  const o = {};
  if (b.ch !== undefined) {
    if (!CHANNELS.includes(b.ch)) throw new Error("채널을 골라 주세요");
    o.ch = b.ch;
  }
  if (b.name !== undefined) o.name = String(b.name).trim().slice(0, 100);
  for (const k of ["start", "end", "apply_by"])
    if (b[k] !== undefined) {
      if (!okDate(b[k] || "")) throw new Error("날짜가 올바르지 않아요");
      o[k] = b[k] || "";
    }
  if (b.status !== undefined) {
    if (!STATUSES.includes(b.status)) throw new Error("상태가 올바르지 않아요");
    o.status = b.status;
  }
  // 제품 = {code: 옵션코드(구글 시트 상품등록 현황·신제품 출시 매뉴얼과 같은 코드), name}. 예전 글자만 있던 것도 받는다
  if (b.products !== undefined)
    o.products = (Array.isArray(b.products) ? b.products : [])
      .map((p) => (typeof p === "string" ? { code: "", name: p } : { code: String(p?.code || ""), name: String(p?.name || "") }))
      .map((p) => ({ code: p.code.trim().slice(0, 80), name: p.name.trim().slice(0, 80) }))
      .filter((p) => p.code || p.name)
      .slice(0, 50);
  for (const [k, n] of [["owner", 10], ["link", 1000], ["apply_link", 1000], ["memo", 2000]]) if (b[k] !== undefined) o[k] = String(b[k]).trim().slice(0, n);
  return o;
}

export const list = () => read().items.map((it) => ({ apply_link: "", ...it, products: (it.products || []).map((p) => (typeof p === "string" ? { code: "", name: p } : p)) }));

export function create(body) {
  const o = clean(body || {});
  if (!o.ch) throw new Error("채널을 골라 주세요");
  if (!o.name) throw new Error("기획전 이름을 넣어 주세요");
  const d = read();
  const it = { id: crypto.randomBytes(4).toString("hex"), ch: o.ch, name: o.name, start: "", end: "", apply_by: "", status: "신청 전", products: [], owner: "", link: "", apply_link: "", memo: "", ...o, created_at: new Date().toISOString() };
  it.updated_at = it.created_at;
  d.items.push(it);
  write(d);
  return it;
}

export function update(id, body) {
  const o = clean(body || {});
  if (o.name === "") throw new Error("기획전 이름을 넣어 주세요");
  const d = read();
  const it = d.items.find((x) => x.id === id);
  if (!it) throw new Error("기획전을 찾지 못했어요");
  Object.assign(it, o, { updated_at: new Date().toISOString() });
  write(d);
  return it;
}

// 지운 기획전은 deleted에 남겨 둔다 (실수로 지웠을 때 되살릴 수 있게)
export function remove(id) {
  const d = read();
  const i = d.items.findIndex((x) => x.id === id);
  if (i < 0) throw new Error("기획전을 찾지 못했어요");
  d.deleted.push({ ...d.items[i], deleted_at: new Date().toISOString() });
  d.deleted = d.deleted.slice(-100);
  d.items.splice(i, 1);
  write(d);
  return { ok: true };
}
