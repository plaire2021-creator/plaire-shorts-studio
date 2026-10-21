// 틱톡: Content Posting API의 '받은편지함 업로드'(초안). 앱 심사 전에는 바로 공개 게시가 안 되므로
// 영상만 틱톡 앱의 받은편지함으로 보내고, 사용자가 앱 알림을 눌러 캡션을 붙여 게시한다.
// OAuth 리디렉트 URL은 틱톡 개발자 앱에 등록한 주소여야 한다. 그 주소로 이동된 뒤 주소창 URL을 스튜디오에 붙여넣으면 연결된다.
import fs from "node:fs";
import crypto from "node:crypto";
import { loadConfig, loadTokens, setToken } from "./store.js";

const API = "https://open.tiktokapis.com/v2";

// 리디렉트 주소: 관리자가 따로 정하지 않으면 localhost 콜백(데스크톱 방식, PKCE). https 주소를 쓰면 주소창 URL 붙여넣기로 연결.
let PORT = 4173;
export const setPort = (p) => (PORT = p);
export const redirectUri = () => loadConfig().tiktok.redirect_uri || `http://localhost:${PORT}/auth/tiktok/callback`;
export const isLocalRedirect = () => redirectUri().startsWith("http://localhost");
const verifiers = new Map(); // state -> code_verifier

export function authUrl(state) {
  const c = loadConfig().tiktok;
  if (!c.client_key) throw new Error("관리자 설정이 필요해요 (틱톡 Client key)");
  const q = new URLSearchParams({ client_key: c.client_key, scope: "user.info.basic,video.upload", response_type: "code", redirect_uri: redirectUri(), state });
  if (isLocalRedirect()) {
    // 틱톡 데스크톱 PKCE: code_challenge = SHA256(verifier)의 16진수
    const v = crypto.randomBytes(32).toString("hex");
    verifiers.set(state, v);
    q.set("code_challenge", crypto.createHash("sha256").update(v).digest("hex"));
    q.set("code_challenge_method", "S256");
  }
  return "https://www.tiktok.com/v2/auth/authorize/?" + q;
}

export async function handleCallback(state, code) {
  const v = verifiers.get(state);
  if (!v) throw new Error("잘못된 요청이에요. 다시 연결해 주세요");
  verifiers.delete(state);
  const d = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(), code_verifier: v });
  saveTok(d);
  const name = await userName().catch(() => null);
  saveTok(d, { name });
  return name;
}

async function tokenRequest(params) {
  const c = loadConfig().tiktok;
  const r = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: c.client_key, client_secret: c.client_secret, ...params }),
  });
  const d = await r.json();
  if (!r.ok || d.error) throw new Error("틱톡 토큰 오류: " + (d.error_description || d.error || r.status));
  return d;
}

const saveTok = (d, extra = {}) =>
  setToken("tiktok", {
    ...extra,
    access_token: d.access_token,
    refresh_token: d.refresh_token,
    open_id: d.open_id,
    expires_at: Date.now() + d.expires_in * 1000,
  });

// 붙여넣은 리디렉트 URL(또는 code 값)로 연결
export async function connectFromPasted(pasted) {
  const c = loadConfig().tiktok;
  let code = pasted.trim();
  try {
    code = new URL(code).searchParams.get("code") || code;
  } catch {}
  const d = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  saveTok(d);
  const name = await userName().catch(() => null);
  saveTok(d, { name });
  return name;
}

async function accessToken() {
  const t = loadTokens().tiktok;
  if (!t?.refresh_token) throw new Error("틱톡이 연결되지 않았어요");
  if (t.expires_at > Date.now() + 60000) return t.access_token;
  const d = await tokenRequest({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  saveTok(d, { name: t.name });
  return d.access_token;
}

async function userName() {
  const r = await fetch(`${API}/user/info/?fields=display_name`, { headers: { Authorization: "Bearer " + (await accessToken()) } });
  const d = await r.json();
  return d.data?.user?.display_name || null;
}

export function status() {
  const c = loadConfig().tiktok;
  const t = loadTokens().tiktok;
  return { configured: !!(c.client_key && c.client_secret), connected: !!t?.refresh_token, account: t?.name || null, paste: !isLocalRedirect() };
}

export const newState = () => crypto.randomBytes(8).toString("hex");

export async function upload({ file }) {
  const token = await accessToken();
  const size = fs.statSync(file).size;
  const init = await fetch(`${API}/post/publish/inbox/video/init/`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 } }),
  });
  const d = await init.json();
  if (!init.ok || (d.error && d.error.code !== "ok")) throw new Error("틱톡 업로드 시작 실패: " + (d.error?.message || init.status));
  const put = await fetch(d.data.upload_url, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size), "Content-Range": `bytes 0-${size - 1}/${size}` },
    body: fs.readFileSync(file),
  });
  if (!put.ok) throw new Error("틱톡 영상 전송 실패: " + (await put.text()).slice(0, 300));
  return {
    url: null,
    privacy: "draft",
    note: "틱톡 앱 받은편지함 알림을 눌러 캡션(복사 버튼)을 붙이고 게시해 주세요. 앱 심사 통과 후에는 바로 공개 게시로 바꿀 수 있어요",
  };
}
