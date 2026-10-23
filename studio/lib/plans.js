// 주간 업무 계획표: 매주 올리는 엑셀을 읽어(scripts/plan_parse.py) 홈 화면 업무판으로. 주마다 data/plans/<시작일>.json
// 체크·링크·휴가는 항목 하나씩 고쳐 저장한다 (여럿이 동시에 눌러도 서로 안 덮어쓰게)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT } from "./store.js";

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
  try {
    return JSON.parse(fs.readFileSync(file(id), "utf8"));
  } catch {
    throw new Error("주간 업무를 찾지 못했어요");
  }
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
  const leave = MEMBERS.map((n) => {
    const p = prev?.leave?.find((l) => l.name === n);
    const f = r.leave.find((l) => l.name === n);
    return { name: n, on: p ? p.on : !!f, memo: p?.memo || (f ? f.kind : "") };
  });
  for (const f of r.leave) if (!MEMBERS.includes(f.name)) leave.push({ name: f.name, on: true, memo: f.kind });
  const plan = {
    id,
    title: r.title || "주간업무 계획표",
    sheet: r.sheet,
    period: r.period,
    file: name,
    uploaded_at: now(),
    leave,
    rows: r.rows.map((row) => ({ cat: row.cat, note: row.note, ref: row.ref, common: row.common, plaire: row.plaire.map(mk(row.cat, "plaire")), gazda: row.gazda.map(mk(row.cat, "gazda")) })),
  };
  return write(plan);
}

export function patchItem(id, { item, done, link }) {
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
          write(p);
          return it;
        }
  throw new Error("업무를 찾지 못했어요");
}

export function setLeave(id, { name, on, memo }) {
  const p = load(id);
  let l = p.leave.find((x) => x.name === name);
  if (!l) p.leave.push((l = { name: String(name).slice(0, 10), on: false, memo: "" }));
  if (on !== undefined) l.on = !!on;
  if (memo !== undefined) l.memo = String(memo).slice(0, 40);
  write(p);
  return p.leave;
}
