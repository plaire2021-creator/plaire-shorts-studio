// 신제품 출시 매뉴얼: 팀 공용 내용 하나를 서버에 저장 (version으로 두 사람이 동시에 고칠 때 덮어쓰기를 막는다)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR } from "./store.js";

const FILE = path.join(DATA_DIR, "launch", "state.json");
const DEFAULT = path.join(path.dirname(fileURLToPath(import.meta.url)), "launch-default.json"); // 팀장님 매뉴얼의 처음 내용(예시)

export function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { version: 0, state: JSON.parse(fs.readFileSync(DEFAULT, "utf8")) };
  }
}

export function save(version, state) {
  const cur = load();
  if (version !== cur.version) return { conflict: true, ...cur };
  if (!state || !state.product || !Array.isArray(state.checklists) || !Array.isArray(state.steps)) throw new Error("매뉴얼 내용이 올바르지 않아요");
  const next = { version: cur.version + 1, saved_at: new Date().toISOString(), state };
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE + ".tmp", JSON.stringify(next));
  fs.renameSync(FILE + ".tmp", FILE);
  return next;
}
