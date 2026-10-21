// 유튜브: Google OAuth(데스크톱 앱 클라이언트, 루프백 리디렉트) + videos.insert 재개 가능 업로드.
// 구글 심사(감사) 전 프로젝트는 공개로 보내도 비공개로 강제된다 → 결과에 privacy를 표시해 알려준다.
import fs from "node:fs";
import { loadConfig, loadTokens, setToken } from "./store.js";

const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.readonly"];
const redirectUri = (port) => `http://127.0.0.1:${port}/auth/youtube/callback`;

export function authUrl(port, state) {
  const c = loadConfig().youtube;
  if (!c.client_id) throw new Error("유튜브 클라이언트 ID를 먼저 설정해 주세요");
  const q = new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: redirectUri(port),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q;
}

async function tokenRequest(params) {
  const c = loadConfig().youtube;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, ...params }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error("유튜브 토큰 오류: " + (d.error_description || d.error));
  return d;
}

export async function handleCallback(port, code) {
  const d = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri(port) });
  const tok = { refresh_token: d.refresh_token, access_token: d.access_token, expires_at: Date.now() + d.expires_in * 1000 };
  setToken("youtube", tok);
  const ch = await channel().catch(() => null);
  setToken("youtube", { ...tok, channel: ch });
  return ch;
}

async function accessToken() {
  const t = loadTokens().youtube;
  if (!t?.refresh_token) throw new Error("유튜브가 연결되지 않았어요");
  if (t.access_token && t.expires_at > Date.now() + 60000) return t.access_token;
  const d = await tokenRequest({ refresh_token: t.refresh_token, grant_type: "refresh_token" });
  setToken("youtube", { ...t, access_token: d.access_token, expires_at: Date.now() + d.expires_in * 1000 });
  return d.access_token;
}

async function channel() {
  const r = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: "Bearer " + (await accessToken()) } });
  const d = await r.json();
  return d.items?.[0]?.snippet?.title || null;
}

export function status() {
  const c = loadConfig().youtube;
  const t = loadTokens().youtube;
  return { configured: !!(c.client_id && c.client_secret), connected: !!t?.refresh_token, account: t?.channel || null };
}

export async function upload({ file, title, description }) {
  const token = await accessToken();
  const size = fs.statSync(file).size;
  const meta = {
    snippet: { title: title.slice(0, 100), description, categoryId: "26" },
    status: { privacyStatus: "public", selfDeclaredMadeForKids: false },
  };
  const init = await fetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": "video/mp4",
      "X-Upload-Content-Length": String(size),
    },
    body: JSON.stringify(meta),
  });
  if (!init.ok) throw new Error("유튜브 업로드 시작 실패: " + (await init.text()).slice(0, 300));
  const put = await fetch(init.headers.get("location"), {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(size) },
    body: fs.readFileSync(file),
  });
  const d = await put.json();
  if (!put.ok) throw new Error("유튜브 업로드 실패: " + JSON.stringify(d).slice(0, 300));
  const privacy = d.status?.privacyStatus;
  return {
    url: `https://youtube.com/shorts/${d.id}`,
    privacy,
    note: privacy === "public" ? "전체공개로 올라갔어요" : "구글 심사 전이라 비공개로 올라갔어요. 유튜브 스튜디오에서 공개로 바꿔 주세요",
  };
}
