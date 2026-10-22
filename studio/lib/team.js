// 서버 PC 모드: 사무실 다른 PC가 브라우저로 접속해서 쓴다.
// - 서버 PC 자신(127.0.0.1)에서 열면 비밀번호 없이 바로 쓴다
// - 다른 PC는 팀 비밀번호를 한 번 넣으면 그 브라우저에서 180일 동안 유지된다
// - 채널 연결·Claude 계정·서버 설정·되살리기처럼 서버 PC에 영향을 주는 일은 서버 PC에서만 한다
import crypto from "node:crypto";
import os from "node:os";
import { loadConfig, updateLocalConfig } from "./store.js";

export const NAME = "plairemstool"; // 사무실 안 접속 주소: http://plairemstool
const COOKIE = "plaire_team";
const MAX_AGE = 180 * 24 * 3600; // 초

export const serverMode = () => !!loadConfig().server_mode;
// 서버 PC 자신인지: 127.0.0.1 뿐 아니라 이 PC의 사무실 주소(예: http://plairemstool → 192.168.0.114)로 열어도 서버 PC다
const ownAddresses = () =>
  new Set(
    Object.values(os.networkInterfaces())
      .flat()
      .filter(Boolean)
      .map((i) => i.address),
  );
export const isLocal = (req) => {
  const a = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return a === "127.0.0.1" || a === "::1" || ownAddresses().has(a);
};

// ---------- 비밀번호 ----------
const hash = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
export const hasPassword = () => !!loadConfig().team_pw;
export function setPassword(pw) {
  pw = String(pw || "").trim();
  if (pw.length < 4) throw new Error("비밀번호는 4자 이상으로 정해 주세요");
  const salt = crypto.randomBytes(16).toString("hex");
  // 비밀번호를 바꾸면 서명 키도 바꿔서, 예전 비밀번호로 들어온 브라우저는 다시 로그인하게 한다
  updateLocalConfig({ team_pw: `${salt}:${hash(pw, salt)}`, auth_secret: crypto.randomBytes(32).toString("hex") });
}
function checkPassword(pw) {
  const [salt, h] = String(loadConfig().team_pw || "").split(":");
  if (!salt || !h) return false;
  const a = Buffer.from(hash(pw, salt), "hex");
  const b = Buffer.from(h, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------- 로그인 쿠키 ----------
const secret = () => {
  let s = loadConfig().auth_secret;
  if (!s) {
    s = crypto.randomBytes(32).toString("hex");
    updateLocalConfig({ auth_secret: s });
  }
  return s;
};
const sign = (v) => crypto.createHmac("sha256", secret()).update(v).digest("hex");
const makeToken = () => {
  const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
  return `${exp}.${sign(exp)}`;
};
function validToken(t) {
  const [exp, sig] = String(t || "").split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const want = sign(exp);
  return sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}
const readCookie = (req) => {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
};

// ---------- 너무 많이 틀리면 잠깐 막기 ----------
const tries = new Map(); // ip → {n, until}
function tooMany(ip) {
  const t = tries.get(ip);
  return t && t.until > Date.now();
}
function failed(ip) {
  const t = tries.get(ip) || { n: 0, until: 0 };
  t.n += 1;
  if (t.n >= 8) (t.until = Date.now() + 10 * 60 * 1000), (t.n = 0);
  tries.set(ip, t);
}

// 로그인 없이 열리는 것: 로그인 화면·로그인 요청·로고
const OPEN = new Set(["/login", "/api/login", "/img/plaire-symbol.png", "/api/health"]);
export function guard(req, res, next) {
  if (!serverMode() || isLocal(req) || OPEN.has(req.path) || validToken(readCookie(req))) return next();
  if (req.path.startsWith("/api/") || req.path.startsWith("/media/")) return res.status(401).json({ error: "팀 비밀번호로 다시 로그인해 주세요", login: true });
  res.redirect("/login");
}

export function login(req, res) {
  const ip = String(req.socket?.remoteAddress || "");
  if (tooMany(ip)) return res.status(429).json({ error: "여러 번 틀려서 10분 동안 막혔어요. 잠시 뒤 다시 해 주세요" });
  if (!hasPassword()) return res.status(400).json({ error: "아직 팀 비밀번호가 정해지지 않았어요. 서버 PC에서 설정해 주세요" });
  if (!checkPassword(req.body?.password)) {
    failed(ip);
    return res.status(401).json({ error: "비밀번호가 맞지 않아요" });
  }
  tries.delete(ip);
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(makeToken())}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
}

// 서버 PC에서만 되는 일
export function localOnly(req, res, next) {
  if (isLocal(req)) return next();
  res.status(403).json({ error: "이 작업은 서버 PC(plairemstool)에서만 할 수 있어요" });
}

// 사무실 안 접속 주소들
export function addresses(port) {
  const host = os.hostname();
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254"))
    .map((i) => i.address);
  const p = (h, withPort) => `http://${h}${withPort ? `:${port}` : ""}`;
  const list = [];
  if (host.toLowerCase() === NAME) list.push(p(NAME, false));
  else list.push(p(host.toLowerCase(), false));
  for (const ip of ips) list.push(p(ip, false));
  return { host, renamed: host.toLowerCase() === NAME, list, port };
}

export const loginPage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>플레르 MS팀 · 로그인</title>
<style>
:root{--ink:#14171c;--sub:#5c6370;--line:#e4e7ec;--bg:#eef0f3;--blue:#2f5be7}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);font-family:"Pretendard","Malgun Gothic",system-ui,sans-serif;color:var(--ink)}
form{width:min(360px,calc(100vw - 32px));background:#fff;border-radius:20px;padding:32px 28px;box-shadow:0 20px 40px -18px rgba(16,24,40,.25);display:grid;gap:14px}
.brand{display:flex;align-items:center;gap:10px}.brand img{width:36px;height:36px}.brand b{font-size:16px}.brand small{display:block;color:var(--sub);font-size:12px}
label{font-size:13px;font-weight:600}input{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:10px;font:inherit;font-size:15px}
input:focus{outline:2px solid var(--blue);outline-offset:1px}button{padding:13px;border:0;border-radius:10px;background:var(--ink);color:#fff;font:inherit;font-weight:700;font-size:15px;cursor:pointer}
.err{min-height:18px;margin:0;color:#d33;font-size:13px}
</style></head><body>
<form id="f"><div class="brand"><img src="/img/plaire-symbol.png" alt=""><div><b>플레르 MS팀 업무 도구</b><small>팀 비밀번호를 넣어 주세요</small></div></div>
<label for="pw">팀 비밀번호</label><input id="pw" type="password" autocomplete="current-password" autofocus>
<p class="err" id="err"></p><button>들어가기</button></form>
<script>
document.getElementById("f").onsubmit=async(e)=>{e.preventDefault();const r=await fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:document.getElementById("pw").value})});
const d=await r.json().catch(()=>({}));if(r.ok)location.href="/";else document.getElementById("err").textContent=d.error||"들어가지 못했어요";};
</script></body></html>`;
