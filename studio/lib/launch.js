// 신제품 출시 매뉴얼: 제품마다 파일 하나(data/launch/products/<id>.json)로 팀 공용 저장
// version으로 두 사람이 동시에 고칠 때 덮어쓰기를 막는다
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./store.js";

const DIR = path.join(DATA_DIR, "launch");
const PDIR = path.join(DIR, "products");
const OLD = path.join(DIR, "state.json"); // 1.16.0: 제품 하나만 저장하던 파일
const DEFAULT = path.join(path.dirname(fileURLToPath(import.meta.url)), "launch-default.json"); // 팀장님 매뉴얼의 처음 내용(예시)
export const OWNERS = ["MS팀", "김은하", "박주혁", "방채원"];

const file = (id) => path.join(PDIR, id + ".json");
const okId = (id) => /^[a-z0-9-]{6,40}$/.test(String(id || ""));
const readDefault = () => JSON.parse(fs.readFileSync(DEFAULT, "utf8"));
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

function write(id, rec) {
  fs.mkdirSync(PDIR, { recursive: true });
  fs.writeFileSync(file(id) + ".tmp", JSON.stringify(rec));
  fs.renameSync(file(id) + ".tmp", file(id));
}
function newId() {
  return Date.now().toString(36) + "-" + crypto.randomBytes(3).toString("hex");
}

// 처음 열 때: 예전 저장본이 있으면 첫 제품으로 옮기고, 없으면 팀장님 예시를 첫 제품으로 둔다
function ensure() {
  if (fs.existsSync(PDIR)) return;
  let first;
  try {
    first = JSON.parse(fs.readFileSync(OLD, "utf8"));
    fs.renameSync(OLD, OLD + ".moved");
  } catch {
    first = { version: 0, state: readDefault() };
  }
  write(newId(), { version: first.version || 0, created_at: new Date().toISOString(), state: first.state });
}

export function list() {
  ensure();
  const t = today();
  return fs
    .readdirSync(PDIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const { state: s, saved_at, created_at } = JSON.parse(fs.readFileSync(path.join(PDIR, f), "utf8"));
        const items = s.checklists.flatMap((c) => c.items);
        const late = items.filter((i) => i.st !== "완료" && i.st !== "보류" && addDays(s.product.launch, i.e) < t).length;
        const open = s.checklists.flatMap((c) => c.items.filter((i) => i.st !== "완료" && i.st !== "보류").map((i) => ({ ...i, ch: c.name })));
        const nx = open.sort((a, b) => a.e - b.e || a.s - b.s || (a.step || 99) - (b.step || 99))[0]; // 마감이 가장 가까운 업무
        const next = nx ? `${nx.ch} ${String(nx.name).replace(/^\s*\[\d+\]\s*/, "")}` : "";
        return { id: f.slice(0, -5), name: s.product.name, launch: s.product.launch, team: s.product.team, done: items.filter((i) => i.st === "완료").length, total: items.length, late, next, saved_at: saved_at || created_at };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.launch).localeCompare(String(a.launch)));
}

export function load(id) {
  if (!okId(id)) throw new Error("제품을 찾지 못했어요");
  try {
    return JSON.parse(fs.readFileSync(file(id), "utf8"));
  } catch {
    throw new Error("제품을 찾지 못했어요");
  }
}

// 새 제품: 팀장님 매뉴얼의 업무·체험단 틀만 가져오고, 상태·실적·예시 숫자는 비운다
export function create({ name, launch, team }) {
  name = String(name || "").trim().slice(0, 100);
  if (!name) throw new Error("제품명을 입력해 주세요");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(launch || ""))) throw new Error("출시일을 골라 주세요");
  if (!OWNERS.includes(team)) team = OWNERS[0];
  const s = readDefault();
  s.product = { name, launch, category: "", team, memo: "" };
  for (const c of s.checklists) for (const it of c.items) Object.assign(it, { st: "대기", memo: "", owner: team });
  for (const c of s.channels) Object.assign(c, { price: 0, margin: 0, qty: 0, ad: 0, promo: 0, etc: 0 });
  s.perf = {};
  s.kpi = {};
  s.perfExample = false;
  for (const x of s.exp) {
    Object.assign(x, { start: addDays(launch, 14), people: [], go: "검토중", owner: team });
    for (const a of x.steps) Object.assign(a, { st: "대기", memo: "", owner: team });
  }
  ensure();
  const id = newId();
  write(id, { version: 0, created_at: new Date().toISOString(), state: s });
  return { id };
}

export function save(id, version, state) {
  const cur = load(id);
  if (version !== cur.version) return { conflict: true, ...cur };
  if (!state || !state.product || !Array.isArray(state.checklists) || !Array.isArray(state.steps)) throw new Error("매뉴얼 내용이 올바르지 않아요");
  const next = { ...cur, version: cur.version + 1, saved_at: new Date().toISOString(), state };
  write(id, next);
  return next;
}

// 지운 제품은 바로 없애지 않고 deleted 폴더로 옮겨 둔다 (실수로 지웠을 때 되살릴 수 있게)
export function remove(id) {
  load(id);
  const to = path.join(DIR, "deleted");
  fs.mkdirSync(to, { recursive: true });
  fs.renameSync(file(id), path.join(to, id + ".json"));
}
