const $ = (id) => document.getElementById(id);
const api = async (url, opts = {}) => {
  const r = await fetch(url, { cache: "no-store", headers: opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}, ...opts });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.login) location.href = "/login"; // 팀 비밀번호 로그인이 풀림
  if (!r.ok) throw new Error(d.error || `오류 (${r.status})`);
  return d;
};
const len = (s) => [...(s || "")].length;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// 플랫폼 로고 (로고가 없으면 글자 배지)
const LOGO = { claude: "img/claude.png", youtube: "img/youtube.png", instagram: "img/instagram.png", tiktok: "img/tiktok.png" };
const badge = (id, mark, cls = "badge") => (LOGO[id] ? `<img class="${cls} logo" src="${LOGO[id]}" alt="">` : `<span class="${cls} b-${id}">${mark}</span>`);
const PLATFORMS = [
  { id: "youtube", name: "유튜브 쇼츠", mark: "Y" },
  { id: "instagram", name: "인스타그램 릴스", mark: "I" },
  { id: "tiktok", name: "틱톡", sub: "틱톡 앱에서 마무리", mark: "T" },
];

let current = null; // 보고 있는 작업
let status = null; // 연결 상태
let poll = null;

// ---------- 준비 상태 (위쪽 4칸) ----------
const READY = [
  { id: "youtube", name: "유튜브", desc: "쇼츠 올리기", mark: "Y" },
  { id: "instagram", name: "인스타그램", desc: "릴스 올리기", mark: "I" },
  { id: "tiktok", name: "틱톡", desc: "틱톡 올리기", mark: "T" },
];
async function loadStatus(fresh) {
  status = await api("/api/status" + (fresh ? "?fresh=1" : ""));
  // 작은 로고 칩: 초록 점 = 연결됨, 주황 = 곧 만료, 회색 = 연결 필요 (누르면 연결)
  $("ready").innerHTML = READY.map((p) => {
    const s = status[p.id] || {};
    const soon = s.connected && s.days_left != null && s.days_left < 14;
    const state = soon ? "soon" : s.connected ? "on" : "off";
    const tip = `${p.name} · ${s.connected ? (s.account || "") + (soon ? ` · ${s.days_left}일 남음 (눌러서 다시 연결)` : " · 연결됨") : s.expired ? "만료됨 · 눌러서 다시 연결" : "연결 안 됨 · 눌러서 연결"}`;
    const tag = state === "on" ? "div" : "button";
    return `<${tag} class="chip ${state}" title="${esc(tip)}"${state === "on" ? "" : ` data-connect="${p.id}"`}>${badge(p.id, p.mark, "chip-logo")}<i class="dot"></i></${tag}>`;
  }).join("");
  const n = READY.filter((p) => status[p.id]?.connected).length;
  $("readySum").textContent = n === READY.length ? "모두 연결됨" : `${READY.length - n}곳 연결 필요`;
  $("readySum").classList.toggle("warn", n !== READY.length);
  document.body.classList.toggle("remote", status.local === false); // 서버 PC가 아닌 곳에서 열면 서버 PC 전용 버튼 숨김
  renderAccount();
  const hint = $("readyHint");
  if (!status.claude.connected && hint.querySelector("#loginCode") && status.claude.login_url) {
    hint.classList.remove("hidden");
  } else if (!status.claude.connected) {
    hint.innerHTML = status.claude.login_url
      ? `브라우저에서 Claude 로그인을 마쳐 주세요. 창이 안 열렸으면 <a href="${esc(status.claude.login_url)}" target="_blank">여기를 눌러 로그인</a><br>로그인 후 화면에 코드가 나오면 복사해서 아래에 붙여넣어 주세요.<span class="code-row"><input class="field" id="loginCode" placeholder="코드 붙여넣기" autocomplete="off"><button class="mini dark" id="loginCodeBtn">확인</button></span>`
      : "처음 한 번만: 위의 <b>로그인</b>을 눌러 회사 Claude 계정으로 로그인해 주세요. 그래야 업무 도구를 쓸 수 있어요.";
    hint.classList.remove("hidden");
  } else hint.classList.add("hidden");
  if (current) renderPlatforms();
}
// 사이드바 맨 위 Claude 계정 카드
function renderAccount() {
  const c = status.claude || {};
  const pending = !!c.login_url || accountBusy;
  const right = status.local === false
    ? `<span class="tag" title="Claude 계정은 서버 PC에서 바꿀 수 있어요">서버 PC</span>`
    : pending
    ? `<span class="tag amber">로그인 대기</span>`
    : c.connected
      ? `<button class="mini" id="switchBtn">계정 바꾸기</button>`
      : `<button class="mini dark" id="loginBtn">로그인</button>`;
  $("account").innerHTML = `${badge("claude", "C", "acc-logo")}<span class="acc-name">Claude <i class="dot ${c.connected ? "on" : ""}"></i><small>${c.connected && c.account ? esc(c.account) : c.found === false ? "Claude 앱을 찾지 못했어요" : "로그인이 필요해요"}</small></span>${right}`;
}
let accountBusy = false;
$("account").onclick = async (e) => {
  const b = e.target.closest("#switchBtn, #loginBtn");
  if (!b) return;
  if (b.id === "switchBtn" && !confirm(`지금 계정(${status.claude.account || "Claude"})을 로그아웃하고 다른 계정으로 로그인할까요?
브라우저 로그인 창에서 바꿀 계정으로 로그인해 주세요.`)) return;
  accountBusy = true;
  renderAccount();
  try {
    await api(b.id === "switchBtn" ? "/api/claude/switch" : "/api/connect/claude", { method: "POST" });
  } catch (er) {
    alert(er.message);
  }
  accountBusy = false;
  waitFor("claude");
};
$("readyHint").onclick = async (e) => {
  if (e.target.id !== "loginCodeBtn") return;
  const b = e.target;
  b.disabled = true;
  b.textContent = "확인 중";
  try {
    await api("/api/claude/code", { method: "POST", body: JSON.stringify({ code: $("loginCode").value }) });
  } catch (er) {
    alert(er.message);
  }
  loadStatus(true);
};
$("ready").onclick = async (e) => {
  const b = e.target.closest("[data-connect]");
  if (!b) return;
  if (status.local === false) return alert("채널 연결은 서버 PC(plairemstool)에서 해 주세요");
  const id = b.dataset.connect;
  if (id === "instagram") {
    await openSettings();
    document.querySelector(".admin").open = true;
    $("igToken").focus();
    $("adminMsg").textContent = "Meta 앱 → Instagram → 'Instagram 로그인이 포함된 API 설정' → 1. 액세스 토큰 생성에서 받은 토큰을 붙여넣고 '토큰으로 연결'을 누르세요";
  } else if (id === "tiktok" && status.tiktok.paste) {
    window.open("/auth/tiktok", "_blank");
    const url = prompt("틱톡에서 허용한 뒤 이동된 페이지의 주소창 URL을 복사해 붙여넣어 주세요");
    if (url) await api("/api/connect/tiktok", { method: "POST", body: JSON.stringify({ pasted: url }) }).catch((er) => alert(er.message));
    loadStatus();
  } else {
    window.open(`/auth/${id}`, "_blank");
    waitFor(id);
  }
};
// 연결될 때까지 상태를 몇 초마다 다시 확인
function waitFor(id) {
  let n = 0;
  const t = setInterval(async () => {
    await loadStatus(true);
    if (status[id]?.connected || ++n > 60) clearInterval(t);
  }, 4000);
  setTimeout(() => loadStatus(true), 1500);
}
window.addEventListener("focus", () => loadStatus(true));

// ---------- 화면 전환 ----------
const uploadMode = () => route.current === "upload"; // 제작된 숏츠 업로드 화면
function show(ids) {
  if (["shorts", "upload"].includes(route.current)) $("crumb").textContent = ids.includes("settings") ? "숏츠 설정" : ids.includes("stepInput") ? (uploadMode() ? "새 업로드" : "새 영상") : current?.product_name || "영상";
  $("settingsBtn").classList.toggle("on", ids.includes("settings"));
  for (const s of ["stepInput", "stepProgress", "stepResult", "stepUpload", "settings"]) $(s).classList.toggle("hidden", !ids.includes(s));
  if (!ids.includes("stepInput")) $("activeJobs").classList.add("hidden");
  setTimeout(pauseHidden);
  // 입력 단계: 제작 화면은 사진 입력, 업로드 화면은 영상 입력
  $("stepCopyInput").classList.toggle("hidden", !(ids.includes("stepInput") && uploadMode()));
  if (uploadMode()) $("stepInput").classList.add("hidden");
}


function newJob() {
  current = null;
  clearInterval(poll);
  $("productName").value = "";
  setProduct(null);
  resetCopyInput();
  setDetails([]);
  $("inputErr").textContent = "";
  show(["stepInput"]);
  loadActive();
}

// 최근 기록: 이 화면(제작/업로드)에서 만든 영상 최근 8개 — 만드는 중·올리기 전·올림·실패
async function loadActive() {
  const mode = uploadMode();
  const jobs = await api("/api/jobs").catch(() => []);
  if (mode !== uploadMode()) return; // 기다리는 사이 다른 화면으로 넘어감
  const mine = (j) => (j.kind === "copy") === uploadMode();
  const list = jobs
    .filter(mine)
    .sort((x, y) => String(y.updated_at || "").localeCompare(String(x.updated_at || "")))
    .slice(0, 8);
  const busy = list.filter((j) => ["generating", "queued"].includes(j.status)).length;
  $("activeJobs").innerHTML =
    `<div class="active-head">최근 기록${busy ? ` <span class="count-badge">${busy}</span>` : ""}</div>` +
    (list.length
      ? list.map((j) => {
        const [t, c] = j.status === "ready" ? (j.uploaded ? [`올림 · ${j.uploaded}곳`, "green"] : ["완성 · 올리기 전", "amber"]) : j.status === "failed" ? ["실패 · 열어서 다시 만들기", "red"] : [j.kind === "copy" ? "문구 쓰는 중" : "만드는 중", "amber"];
        return `<div class="active-row ${c}" data-open="${j.id}" role="button" tabindex="0"><span class="name">${esc(j.product_name)}</span><span class="tag ${c}">${t}</span><span class="go">열기</span><button class="del" data-del="${j.id}" data-name="${esc(j.product_name)}" data-making="${j.status !== "ready" && j.status !== "failed" ? 1 : ""}">삭제</button></div>`;
      }).join("")
      : `<p class="active-empty">${uploadMode() ? "아직 올린 영상이 없어요" : "아직 만든 영상이 없어요"}</p>`);
  const inputShown = !$("stepInput").classList.contains("hidden") || !$("stepCopyInput").classList.contains("hidden");
  $("activeJobs").classList.toggle("hidden", current !== null || !inputShown);
}
$("activeJobs").onclick = async (e) => {
  const d = e.target.closest("[data-del]");
  if (d) {
    const msg = d.dataset.making ? `'${d.dataset.name}'은 아직 만드는 중이에요.\n만들기를 멈추고 지울까요?` : `'${d.dataset.name}' 영상을 지울까요?\n이 PC에 저장된 영상 파일도 함께 지워져요. (이미 채널에 올린 게시물은 그대로예요)`;
    if (!confirm(msg)) return;
    d.disabled = true;
    d.textContent = "지우는 중";
    try {
      await api(`/api/jobs/${d.dataset.del}`, { method: "DELETE" });
    } catch (er) {
      alert(er.message);
    }
    return loadActive();
  }
  const b = e.target.closest("[data-open]");
  if (b) openJob(b.dataset.open);
};
setInterval(() => !current && ["shorts", "upload"].includes(route.current) && loadActive(), 10000);

async function openJob(id) {
  current = await api(`/api/jobs/${id}`);
  render();
  clearInterval(poll);
  poll = setInterval(async () => {
    if (!current) return;
    const busy = current.running || current.status === "generating" || Object.values(current.uploads || {}).some((u) => u.state === "uploading");
    if (!busy) return;
    current = await api(`/api/jobs/${current.id}`);
    render(true);
  }, 2500);
}

function render(fromPoll) {
  const j = current;
  if (!j) return;
  const copy = j.kind === "copy";
  $("progressTitle").textContent = copy ? "제목·설명글을 쓰고 있어요" : "영상을 만들고 있어요";
  $("progressDesc").textContent = copy ? "보통 1~2분 걸려요. 이 창을 닫아도 계속 써요." : "보통 3~5분 걸려요. 이 창을 닫아도 계속 만들어요.";
  $("redoSummary").textContent = copy ? "문구 다시 쓰기" : "다시 만들기";
  $("regenBtn").textContent = copy ? "다시 쓰기" : "다시 만들기";
  $("revision").placeholder = copy ? "바꿀 점 (예: 제목을 더 짧고 세게)" : "바꿀 점 (예: 첫 자막을 더 짧게)";
  if (j.status === "generating" || j.running) {
    show(["stepProgress"]);
    const sec = Math.round((Date.now() - new Date(j.started_at)) / 1000);
    $("elapsed").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    $("log").innerHTML = (j.log || []).slice(-40).map((l) => `<li>${esc(l.m)}</li>`).join("");
    return;
  }
  if (!j.result) {
    show(["stepResult"]);
    $("video").removeAttribute("src");
    $("resultName").textContent = j.product_name;
    $("resultErr").textContent = (j.error || "실패했어요") + " — 아래 '다시 만들기'를 눌러 보세요";
    return;
  }
  show(["stepResult", "stepUpload"]);
  $("resultName").textContent = j.product_name;
  $("resultErr").textContent = j.status === "failed" ? j.error : "";
  if (!fromPoll || $("video").dataset.src !== j.video_url) {
    $("video").src = j.video_url;
    $("video").dataset.src = j.video_url;
    $("title").value = j.title || "";
    $("desc").value = j.description || "";
  }
  // 다른 제목 후보: 누르면 제목이 바뀜
  const opts = [...new Set([j.result?.title, ...(j.result?.title_options || [])].filter(Boolean))];
  $("titleOpts").innerHTML = opts.length > 1 ? `<small>다른 제목 후보</small>` + opts.map((t) => `<button class="opt" data-title="${esc(t)}">${esc(t)}</button>`).join("") : "";
  $("titleOpts").classList.toggle("hidden", opts.length < 2);
  markTitleOpt();
  const dl = j.video_url ? j.video_url + "&download=1" : "#";
  $("downloadBtn").href = dl;
  counts();
  renderPlatforms();
}

function counts() {
  const t = len($("title").value), d = len($("desc").value);
  $("titleCount").textContent = `${t}/25자`;
  $("descCount").textContent = `${d}/150자`;
  $("titleCount").classList.toggle("over", t > 25);
  $("descCount").classList.toggle("over", d > 150);
}
let saveTimer;
const autosave = () => {
  counts();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveMeta, 800);
};
$("title").oninput = () => (autosave(), markTitleOpt());
function markTitleOpt() {
  for (const b of $("titleOpts").querySelectorAll(".opt")) b.classList.toggle("on", b.dataset.title === $("title").value);
}
$("titleOpts").onclick = (e) => {
  const b = e.target.closest(".opt");
  if (!b) return;
  $("title").value = b.dataset.title;
  autosave();
  markTitleOpt();
};
$("desc").oninput = autosave;

function renderPlatforms() {
  const up = current?.uploads || {};
  $("platforms").innerHTML = PLATFORMS.map((p) => {
    const st = status?.[p.id] || {};
    const u = up[p.id];
    let line = st.connected ? `<span class="muted">${esc(st.account || "연결됨")}</span>` : `<span class="bad">왼쪽 연결에서 먼저 연결하기</span>`;
    if (u?.state === "uploading") line = "올리는 중…";
    if (u?.state === "done") line = `<span class="ok">올라갔어요</span> ${u.url ? `<a href="${esc(u.url)}" target="_blank">보러 가기</a>` : ""}<br><span class="muted">${esc(u.note || "")}</span>`;
    if (u?.state === "error") line = `<span class="bad">실패: ${esc(u.error)}</span>`;
    const checked = st.connected && u?.state !== "done" ? "checked" : "";
    return `<label class="pf ${st.connected ? "" : "off"}"><span class="pfh"><input type="checkbox" data-pf="${p.id}" ${checked} ${st.connected ? "" : "disabled"}>${badge(p.id, p.mark, "pf-logo")}${p.name}${p.sub ? ` <span class="muted">${p.sub}</span>` : ""}</span><span class="st">${line}</span></label>`;
  }).join("");
}

// ---------- 1. 자료 넣기 ----------
// 끌어다 놓은 항목(파일·폴더 섞여도 됨)을 폴더 안까지 펼쳐 [{file, path}]로 만든다
async function droppedFiles(dt) {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter(Boolean); // await 전에 먼저 꺼내야 함
  if (!entries.length) return [...dt.files].map((file) => ({ file, path: file.name }));
  const out = [];
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((ok, no) => entry.file(ok, no));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((ok, no) => reader.readEntries(ok, no)); // 한 번에 최대 100개라 빌 때까지 반복
        if (!batch.length) break;
        for (const e of batch) await walk(e, prefix + entry.name + "/");
      }
    }
  };
  for (const e of entries) await walk(e, "");
  return out;
}
const pickedFiles = (input) => [...input.files].map((file) => ({ file, path: file.webkitRelativePath || file.name }));
const isImg = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name);
const byName = (x, y) => x.path.localeCompare(y.path, undefined, { numeric: true });
const topFolder = (items) => (items[0]?.path.includes("/") ? items[0].path.split("/")[0] : "");
function dropZone(el, onDrop) {
  el.ondragover = (e) => (e.preventDefault(), el.classList.add("over"));
  el.ondragleave = () => el.classList.remove("over");
  el.ondrop = async (e) => {
    e.preventDefault();
    el.classList.remove("over");
    $("inputErr").textContent = "";
    onDrop(await droppedFiles(e.dataTransfer));
  };
}
// 영역을 누르면 기본 고르기 창, 아래 글자 버튼으로 다른 방식 선택
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-pick]");
  if (p) return $(p.dataset.pick).click();
  if (e.target.closest("#detailDrop")) $("detail").click();
  else if (e.target.closest("#drop")) $("photoDir").click();
});

// 넣은 이미지 미리보기 + 비우기 (zip이면 파일 이름만)
function showThumbs(box, items, onClear, zip) {
  for (const u of box.querySelectorAll("img")) URL.revokeObjectURL(u.src);
  const imgs = items.filter((i) => isImg(i.file));
  const any = !!zip || imgs.length > 0;
  box.innerHTML =
    (zip ? `<span class="zip-chip">${esc(zip.name)}</span>` : imgs.map((i) => `<img src="${URL.createObjectURL(i.file)}" alt="" title="${esc(i.path)}" loading="lazy" decoding="async">`).join("")) +
    (any ? `<button type="button" class="mini">비우기</button>` : "");
  box.classList.toggle("hidden", !any);
  box.onclick = (e) => e.target.closest("button") && onClear();
}

// 상세페이지 이미지 (여러 장, 파일 이름 순)
let details = [];
const detailDrop = $("detailDrop");
function setDetails(items) {
  details = items.filter((i) => isImg(i.file)).sort(byName);
  showThumbs($("detailThumbs"), details, () => setDetails([]));
  $("detailText").textContent = details.length ? `${details.length}장 선택됨 · 더 넣으려면 다시 놓으세요` : "상세페이지 이미지나 폴더를 여기에 놓으세요";
  detailDrop.classList.toggle("picked", !!details.length);
  $("detail").value = "";
  $("detailDir").value = "";
}
dropZone(detailDrop, (items) => {
  if (!items.some((i) => isImg(i.file))) return ($("inputErr").textContent = "상세페이지는 이미지 파일(jpg·png)이나 이미지가 든 폴더만 넣을 수 있어요");
  setDetails([...details, ...items]);
});
$("detail").onchange = () => setDetails([...details, ...pickedFiles($("detail"))]);
$("detailDir").onchange = () => setDetails([...details, ...pickedFiles($("detailDir"))]);

// 제품 이미지: 사진 폴더 그대로 또는 zip 하나
let product = null; // { zip: File } 또는 { files: [{file, path}], name }
const drop = $("drop");
function setProduct(p) {
  product = p;
  const mb = (n) => `${(n / 1e6).toFixed(0)}MB`;
  if (!p) $("dropText").textContent = "제품 사진 폴더를 여기에 놓으세요";
  else if (p.zip) $("dropText").textContent = `${p.zip.name} (${mb(p.zip.size)})`;
  else $("dropText").textContent = `${p.name ? p.name + " 폴더 · " : ""}사진 ${p.files.filter((i) => isImg(i.file)).length}장 (${mb(p.files.reduce((s, i) => s + i.file.size, 0))})`;
  drop.classList.toggle("picked", !!p);
  showThumbs($("photoThumbs"), p?.files ? [...p.files].sort(byName) : [], () => setProduct(null), p?.zip);
  if (p && !$("productName").value) $("productName").value = p.zip ? p.zip.name.replace(/\.zip$/i, "") : p.name || "";
  $("zip").value = "";
  $("photoDir").value = "";
}
function productFrom(items) {
  const zip = items.find((i) => /\.zip$/i.test(i.file.name));
  if (zip && items.length === 1) return setProduct({ zip: zip.file });
  const files = items.filter((i) => !/(^|\/)(\.|Thumbs\.db$|desktop\.ini$)/i.test(i.path)); // 숨김·시스템 파일 제외
  if (!files.some((i) => isImg(i.file))) return ($("inputErr").textContent = "제품 사진이 든 폴더나 zip 파일을 넣어 주세요");
  setProduct({ files, name: topFolder(files) });
}
dropZone(drop, productFrom);
$("photoDir").onchange = () => productFrom(pickedFiles($("photoDir")));
$("zip").onchange = () => $("zip").files[0] && setProduct({ zip: $("zip").files[0] });

// ---------- 1-b. 이미 만든 영상 올리기 ----------
let copyVideo = null;
const isVideo = (f) => /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name);
function setCopyVideo(f) {
  copyVideo = f;
  const pv = $("videoPreview");
  if (pv.src) URL.revokeObjectURL(pv.src);
  if (f) pv.src = URL.createObjectURL(f);
  else pv.removeAttribute("src");
  $("videoThumbs").classList.toggle("hidden", !f);
  $("videoText").textContent = f ? `${f.name} (${(f.size / 1e6).toFixed(0)}MB)` : "영상 파일을 여기에 놓으세요";
  $("videoDrop").classList.toggle("picked", !!f);
  $("videoFile").value = "";
}
$("videoClear").onclick = () => setCopyVideo(null);
function resetCopyInput() {
  $("copyName").value = "";
  $("copyErr").textContent = "";
  setCopyVideo(null);
}
dropZone($("videoDrop"), (items) => {
  const v = items.find((i) => isVideo(i.file));
  if (!v) return ($("copyErr").textContent = "mp4·mov 영상 파일을 넣어 주세요");
  $("copyErr").textContent = "";
  setCopyVideo(v.file);
});
$("videoFile").onchange = () => $("videoFile").files[0] && setCopyVideo($("videoFile").files[0]);
document.addEventListener("click", (e) => {
  if (e.target.closest("[data-pick]") || e.target.closest("video")) return;
  if (e.target.closest("#videoDrop")) $("videoFile").click();
});
$("copyBtn").onclick = async () => {
  const name = $("copyName").value.trim();
  if (!status?.claude?.connected) return ($("copyErr").textContent = "먼저 왼쪽 위 Claude 로그인을 눌러 로그인해 주세요");
  if (!name) return ($("copyErr").textContent = "제품명을 입력해 주세요");
  if (!copyVideo) return ($("copyErr").textContent = "올릴 영상 파일을 넣어 주세요");
  const fd = new FormData();
  fd.append("product_name", name);
  fd.append("video", copyVideo);
  $("copyBtn").disabled = true;
  $("copyBtn").textContent = "영상 보내는 중…";
  try {
    const j = await api("/api/jobs/copy", { method: "POST", body: fd });
    await openJob(j.id);
  } catch (e) {
    $("copyErr").textContent = e.message;
  } finally {
    $("copyBtn").disabled = false;
    $("copyBtn").textContent = "제목·설명글 만들기";
  }
};

$("createBtn").onclick = async () => {
  const name = $("productName").value.trim();
  if (!status?.claude?.connected) return ($("inputErr").textContent = "먼저 왼쪽 위 Claude 로그인을 눌러 로그인해 주세요");
  if (!name) return ($("inputErr").textContent = "제품명을 입력해 주세요");
  if (!details.length) return ($("inputErr").textContent = "상세페이지 이미지를 넣어 주세요");
  if (!product) return ($("inputErr").textContent = "제품 사진 폴더나 zip 파일을 넣어 주세요");
  const fd = new FormData();
  fd.append("product_name", name);
  for (const d of details) fd.append("detail", d.file);
  if (product.zip) fd.append("zip", product.zip);
  else {
    // 한글 파일 이름이 깨지지 않게 폴더 안 경로는 따로 보낸다 (파일과 같은 순서)
    fd.append("photo_paths", JSON.stringify(product.files.map((i) => i.path)));
    for (const i of product.files) fd.append("photos", i.file);
  }
  $("createBtn").disabled = true;
  $("createBtn").textContent = "파일 보내는 중…";
  try {
    const j = await api("/api/jobs", { method: "POST", body: fd });
    await openJob(j.id);
  } catch (e) {
    $("inputErr").textContent = e.message;
  } finally {
    $("createBtn").disabled = false;
    $("createBtn").textContent = "영상 만들기";
  }
};

// ---------- 2. 결과 ----------
async function saveMeta() {
  if (!current) return;
  current = await api(`/api/jobs/${current.id}/meta`, { method: "PUT", body: JSON.stringify({ title: $("title").value, description: $("desc").value }) });
}
$("folderBtn").onclick = () => api(`/api/jobs/${current.id}/open-folder`, { method: "POST" });
$("regenBtn").onclick = async () => {
  try {
    current = await api(`/api/jobs/${current.id}/regenerate`, { method: "POST", body: JSON.stringify({ revision: $("revision").value }) });
    $("revision").value = "";
    openJob(current.id);
  } catch (e) {
    $("resultErr").textContent = e.message;
  }
};

// ---------- 3. 올리기 ----------
$("uploadBtn").onclick = async () => {
  $("uploadErr").textContent = "";
  const platforms = [...document.querySelectorAll("[data-pf]:checked")].map((c) => c.dataset.pf);
  if (!platforms.length) return ($("uploadErr").textContent = "올릴 곳을 하나 이상 체크해 주세요");
  if (len($("title").value) > 25 || len($("desc").value) > 150) return ($("uploadErr").textContent = "제목은 25자, 설명글은 150자 이내로 줄여 주세요");
  const names = platforms.map((p) => PLATFORMS.find((x) => x.id === p).name).join(", ");
  if (!confirm(`${names}에 전체공개로 올릴게요.\n\n제목: ${$("title").value}`)) return;
  try {
    await saveMeta();
    current = await api(`/api/jobs/${current.id}/upload`, { method: "POST", body: JSON.stringify({ platforms }) });
    render();
  } catch (e) {
    $("uploadErr").textContent = e.message;
  }
};

// ---------- 설정 ----------
document.querySelectorAll("[data-disconnect]").forEach((b) =>
  (b.onclick = async () => {
    if (!confirm(`${b.textContent}할까요?`)) return;
    await api(`/api/disconnect/${b.dataset.disconnect}`, { method: "POST" });
    loadStatus();
  }),
);
async function loadAdmin() {
  const a = await api("/api/admin");
  $("ytId").value = a.youtube.client_id || "";
  $("ytSecret").value = a.youtube.client_secret || "";
  $("igAppId").value = a.instagram.app_id || "";
  $("igSecret").value = a.instagram.app_secret || "";
  $("cfFound").textContent = a.cloudflared_found || "없음 — setup.ps1 다시 실행";
  $("ttKey").value = a.tiktok.client_key || "";
  $("ttSecret").value = a.tiktok.client_secret || "";
  $("ttRedirect").value = a.tiktok.redirect_uri || "";
  $("ttRedirectNow").textContent = a.tiktok.redirect;
  $("claudePath").value = a.claude_path || "";
  $("claudePath").placeholder = a.claude_found ? `자동: ${a.claude_found}` : "Claude 앱을 찾지 못했어요";
  $("dataDir").textContent = a.data_dir;
}
$("igTokenBtn").onclick = async () => {
  try {
    const r = await api("/api/connect/instagram", { method: "POST", body: JSON.stringify({ token: $("igToken").value }) });
    $("igToken").value = "";
    $("adminMsg").textContent = "인스타그램 연결: " + r.account;
    loadStatus(true);
  } catch (e) {
    $("adminMsg").textContent = e.message;
  }
};
$("saveAdmin").onclick = async () => {
  await api("/api/admin", {
    method: "PUT",
    body: JSON.stringify({
      claude_path: $("claudePath").value,
      youtube: { client_id: $("ytId").value, client_secret: $("ytSecret").value },
      instagram: { app_id: $("igAppId").value, app_secret: $("igSecret").value },
      tiktok: { client_key: $("ttKey").value, client_secret: $("ttSecret").value, redirect_uri: $("ttRedirect").value },
    }),
  });
  $("adminMsg").textContent = "저장했어요";
  loadAdmin();
  loadStatus();
};
async function openSettings() {
  clearInterval(poll);
  current = null;
  if (status?.local !== false) await loadAdmin();
  show(["settings"]);
}
// 톱니바퀴: 홈에서는 업무 도구 전체 설정, 숏츠 두 탭에서는 숏츠 설정
$("settingsBtn").onclick = () => (["shorts", "upload"].includes(route.current) ? openSettings() : go("settings"));
$("topNewBtn").onclick = newJob;
$("home").onclick = (e) => (e.preventDefault(), go("home"));

// ---------- 플레르 MS팀: 항목 이동 ----------
const SECTIONS = {
  home: { title: "홈" },
  settings: { title: "설정" },
  shorts: { title: "숏츠 제작 및 업로드" },
  upload: { title: "제작된 숏츠 업로드" },
  "weekly-sales": { title: "주간 매출 통계", desc: "채널별 주간 매출과 지난주 대비 변화를 봐요.", ico: "ico-bar" },
  "monthly-sales": { title: "월간 매출 통계", desc: "채널별 월간 매출과 전월 대비 변화를 봐요.", ico: "ico-cal" },
  reviews: { title: "제품 리뷰수 종합", desc: "채널별 제품 리뷰 수를 한곳에 모아 봐요.", ico: "ico-star" },
  blog: { title: "블로그 작성 도우미", desc: "제품 자료로 블로그 글과 이미지를 준비해요.", ico: "ico-pen" },
  "review-reply": { title: "리뷰 답글 작성 도우미", desc: "고객 리뷰에 맞는 답글을 빠르게 써요.", ico: "ico-chat" },
};
function go(name) {
  if (location.hash !== "#/" + (name === "home" ? "" : name)) location.hash = "#/" + (name === "home" ? "" : name);
  route();
}
// 보이지 않게 된 영상은 멈춘다 (다른 화면으로 가도 소리가 계속 나지 않게)
function pauseHidden() {
  for (const v of document.querySelectorAll("video")) if (!v.paused && !v.offsetParent) v.pause();
}
function route() {
  setTimeout(pauseHidden);
  let name = location.hash.replace(/^#\/?/, "") || "home";
  if (!SECTIONS[name]) name = "home";
  route.current = name;
  const sec = SECTIONS[name];
  const isShorts = name === "shorts" || name === "upload"; // 두 화면이 같은 결과·업로드 단계를 씀
  document.querySelectorAll("[data-route]").forEach((a) => a.classList.toggle("on", a.dataset.route === name));
  $("homeView").classList.toggle("hidden", name !== "home");
  $("shortsView").classList.toggle("hidden", !isShorts);
  $("weeklyView").classList.toggle("hidden", name !== "weekly-sales");
  $("reviewView").classList.toggle("hidden", name !== "review-reply");
  $("monthlyView").classList.toggle("hidden", name !== "monthly-sales");
  $("settingsView").classList.toggle("hidden", name !== "settings");
  $("blogView").classList.toggle("hidden", name !== "blog");
  if (name === "blog") blogOpen();
  $("settingsBtn").classList.toggle("hidden", !["home", "settings", "shorts", "upload"].includes(name));
  $("settingsBtn").classList.toggle("on", name === "settings");
  if (name === "settings") loadTeam();
  $("placeholderView").classList.toggle("hidden", isShorts || ["home", "weekly-sales", "review-reply", "monthly-sales", "settings", "blog"].includes(name));
  if (name === "monthly-sales") monthlyOpen();
  if (name === "review-reply") reviewOpen();
  if (name === "weekly-sales") weeklyOpen();
  $("shortsSide").classList.toggle("hidden", !isShorts);
  $("shortsTop").classList.toggle("hidden", !isShorts);
  $("crumbSection").textContent = sec.title;
  const sub = isShorts || ["weekly-sales", "review-reply", "monthly-sales", "blog"].includes(name); // 하위 단계 표시가 있는 화면
  $("crumbSep").classList.toggle("hidden", !sub);
  $("crumb").classList.toggle("hidden", !sub);
  if (!isShorts && name !== "home") {
    $("phTitle").textContent = sec.title;
    $("phDesc").textContent = sec.desc;
    $("phIco").className = "tool-ico " + sec.ico;
  }
  if (isShorts) {
    $("shortsTitle").textContent = sec.title;
    $("shortsDesc").textContent = name === "upload" ? "이미 만든 영상을 넣으면 제목·설명글을 써서 채널에 올려요." : "사진과 상세페이지만 넣으면 숏츠·제목·설명글을 만들고 채널에 올려요.";
    $("topNewBtn").lastChild.textContent = name === "upload" ? " 새 영상 올리기" : " 새 영상 만들기";
  }
  if (isShorts && !current && $("settings").classList.contains("hidden")) {
    show(["stepInput"]);
    loadActive();
  }
  document.title = name === "home" ? "플레르 MS팀" : `${sec.title} · 플레르 MS팀`;
}
window.addEventListener("hashchange", route);
// 숏츠 메뉴(홈 카드 포함)를 누르면 언제나 새 영상 입력 화면으로
document.addEventListener("click", (e) => {
  if (e.target.closest("a[href=\"#/shorts\"], a[href=\"#/upload\"]")) newJob();
});

loadStatus(true).then(() => {
  newJob();
  route();
});

// ================= 주간 매출 통계 =================
const WK_CH = { naver: "네이버", coupang: "쿠팡", ohouse: "오늘의집", cafe24: "자사몰" };
const WK_NEED = {
  naver: "네이버 상품별 통계 (sales_…xlsx)",
  coupang: "쿠팡 판매 인사이트 (SELLER_INSIGHTS_VENDOR_ITEM_METRICS_…xlsx)",
  ohouse: "오늘의집 주문배송 내역 (…xlsx)",
  cafe24: "자사몰 카페24 주문내역 (plaire1054_…csv)",
};
const WK_STEPS = ["이번 주 집계", "원본 ↔ 집계 검증", "통합파일에 이번 주 추가", "통합파일 검증", "구글 시트 교체 + 전 칸 대조"];
let wkCo = "플레르가구";
try {
  wkCo = localStorage.getItem("wkCo") || wkCo;
} catch {}
let wkFiles = [];
let wkRun = null;
let wkPoll = null;
let wkSetup = null;
// 파일 이름으로 어느 채널인지 미리 짐작 (최종 판별은 스크립트가 내용으로 한다)
const wkGuess = (n) => (/^sales_/i.test(n) ? "naver" : /SELLER_INSIGHTS/i.test(n) ? "coupang" : /주문배송/.test(n) ? "ohouse" : /\.csv$/i.test(n) ? "cafe24" : null);
const wkChannels = () => (wkCo === "플레르가구" ? ["naver", "coupang", "ohouse", "cafe24"] : ["naver", "coupang", "ohouse"]);
const won = (v) => (v == null ? "-" : v.toLocaleString("ko-KR"));

async function weeklyOpen() {
  $("crumbSection").textContent = "주간 매출 통계";
  wkTabs();
  if (!wkSetup) {
    wkSetup = await api("/api/weekly/check").catch((e) => ({ ok: false, output: e.message, latest: {} }));
  }
  wkShowSetup();
  const runs = await api(`/api/weekly/runs?company=${encodeURIComponent(wkCo)}`).catch(() => []);
  const live = runs.find((r) => r.running);
  if (live) return wkOpenRun(live.id);
  if (!wkRun || wkRun.company !== wkCo) wkShowInput();
  wkHistory(runs);
}
function wkTabs() {
  for (const b of $("coSeg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.co === wkCo);
  $("noCafeRow").classList.toggle("hidden", wkCo !== "플레르가구");
  wkRenderFiles();
}
function wkShowSetup() {
  const el = $("wkSetup");
  const last = wkSetup?.latest?.[wkCo];
  $("wkLast").textContent = last ? `마지막 반영: ${last}` : "";
  if (wkSetup && !wkSetup.ok) {
    el.innerHTML = "이 PC는 아직 준비가 덜 됐어요. 아래 [ERR] 항목을 먼저 해결해 주세요.<pre>" + esc(wkSetup.output) + "</pre>";
    el.classList.remove("hidden");
  } else el.classList.add("hidden");
}
$("coSeg").onclick = (e) => {
  const b = e.target.closest("[data-co]");
  if (!b || b.dataset.co === wkCo) return;
  wkCo = b.dataset.co;
  try {
    localStorage.setItem("wkCo", wkCo);
  } catch {}
  wkFiles = [];
  wkRun = null;
  clearInterval(wkPoll);
  weeklyOpen();
};
function wkShowInput() {
  clearInterval(wkPoll);
  wkRun = null;
  for (const id of ["wkProgress", "wkResult"]) $(id).classList.add("hidden");
  $("wkInput").classList.remove("hidden");
  $("crumb").textContent = "";
  wkRenderFiles();
}
function wkRenderFiles() {
  const chans = wkChannels();
  const have = new Set(wkFiles.map((f) => wkGuess(f.name)));
  const noCafe = $("noCafe24").checked;
  $("wkNeed").innerHTML = chans
    .map((c) => {
      const ok = have.has(c) || (c === "cafe24" && noCafe);
      return `<span class="need-chip ${ok ? "ok" : ""}">${ok ? "✓" : "○"} ${WK_NEED[c]}</span>`;
    })
    .join("");
  $("wkFiles").innerHTML = wkFiles
    .map((f, i) => {
      const g = wkGuess(f.name);
      const wrong = g === "cafe24" && wkCo !== "플레르가구";
      return `<li><span class="ch ${g && !wrong ? "" : "warn"}">${wrong ? "가즈다엔 자사몰 없음" : g ? WK_CH[g] : "확인 필요"}</span><span class="fname">${esc(f.name)}</span><small>${(f.size / 1e3).toFixed(0)}KB</small><button class="del" data-rm="${i}">빼기</button></li>`;
    })
    .join("");
  $("wkDropText").textContent = wkFiles.length ? `${wkFiles.length}개 넣음 · 더 넣으려면 다시 놓으세요` : "원본 파일을 한꺼번에 여기에 놓으세요";
  $("wkDrop").classList.toggle("picked", chans.every((c) => have.has(c) || (c === "cafe24" && noCafe)));
}
function wkAdd(list) {
  $("wkErr").textContent = "";
  for (const f of list) {
    if (!/\.(xlsx|xlsm|csv)$/i.test(f.name)) {
      $("wkErr").textContent = `엑셀·CSV 파일만 넣을 수 있어요: ${f.name}`;
      continue;
    }
    // 같은 채널 파일을 다시 넣으면 새 것으로 바꿈
    const g = wkGuess(f.name);
    wkFiles = wkFiles.filter((x) => x.name !== f.name && !(g && wkGuess(x.name) === g));
    wkFiles.push(f);
  }
  wkRenderFiles();
}
dropZone($("wkDrop"), (items) => wkAdd(items.map((i) => i.file)));
$("wkFile").onchange = () => (wkAdd([...$("wkFile").files]), ($("wkFile").value = ""));
$("wkDrop").addEventListener("click", (e) => !e.target.closest("[data-pick]") && $("wkFile").click());
$("wkFiles").onclick = (e) => {
  const b = e.target.closest("[data-rm]");
  if (b) (wkFiles.splice(Number(b.dataset.rm), 1), wkRenderFiles());
};
$("noCafe24").onchange = wkRenderFiles;
$("wkRun").onclick = async () => {
  if (!wkFiles.length) return ($("wkErr").textContent = "이번 주 원본 파일을 넣어 주세요");
  const have = new Set(wkFiles.map((f) => wkGuess(f.name)));
  const miss = wkChannels().filter((c) => !have.has(c) && !(c === "cafe24" && $("noCafe24").checked));
  if (miss.length && !confirm(`${miss.map((c) => WK_CH[c]).join("·")} 파일이 안 보여요. 그래도 실행할까요?\n(스크립트가 내용으로 다시 판별해요)`)) return;
  const fd = new FormData();
  fd.append("company", wkCo);
  if (wkCo === "플레르가구" && $("noCafe24").checked) fd.append("no_cafe24", "1");
  for (const f of wkFiles) fd.append("files", f, f.name);
  $("wkRun").disabled = true;
  $("wkRun").textContent = "파일 보내는 중…";
  try {
    const r = await api("/api/weekly/runs", { method: "POST", body: fd });
    wkFiles = [];
    $("noCafe24").checked = false;
    await wkOpenRun(r.id);
  } catch (e) {
    $("wkErr").textContent = e.message;
  } finally {
    $("wkRun").disabled = false;
    $("wkRun").textContent = "집계하고 구글 시트에 반영";
  }
};
async function wkOpenRun(id) {
  clearInterval(wkPoll);
  const load = async () => {
    wkRun = await api(`/api/weekly/runs/${id}`);
    wkRender();
    if (wkRun.status !== "running") {
      clearInterval(wkPoll);
      if (wkSetup) wkSetup = null; // 마지막 반영 주차 새로 읽기
      api(`/api/weekly/runs?company=${encodeURIComponent(wkCo)}`).then(wkHistory).catch(() => {});
    }
  };
  await load();
  if (wkRun.status === "running") wkPoll = setInterval(load, 1500);
}
function wkRender() {
  const r = wkRun;
  $("wkInput").classList.add("hidden");
  const log = (r.log || []).map((l) => `<li>${esc(l)}</li>`).join("");
  if (r.status === "running") {
    $("wkProgress").classList.remove("hidden");
    $("wkResult").classList.add("hidden");
    const sec = Math.round((Date.now() - new Date(r.started_at)) / 1000);
    $("wkElapsed").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const step = Math.max(0, ...(r.log || []).map((l) => +(l.match(/^\[(\d)\/5\]/) || [])[1] || 0));
    $("wkSteps").innerHTML = WK_STEPS.map((s, i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}">${s}</li>`).join("");
    $("wkLog").innerHTML = log;
    $("crumb").textContent = "집계 중";
    return;
  }
  $("wkProgress").classList.add("hidden");
  $("wkResult").classList.remove("hidden");
  const ok = r.status === "done";
  $("crumb").textContent = r.week?.label || "";
  $("wkResTitle").textContent = ok ? `${r.week?.label || "이번 주"} 반영 완료` : "중간에 멈췄어요";
  const rate = (r.error_rates || []).at(-1) || "";
  $("wkResTag").textContent = ok ? (rate.match(/오류율\s*[\d.]+%/) || ["검증 완료"])[0] : "구글 시트는 그대로예요";
  $("wkResTag").className = "tag " + (ok ? "green" : "red");
  $("wkStop").classList.toggle("hidden", ok);
  $("wkStop").textContent = ok ? "" : r.stop || "";
  const sm = r.summary;
  $("wkTable").classList.toggle("hidden", !sm);
  if (sm) {
    const [c1, c0] = sm.cols;
    $("wkTable").innerHTML =
      `<thead><tr><th>채널</th><th>${esc(c1)}</th><th>${esc(c0 || "지난주")}</th><th>증감</th></tr></thead><tbody>` +
      sm.rows
        .map((row) => {
          const [v1, v0] = row.values;
          const d = v1 != null && v0 ? ((v1 - v0) / v0) * 100 : null;
          const cls = d == null ? "" : d >= 0 ? "up" : "down";
          return `<tr class="${/합계/.test(row.label) ? "total" : ""}"><td>${esc(row.label)}</td><td>${won(v1)}</td><td>${won(v0)}</td><td class="${cls}">${d == null ? "-" : (d >= 0 ? "▲ " : "▼ ") + Math.abs(d).toFixed(1) + "%"}</td></tr>`;
        })
        .join("") +
      "</tbody>";
  }
  $("wkChecks").innerHTML = (r.error_rates || []).map((l) => `<li>${esc(l)}</li>`).join("");
  $("wkDownload").classList.toggle("hidden", !r.master);
  $("wkDownload").href = `/api/weekly/runs/${r.id}/file`;
  $("wkSheet").href = wkSetup?.sheets?.[r.company] || "#";
  $("wkSheet").classList.toggle("hidden", !ok);
  $("wkResLog").innerHTML = log;
}
$("wkAgain").onclick = () => (wkShowInput(), weeklyOpen());
function wkHistory(runs) {
  const list = (runs || []).filter((r) => r.status !== "running").slice(0, 5);
  $("wkHistory").innerHTML =
    `<div class="active-head">최근 기록</div>` +
    (list.length
      ? list
        .map((r) => {
          const ok = r.status === "done";
          const total = r.summary?.rows?.find((x) => /합계/.test(x.label))?.values?.[0];
          return `<div class="active-row ${ok ? "green" : "red"}" data-run="${r.id}" role="button" tabindex="0"><span class="name">${esc(r.week?.label || r.id)}${total != null ? ` · 합계 ${won(total)}원` : ""}</span><span class="tag ${ok ? "green" : "red"}">${ok ? "반영 완료" : "멈춤"}</span><span class="go">보기</span></div>`;
        })
        .join("")
      : `<p class="active-empty">아직 만든 주간 통계가 없어요</p>`);
  $("wkHistory").classList.remove("hidden");
}
$("wkHistory").onclick = (e) => {
  const r = e.target.closest("[data-run]");
  if (r) wkOpenRun(r.dataset.run);
};

// ================= 리뷰 답글 작성 도우미 =================
let rvBrand = "플레르가구";
try {
  rvBrand = localStorage.getItem("rvBrand") || rvBrand;
} catch {}
let rvFile = null;
let rvRun = null;
let rvPoll = null;

async function reviewOpen() {
  for (const b of $("rvSeg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.br === rvBrand);
  $("rvBrandTag").textContent = rvBrand;
  const runs = await api(`/api/reviews/runs?brand=${encodeURIComponent(rvBrand)}`).catch(() => []);
  const live = runs.find((r) => r.running);
  if (live) return rvOpenRun(live.id);
  if (!rvRun || rvRun.brand !== rvBrand) rvShowInput();
  rvHistory(runs);
}
$("rvSeg").onclick = (e) => {
  const b = e.target.closest("[data-br]");
  if (!b || b.dataset.br === rvBrand) return;
  rvBrand = b.dataset.br;
  try {
    localStorage.setItem("rvBrand", rvBrand);
  } catch {}
  rvRun = null;
  rvSetFile(null);
  reviewOpen();
};
function rvShowInput() {
  clearInterval(rvPoll);
  rvRun = null;
  $("rvProgress").classList.add("hidden");
  $("rvResult").classList.add("hidden");
  $("rvCards").classList.add("hidden");
  $("rvInput").classList.remove("hidden");
  $("crumb").textContent = "";
}
function rvSetFile(f) {
  rvFile = f;
  $("rvDropText").textContent = f ? `${f.name} (${(f.size / 1e3).toFixed(0)}KB)` : "리뷰 엑셀(review_….xlsx)을 여기에 놓으세요";
  $("rvDrop").classList.toggle("picked", !!f);
  $("rvFile").value = "";
}
dropZone($("rvDrop"), (items) => {
  const x = items.find((i) => /\.xlsx$/i.test(i.file.name));
  if (!x) return ($("rvErr").textContent = "엑셀(.xlsx) 파일을 넣어 주세요");
  $("rvErr").textContent = "";
  rvSetFile(x.file);
});
$("rvFile").onchange = () => $("rvFile").files[0] && rvSetFile($("rvFile").files[0]);
$("rvDrop").addEventListener("click", (e) => !e.target.closest("[data-pick]") && $("rvFile").click());
$("rvRun").onclick = async () => {
  if (!status?.claude?.connected) return ($("rvErr").textContent = "먼저 왼쪽 위 Claude 로그인을 눌러 로그인해 주세요");
  if (!rvFile) return ($("rvErr").textContent = "리뷰 엑셀을 넣어 주세요");
  const fd = new FormData();
  fd.append("brand", rvBrand);
  fd.append("file", rvFile, rvFile.name);
  $("rvRun").disabled = true;
  $("rvRun").textContent = "엑셀 보내는 중…";
  try {
    const r = await api("/api/reviews/runs", { method: "POST", body: fd });
    rvSetFile(null);
    $("rvErr").textContent = "";
    await rvOpenRun(r.id);
  } catch (e) {
    $("rvErr").textContent = e.message;
  } finally {
    $("rvRun").disabled = false;
    $("rvRun").textContent = "답글 쓰기";
  }
};
async function rvOpenRun(id) {
  clearInterval(rvPoll);
  const load = async () => {
    rvRun = await api(`/api/reviews/runs/${id}`);
    rvRender();
    if (!rvRun.running) {
      clearInterval(rvPoll);
      api(`/api/reviews/runs?brand=${encodeURIComponent(rvBrand)}`).then(rvHistory).catch(() => {});
    }
  };
  await load();
  if (rvRun.running) rvPoll = setInterval(load, 2500);
}
// 5점 미만 엑셀 받기 상자
const rvLowBox = (r) =>
  r.low
    ? `<span>전체 ${r.total}건 중 <b>${r.low}건</b>이 5점이 아니에요</span><a class="btn-dark" href="/api/reviews/runs/${r.id}/low">엑셀 받기</a>`
    : `<span>${r.total ? `전체 ${r.total}건이 모두 5점이에요` : "리뷰가 없어요"}</span>`;
function rvRender() {
  const r = rvRun;
  $("rvInput").classList.add("hidden");
  $("crumb").textContent = r.running ? "답글 쓰는 중" : "답글 결과";
  if (r.running) {
    $("rvProgress").classList.remove("hidden");
    $("rvResult").classList.add("hidden");
    const sec = Math.round((Date.now() - new Date(r.started_at)) / 1000);
    $("rvElapsed").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    $("rvLowBox1").innerHTML = rvLowBox(r);
    $("rvLog").innerHTML = (r.log || []).slice(-40).map((l) => `<li>${esc(l)}</li>`).join("");
    return;
  }
  $("rvProgress").classList.add("hidden");
  $("rvResult").classList.remove("hidden");
  $("rvCards").classList.remove("hidden");
  const ok = r.status === "done";
  $("rvResTitle").textContent = ok ? "수정 필요한 리뷰" : "답글을 다 쓰지 못했어요";
  $("rvStop").classList.toggle("hidden", ok);
  $("rvStop").textContent = ok ? "" : r.error || "";
  $("rvLowBox2").innerHTML = rvLowBox(r);
  if (r.page && $("rvCards").dataset.run !== r.id) rvLoadCards(r.id);
  if (!r.page) $("rvCards").innerHTML = "";
}
// 스킬이 만든 답글 페이지에서 카드 내용만 꺼내 스튜디오 화면에 맞게 다시 그린다
async function rvLoadCards(id) {
  const box = $("rvCards");
  box.dataset.run = id;
  box.innerHTML = "";
  const html = await fetch(`/api/reviews/runs/${id}/page`, { cache: "no-store" }).then((x) => x.text()).catch(() => "");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const txt = (el, sel) => el.querySelector(sel)?.textContent.trim() || "";
  box.innerHTML = [...doc.querySelectorAll("article.rev")]
    .map((el, i) => {
      const stars = (txt(el, ".stars").match(/★/g) || []).length;
      const img = el.querySelector("figure img")?.getAttribute("src");
      const month = el.dataset.month === "1";
      const prior = el.querySelector(".prior")?.textContent.replace(/^\s*첫 리뷰\s*·?\s*/, "").trim();
      const note = txt(el, ".note").replace(/^→\s*/, "");
      return `<article class="rv-card${el.dataset.flag ? " flag" : ""}">
  <div class="rv-src">
    <div class="rv-top"><span class="rv-stars${stars < 5 ? " low" : ""}">${"★".repeat(stars)}${"☆".repeat(5 - stars)}</span>${month ? '<span class="tag">한달사용</span>' : ""}<span class="rv-who">${esc(txt(el, ".who"))}</span></div>
    <b class="rv-prod">${esc(txt(el, ".prod"))}</b>
    <p class="rv-text">${esc(txt(el, ".text"))}</p>
    ${prior ? `<p class="rv-prior">처음 리뷰 · ${esc(prior)}</p>` : ""}
    ${img ? `<img class="rv-img" src="${img}" alt="">` : ""}
  </div>
  <div class="rv-reply">
    <pre id="rvr${i}">${esc(el.querySelector(".reply")?.textContent.trim() || "")}</pre>
    <button class="btn-dark" data-copy="rvr${i}">복사</button>
    ${note ? `<p class="rv-note">${esc(note)}</p>` : ""}
  </div>
</article>`;
    })
    .join("");
}
$("rvCards").onclick = async (e) => {
  const b = e.target.closest("[data-copy]");
  if (b) {
    await navigator.clipboard.writeText($(b.dataset.copy).textContent);
    b.textContent = "복사됨";
    b.classList.add("done");
    setTimeout(() => ((b.textContent = "복사"), b.classList.remove("done")), 1500);
    return;
  }
  const im = e.target.closest(".rv-img");
  if (im) im.classList.toggle("big");
};
function rvReset() {
  $("rvCards").innerHTML = "";
  $("rvCards").dataset.run = "";
  rvShowInput();
}
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href="#/review-reply"]') && route.current === "review-reply") (rvReset(), reviewOpen());
});
function rvHistory(runs) {
  const list = (runs || []).filter((r) => !r.running).slice(0, 5);
  $("rvHistory").innerHTML =
    `<div class="active-head">최근 기록</div>` +
    (list.length
      ? list
        .map((r) => {
          const ok = r.status === "done";
          return `<div class="active-row ${ok ? "green" : "red"}" data-rv="${r.id}" role="button" tabindex="0"><span class="name">${esc(r.source || r.id)} · ${r.total ?? "-"}건${r.low ? ` (5점 미만 ${r.low})` : ""}</span><span class="tag ${ok ? "green" : "red"}">${ok ? "완성" : "멈춤"}</span><span class="go">보기</span><button class="del" data-rvdel="${r.id}">삭제</button></div>`;
        })
        .join("")
      : `<p class="active-empty">아직 쓴 답글이 없어요</p>`);
  $("rvHistory").classList.remove("hidden");
}
$("rvHistory").onclick = async (e) => {
  const d = e.target.closest("[data-rvdel]");
  if (d) {
    if (!confirm("이 기록과 만든 파일(답글 페이지·엑셀)을 지울까요?")) return;
    await api(`/api/reviews/runs/${d.dataset.rvdel}`, { method: "DELETE" }).catch((er) => alert(er.message));
    if (rvRun?.id === d.dataset.rvdel) rvShowInput();
    return reviewOpen();
  }
  const r = e.target.closest("[data-rv]");
  if (r) rvOpenRun(r.dataset.rv);
};

// ================= 월간 매출 통계 =================
const M_STEPS = ["파일 판별·기간 확인", "원본 사본 보관", "월간판매데이터 만들기", "검증 A — 원본 ↔ 월간파일", "매출통계 작성", "검증 B — 이번 달 블록·과거 이력 보존", "매출통계 토탈 작성 + 검증 C"];
const M_NEED = {
  naver: "네이버 상품별 통계 (sales_YYYYMM01-말일…xlsx)",
  coupang: "쿠팡 판매 인사이트 (SELLER_INSIGHTS_VENDOR_ITEM_METRICS_…xlsx)",
  ohouse: "오늘의집 주문배송 내역 (…xlsx)",
  cafe24: "자사몰 카페24 주문내역 (plaire1054_…csv)",
};
let mCo = "플레르가구";
try {
  mCo = localStorage.getItem("mCo") || mCo;
} catch {}
let mFiles = [];
let mRun = null;
let mPoll = null;
const mChannels = () => (mCo === "플레르가구" ? ["naver", "coupang", "ohouse", "cafe24"] : ["naver", "coupang", "ohouse"]);

async function monthlyOpen() {
  for (const b of $("mCoSeg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.co === mCo);
  api("/api/monthly/info").then((i) => ($("mLast").textContent = i.latest?.[mCo] ? `마지막 반영: ${i.latest[mCo]}` : "")).catch(() => {});
  const runs = await api(`/api/monthly/runs?company=${encodeURIComponent(mCo)}`).catch(() => []);
  const live = runs.find((r) => r.running);
  if (live) return mOpenRun(live.id);
  if (!mRun || mRun.company !== mCo) mShowInput();
  mHistoryList(runs);
}
$("mCoSeg").onclick = (e) => {
  const b = e.target.closest("[data-co]");
  if (!b || b.dataset.co === mCo) return;
  mCo = b.dataset.co;
  try {
    localStorage.setItem("mCo", mCo);
  } catch {}
  mFiles = [];
  mRun = null;
  monthlyOpen();
};
function mShowInput() {
  clearInterval(mPoll);
  mRun = null;
  $("mProgress").classList.add("hidden");
  $("mResult").classList.add("hidden");
  $("mInput").classList.remove("hidden");
  $("crumb").textContent = "";
  mRender();
}
function mRender() {
  const have = new Set(mFiles.map((f) => wkGuess(f.name)));
  $("mNeed").innerHTML = mChannels()
    .map((c) => {
      const ok = have.has(c);
      return `<span class="need-chip ${ok ? "ok" : ""}">${ok ? "✓" : "○"} ${M_NEED[c]}</span>`;
    })
    .join("");
  $("mFiles").innerHTML = mFiles
    .map((f, i) => {
      const g = wkGuess(f.name);
      const wrong = g === "cafe24" && mCo !== "플레르가구";
      return `<li><span class="ch ${g && !wrong ? "" : "warn"}">${wrong ? "가즈다엔 자사몰 없음" : g ? WK_CH[g] : "확인 필요"}</span><span class="fname">${esc(f.name)}</span><small>${(f.size / 1e3).toFixed(0)}KB</small><button class="del" data-mrm="${i}">빼기</button></li>`;
    })
    .join("");
  $("mDropText").textContent = mFiles.length ? `${mFiles.length}개 넣음 · 더 넣으려면 다시 놓으세요` : "원본 파일을 한꺼번에 여기에 놓으세요";
  $("mDrop").classList.toggle("picked", mChannels().every((c) => have.has(c)));
}
function mAdd(list) {
  $("mErr").textContent = "";
  for (const f of list) {
    if (!/\.(xlsx|xlsm|csv)$/i.test(f.name)) {
      $("mErr").textContent = `엑셀·CSV 파일만 넣을 수 있어요: ${f.name}`;
      continue;
    }
    const g = wkGuess(f.name);
    mFiles = mFiles.filter((x) => x.name !== f.name && !(g && wkGuess(x.name) === g));
    mFiles.push(f);
  }
  mRender();
}
dropZone($("mDrop"), (items) => mAdd(items.map((i) => i.file)));
$("mFile").onchange = () => (mAdd([...$("mFile").files]), ($("mFile").value = ""));
$("mDrop").addEventListener("click", (e) => !e.target.closest("[data-pick]") && $("mFile").click());
$("mFiles").onclick = (e) => {
  const b = e.target.closest("[data-mrm]");
  if (b) (mFiles.splice(Number(b.dataset.mrm), 1), mRender());
};
$("mRun").onclick = async () => {
  if (!mFiles.length) return ($("mErr").textContent = "한 달치 원본 파일을 넣어 주세요");
  const have = new Set(mFiles.map((f) => wkGuess(f.name)));
  const miss = mChannels().filter((c) => !have.has(c));
  const msg = miss.includes("cafe24") ? "\n(자사몰 파일이 없으면 이번 달 자사몰은 0원으로 처리돼요)" : "\n(스크립트가 내용으로 다시 판별해요)";
  if (miss.length && !confirm(`${miss.map((c) => WK_CH[c]).join("·")} 파일이 안 보여요. 그래도 실행할까요?${msg}`)) return;
  const fd = new FormData();
  fd.append("company", mCo);
  for (const f of mFiles) fd.append("files", f, f.name);
  $("mRun").disabled = true;
  $("mRun").textContent = "파일 보내는 중…";
  try {
    const r = await api("/api/monthly/runs", { method: "POST", body: fd });
    mFiles = [];
    await mOpenRun(r.id);
  } catch (e) {
    $("mErr").textContent = e.message;
  } finally {
    $("mRun").disabled = false;
    $("mRun").textContent = "월간 통계 만들기";
  }
};
async function mOpenRun(id) {
  clearInterval(mPoll);
  const load = async () => {
    mRun = await api(`/api/monthly/runs/${id}`);
    mShow();
    if (!mRun.running) {
      clearInterval(mPoll);
      api(`/api/monthly/runs?company=${encodeURIComponent(mCo)}`).then(mHistoryList).catch(() => {});
    }
  };
  await load();
  if (mRun.running) mPoll = setInterval(load, 1500);
}
function mShow() {
  const r = mRun;
  $("mInput").classList.add("hidden");
  const log = (r.log || []).map((l) => `<li>${esc(l)}</li>`).join("");
  if (r.running) {
    $("mProgress").classList.remove("hidden");
    $("mResult").classList.add("hidden");
    const sec = Math.round((Date.now() - new Date(r.started_at)) / 1000);
    $("mElapsed").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    const step = Math.max(0, ...(r.log || []).map((l) => +(l.match(/^\[(\d)\]/) || [])[1] || 0));
    $("mSteps").innerHTML = M_STEPS.map((s, i) => `<li class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}">${s}</li>`).join("");
    $("crumb").textContent = "만드는 중";
    return;
  }
  $("mProgress").classList.add("hidden");
  $("mResult").classList.remove("hidden");
  const ok = r.status === "done";
  $("crumb").textContent = r.month?.label || "";
  $("mResTitle").textContent = ok ? `${r.month?.label || "이번 달"} 월간 통계 완료` : "중간에 멈췄어요";
  $("mResTag").textContent = ok ? (r.check?.match(/오류율\s*[\d.]+%/) || ["검증 완료"])[0] : "통합파일은 그대로예요";
  $("mResTag").className = "tag " + (ok ? "green" : "red");
  $("mStop").classList.toggle("hidden", ok);
  $("mStop").textContent = ok ? "" : r.stop || "";
  const sm = r.summary || [];
  $("mTable").classList.toggle("hidden", !sm.length);
  if (sm.length) {
    const prevLabel = r.month ? `${r.month.month - 1}월` : "지난달";
    $("mTable").innerHTML =
      `<thead><tr><th>채널</th><th>${esc(r.month?.label || "이번 달")}</th><th>${prevLabel}</th><th>증감</th></tr></thead><tbody>` +
      sm
        .map((row) => {
          const d = row.prev ? ((row.value - row.prev) / row.prev) * 100 : null;
          return `<tr class="${row.label === "합계" ? "total" : ""}"><td>${esc(row.label)}</td><td>${won(row.value)}</td><td>${won(row.prev)}</td><td class="${d == null ? "" : d >= 0 ? "up" : "down"}">${d == null ? "-" : (d >= 0 ? "▲ " : "▼ ") + Math.abs(d).toFixed(1) + "%"}</td></tr>`;
        })
        .join("") +
      "</tbody>";
  }
  $("mCheck").textContent = [r.check && `검증: ${r.check}`, ["paid", "order"].includes(r.cafe24_basis) && "자사몰은 고객이 실제 결제한 금액(쿠폰·할인 적용) 기준이에요 · 부분 환불은 반영 안 돼요"].filter(Boolean).join(" · ");
  const label = (f) => (/토탈/.test(f) ? "매출통계 토탈 받기" : /매출통계/.test(f) ? `${r.company} 매출통계 받기` : "파일 받기");
  // 받는 파일은 회사 매출통계 하나만 (토탈·월간판매데이터는 폴더에만 남김)
  const i = (r.outputs || []).findIndex((f) => /_\d{4}_\d+월_매출통계\.xlsx$/.test(f));
  $("mFilesOut").innerHTML = i >= 0 ? `<a class="btn-dark" href="/api/monthly/runs/${r.id}/file/${i}">${label(r.outputs[i])}</a>` : "";
}
function mHistoryList(runs) {
  const list = (runs || []).filter((r) => !r.running).slice(0, 5);
  $("mHistory").innerHTML =
    `<div class="active-head">최근 기록</div>` +
    (list.length
      ? list
        .map((r) => {
          const ok = r.status === "done";
          const total = (r.summary || []).find((x) => x.label === "합계")?.value;
          return `<div class="active-row ${ok ? "green" : "red"}" data-mrun="${r.id}" role="button" tabindex="0"><span class="name">${esc(r.month?.label || r.id)}${total != null ? ` · 합계 ${won(total)}원` : ""}</span><span class="tag ${ok ? "green" : "red"}">${ok ? "완료" : "멈춤"}</span><span class="go">보기</span></div>`;
        })
        .join("")
      : `<p class="active-empty">아직 만든 월간 통계가 없어요</p>`);
  $("mHistory").classList.remove("hidden");
}
$("mHistory").onclick = (e) => {
  const r = e.target.closest("[data-mrun]");
  if (r) mOpenRun(r.dataset.mrun);
};
// 사이드바 '월간 매출 통계'를 다시 누르면 새로 넣는 화면으로
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href="#/monthly-sales"]') && route.current === "monthly-sales") (mShowInput(), monthlyOpen());
});

// ================= 팀 공유 (서버 PC) · 백업 =================
const fmtSize = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(0)}MB` : `${Math.max(1, Math.round(n / 1e3))}KB`);
const fmtTime = (t) => new Date(t).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
async function loadTeam() {
  const t = await api("/api/server").catch(() => null);
  if (t) {
    $("teamMode").checked = t.server_mode;
    $("teamPw").placeholder = t.has_password ? "새 팀 비밀번호 (바꿀 때만)" : "팀 비밀번호 (4자 이상)";
    $("teamPwBtn").textContent = t.has_password ? "비밀번호 바꾸기" : "비밀번호 정하기";
    const main = t.addresses.list[0];
    $("teamNote").textContent = !t.local
      ? "이 화면은 서버 PC에 접속해서 보고 있어요. 서버 설정·되살리기는 서버 PC에서만 할 수 있어요."
      : t.server_mode
        ? "켜져 있어요. 사무실 다른 PC에서는 아래 주소로 들어와서 팀 비밀번호를 넣으면 돼요."
        : "꺼져 있어요. 켜면 사무실 다른 PC에서 브라우저로 이 업무 도구를 쓸 수 있어요.";
    $("teamAddr").innerHTML = t.server_mode
      ? t.addresses.list.map((u, i) => `<code class="${i ? "" : "main"}">${esc(u)}</code>`).join("") +
        (t.addresses.renamed ? "" : `<p class="muted">주소를 <b>http://${esc(t.name)}</b> 로 쓰려면 이 PC 이름을 '${esc(t.name)}'으로 바꿔 주세요 (설정 › 시스템 › 정보 › 이 PC 이름 바꾸기 → 다시 시작).</p>`)
      : "";
    void main;
  }
  const b = await api("/api/backups").catch((e) => ({ error: e.message, items: [] }));
  const last = b.last;
  $("bkStatus").innerHTML = `저장 위치: <code>${esc(b.dir || "")}</code><br>` +
    (last?.ok === false ? `<span class="err">마지막 백업 실패: ${esc(last.error || "")}</span>` : last?.at ? `마지막 백업: ${fmtTime(last.at)} (${esc(last.reason || "")})` : "아직 백업이 없어요. 매일 밤 9시 이후 자동으로 만들어요.");
  const local = status?.local !== false;
  $("bkList").innerHTML = (b.items || [])
    .slice(0, 14)
    .map((x) => `<li><span>${fmtTime(x.time)}${/되살리기전/.test(x.name) ? " · 되살리기 전 상태" : ""}</span><small>${fmtSize(x.size)}</small>${local ? `<button class="mini" data-restore="${esc(x.name)}">이 백업으로 되살리기</button>` : ""}</li>`)
    .join("");
}
$("teamMode").onchange = async () => {
  const on = $("teamMode").checked;
  if (on && !confirm("사무실 다른 PC에서도 이 업무 도구를 쓰게 열까요?\n팀 비밀번호를 아는 사람만 들어올 수 있어요. 잠깐 다시 켜져요.")) return ($("teamMode").checked = !on);
  try {
    await api("/api/server", { method: "PUT", body: JSON.stringify({ server_mode: on }) });
    $("teamMsg").textContent = "다시 켜는 중이에요... 몇 초 뒤 새로고침돼요";
    setTimeout(() => location.reload(), 6000);
  } catch (e) {
    $("teamMode").checked = !on;
    $("teamMsg").textContent = e.message;
  }
};
$("teamPwBtn").onclick = async () => {
  try {
    await api("/api/server", { method: "PUT", body: JSON.stringify({ password: $("teamPw").value }) });
    $("teamPw").value = "";
    $("teamMsg").textContent = "팀 비밀번호를 정했어요. 다른 PC는 이 비밀번호로 들어와요.";
    loadTeam();
  } catch (e) {
    $("teamMsg").textContent = e.message;
  }
};
$("bkNow").onclick = async () => {
  $("bkNow").disabled = true;
  $("bkNow").textContent = "백업 중…";
  try {
    await api("/api/backups", { method: "POST" });
  } catch (e) {
    alert(e.message);
  }
  $("bkNow").disabled = false;
  $("bkNow").textContent = "지금 백업하기";
  loadTeam();
};
$("bkList").onclick = async (e) => {
  const b = e.target.closest("[data-restore]");
  if (!b) return;
  if (!confirm("이 백업으로 되살릴까요?\n매출 통계 파일·설정·연결이 그때 상태로 돌아가요. 지금 상태는 따로 백업해 둬요.")) return;
  b.disabled = true;
  b.textContent = "되살리는 중…";
  try {
    const r = await api("/api/backups/restore", { method: "POST", body: JSON.stringify({ name: b.dataset.restore }) });
    alert(`되살렸어요 (${r.restored}개 파일). 잠깐 다시 켜져요.`);
    setTimeout(() => location.reload(), 6000);
  } catch (er) {
    alert(er.message);
    loadTeam();
  }
};

// ================= 지금 진행 중인 작업 (오른쪽 위) =================
async function loadActivity() {
  const r = await api("/api/activity").catch(() => null);
  const items = r?.items || [];
  const el = $("activity");
  el.classList.toggle("hidden", !items.length);
  el.textContent = `진행 중 ${items.length}`;
  el.title = items.map((i) => `${i.kind} · ${i.label} ${i.what}`).join("\n");
}
$("activity").onclick = () => alert($("activity").title || "진행 중인 작업이 없어요");
loadActivity();
setInterval(loadActivity, 10000);

// ================= 블로그 작성 도우미 =================
let blBrand = "플레르가구";
try {
  blBrand = localStorage.getItem("blBrand") || blBrand;
} catch {}
let blDetails = [];
let blProduct = null; // { zip } | { files, name }
let blRunNow = null;
let blPoll = null;

const BL_TARGET = { 플레르가구: "가정집(신혼·이사·아이 있는 집 등)", 가즈다가구: "업소(카페·식당·사무실·학원 등)" };
function blTopicHelp() {
  $("blTopic").placeholder = blBrand === "가즈다가구" ? "예: 카페 창업 인테리어, 학원 교실 리뉴얼, 식당 좌석 배치" : "예: 신혼집 거실 꾸미기, 강남 ○○ 아파트 입주, 아이 방 정리";
  $("blTopicHelp").textContent = `아무것도 적지 않으면 지금 가장 인기 있는 키워드를 찾아서 써 드려요. ${blBrand}는 ${BL_TARGET[blBrand]} 고객에게 맞춰 써요.`;
}
async function blogOpen() {
  for (const b of $("blSeg").querySelectorAll("button")) b.classList.toggle("on", b.dataset.br === blBrand);
  blTopicHelp();
  const runs = await api("/api/blog/runs").catch(() => []);
  const live = runs.find((r) => r.running);
  if (live) return blOpenRun(live.id);
  if (!blRunNow) blShowInput();
  blHistory(runs);
}
$("blSeg").onclick = (e) => {
  const b = e.target.closest("[data-br]");
  if (!b) return;
  blBrand = b.dataset.br;
  try {
    localStorage.setItem("blBrand", blBrand);
  } catch {}
  for (const x of $("blSeg").querySelectorAll("button")) x.classList.toggle("on", x.dataset.br === blBrand);
  blTopicHelp();
};
function blShowInput() {
  clearInterval(blPoll);
  blRunNow = null;
  for (const id of ["blProgress", "blResult"]) $(id).classList.add("hidden");
  $("blInput").classList.remove("hidden");
  $("crumb").textContent = "";
}
function blSetDetails(items) {
  blDetails = items.filter((i) => isImg(i.file)).sort(byName);
  $("blDetailText").textContent = blDetails.length ? `${blDetails.length}장 선택됨 · 더 넣으려면 다시 놓으세요` : "상세페이지 이미지나 폴더를 여기에 놓으세요";
  showThumbs($("blDetailThumbs"), blDetails, () => blSetDetails([]));
  $("blDetailDrop").classList.toggle("picked", !!blDetails.length);
  $("blDetail").value = "";
  $("blDetailDir").value = "";
}
function blSetProduct(p) {
  blProduct = p;
  const mb = (n) => `${(n / 1e6).toFixed(0)}MB`;
  $("blPhotoText").textContent = !p ? "제품 사진 폴더를 여기에 놓으세요" : p.zip ? `${p.zip.name} (${mb(p.zip.size)})` : `${p.name ? p.name + " 폴더 · " : ""}사진 ${p.files.filter((i) => isImg(i.file)).length}장`;
  $("blPhotoDrop").classList.toggle("picked", !!p);
  showThumbs($("blPhotoThumbs"), p?.files ? [...p.files].sort(byName) : [], () => blSetProduct(null), p?.zip);
  if (p && !$("blName").value) $("blName").value = p.zip ? p.zip.name.replace(/\.zip$/i, "") : p.name || "";
  $("blZip").value = "";
  $("blPhotoDir").value = "";
}
function blProductFrom(items) {
  const zip = items.find((i) => /\.zip$/i.test(i.file.name));
  if (zip && items.length === 1) return blSetProduct({ zip: zip.file });
  const files = items.filter((i) => !/(^|\/)(\.|Thumbs\.db$|desktop\.ini$)/i.test(i.path));
  if (!files.some((i) => isImg(i.file))) return ($("blErr").textContent = "제품 사진이 든 폴더나 zip 파일을 넣어 주세요");
  blSetProduct({ files, name: topFolder(files) });
}
dropZone($("blDetailDrop"), (items) => blSetDetails([...blDetails, ...items]));
dropZone($("blPhotoDrop"), blProductFrom);
$("blDetail").onchange = () => blSetDetails([...blDetails, ...pickedFiles($("blDetail"))]);
$("blDetailDir").onchange = () => blSetDetails([...blDetails, ...pickedFiles($("blDetailDir"))]);
$("blPhotoDir").onchange = () => blProductFrom(pickedFiles($("blPhotoDir")));
$("blZip").onchange = () => $("blZip").files[0] && blSetProduct({ zip: $("blZip").files[0] });
$("blDetailDrop").addEventListener("click", (e) => !e.target.closest("[data-pick]") && $("blDetail").click());
$("blPhotoDrop").addEventListener("click", (e) => !e.target.closest("[data-pick]") && $("blPhotoDir").click());
$("blRun").onclick = async () => {
  const name = $("blName").value.trim();
  if (!status?.claude?.connected) return ($("blErr").textContent = "먼저 왼쪽 위 Claude 로그인을 해 주세요");
  if (!name) return ($("blErr").textContent = "제품명을 입력해 주세요");
  if (!blDetails.length) return ($("blErr").textContent = "상세페이지 이미지를 넣어 주세요");
  if (!blProduct) return ($("blErr").textContent = "제품 사진 폴더나 zip 파일을 넣어 주세요");
  const fd = new FormData();
  fd.append("brand", blBrand);
  fd.append("product_name", name);
  fd.append("topic", $("blTopic").value.trim());
  for (const d of blDetails) fd.append("detail", d.file);
  if (blProduct.zip) fd.append("zip", blProduct.zip);
  else {
    fd.append("photo_paths", JSON.stringify(blProduct.files.map((i) => i.path)));
    for (const i of blProduct.files) fd.append("photos", i.file);
  }
  $("blRun").disabled = true;
  $("blRun").textContent = "자료 보내는 중…";
  try {
    const r = await api("/api/blog/runs", { method: "POST", body: fd });
    $("blName").value = "";
    $("blTopic").value = "";
    blSetDetails([]);
    blSetProduct(null);
    $("blErr").textContent = "";
    await blOpenRun(r.id);
  } catch (e) {
    $("blErr").textContent = e.message;
  } finally {
    $("blRun").disabled = false;
    $("blRun").textContent = "블로그 글 쓰기";
  }
};
async function blOpenRun(id) {
  clearInterval(blPoll);
  const load = async () => {
    blRunNow = await api(`/api/blog/runs/${id}`);
    blRender();
    if (!blRunNow.running) {
      clearInterval(blPoll);
      api("/api/blog/runs").then(blHistory).catch(() => {});
    }
  };
  await load();
  if (blRunNow.running) blPoll = setInterval(load, 2500);
}
function blRender() {
  const r = blRunNow;
  $("blInput").classList.add("hidden");
  $("crumb").textContent = r.product_name || "";
  if (r.running) {
    $("blProgress").classList.remove("hidden");
    $("blResult").classList.add("hidden");
    const sec = Math.round((Date.now() - new Date(r.started_at)) / 1000);
    $("blElapsed").textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    $("blNow").textContent = (r.log || []).filter((l) => !l.startsWith("·")).slice(-1)[0] || "";
    return;
  }
  $("blProgress").classList.add("hidden");
  $("blResult").classList.remove("hidden");
  const ok = r.status === "done";
  const x = r.result || {};
  $("blStop").classList.toggle("hidden", ok);
  $("blStop").textContent = ok ? "" : r.error || "";
  for (const el of $("blResult").querySelectorAll("section")) el.classList.toggle("hidden", !ok);
  if (!ok) return;
  $("blAngle").textContent = x.topic?.angle || "";
  $("blWhy").textContent = x.topic?.why || "";
  const kw = x.keywords || {};
  $("blKw").innerHTML = [kw.main && `<span class="kw main">${esc(kw.main)}</span>`, kw.product && `<span class="kw prod">${esc(kw.product)}</span>`, ...(kw.sub || []).map((k) => `<span class="kw">${esc(k)}</span>`)].filter(Boolean).join("");
  $("blTitles").innerHTML = [x.title, ...(x.title_options || [])]
    .filter(Boolean)
    .map((t, i) => `<div class="bl-title${i ? "" : " first"}"><span id="blT${i}">${esc(t)}</span><button class="mini" data-blcopy="blT${i}">복사</button></div>`)
    .join("");
  $("blBody").textContent = x.body || "";
  $("blChars").textContent = x.chars ? `${Number(x.chars).toLocaleString()}자` : "";
  $("blTags").textContent = (x.tags || []).join(", ");
  const imgs = x.images || [];
  $("blImgCount").textContent = imgs.length ? `${imgs.length}장 · 3:2` : "";
  $("blImgs").innerHTML = imgs.map((n, i) => `<figure><img src="/api/blog/runs/${r.id}/img/${encodeURIComponent(n)}" alt="" loading="lazy"><figcaption>사진 ${i + 1}</figcaption></figure>`).join("");
  $("blZipBtn").href = `/api/blog/runs/${r.id}/zip`;
  $("blZipBtn").classList.toggle("hidden", !x.zip);
  $("blNotes").innerHTML = (x.notes || []).map((n) => `<li>${esc(n)}</li>`).join("");
}
$("blResult").onclick = async (e) => {
  const b = e.target.closest("[data-blcopy]");
  if (!b) return;
  await navigator.clipboard.writeText($(b.dataset.blcopy).textContent);
  const t = b.textContent;
  b.textContent = "복사됨";
  setTimeout(() => (b.textContent = t), 1500);
};
function blHistory(runs) {
  const list = (runs || []).filter((r) => !r.running).slice(0, 6);
  $("blHistory").innerHTML =
    `<div class="active-head">최근 기록</div>` +
    (list.length
      ? list
        .map((r) => {
          const ok = r.status === "done";
          return `<div class="active-row ${ok ? "green" : "red"}" data-blrun="${r.id}" role="button" tabindex="0"><span class="name">${esc(r.product_name)}${r.result?.keywords?.main ? ` · ${esc(r.result.keywords.main)}` : ""}</span><span class="tag ${ok ? "green" : "red"}">${ok ? "완성" : "멈춤"}</span><span class="go">보기</span><button class="del" data-bldel="${r.id}">삭제</button></div>`;
        })
        .join("")
      : `<p class="active-empty">아직 쓴 블로그 글이 없어요</p>`);
  $("blHistory").classList.remove("hidden");
}
$("blHistory").onclick = async (e) => {
  const d = e.target.closest("[data-bldel]");
  if (d) {
    if (!confirm("이 기록과 만든 글·사진을 지울까요?")) return;
    await api(`/api/blog/runs/${d.dataset.bldel}`, { method: "DELETE" }).catch((er) => alert(er.message));
    if (blRunNow?.id === d.dataset.bldel) blShowInput();
    return blogOpen();
  }
  const r = e.target.closest("[data-blrun]");
  if (r) blOpenRun(r.dataset.blrun);
};
// 사이드바 '블로그 작성 도우미'를 다시 누르면 새로 넣는 화면으로
document.addEventListener("click", (e) => {
  if (e.target.closest('a[href="#/blog"]') && route.current === "blog") (blShowInput(), blogOpen());
});
