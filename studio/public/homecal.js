// 홈 캘린더: 신제품 출시일(/api/launch/products) + 기획전 기간(/api/promos) 자동, 팀이 직접 넣는 일정(/api/events, 색 선택).
// dash.js가 홈을 다시 그려도 달력은 그대로 두려고 요소 하나(window.homeCal.el)를 계속 옮겨 끼운다. 일정 창은 body에 따로 띄운다
(function () {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const addD = (d, n) => { const t = new Date(d + "T00:00:00"); t.setDate(t.getDate() + n); return iso(t); };
  const kd = (d) => { const t = new Date(d + "T00:00:00"); return `${t.getMonth() + 1}월 ${t.getDate()}일 (${WD[t.getDay()]})`; };
  const CH = { "스마트스토어": "#03c75a", "쿠팡": "#e5322d", "오늘의집": "#35b6e8" };
  const COLORS = [["#2f5bea", "파랑"], ["#1f9d55", "초록"], ["#c27803", "노랑"], ["#d93f3f", "빨강"], ["#7c4dff", "보라"], ["#e0529c", "분홍"], ["#0f9d9a", "청록"], ["#5b616e", "회색"]];
  const LANES = 3; // 한 주에 보이는 줄 수 (넘치면 날짜 옆에 +n, 누르면 그날 일정 전부)

  const el = document.createElement("section");
  el.className = "card hd-card hc";
  const M = document.createElement("div");
  M.id = "hcModal";
  document.body.appendChild(M);
  let month = iso(new Date()).slice(0, 7), launches = [], promos = [], events = [], form = null, loaded = false;

  async function getJSON(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "서버에 연결하지 못했어요");
    return j;
  }
  async function refresh() {
    if (form) return;
    const [a, b, c] = await Promise.all([
      getJSON("/api/launch/products").then((r) => r.products).catch(() => launches),
      getJSON("/api/promos").then((r) => r.items).catch(() => promos),
      getJSON("/api/events").then((r) => r.items).catch(() => events),
    ]);
    launches = a; promos = b; events = c; loaded = true;
    render();
  }

  // 달력에 올릴 것 전부: {s, e, label, color, kind, id, href}
  function items() {
    const out = [];
    for (const p of launches) if (p.launch) out.push({ s: p.launch, e: p.launch, label: "출시 · " + p.name, color: "#16181d", kind: "launch", href: "#/launch" });
    for (const p of promos) {
      if (p.status === "미선정") continue;
      if (p.start || p.end) out.push({ s: p.start || p.end, e: p.end || p.start, label: `${p.ch} · ${p.name}`, color: CH[p.ch] || "#5b616e", kind: "promo", href: "#/promo" });
      else if (p.apply_by && p.status === "신청 전") out.push({ s: p.apply_by, e: p.apply_by, label: `${p.ch} · ${p.name} 신청 마감`, color: CH[p.ch] || "#5b616e", kind: "apply", href: "#/promo" });
    }
    for (const v of events) out.push({ s: v.start, e: v.end || v.start, label: v.title, color: v.color, kind: "event", id: v.id });
    return out.sort((x, y) => x.s.localeCompare(y.s) || y.e.localeCompare(x.e));
  }

  function week(ws, all, m) {
    const we = addD(ws, 6), days = [...Array(7)].map((_, i) => addD(ws, i));
    const segs = all.filter((x) => x.s <= we && x.e >= ws);
    const lanes = [], placed = [], more = Array(7).fill(0);
    for (const x of segs) {
      const a = Math.max(0, days.indexOf(x.s < ws ? ws : x.s)), b = days.indexOf(x.e > we ? we : x.e);
      let l = lanes.findIndex((end) => end < a);
      if (l < 0) { l = lanes.length; lanes.push(-1); }
      lanes[l] = b;
      if (l < LANES) placed.push({ x, a, b, l });
      else for (let i = a; i <= b; i++) more[i]++;
    }
    const today = iso(new Date());
    return `<div class="hc-week">
      <div class="hc-bg">${days.map((d, i) => `<button class="hc-day ${d.slice(0, 7) !== m ? "out" : ""} ${d === today ? "today" : ""}" data-day="${d}" aria-label="${kd(d)} 일정 추가"><span class="hc-dn">${Number(d.slice(8))}</span>${more[i] ? `<span class="hc-more" title="일정 ${more[i]}개 더 — 눌러서 모두 보기">+${more[i]}</span>` : ""}</button>`).join("")}</div>
      <div class="hc-bars">${placed.map(({ x, a, b, l }) => `<button class="hc-bar ${x.kind} ${x.s >= ws ? "first" : ""} ${x.e <= we ? "last" : ""}" style="grid-column:${a + 1}/span ${b - a + 1};grid-row:${l + 1};--c:${x.color}" ${x.id ? `data-ev="${x.id}"` : `data-href="${x.href}"`} title="${esc(x.label)}">${esc(x.label)}</button>`).join("")}</div>
    </div>`;
  }

  function render() {
    const [y, m] = month.split("-").map(Number);
    const first = new Date(y, m - 1, 1), ws0 = addD(iso(first), -first.getDay());
    const last = iso(new Date(y, m, 0)), all = items();
    let weeks = "";
    for (let ws = ws0; ws <= last; ws = addD(ws, 7)) weeks += week(ws, all, month);
    el.innerHTML = `<div class="hd-head"><h2>${y}년 ${m}월</h2>
        <span class="hc-nav"><button class="hd-lk" data-mv="-1" aria-label="이전 달">‹</button><button class="hd-lk" data-mv="0">오늘</button><button class="hd-lk" data-mv="1" aria-label="다음 달">›</button></span>
        <span class="hc-lg"><span><i style="--c:#16181d"></i>출시</span>${Object.entries(CH).map(([k, c]) => `<span><i style="--c:${c}"></i>${k} 기획전</span>`).join("")}</span>
        <button class="hc-add" data-day="${iso(new Date()).slice(0, 7) === month ? iso(new Date()) : month + "-01"}">+ 일정 추가</button></div>
      <div class="hc-wd">${WD.map((w) => `<span>${w}</span>`).join("")}</div>
      <div class="hc-grid">${loaded ? weeks : '<p class="muted hc-wait">일정을 불러오는 중…</p>'}</div>`;
  }

  // ---------- 일정 추가·수정 창 ----------
  function modal() {
    if (!form) { M.innerHTML = ""; return; }
    const f = form;
    const same = f.id ? [] : items().filter((x) => x.s <= f.start && x.e >= f.start);
    M.innerHTML = `<div class="pm-modal hc-modal" data-close>
      <form class="pm-dlg" id="hcForm" autocomplete="off">
        <div class="pm-dhead"><b>${f.id ? "일정 수정" : kd(f.start)}</b><button type="button" class="pm-x" data-close aria-label="닫기">✕</button></div>
        ${same.length ? `<div class="hc-same">${same.map((x) => `<button type="button" class="hc-si" ${x.id ? `data-ev="${x.id}"` : `data-href="${x.href}"`}><i style="--c:${x.color}"></i>${esc(x.label)}</button>`).join("")}</div>` : ""}
        <label class="pm-f"><span>일정 이름</span><input data-f="title" value="${esc(f.title)}" placeholder="예) 박주혁 연차, 거실장 촬영, 팀 회식" required></label>
        <label class="pm-f"><span>날짜</span><span class="pm-range"><input type="date" data-f="start" value="${f.start}" required><span class="muted">~</span><input type="date" data-f="end" value="${f.end}"></span></label>
        <div class="pm-f"><span>색상</span><div class="hc-colors">${COLORS.map(([c, n]) => `<button type="button" class="${f.color === c ? "on" : ""}" data-color="${c}" style="--c:${c}" aria-label="${n}" title="${n}"></button>`).join("")}</div></div>
        <label class="pm-f"><span>메모</span><textarea data-f="memo" rows="2" placeholder="필요하면 적어 주세요">${esc(f.memo)}</textarea></label>
        <div class="pm-dfoot">${f.id ? `<button type="button" class="pm-del" id="hcDel">삭제</button>` : ""}<span></span><button type="button" class="btn" data-close>취소</button><button class="btn pm-save">${f.id ? "저장" : "추가"}</button></div>
      </form></div>`;
  }
  const grab = () => M.querySelectorAll("[data-f]").forEach((i) => (form[i.dataset.f] = i.value));
  function open(f) { form = f; modal(); M.querySelector('[data-f="title"]')?.focus(); }
  function close() { form = null; modal(); render(); }
  function openEvent(id) { const v = events.find((x) => x.id === id); if (v) open({ ...v, end: v.end || v.start, memo: v.memo || "" }); }

  el.addEventListener("click", (e) => {
    const t = e.target;
    const mv = t.closest("[data-mv]");
    if (mv) {
      const d = Number(mv.dataset.mv), [y, m] = month.split("-").map(Number);
      month = d ? iso(new Date(y, m - 1 + d, 1)).slice(0, 7) : iso(new Date()).slice(0, 7);
      return render();
    }
    const ev = t.closest("[data-ev]");
    if (ev) return openEvent(ev.dataset.ev);
    const hr = t.closest("[data-href]");
    if (hr) { location.hash = hr.dataset.href; return; }
    const day = t.closest("[data-day]");
    if (day) open({ title: "", start: day.dataset.day, end: day.dataset.day, color: COLORS[0][0], memo: "" });
  });
  M.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.classList.contains("hc-modal") || t.closest("button[data-close]")) return close();
    const c = t.closest("[data-color]");
    if (c) { grab(); form.color = c.dataset.color; return modal(); }
    const ev = t.closest("[data-ev]");
    if (ev) return openEvent(ev.dataset.ev);
    const hr = t.closest("[data-href]");
    if (hr) { form = null; modal(); location.hash = hr.dataset.href; return; }
    if (t.closest("#hcDel")) {
      if (!confirm(`'${form.title}' 일정을 지울까요?`)) return;
      try { await getJSON("/api/events/" + form.id, { method: "DELETE" }); events = events.filter((x) => x.id !== form.id); close(); } catch (er) { alert(er.message); }
    }
  });
  M.addEventListener("change", (e) => {
    // 시작일을 끝일보다 뒤로 옮기면 끝일도 같이
    if (e.target.dataset.f === "start") { const end = M.querySelector('[data-f="end"]'); if (end && end.value < e.target.value) end.value = e.target.value; }
  });
  M.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  M.addEventListener("submit", async (e) => {
    e.preventDefault();
    grab();
    const body = { title: form.title, start: form.start, end: form.end, color: form.color, memo: form.memo };
    try {
      const v = await getJSON(form.id ? "/api/events/" + form.id : "/api/events", { method: form.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      events = form.id ? events.map((x) => (x.id === v.id ? v : x)) : [...events, v];
      close();
    } catch (er) { alert(er.message); }
  });

  render();
  window.homeCal = { el, refresh };
})();
