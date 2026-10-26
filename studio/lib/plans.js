// 주간 업무 계획표: 매주 올리는 엑셀을 읽어(scripts/plan_parse.py) 홈 화면 업무판으로. 주마다 data/plans/<시작일>.json
// 체크·링크·휴가는 항목 하나씩 고쳐 저장한다 (여럿이 동시에 눌러도 서로 안 덮어쓰게)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT } from "./store.js";
import * as goals from "./goals.js";

const DIR = path.join(DATA_DIR, "plans");
export const MEMBERS = ["김은하", "박주혁", "방채원"];
const file = (id) => path.join(DIR, id + ".json");
const okId = (id) => /^\d{4}-\d{2}-\d{2}$/.test(String(id || ""));
const now = () => new Date().toISOString();

function write(p) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(file(p.id) + ".tmp", JSON.stringify(p, null, 1));
  fs.renameSync(file(p.id) + ".tmp", file(p.id));
  return p;
}
export function load(id) {
  if (!okId(id)) throw new Error("주간 업무를 찾지 못했어요");
  let p;
  try {
    p = JSON.parse(fs.readFileSync(file(id), "utf8"));
  } catch {
    throw new Error("주간 업무를 찾지 못했어요");
  }
  // 1.34.0 휴가 형식({on, memo}) → 날짜별({days, note})
  p.leave = (p.leave || []).map((l) => (l.days ? l : { name: l.name, days: {}, note: l.on ? l.memo || "휴가" : "" }));
  // 1.44.0 전 자료엔 행 id가 없다 → 붙여서 저장해 둔다 (화면·서버가 같은 id를 쓰게)
  if (p.rows.some((r) => !r.id)) {
    for (const r of p.rows) r.id ||= crypto.randomBytes(3).toString("hex");
    write(p);
  }
  return p;
}
export function list() {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8"));
        const items = p.rows.flatMap((r) => [...r.plaire, ...r.gazda]);
        return { id: p.id, period: p.period, title: p.title, done: items.filter((i) => i.done).length, total: items.length, uploaded_at: p.uploaded_at };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.id.localeCompare(a.id));
}

function parse(xlsx) {
  return new Promise((resolve, reject) => {
    const py = process.platform === "win32" ? "python" : "python3";
    execFile(py, [path.join(PLUGIN_ROOT, "scripts", "plan_parse.py"), xlsx], { encoding: "utf8", timeout: 60000, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true }, (err, out) => {
      try {
        const r = JSON.parse(String(out || "").trim().split("\n").pop());
        return r.error ? reject(new Error(r.error)) : resolve(r);
      } catch {
        reject(new Error("업무 계획표를 읽지 못했어요"));
      }
    });
  });
}

// 엑셀을 올리면: 같은 주가 이미 있으면 같은 문장 업무의 체크·링크와 휴가 표시는 이어받는다
export async function importXlsx(xlsx, name) {
  const r = await parse(xlsx);
  try { goals.importFromPlan(r.goals); } catch {} // '월간목표매출' 시트가 있으면 홈 목표 매출도 맞춘다
  const id = r.period?.[0] || new Date().toISOString().slice(0, 10);
  let prev = null;
  try {
    prev = load(id);
  } catch {}
  const old = new Map();
  if (prev) for (const row of prev.rows) for (const side of ["plaire", "gazda"]) for (const it of row[side]) old.set(row.cat + "|" + side + "|" + it.t, it);
  const mk = (cat, side) => (x) => {
    const o = old.get(cat + "|" + side + "|" + x.t);
    return { id: crypto.randomBytes(4).toString("hex"), t: x.t, link: o?.link || x.link || "", done: !!o?.done, done_at: o?.done_at || "" };
  };
  // 휴가: 사람마다 날짜별(연차·반차). 엑셀엔 날짜 없이 '연차 : 이름'만 있어서 그 사람은 '날짜 미정'으로 표시해 둔다
  const names = [...MEMBERS, ...r.leave.map((l) => l.name).filter((n) => !MEMBERS.includes(n))];
  const leave = names.map((n) => {
    const p = prev?.leave?.find((l) => l.name === n);
    const f = r.leave.find((l) => l.name === n);
    return { name: n, days: p?.days || {}, note: p ? p.note || "" : f ? f.kind : "" };
  });
  const rows = r.rows.map((row) => ({ id: crypto.randomBytes(3).toString("hex"), cat: row.cat, note: row.note, ref: row.ref, common: row.common, plaire: row.plaire.map(mk(row.cat, "plaire")), gazda: row.gazda.map(mk(row.cat, "gazda")) }));
  // 화면에서 직접 넣은 업무·항목(manual)은 같은 주 엑셀을 다시 올려도 남긴다
  if (prev)
    for (const pr of prev.rows) {
      let row = rows.find((x) => x.cat === pr.cat);
      if (!row && pr.manual) rows.push((row = { ...pr, plaire: [], gazda: [] }));
      if (!row) continue;
      for (const side of ["plaire", "gazda"]) for (const it of pr[side]) if (it.manual && !row[side].some((x) => x.t === it.t)) row[row.common ? "plaire" : side].push(it);
    }
  const plan = {
    id,
    title: r.title || "주간업무 계획표",
    sheet: r.sheet,
    period: r.period,
    file: name,
    uploaded_at: now(),
    leave,
    rows,
  };
  return write(plan);
}

export function patchItem(id, { item, done, link, t }) {
  const p = load(id);
  for (const row of p.rows)
    for (const side of ["plaire", "gazda"])
      for (const it of row[side])
        if (it.id === item) {
          if (done !== undefined) {
            it.done = !!done;
            it.done_at = it.done ? now() : "";
          }
          if (link !== undefined) it.link = String(link).trim().slice(0, 1000);
          if (t !== undefined) {
            const v = String(t).trim().slice(0, 300);
            if (!v) throw new Error("업무 내용을 적어 주세요");
            it.t = v;
          }
          write(p);
          return it;
        }
  throw new Error("업무를 찾지 못했어요");
}

// ---------- 업무·항목 직접 추가·삭제 (화면에서) ----------
const rowOf = (p, rid) => {
  const r = p.rows.find((x) => x.id === rid);
  if (!r) throw new Error("항목을 찾지 못했어요");
  return r;
};
export function addItem(id, { row, side, t }) {
  const p = load(id), r = rowOf(p, row);
  const v = String(t || "").trim().slice(0, 300);
  if (!v) throw new Error("업무 내용을 적어 주세요");
  const s = r.common || side !== "gazda" ? "plaire" : "gazda";
  const it = { id: crypto.randomBytes(4).toString("hex"), t: v, link: "", done: false, done_at: "", manual: true };
  r[s].push(it);
  write(p);
  return it;
}
export function deleteItem(id, item) {
  const p = load(id);
  for (const r of p.rows)
    for (const side of ["plaire", "gazda"]) {
      const i = r[side].findIndex((x) => x.id === item);
      if (i >= 0) {
        r[side].splice(i, 1);
        write(p);
        return { ok: true };
      }
    }
  throw new Error("업무를 찾지 못했어요");
}
export function addRow(id, { cat, common }) {
  const p = load(id);
  const v = String(cat || "").trim().slice(0, 40);
  if (!v) throw new Error("항목 이름을 적어 주세요");
  if (p.rows.some((x) => x.cat === v)) throw new Error("같은 이름의 항목이 이미 있어요");
  const r = { id: crypto.randomBytes(3).toString("hex"), cat: v, note: "", ref: "", common: !!common, plaire: [], gazda: [], manual: true };
  p.rows.push(r);
  write(p);
  return r;
}
export function patchRow(id, { row, cat }) {
  const p = load(id), r = rowOf(p, row);
  const v = String(cat || "").trim().slice(0, 40);
  if (!v) throw new Error("항목 이름을 적어 주세요");
  if (p.rows.some((x) => x !== r && x.cat === v)) throw new Error("같은 이름의 항목이 이미 있어요");
  r.cat = v;
  write(p);
  return r;
}
export function deleteRow(id, row) {
  const p = load(id), r = rowOf(p, row);
  p.rows.splice(p.rows.indexOf(r), 1);
  write(p);
  return { ok: true };
}

// 휴가 하루 바꾸기: kind = '연차' | '반차' | '' (지우기). 날짜를 하나라도 고르면 엑셀에서 온 '날짜 미정' 표시는 지운다
export function setLeave(id, { name, date, dates, kind }) {
  const p = load(id);
  const ds = (Array.isArray(dates) ? dates : [date]).map(String).slice(0, 31); // 여러 날(기간)을 한 번에
  if (!ds.length || !ds.every((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))) throw new Error("날짜가 올바르지 않아요");
  let l = p.leave.find((x) => x.name === name);
  if (!l) p.leave.push((l = { name: String(name).slice(0, 10), days: {}, note: "" }));
  l.days = l.days || {};
  for (const d of ds) {
    if (kind === "연차" || kind === "반차") l.days[d] = kind;
    else delete l.days[d];
  }
  l.note = "";
  write(p);
  return p.leave;
}
