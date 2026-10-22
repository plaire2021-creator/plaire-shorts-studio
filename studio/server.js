// 플레르 숏츠 스튜디오 로컬 서버 (이 PC에서만 접속: 127.0.0.1 / ::1)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { exec, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import express from "express";
import multer from "multer";
import { DATA_DIR, PLUGIN_ROOT, updateLocalConfig, jobDir, listJobs, loadConfig, loadJob, newJobId, saveConfig, saveJob, setToken } from "./lib/store.js";
import { claudeAuth, claudeLoginUrl, findClaude, isRunning, isRunningAny, saveDetailImages, startClaudeLogin, startGeneration, stopGeneration, submitClaudeCode, switchClaudeAccount, unzipInto } from "./lib/generate.js";
import * as youtube from "./lib/youtube.js";
import * as instagram from "./lib/instagram.js";
import * as tiktok from "./lib/tiktok.js";
import { findCloudflared } from "./lib/tunnel.js";
import * as weekly from "./lib/weekly.js";
import * as reviews from "./lib/reviews.js";
import * as monthly from "./lib/monthly.js";
import * as team from "./lib/team.js";
import * as backup from "./lib/backup.js";
import * as blog from "./lib/blog.js";

const PORT = Number(process.env.PORT || loadConfig().port || 4173);
tiktok.setPort(PORT);
const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api", (req, res, next) => (res.set("Cache-Control", "no-store"), next())); // 연결 상태가 옛 값으로 보이지 않게
// 서버 PC 모드: 다른 PC는 팀 비밀번호로 들어온다 (서버 PC 자신은 그냥 통과)
app.get("/login", (req, res) => (!team.serverMode() || team.isLocal(req) ? res.redirect("/") : res.type("html").send(team.loginPage)));
app.post("/api/login", team.login);
app.use(team.guard);
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), "public"), { setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") })); // 업데이트 후 옛 화면이 남지 않게

// 서버가 꺼졌다 켜지면 중간에 끊긴 작업을 실패로 표시
// (만들던 스튜디오가 아직 살아 있으면 건드리지 않음)
const alive = (pid) => {
  try {
    return !!pid && process.kill(pid, 0);
  } catch {
    return false;
  }
};
for (const j of listJobs()) if ((j.status === "generating" || j.status === "queued") && !alive(j.server_pid)) saveJob({ ...j, status: "failed", error: "스튜디오가 꺼져서 중단됐어요. 다시 만들기를 눌러 주세요" });

const upload = multer({ dest: path.join(DATA_DIR, "tmp"), limits: { fileSize: 2 * 1024 ** 3 } });
const states = new Set();
const newState = () => {
  const s = crypto.randomBytes(8).toString("hex");
  states.add(s);
  return s;
};
const err = (res, e, code = 400) => res.status(code).json({ error: e.message || String(e) });
const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:Pretendard,'Malgun Gothic',sans-serif;display:grid;place-items:center;height:90vh;margin:0;background:#f6f4f0"><div style="background:#fff;border:1px solid #e6e1d8;border-radius:14px;padding:28px 34px;text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#6b665e;margin:0">${body}</p></div><script>setTimeout(()=>window.close(),2500)</script>`;

// 화면에 보낼 작업 정보 (파일 경로는 /media 주소로 바꿔서)
function view(job) {
  if (!job) return null;
  const r = job.result;
  return {
    ...job,
    running: isRunning(job.id),
    video_url: r?.video ? `/media/${job.id}/${encodeURIComponent(path.basename(r.video))}?v=${encodeURIComponent(job.updated_at || "")}` : null,
  };
}

// ---------- 준비 상태 (첫 화면 위쪽 4칸) ----------
let claudeCache = { at: 0, v: null };
app.get("/api/status", (req, res) => {
  res.set("X-Local", team.isLocal(req) ? "1" : "0");
  if (req.query.fresh || Date.now() - claudeCache.at > 15000) claudeCache = { at: Date.now(), v: claudeAuth() };
  res.json({
    claude: { ...claudeCache.v, configured: true, login_url: claudeLoginUrl() },
    youtube: youtube.status(),
    instagram: instagram.status(),
    tiktok: tiktok.status(),
    local: team.isLocal(req),
    server_mode: team.serverMode(),
  });
});

// ---------- 작업 ----------
app.get("/api/jobs", (req, res) =>
  res.json(
    listJobs().map((j) => ({
      id: j.id,
      kind: j.kind || "make",
      product_name: j.product_name,
      status: j.status,
      title: j.title,
      updated_at: j.updated_at,
      uploaded: Object.values(j.uploads || {}).filter((u) => u.state === "done").length,
      naver_pending: !!j.result && !(j.naver?.clip && j.naver?.shopping),
    })),
  ),
);
app.get("/api/jobs/:id", (req, res) => res.json(view(loadJob(req.params.id))));

// 업로드 파일의 한글 이름 복원 (multer는 latin1로 읽음)
const realName = (f) => path.basename(Buffer.from(f.originalname, "latin1").toString("utf8"));

// ---------- 리뷰 답글 작성 도우미 ----------
// 스튜디오가 꺼졌다 켜져서 멈춘 실행은 '멈춤'으로 보여 준다
const reviewView = (r) => {
  if (!r) return null;
  const live = reviews.isRunning(r.id);
  if (r.status === "running" && !live && !alive(r.server_pid)) return { ...r, status: "failed", error: "스튜디오가 꺼져서 중단됐어요. 다시 넣어 주세요" };
  return { ...r, running: live || (r.status === "running" && alive(r.server_pid)) };
};
app.get("/api/reviews/runs", (req, res) => res.json(reviews.listRuns(req.query.brand).map(reviewView)));
app.get("/api/reviews/runs/:id", (req, res) => {
  const r = reviewView(reviews.loadRun(req.params.id));
  if (!r) return err(res, new Error("기록이 없어요"), 404);
  res.json(r);
});
app.get("/api/reviews/runs/:id/low", (req, res) => {
  const r = reviews.loadRun(req.params.id);
  if (!r?.low_file || !fs.existsSync(r.low_file)) return err(res, new Error("엑셀이 없어요"), 404);
  res.download(r.low_file, path.basename(r.low_file));
});
app.get("/api/reviews/runs/:id/page", (req, res) => {
  const r = reviews.loadRun(req.params.id);
  if (!r?.page || !fs.existsSync(r.page)) return err(res, new Error("답글 페이지가 없어요"), 404);
  if (req.query.download) return res.download(r.page, path.basename(r.page));
  res.sendFile(r.page);
});
app.delete("/api/reviews/runs/:id", (req, res) => {
  reviews.stopRun(req.params.id);
  fs.rmSync(reviews.runDir(req.params.id), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  res.json({ ok: true });
});
app.post("/api/reviews/runs", upload.single("file"), (req, res) => {
  const f = req.file;
  try {
    if (!f) throw new Error("스마트스토어 리뷰 엑셀을 넣어 주세요");
    const name = realName(f);
    if (!/\.xlsx$/i.test(name)) throw new Error("엑셀(.xlsx) 파일만 넣을 수 있어요");
    const id = newJobId();
    fs.mkdirSync(reviews.runDir(id), { recursive: true });
    const xlsx = path.join(reviews.runDir(id), name);
    fs.renameSync(f.path, xlsx);
    res.json(reviews.startRun({ id, brand: String(req.body.brand || ""), xlsx }));
  } catch (e) {
    err(res, e);
  } finally {
    if (f) fs.rmSync(f.path, { force: true });
  }
});

// ---------- 월간 매출 통계 ----------
app.get("/api/monthly/info", (req, res) => res.json({ dir: monthly.monthlyDir(), latest: monthly.latest() }));
app.get("/api/monthly/runs", (req, res) => res.json(monthly.listRuns(req.query.company)));
app.get("/api/monthly/runs/:id", (req, res) => {
  const r = monthly.loadRun(req.params.id);
  if (!r) return err(res, new Error("기록이 없어요"), 404);
  const live = monthly.isRunning(r.id);
  if (r.status === "running" && !live) return res.json({ ...r, status: "failed", running: false, stop: r.stop || "스튜디오가 꺼져서 중단됐어요. 다시 넣어 주세요" });
  res.json({ ...r, running: live });
});
app.get("/api/monthly/runs/:id/file/:i", (req, res) => {
  const f = monthly.loadRun(req.params.id)?.outputs?.[Number(req.params.i)];
  if (!f || !fs.existsSync(f)) return err(res, new Error("파일이 없어요"), 404);
  res.download(f, path.basename(f));
});
app.post("/api/monthly/runs", upload.array("files", 10), (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) throw new Error("이번 달 원본 파일을 넣어 주세요");
    const id = newJobId();
    const raw = path.join(monthly.runDir(id), "raw");
    fs.mkdirSync(raw, { recursive: true });
    const paths = files.map((f) => {
      const p = path.join(raw, realName(f));
      fs.renameSync(f.path, p);
      return p;
    });
    const net = String(req.body.cafe24_net || "").replace(/\D/g, "");
    res.json(monthly.startRun({ id, company: String(req.body.company || ""), files: paths, cafe24Net: net ? Number(net) : null, noCafe24: req.body.no_cafe24 === "1" }));
  } catch (e) {
    err(res, e);
  } finally {
    for (const f of files) fs.rmSync(f.path, { force: true });
  }
});

// ---------- 주간 매출 통계 ----------
// 원본 파일 이름에 기간이 들어 있어서(네이버 sales_YYYYMMDD-…) 이름을 그대로 살려 저장한다
app.get("/api/weekly/check", (req, res) => res.json({ ...weekly.checkSetup(), sheets: weekly.SHEETS }));
app.get("/api/weekly/runs", (req, res) => res.json(weekly.listRuns(req.query.company)));
app.get("/api/weekly/runs/:id", (req, res) => {
  const r = weekly.loadRun(req.params.id);
  if (!r) return err(res, new Error("기록이 없어요"), 404);
  const live = weekly.isBusy(r.company) && r.status === "running";
  // 스튜디오가 꺼졌다 켜져서 끊긴 실행은 '멈춤'으로
  if (r.status === "running" && !live) return res.json({ ...r, status: "failed", running: false, stop: r.stop || "스튜디오가 꺼져서 중단됐어요. 다시 넣어 주세요" });
  res.json({ ...r, running: live });
});
app.get("/api/weekly/runs/:id/file", (req, res) => {
  const r = weekly.loadRun(req.params.id);
  if (!r?.master || !fs.existsSync(r.master)) return err(res, new Error("통합파일이 없어요"), 404);
  res.download(r.master, path.basename(r.master));
});
app.post("/api/weekly/runs", upload.array("files", 10), (req, res) => {
  const files = req.files || [];
  try {
    if (!files.length) throw new Error("이번 주 원본 파일을 넣어 주세요");
    const id = newJobId();
    const raw = path.join(weekly.runDir(id), "raw");
    fs.mkdirSync(raw, { recursive: true });
    const paths = files.map((f) => {
      const p = path.join(raw, realName(f));
      fs.renameSync(f.path, p);
      return p;
    });
    res.json(weekly.startRun({ id, company: String(req.body.company || ""), files: paths, noCafe24: req.body.no_cafe24 === "1" }));
  } catch (e) {
    err(res, e);
  } finally {
    for (const f of files) fs.rmSync(f.path, { force: true });
  }
});

// 이미 만든 영상 올리기: 영상 1개(+상세페이지 이미지 선택) → 문구만 쓰고 배포
app.post("/api/jobs/copy", upload.fields([{ name: "video", maxCount: 1 }, { name: "detail", maxCount: 300 }]), (req, res) => {
  const video = req.files?.video?.[0];
  const details = req.files?.detail || [];
  try {
    const name = String(req.body.product_name || "").trim();
    if (!name) throw new Error("제품명을 입력해 주세요");
    if (!video) throw new Error("올릴 영상 파일을 넣어 주세요");
    const ext = (path.extname(video.originalname) || ".mp4").toLowerCase();
    if (![".mp4", ".mov", ".m4v", ".webm"].includes(ext)) throw new Error("mp4·mov 영상 파일만 올릴 수 있어요");
    const id = newJobId();
    const product_dir = path.join(jobDir(id), "product");
    fs.mkdirSync(path.join(product_dir, "숏츠_영상"), { recursive: true });
    const src = path.join(product_dir, "숏츠_영상", "원본영상" + ext);
    fs.renameSync(video.path, src);
    if (details.length) saveDetailImages(product_dir, details.map((f) => f.path));
    saveJob({ id, kind: "copy", product_name: name, product_dir, source_video: src, status: "queued", log: [], uploads: {}, naver: { clip: false, shopping: false } });
    startGeneration(id);
    res.json(view(loadJob(id)));
  } catch (e) {
    err(res, e);
  } finally {
    for (const f of [video, ...details].filter(Boolean)) fs.rmSync(f.path, { force: true });
  }
});

// 폴더째 올린 사진을 원래 폴더 구조대로 <작업>\product 에 저장 (zip 풀 때와 같은 규칙)
function savePhotoFolder(id, photos, paths, dest = path.join(jobDir(id), "product")) {
  photos.forEach((f, i) => {
    const rel = String(paths[i] || f.originalname).replace(/\\/g, "/");
    const target = path.normalize(path.join(dest, rel));
    if (!target.startsWith(dest + path.sep)) return; // 경로 탈출 방지
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.renameSync(f.path, target);
  });
  // 최상위 폴더가 하나뿐이면 그 안을 제품 폴더로 본다
  const entries = fs.readdirSync(dest).filter((e) => !e.startsWith("."));
  const one = entries.length === 1 && fs.statSync(path.join(dest, entries[0])).isDirectory();
  return { files: photos.length, product_dir: one ? path.join(dest, entries[0]) : dest };
}

app.post("/api/jobs", upload.fields([{ name: "zip", maxCount: 1 }, { name: "detail", maxCount: 300 }, { name: "photos", maxCount: 3000 }]), (req, res) => {
  const zipFile = req.files?.zip?.[0];
  const details = req.files?.detail || []; // 화면에서 정한 순서(파일 이름 순)대로 온다
  const photos = req.files?.photos || []; // 폴더째 올린 제품 사진
  try {
    const name = String(req.body.product_name || "").trim();
    if (!zipFile && !photos.length) throw new Error("제품 사진 폴더나 zip 파일을 넣어 주세요");
    if (!name) throw new Error("제품명을 입력해 주세요");
    const id = newJobId();
    fs.mkdirSync(jobDir(id), { recursive: true });
    let files, product_dir;
    if (zipFile) {
      const zip = path.join(jobDir(id), "upload.zip");
      fs.renameSync(zipFile.path, zip);
      ({ files, product_dir } = unzipInto(id, zip));
    } else ({ files, product_dir } = savePhotoFolder(id, photos, JSON.parse(req.body.photo_paths || "[]")));
    if (files < 3) throw new Error("zip 안에 파일이 거의 없어요");
    if (details.length) saveDetailImages(product_dir, details.map((f) => f.path));
    saveJob({ id, product_name: name, product_dir, status: "queued", log: [], uploads: {}, naver: { clip: false, shopping: false } });
    startGeneration(id);
    res.json(view(loadJob(id)));
  } catch (e) {
    err(res, e);
  } finally {
    for (const f of [...details, ...photos]) fs.rmSync(f.path, { force: true });
  }
});

// ---------- 블로그 작성 도우미 ----------
// 스튜디오가 꺼졌다 켜져서 멈춘 실행은 '멈춤'으로
const blogView = (r) => {
  if (!r) return null;
  const live = blog.isRunning(r.id);
  if (r.status === "running" && !live && !alive(r.server_pid)) return { ...r, status: "failed", error: "스튜디오가 꺼져서 중단됐어요. 다시 넣어 주세요" };
  return { ...r, running: live || (r.status === "running" && alive(r.server_pid)) };
};
app.get("/api/blog/runs", (req, res) => res.json(blog.listRuns().map(blogView)));
app.get("/api/blog/runs/:id", (req, res) => {
  const r = blogView(blog.loadRun(req.params.id));
  if (!r) return err(res, new Error("기록이 없어요"), 404);
  res.json(r);
});
app.get("/api/blog/runs/:id/zip", (req, res) => {
  const z = blog.loadRun(req.params.id)?.result?.zip;
  if (!z || !fs.existsSync(z)) return err(res, new Error("사진 zip이 없어요"), 404);
  const r = blog.loadRun(req.params.id);
  res.download(z, `블로그사진_${String(r.product_name || "제품").replace(/[\\/:*?"<>|]/g, "")}.zip`);
});
app.get("/api/blog/runs/:id/img/:name", (req, res) => {
  const p = blog.imagePath(req.params.id, req.params.name);
  if (!p) return err(res, new Error("사진이 없어요"), 404);
  res.sendFile(p);
});
app.delete("/api/blog/runs/:id", (req, res) => {
  blog.stopRun(req.params.id);
  fs.rmSync(blog.runDir(req.params.id), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  res.json({ ok: true });
});
app.post("/api/blog/runs", upload.fields([{ name: "zip", maxCount: 1 }, { name: "detail", maxCount: 300 }, { name: "photos", maxCount: 3000 }]), (req, res) => {
  const zipFile = req.files?.zip?.[0];
  const details = req.files?.detail || [];
  const photos = req.files?.photos || [];
  try {
    const name = String(req.body.product_name || "").trim();
    if (!name) throw new Error("제품명을 입력해 주세요");
    if (!zipFile && !photos.length) throw new Error("제품 사진 폴더나 zip 파일을 넣어 주세요");
    const id = newJobId();
    const dest = path.join(blog.runDir(id), "product");
    fs.mkdirSync(dest, { recursive: true });
    let product_dir;
    if (zipFile) {
      const zip = path.join(blog.runDir(id), "upload.zip");
      fs.renameSync(zipFile.path, zip);
      ({ product_dir } = unzipInto(id, zip, dest));
    } else ({ product_dir } = savePhotoFolder(id, photos, JSON.parse(req.body.photo_paths || "[]"), dest));
    if (details.length) saveDetailImages(product_dir, details.map((f) => f.path));
    res.json(blog.startRun({ id, brand: String(req.body.brand || ""), product_name: name, product_dir, topic: String(req.body.topic || "").trim().slice(0, 300) }));
  } catch (e) {
    err(res, e);
  } finally {
    for (const f of [...details, ...photos]) fs.rmSync(f.path, { force: true });
  }
});

app.post("/api/jobs/:id/regenerate", (req, res) => {
  try {
    startGeneration(req.params.id, { revision: String(req.body.revision || "").trim() || null });
    res.json(view(loadJob(req.params.id)));
  } catch (e) {
    err(res, e);
  }
});

app.put("/api/jobs/:id/meta", (req, res) => {
  const job = loadJob(req.params.id);
  if (!job) return err(res, new Error("작업이 없어요"), 404);
  const { title, description, naver } = req.body;
  if (title !== undefined) job.title = String(title);
  if (description !== undefined) job.description = String(description);
  if (naver) job.naver = { ...job.naver, ...naver };
  res.json(view(saveJob(job)));
});

app.delete("/api/jobs/:id", async (req, res) => {
  const job = loadJob(req.params.id);
  if (!job) return err(res, new Error("이미 지워진 영상이에요"), 404);
  try {
    await stopGeneration(job.id);
    // 방금 멈춘 프로그램이 파일을 잠깐 붙잡고 있을 수 있어서 몇 번 다시 시도
    fs.rmSync(jobDir(job.id), { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
    res.json({ ok: true });
  } catch (e) {
    err(res, new Error("지우지 못했어요: " + e.message));
  }
});

// 영상 파일 (해당 작업의 숏츠_영상 폴더 안만)
app.get("/media/:id/:file", (req, res) => {
  const job = loadJob(req.params.id);
  const dir = job && path.join(job.product_dir, "숏츠_영상");
  const f = dir && path.join(dir, path.basename(req.params.file));
  if (!f || !fs.existsSync(f)) return res.sendStatus(404);
  if (req.query.download) res.attachment(`${job.product_name}_숏츠.mp4`);
  res.sendFile(f);
});

app.post("/api/jobs/:id/open-folder", team.localOnly, (req, res) => {
  const job = loadJob(req.params.id);
  if (!job) return res.sendStatus(404);
  exec(`explorer "${path.join(job.product_dir, "숏츠_영상")}"`);
  res.json({ ok: true });
});

// ---------- 업로드 ----------
const UP = {
  youtube: (job, file) => youtube.upload({ file, title: job.title, description: job.description }),
  instagram: (job, file) => instagram.upload({ file, caption: `${job.title}\n${job.description}` }),
  tiktok: (job, file) => tiktok.upload({ file }),
};

app.post("/api/jobs/:id/upload", async (req, res) => {
  const job = loadJob(req.params.id);
  if (!job?.result?.video) return err(res, new Error("먼저 영상을 만들어 주세요"));
  if ([...job.title].length > 25 || [...job.description].length > 150) return err(res, new Error("제목 25자, 설명글 150자 이내로 맞춰 주세요"));
  const platforms = (req.body.platforms || []).filter((p) => UP[p]);
  if (!platforms.length) return err(res, new Error("올릴 곳을 하나 이상 골라 주세요"));
  for (const p of platforms) job.uploads[p] = { state: "uploading", at: new Date().toISOString() };
  saveJob(job);
  res.json(view(job));
  for (const p of platforms) {
    const j = loadJob(job.id);
    try {
      const r = await UP[p](j, j.result.video);
      j.uploads[p] = { state: "done", at: new Date().toISOString(), ...r };
    } catch (e) {
      j.uploads[p] = { state: "error", at: new Date().toISOString(), error: e.message };
    }
    saveJob(j);
  }
});

// ---------- 연결 (버튼 한 번) ----------
app.post("/api/claude/code", team.localOnly, async (req, res) => {
  try {
    const r = await submitClaudeCode(req.body?.code);
    claudeCache = { at: 0, v: null };
    res.json(r);
  } catch (e) {
    err(res, e);
  }
});
app.post("/api/claude/switch", team.localOnly, (req, res) => {
  try {
    if (isRunningAny()) throw new Error("영상을 만드는 중에는 계정을 바꿀 수 없어요. 끝난 뒤에 다시 눌러 주세요");
    const r = switchClaudeAccount();
    claudeCache = { at: 0, v: null };
    res.json(r);
  } catch (e) {
    err(res, e);
  }
});

app.post("/api/connect/claude", team.localOnly, (req, res) => {
  try {
    res.json(startClaudeLogin());
  } catch (e) {
    err(res, e);
  }
});

const callbackPage = (fn, label) => async (req, res) => {
  try {
    if (!states.delete(req.query.state)) throw new Error("잘못된 요청이에요. 스튜디오에서 다시 눌러 주세요");
    if (req.query.error) throw new Error(req.query.error_description || req.query.error);
    const account = await fn(req);
    res.send(page(`${label} 연결 완료`, `${account ? account + " · " : ""}이 창은 곧 닫혀요. 스튜디오로 돌아가세요.`));
  } catch (e) {
    // 연결 실패 이유를 남겨 둔다 (%USERPROFILE%\plaire-shorts\auth-errors.log)
    fs.appendFileSync(path.join(DATA_DIR, "auth-errors.log"), `${new Date().toISOString()} ${label}: ${e.message}
`);
    console.error(`${label} 연결 실패:`, e.message);
    res.status(400).send(page(`${label} 연결 실패`, e.message));
  }
};
const startAuth = (fn) => (req, res) => {
  try {
    res.redirect(fn(newState()));
  } catch (e) {
    res.status(400).send(page("연결할 수 없어요", e.message));
  }
};

app.get("/auth/youtube", team.localOnly, startAuth((s) => youtube.authUrl(PORT, s)));
app.get("/auth/youtube/callback", callbackPage((req) => youtube.handleCallback(PORT, req.query.code), "유튜브"));
app.get("/auth/instagram", team.localOnly, startAuth((s) => instagram.authUrl(PORT, s)));
app.get("/auth/instagram/callback", callbackPage((req) => instagram.handleCallback(PORT, req.query.code), "인스타그램"));
// 관리자: Meta 대시보드에서 만든 인스타 액세스 토큰을 직접 붙여넣어 연결
app.post("/api/connect/instagram", team.localOnly, async (req, res) => {
  try {
    res.json({ account: await instagram.connectWithToken(String(req.body.token || "").trim()) });
  } catch (e) {
    err(res, e);
  }
});
app.get("/auth/tiktok", team.localOnly, startAuth((s) => tiktok.authUrl(s)));
app.get("/auth/tiktok/callback", callbackPage((req) => tiktok.handleCallback(req.query.state, req.query.code), "틱톡"));
// 틱톡을 https 리디렉트로 쓰는 경우: 이동된 주소창 URL 붙여넣기
app.post("/api/connect/tiktok", team.localOnly, async (req, res) => {
  try {
    res.json({ account: await tiktok.connectFromPasted(String(req.body.pasted || "")) });
  } catch (e) {
    err(res, e);
  }
});

app.post("/api/disconnect/:platform", team.localOnly, (req, res) => {
  if (!["youtube", "instagram", "tiktok"].includes(req.params.platform)) return res.sendStatus(404);
  setToken(req.params.platform, null);
  res.json({ ok: true });
});

// ---------- 관리자 설정 (개발자 앱 값) ----------
const mask = (s) => (s ? s.slice(0, 4) + "…" + s.slice(-3) : "");
app.get("/api/admin", (req, res) => {
  const c = loadConfig();
  res.json({
    data_dir: DATA_DIR,
    port: PORT,
    claude_path: c.claude_path,
    claude_found: findClaude(),
    youtube: { client_id: c.youtube.client_id, client_secret: mask(c.youtube.client_secret) },
    instagram: { app_id: c.instagram.app_id, app_secret: mask(c.instagram.app_secret), redirect: instagram.redirectUri(PORT) },
    cloudflared_found: findCloudflared(),
    tiktok: { client_key: c.tiktok.client_key, client_secret: mask(c.tiktok.client_secret), redirect_uri: c.tiktok.redirect_uri, redirect: tiktok.redirectUri() },
  });
});
// 비어 있거나 가려진(…) 값은 기존 값 유지
app.put("/api/admin", team.localOnly, (req, res) => {
  const c = loadConfig();
  const merge = (dst, src) => {
    for (const [k, v] of Object.entries(src || {})) if (typeof v === "string" && !v.includes("…")) dst[k] = v.trim();
  };
  if (typeof req.body.claude_path === "string") c.claude_path = req.body.claude_path.trim();
  merge(c.youtube, req.body.youtube);
  merge(c.instagram, req.body.instagram);
  merge(c.tiktok, req.body.tiktok);
  saveConfig(c);
  res.json({ ok: true });
});

// ---------- 팀 공유 (서버 PC) ----------
app.get("/api/server", (req, res) =>
  res.json({ server_mode: team.serverMode(), has_password: team.hasPassword(), local: team.isLocal(req), addresses: team.addresses(PORT), name: team.NAME }),
);
app.put("/api/server", team.localOnly, (req, res) => {
  try {
    if (req.body.password) team.setPassword(req.body.password);
    if (typeof req.body.server_mode === "boolean") {
      if (req.body.server_mode && !team.hasPassword()) throw new Error("먼저 팀 비밀번호를 정해 주세요");
      updateLocalConfig({ server_mode: req.body.server_mode });
    }
    res.json({ ok: true, restart: typeof req.body.server_mode === "boolean" });
    // 접속 범위가 바뀌면 다시 켠다 (지킴이가 바로 다시 켬)
    if (typeof req.body.server_mode === "boolean") setTimeout(() => process.exit(75), 500);
  } catch (e) {
    err(res, e);
  }
});
app.get("/api/backups", async (req, res) => {
  try {
    res.json({ ...backup.backupStatus(), items: (await backup.listBackups()).items });
  } catch (e) {
    res.json({ ...backup.backupStatus(), items: [], error: e.message });
  }
});
app.post("/api/backups", async (req, res) => {
  try {
    res.json(await backup.makeBackup("수동"));
  } catch (e) {
    err(res, e);
  }
});
app.post("/api/backups/restore", team.localOnly, async (req, res) => {
  try {
    if (busyNow()) throw new Error("지금 진행 중인 작업이 있어요. 끝난 뒤에 되살려 주세요");
    const r = await backup.restoreBackup(req.body.name);
    res.json(r);
    setTimeout(() => process.exit(75), 500); // 되살린 설정으로 다시 켜기
  } catch (e) {
    err(res, e);
  }
});
// 지금 진행 중인 작업 (모든 사람이 볼 수 있게)
app.get("/api/activity", (req, res) => {
  const items = [];
  for (const j of listJobs()) {
    if (j.status === "generating" || j.status === "queued") items.push({ kind: "숏츠", label: j.product_name, what: j.kind === "copy" ? "문구 쓰는 중" : "만드는 중" });
    if (Object.values(j.uploads || {}).some((u) => u.state === "uploading")) items.push({ kind: "업로드", label: j.product_name, what: "올리는 중" });
  }
  for (const r of weekly.listRuns()) if (r.running) items.push({ kind: "주간 매출", label: r.company, what: "집계 중" });
  for (const r of monthly.listRuns()) if (r.running) items.push({ kind: "월간 매출", label: r.company, what: "집계 중" });
  for (const r of reviews.listRuns()) if (r.running) items.push({ kind: "리뷰 답글", label: r.brand, what: "쓰는 중" });
  for (const r of blog.listRuns()) if (r.running) items.push({ kind: "블로그", label: r.product_name, what: "쓰는 중" });
  res.json({ items });
});

// ---------- 안정성 ----------
const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")).version;
  } catch {
    return "?";
  }
})();
const stamp = () => new Date().toLocaleString("ko-KR", { hour12: false });
// 한 요청에서 난 오류 때문에 서버 전체가 꺼지지 않게 기록만 하고 계속 돈다
process.on("uncaughtException", (e) => console.error(`${stamp()} [오류]`, e?.stack || e));
process.on("unhandledRejection", (e) => console.error(`${stamp()} [오류]`, e?.stack || e));

// 지금 하고 있는 일이 있는지 (영상 생성·업로드·주간/월간 집계·리뷰 답글)
const busyNow = () =>
  isRunningAny() ||
  weekly.anyRunning() ||
  monthly.isBusy() ||
  reviews.anyRunning() ||
  blog.anyRunning() ||
  listJobs().some((j) => Object.values(j.uploads || {}).some((u) => u.state === "uploading"));
app.get("/api/health", (req, res) => res.json({ ok: true, version: VERSION, busy: busyNow(), pid: process.pid }));

// 지킴이(watchdog.ps1)로 켜진 경우: 새 버전이 설치되면 하던 일이 끝난 뒤 스스로 꺼진다(코드 75) → 지킴이가 새 버전으로 다시 켠다
const installedRoot = () => {
  try {
    const ip = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "plugins", "installed_plugins.json"), "utf8"));
    return ip.plugins?.["plaire-shorts-studio@plaire-tools"]?.[0]?.installPath || null;
  } catch {
    return null;
  }
};
let waitingLogged = false;
let preparing = false;
async function checkUpdate() {
  const root = installedRoot();
  if (!root || preparing || path.resolve(root) === path.resolve(PLUGIN_ROOT) || !fs.existsSync(path.join(root, "studio", "server.js"))) return;
  if (busyNow()) {
    if (!waitingLogged) console.log(`${stamp()} 새 버전이 설치됐어요. 하던 일이 끝나면 갈아탈게요`);
    waitingLogged = true;
    return;
  }
  // 새 버전 구성요소를 미리 깔아 두고 갈아탄다(멈춰 있는 시간을 줄이려고)
  preparing = true;
  for (const d of ["studio", "engine"]) {
    if (fs.existsSync(path.join(root, d, "node_modules"))) continue;
    console.log(`${stamp()} 새 버전 ${d} 구성요소 설치 중`);
    await new Promise((ok) => exec(`npm install --prefix "${path.join(root, d)}" --no-audit --no-fund`, { windowsHide: true }, () => ok()));
  }
  preparing = false;
  if (busyNow()) return;
  console.log(`${stamp()} 새 버전으로 갈아타요 (${VERSION} → ${root})`);
  process.exit(75);
}
if (process.env.PLAIRE_WATCHDOG) setInterval(() => checkUpdate().catch((e) => console.error(stamp(), e)), 60 * 1000);

// GitHub에서 새 버전 받아오기: 켜지고 1분 뒤 + 30분마다 (받아만 두면 위 checkUpdate가 하던 일이 끝난 뒤 갈아탄다)
let fetching = false;
const run = (exe, args) =>
  new Promise((ok) => execFile(exe, args, { windowsHide: true, timeout: 5 * 60 * 1000 }, (e, out, err) => ok({ code: e ? e.code ?? 1 : 0, text: `${out || ""}${err || ""}`.trim() })));
async function fetchUpdate() {
  if (fetching) return { busy: true };
  const exe = findClaude();
  if (!exe) return { error: "Claude Code를 찾지 못했어요" };
  fetching = true;
  try {
    const m = await run(exe, ["plugin", "marketplace", "update", "plaire-tools"]);
    const p = await run(exe, ["plugin", "update", "plaire-shorts-studio@plaire-tools"]);
    const got = /updated from\s+(\S+)\s+to\s+(\S+)/.exec(p.text);
    if (got) console.log(`${stamp()} GitHub에서 새 버전을 받았어요: ${got[1]} → ${got[2]}`);
    else if (m.code || p.code) console.error(`${stamp()} 새 버전 확인 실패: ${(m.code ? m.text : p.text).split(/\r?\n/).pop()}`);
    return { ok: true, updated: got ? got[2] : null, current: VERSION };
  } finally {
    fetching = false;
  }
}
// 화면이나 다른 곳에서 "지금 확인"할 때
app.post("/api/update/check", async (req, res) => res.json(await fetchUpdate()));
if (process.env.PLAIRE_WATCHDOG) backup.scheduleBackups(busyNow);
if (process.env.PLAIRE_WATCHDOG) {
  setTimeout(() => fetchUpdate().catch((e) => console.error(stamp(), e)), 60 * 1000);
  setInterval(() => fetchUpdate().catch((e) => console.error(stamp(), e)), 30 * 60 * 1000);
}

// localhost가 ::1로 풀리는 PC도 있어서 두 주소 모두에서 받는다
const onListen = () => {
  const url = `http://localhost:${PORT}`;
  console.log(`${stamp()} 플레르 MS팀 업무 도구 ${VERSION}: ${url}  (데이터: ${DATA_DIR})`);
  if (process.argv.includes("--open")) exec(process.platform === "win32" ? `start "" "${url}"` : `open "${url}"`);
};
const HOST = team.serverMode() ? "0.0.0.0" : "127.0.0.1";
if (team.serverMode()) app.listen(80, "0.0.0.0").on("error", (e) => console.error(`${stamp()} 80번 포트를 쓰지 못해서 주소 뒤에 :${PORT}를 붙여야 해요 (${e.code})`));
app.listen(PORT, HOST, onListen).on("error", (e) => {
  // 이미 다른 창에서 켜져 있으면 조용히 끝낸다 (지킴이가 잠시 뒤 다시 확인)
  console.error(`${stamp()} 서버를 켜지 못했어요: ${e.code === "EADDRINUSE" ? `${PORT}번이 이미 쓰이는 중` : e.message}`);
  process.exit(98);
});
// 인스타 토큰(60일) 자동 연장: 켜질 때 + 12시간마다
const keepInstagram = () => instagram.refreshIfNeeded().catch((e) => fs.appendFileSync(path.join(DATA_DIR, "auth-errors.log"), `${new Date().toISOString()} 인스타그램 토큰 연장 실패: ${e.message}
`));
keepInstagram();
setInterval(keepInstagram, 12 * 3600 * 1000);
app.listen(PORT, "::1").on("error", () => {});
