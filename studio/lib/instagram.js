// 인스타그램 릴스: 'Instagram 로그인' 방식 API (graph.instagram.com).
// 페이스북 페이지 연결이 필요 없어서 인스타 쇼핑(커머스) 연결을 건드리지 않는다.
// 이 방식은 영상을 공개 URL로만 받으므로, 올리는 동안만 tunnel.js로 영상 파일 하나를 임시 공개한다.
// 토큰: 장기 토큰(60일) → 쓸 때마다 7일 넘었으면 자동 갱신.
import { loadConfig, loadTokens, setToken } from "./store.js";
import { shareFile } from "./tunnel.js";

const ver = () => loadConfig().instagram.api_version || "v23.0";
const G = () => `https://graph.instagram.com/${ver()}`;
const SCOPE = "instagram_business_basic,instagram_business_content_publish";
export const redirectUri = (port) => `http://localhost:${port}/auth/instagram/callback`;

async function call(url, opts) {
  const r = await fetch(url, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error || d.error_message) throw new Error("인스타그램 오류: " + (d.error?.message || d.error_message || r.status));
  return d;
}
const form = (o) => ({ method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(o) });

// ---------- 연결 ----------
export function authUrl(port, state) {
  const c = loadConfig().instagram;
  if (!c.app_id) throw new Error("관리자 설정이 필요해요 (Instagram 앱 ID)");
  return "https://www.instagram.com/oauth/authorize?" + new URLSearchParams({ client_id: c.app_id, redirect_uri: redirectUri(port), response_type: "code", scope: SCOPE, state });
}

export async function handleCallback(port, code) {
  const c = loadConfig().instagram;
  if (!c.app_secret) throw new Error("관리자 설정이 필요해요 (Instagram 앱 시크릿)");
  const short = await call("https://api.instagram.com/oauth/access_token", form({ client_id: c.app_id, client_secret: c.app_secret, grant_type: "authorization_code", redirect_uri: redirectUri(port), code: code.replace(/#_$/, "") }));
  const long = await call("https://graph.instagram.com/access_token?" + new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: c.app_secret, access_token: short.access_token }));
  return saveToken(long.access_token, long.expires_in);
}

// Meta 대시보드 'Instagram 로그인이 포함된 API 설정 → 액세스 토큰 생성'에서 받은 토큰을 붙여넣는 방법 (시크릿 없이 가능)
export async function connectWithToken(token) {
  if (!token) throw new Error("토큰을 붙여넣어 주세요");
  return saveToken(token, 60 * 24 * 3600);
}

async function saveToken(token, expiresIn) {
  const me = await call(`${G()}/me?fields=user_id,username&access_token=${token}`);
  setToken("instagram", { access_token: token, user_id: me.user_id, username: me.username, refreshed_at: Date.now(), expires_at: Date.now() + expiresIn * 1000 });
  return "@" + me.username;
}

// 60일 토큰을 연장한다. 스튜디오가 켜질 때·12시간마다·업로드할 때 부르고, 마지막 연장 후 하루가 지났을 때만 실제로 요청한다.
export async function refreshIfNeeded() {
  const t = loadTokens().instagram;
  if (!t?.access_token || (t.expires_at && t.expires_at < Date.now())) return false;
  if (Date.now() - (t.refreshed_at || 0) < 24 * 3600 * 1000) return false;
  const d = await call("https://graph.instagram.com/refresh_access_token?" + new URLSearchParams({ grant_type: "ig_refresh_token", access_token: t.access_token }));
  setToken("instagram", { ...t, access_token: d.access_token, refreshed_at: Date.now(), expires_at: Date.now() + d.expires_in * 1000 });
  return true;
}

async function accessToken() {
  if (!loadTokens().instagram?.access_token) throw new Error("인스타그램이 연결되지 않았어요");
  await refreshIfNeeded().catch(() => {});
  return loadTokens().instagram.access_token;
}

export function status() {
  const c = loadConfig().instagram;
  const t = loadTokens().instagram;
  const expired = t?.expires_at && t.expires_at < Date.now();
  const days = t?.expires_at ? Math.floor((t.expires_at - Date.now()) / 86400000) : null;
  return { configured: true, connected: !!t?.access_token && !expired, account: t?.username ? "@" + t.username : null, expired: !!expired, days_left: days };
}

// ---------- 게시 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function upload({ file, caption }) {
  const token = await accessToken();
  const uid = loadTokens().instagram.user_id;
  const { url, stop } = await shareFile(file);
  try {
    const c = await call(`${G()}/${uid}/media`, form({ media_type: "REELS", video_url: url, caption, share_to_feed: "true", access_token: token }));
    // 인스타가 영상을 가져가 처리할 때까지 대기 (최대 10분)
    for (let i = 0; i < 120; i++) {
      const s = await call(`${G()}/${c.id}?fields=status_code,status&access_token=${token}`);
      if (s.status_code === "FINISHED") break;
      if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error("인스타그램 영상 처리 실패: " + (s.status || s.status_code));
      await sleep(5000);
    }
    const p = await call(`${G()}/${uid}/media_publish`, form({ creation_id: c.id, access_token: token }));
    const m = await call(`${G()}/${p.id}?fields=permalink&access_token=${token}`).catch(() => ({}));
    return { url: m.permalink || null, privacy: "public", note: "전체공개로 게시됐어요" };
  } finally {
    stop();
  }
}
