// 스마트스토어 상품 링크 → 상품명·상세페이지 이미지 (scripts/smartstore_fetch.py: 이 PC의 크롬을 화면 밖에 띄워 읽음)
// 블로그·숏츠가 상세페이지 이미지 대신 링크만 받을 때 쓴다. 크롬을 한 번에 하나만 띄우도록 줄을 세운다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { PLUGIN_ROOT } from "./store.js";

const PY = process.platform === "win32" ? "python" : "python3";
export const isStoreUrl = (u) => /^https?:\/\/(m\.)?(smartstore|brand)\.naver\.com\/[^/\s]+\/products\/\d+/.test(String(u || "").trim());

let queue = Promise.resolve();
let pending = 0;
export const anyFetching = () => pending > 0; // 자동 업데이트가 링크 읽는 중에 서버를 다시 켜지 않게
export function fetchStore(url) {
  pending++;
  const job = queue.then(
    () =>
      new Promise((resolve, reject) => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plaire_store_"));
        execFile(PY, ["-X", "utf8", path.join(PLUGIN_ROOT, "scripts", "smartstore_fetch.py"), url, dir], { encoding: "utf8", timeout: 180000, env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" }, windowsHide: true }, (err, out) => {
          try {
            const r = JSON.parse(String(out || "").trim().split("\n").pop());
            if (r.error) throw new Error(r.error);
            resolve({ ...r, dir });
          } catch (e) {
            fs.rmSync(dir, { recursive: true, force: true });
            reject(new Error(e.message && !/JSON/.test(e.message) ? e.message : "스마트스토어 링크를 읽지 못했어요"));
          }
        });
      }),
  );
  queue = job.catch(() => {});
  return job.finally(() => pending--);
}
