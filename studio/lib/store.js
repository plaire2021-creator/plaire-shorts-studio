// PC별 데이터: %USERPROFILE%\plaire-shorts\ (작업물·설정·토큰). 저장소(플러그인)에는 넣지 않는다.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const DATA_DIR = process.env.PLAIRE_SHORTS_HOME || path.join(os.homedir(), "plaire-shorts");
export const JOBS_DIR = path.join(DATA_DIR, "jobs");
const CONFIG = path.join(DATA_DIR, "config.json");
const TOKENS = path.join(DATA_DIR, "tokens.json");

fs.mkdirSync(JOBS_DIR, { recursive: true });

const DEFAULT_CONFIG = {
  port: 4173,
  claude_path: "",
  cloudflared_path: "",
  youtube: { client_id: "", client_secret: "" },
  instagram: { app_id: "", app_secret: "", api_version: "v23.0" }, // Instagram 로그인 방식의 Instagram 앱 ID·시크릿
  tiktok: { client_key: "", client_secret: "", redirect_uri: "" }, // 비우면 http://localhost:<포트>/auth/tiktok/callback
};

const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (p, v) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2), "utf8");
};

// 공용 설정(studio/app-config.json, 비공개 저장소에 포함) → 모든 PC에 자동 적용. PC별 config.json이 있으면 그 값이 우선.
const APP_CONFIG = path.join(PLUGIN_ROOT, "studio", "app-config.json");
export const loadConfig = () => {
  const a = readJson(APP_CONFIG, {});
  const c = readJson(CONFIG, {});
  const pick = (k) => {
    const out = { ...DEFAULT_CONFIG[k], ...a[k] };
    for (const [kk, v] of Object.entries(c[k] || {})) if (v) out[kk] = v;
    return out;
  };
  return { ...DEFAULT_CONFIG, ...a, ...c, youtube: pick("youtube"), instagram: pick("instagram"), tiktok: pick("tiktok") };
};
export const saveConfig = (c) => writeJson(CONFIG, c);
// 이 PC 설정 파일에서 일부 값만 바꾼다 (공용 설정과 섞지 않음)
export const updateLocalConfig = (patch) => writeJson(CONFIG, { ...readJson(CONFIG, {}), ...patch });
export const loadTokens = () => readJson(TOKENS, {});
export const saveTokens = (t) => writeJson(TOKENS, t);
export const setToken = (platform, value) => {
  const t = loadTokens();
  if (value) t[platform] = value;
  else delete t[platform];
  saveTokens(t);
};

// ---------- 작업(job) ----------
const jobFile = (id) => path.join(JOBS_DIR, id, "job.json");

export const newJobId = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
export const jobDir = (id) => path.join(JOBS_DIR, id);
export const loadJob = (id) => readJson(jobFile(id), null);
export const saveJob = (job) => {
  job.updated_at = new Date().toISOString();
  writeJson(jobFile(job.id), job);
  return job;
};
export const listJobs = () =>
  fs
    .readdirSync(JOBS_DIR)
    .map(loadJob)
    .filter(Boolean)
    .sort((a, b) => b.id.localeCompare(a.id));
