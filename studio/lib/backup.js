// 매일 자동 백업 + 되살리기 (실제 압축·풀기는 scripts/backup.py)
// 백업 위치: 설정 backup_dir > OneDrive\플레르MS팀_백업 > D:\플레르MS팀_백업 > %USERPROFILE%\플레르MS팀_백업
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DATA_DIR, PLUGIN_ROOT, loadConfig, updateLocalConfig } from "./store.js";

const PY = process.platform === "win32" ? "python" : "python3";
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "backup.py");

export function backupDir() {
  const set = loadConfig().backup_dir;
  if (set) return set;
  const home = os.homedir();
  const od = process.env.OneDriveCommercial || process.env.OneDrive || path.join(home, "OneDrive");
  if (fs.existsSync(od)) return path.join(od, "플레르MS팀_백업");
  if (process.platform === "win32" && fs.existsSync("D:\\")) return "D:\\플레르MS팀_백업";
  return path.join(home, "플레르MS팀_백업");
}

function py(args) {
  return new Promise((ok, fail) => {
    const p = spawn(PY, ["-X", "utf8", SCRIPT, ...args], { env: { ...process.env, PYTHONIOENCODING: "utf-8", PLAIRE_SHORTS_HOME: DATA_DIR }, windowsHide: true });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => {
      const last = out.trim().split(/\r?\n/).pop() || "";
      try {
        if (code === 0) return ok(JSON.parse(last));
      } catch {}
      fail(new Error((err || out || `종료 코드 ${code}`).trim().split(/\r?\n/).pop()));
    });
  });
}

let running = false;
export async function makeBackup(reason = "수동") {
  if (running) throw new Error("백업을 만드는 중이에요");
  running = true;
  try {
    const r = await py(["make", backupDir()]);
    updateLocalConfig({ last_backup: { at: new Date().toISOString(), file: path.basename(r.file), size: r.size, reason, ok: true } });
    return r;
  } catch (e) {
    updateLocalConfig({ last_backup: { ...(loadConfig().last_backup || {}), failed_at: new Date().toISOString(), error: e.message, ok: false } });
    throw e;
  } finally {
    running = false;
  }
}
export const listBackups = () => py(["list", backupDir()]);
export async function restoreBackup(name) {
  const file = path.join(backupDir(), path.basename(String(name || "")));
  if (!/^백업_.+\.zip$/.test(path.basename(file)) || !fs.existsSync(file)) throw new Error("그 백업 파일을 찾지 못했어요");
  return py(["restore", file]);
}
export const backupStatus = () => ({ dir: backupDir(), last: loadConfig().last_backup || null, running });

// 매일 밤 9시 이후 하루 한 번 (그날 백업이 없으면). 켜졌을 때 마지막 백업이 36시간 넘었으면 바로 한 번.
export function scheduleBackups(isBusy) {
  const tick = async (startup) => {
    const last = loadConfig().last_backup;
    const lastAt = last?.ok ? new Date(last.at) : null;
    const now = new Date();
    const due = startup
      ? !lastAt || now - lastAt > 36 * 3600 * 1000
      : now.getHours() >= 21 && (!lastAt || lastAt.toDateString() !== now.toDateString());
    if (!due || isBusy()) return;
    try {
      const r = await makeBackup(startup ? "켜질 때" : "매일 밤");
      console.log(`${now.toLocaleString("ko-KR", { hour12: false })} 자동 백업: ${path.basename(r.file)} (${Math.round(r.size / 1e6)}MB)`);
    } catch (e) {
      console.error(`${now.toLocaleString("ko-KR", { hour12: false })} 자동 백업 실패: ${e.message}`);
    }
  };
  setTimeout(() => tick(true), 3 * 60 * 1000);
  setInterval(() => tick(false), 30 * 60 * 1000);
}
