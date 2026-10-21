// 영상 파일 하나만 잠깐 인터넷에 여는 장치.
// 인스타그램(Instagram 로그인 방식 API)은 로컬 파일을 직접 받지 않고 공개 URL에서 영상을 가져가기 때문에 필요하다.
// - 스튜디오 서버와 완전히 별개인 작은 서버가 '무작위 경로의 파일 1개'만 응답한다 (다른 경로는 전부 404)
// - Cloudflare 빠른 터널(cloudflared, 계정 불필요)로 https 주소를 받는다
// - 게시가 끝나거나 15분이 지나면 서버와 터널을 모두 닫는다
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { loadConfig } from "./store.js";

export function findCloudflared() {
  const c = loadConfig().cloudflared_path;
  if (c && fs.existsSync(c)) return c;
  const which = spawnSync(process.platform === "win32" ? "where" : "which", ["cloudflared"], { encoding: "utf8" });
  const hit = (which.stdout || "").split(/\r?\n/).find((l) => l.trim());
  if (which.status === 0 && hit) return hit.trim();
  for (const p of ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"]) if (fs.existsSync(p)) return p;
  return null;
}

export async function shareFile(file, { minutes = 15 } = {}) {
  const exe = findCloudflared();
  if (!exe) throw new Error("임시 공개 주소 도구(cloudflared)가 없어요. 설치 스크립트(setup.ps1)를 다시 실행해 주세요");
  const size = fs.statSync(file).size;
  const key = crypto.randomBytes(16).toString("hex");
  const route = `/${key}/video.mp4`;

  const server = http.createServer((req, res) => {
    if (req.url.split("?")[0] !== route || !["GET", "HEAD"].includes(req.method)) {
      res.writeHead(404).end();
      return;
    }
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    let start = 0;
    let end = size - 1;
    if (range) {
      if (range[1]) start = Number(range[1]);
      if (range[2]) end = Math.min(Number(range[2]), size - 1);
      if (!range[1] && range[2]) start = size - Number(range[2]);
    }
    res.writeHead(range ? 206 : 200, {
      "Content-Type": "video/mp4",
      "Content-Length": end - start + 1,
      "Accept-Ranges": "bytes",
      ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;

  const proc = spawn(exe, ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], { stdio: ["ignore", "pipe", "pipe"] });
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    proc.kill();
    server.close();
  };
  const timer = setTimeout(stop, minutes * 60 * 1000);
  proc.on("close", () => clearTimeout(timer));

  const base = await new Promise((ok, fail) => {
    let out = "";
    const onData = (d) => {
      out += d;
      const m = out.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m) ok(m[0]);
    };
    proc.stdout.on("data", onData);
    proc.stderr.on("data", onData);
    proc.on("close", () => fail(new Error("임시 공개 주소를 만들지 못했어요: " + out.slice(-300))));
    setTimeout(() => fail(new Error("임시 공개 주소를 만드는 데 시간이 너무 걸려요")), 45000);
  }).catch((e) => {
    stop();
    throw e;
  });

  const url = base + route;
  // 터널이 바깥에서 실제로 열릴 때까지 확인 (DNS 반영에 몇 초 걸림)
  for (let i = 0; i < 20; i++) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      if (r.ok) return { url, stop };
    } catch {}
    await new Promise((r) => setTimeout(r, 3000));
  }
  stop();
  throw new Error("임시 공개 주소가 열리지 않았어요. 인터넷 연결을 확인해 주세요");
}

export const fileName = (p) => path.basename(p);
