// '기획전 관리' 화면(#/promo): 스마트스토어·쿠팡·오늘의집 세 칸에 기획전 카드. 카드를 누르면 고치는 창.
// 서버: /api/promos (lib/promos.js). 홈 카드(dash.js)도 window.promoPhase로 같은 상태 이름을 쓴다
(function () {
  const V = document.getElementById("promoView");
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const md = (d) => { const t = new Date(d + "T00:00:00"); return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`; };
  const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  const CH_KEY = { "스마트스토어": "ss", "쿠팡": "cp", "오늘의집": "oh" };

  // 날짜와 신청 상태로 지금 단계를 정한다: 진행 중 > 진행 예정 > 결과 대기 > 신청 전, 끝났거나 미선정이면 '지난 기획전'
  function phase(it, today = iso(new Date())) {
    if (it.status === "미선정") return { k: "off", t: "미선정", past: true };
    if (it.end && it.end < today) return { k: "done", t: "종료", past: true };
    if (it.status === "선정") return it.start && it.start > today ? { k: "soon", t: "선정 · 진행 예정", o: 1 } : { k: "live", t: "진행 중", o: 0 };
    if (it.status === "신청 완료") return { k: "wait", t: "결과 대기", o: 2 };
    return { k: "todo", t: it.apply_by ? `신청 마감 ${md(it.apply_by)}` : "신청 전", o: 3 };
  }
  const period = (it) => (it.start || it.end ? `${it.start ? md(it.start) : "?"} – ${it.end ? md(it.end) : "?"}` : "기간 미정");
  window.promoPhase = phase;
  window.promoPeriod = period;
  window.promoChKey = CH_KEY;
  if (!V) return;

  let data = null, err = "", openPast = {}, edit = null; // edit = 고치는 중인 기획전 사본 (새로 만들 땐 id 없음)

  async function getJSON(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "서버에 연결하지 못했어요");
    return j;
  }
  async function load() {
    try { data = await getJSON("/api/promos"); err = ""; } catch (e) { err = e.message; }
  }
  window.promoOpen = async function () {
    await load();
    render();
  };

  function card(it) {
    const p = phase(it), pr = it.products || [];
    return `<button class="pm-card ${p.past ? "past" : ""}" data-open="${it.id}">
      <span class="pm-top"><b>${esc(it.name)}</b><span class="pm-pill ${p.k}">${esc(p.t)}</span></span>
      <span class="pm-date">${period(it)}</span>
      ${pr.length ? `<span class="pm-prods">${pr.slice(0, 3).map((x) => `<i>${esc(x)}</i>`).join("")}${pr.length > 3 ? `<i class="more">+${pr.length - 3}</i>` : ""}</span>` : ""}
      ${it.memo || it.owner ? `<span class="pm-foot"><span>${esc((it.memo || "").split("\n").pop())}</span>${it.owner ? `<em>${esc(it.owner)}</em>` : ""}</span>` : ""}
    </button>`;
  }
  function column(ch) {
    const all = data.items.filter((x) => x.ch === ch);
    const now = all.filter((x) => !phase(x).past).sort((a, b) => phase(a).o - phase(b).o || (a.start || a.apply_by || "9").localeCompare(b.start || b.apply_by || "9"));
    const past = all.filter((x) => phase(x).past).sort((a, b) => (b.end || "").localeCompare(a.end || ""));
    return `<section class="pm-col">
      <div class="pm-chead"><i class="pm-dot ${CH_KEY[ch]}"></i><b>${ch}</b><span class="muted">${now.length}</span><button class="pm-add" data-add="${ch}" aria-label="${ch} 기획전 추가">+</button></div>
      <div class="pm-list">${now.length ? now.map(card).join("") : `<button class="pm-empty" data-add="${ch}">+ 기획전 추가</button>`}</div>
      ${past.length ? `<button class="pm-pastbtn" data-past="${ch}">지난 기획전 ${past.length} ${openPast[ch] ? "▴" : "▾"}</button>${openPast[ch] ? `<div class="pm-list">${past.map(card).join("")}</div>` : ""}` : ""}
    </section>`;
  }

  function editor() {
    const e = edit, st = data.statuses, mem = data.members;
    return `<div class="pm-modal" data-close>
      <form class="pm-dlg" id="pmForm" autocomplete="off">
        <div class="pm-dhead"><b>${e.id ? "기획전 수정" : "새 기획전"}</b><button type="button" class="pm-x" data-close aria-label="닫기">✕</button></div>
        <div class="pm-seg">${data.channels.map((c) => `<button type="button" class="${e.ch === c ? "on" : ""}" data-set="ch" data-v="${c}"><i class="pm-dot ${CH_KEY[c]}"></i>${c}</button>`).join("")}</div>
        <label class="pm-f"><span>기획전 이름</span><input data-f="name" value="${esc(e.name)}" placeholder="예) 11월 블랙프라이데이 기획전" required></label>
        <div class="pm-f2">
          <label class="pm-f"><span>진행 기간</span><span class="pm-range"><input type="date" data-f="start" value="${e.start}"><span class="muted">~</span><input type="date" data-f="end" value="${e.end}"></span></label>
          <label class="pm-f"><span>신청 마감</span><input type="date" data-f="apply_by" value="${e.apply_by}"></label>
        </div>
        <div class="pm-f"><span>신청 상태</span><div class="pm-seg st">${st.map((s) => `<button type="button" class="${e.status === s ? "on" : ""}" data-set="status" data-v="${s}">${s}</button>`).join("")}</div></div>
        <div class="pm-f"><span>${e.status === "선정" ? "선정 제품" : "신청 제품"}</span>
          <div class="pm-chips">${e.products.map((p, i) => `<span>${esc(p)}<button type="button" data-delp="${i}" aria-label="${esc(p)} 빼기">✕</button></span>`).join("")}<input id="pmProd" placeholder="${e.products.length ? "" : "제품명 쓰고 Enter"}"></div></div>
        <div class="pm-f2">
          <label class="pm-f"><span>담당</span><select data-f="owner"><option value="">-</option>${mem.map((m) => `<option ${e.owner === m ? "selected" : ""}>${m}</option>`).join("")}</select></label>
          <label class="pm-f"><span>링크</span><input data-f="link" value="${esc(e.link)}" placeholder="기획전·신청 페이지 주소"></label>
        </div>
        <label class="pm-f"><span>진행 메모</span><textarea data-f="memo" rows="3" placeholder="예) 10/24 쿠폰 세팅 완료, 배너 시안 요청">${esc(e.memo)}</textarea></label>
        <div class="pm-dfoot">${e.id ? `<button type="button" class="pm-del" id="pmDel">삭제</button>` : ""}${e.id && e.link ? `<a class="pm-lnk" href="${esc(e.link)}" target="_blank" rel="noopener">링크 열기 ↗</a>` : ""}<span></span><button type="button" class="btn" data-close>취소</button><button class="btn pm-save">저장</button></div>
      </form>
    </div>`;
  }

  function render() {
    if (err) { V.innerHTML = `<div class="pm-wrap"><p class="muted">${esc(err)}</p></div>`; return; }
    if (!data) return;
    V.innerHTML = `<div class="pm-wrap"><div class="pm-cols">${data.channels.map(column).join("")}</div></div>${edit ? editor() : ""}`;
  }
  // 입력 중인 값을 edit에 담아 둔다 (다시 그려도 지워지지 않게)
  function grab() {
    if (!edit) return;
    V.querySelectorAll("[data-f]").forEach((i) => (edit[i.dataset.f] = i.value));
  }
  function addProduct() {
    const i = V.querySelector("#pmProd");
    const v = i?.value.trim();
    if (!v) return false;
    grab();
    for (const p of v.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)) if (!edit.products.includes(p)) edit.products.push(p);
    render();
    V.querySelector("#pmProd")?.focus();
    return true;
  }

  V.addEventListener("click", async (e) => {
    const t = e.target;
    if (t.classList.contains("pm-modal") || t.closest("button[data-close]")) { edit = null; return render(); }
    const add = t.closest("[data-add]");
    if (add) { edit = { ch: add.dataset.add, name: "", start: "", end: "", apply_by: "", status: "신청 전", products: [], owner: "", link: "", memo: "" }; render(); return V.querySelector('[data-f="name"]')?.focus(); }
    const op = t.closest("[data-open]");
    if (op) { const it = data.items.find((x) => x.id === op.dataset.open); edit = JSON.parse(JSON.stringify({ ...it, products: it.products || [] })); return render(); }
    const pb = t.closest("[data-past]");
    if (pb) { openPast[pb.dataset.past] = !openPast[pb.dataset.past]; return render(); }
    const set = t.closest("[data-set]");
    if (set) { grab(); edit[set.dataset.set] = set.dataset.v; return render(); }
    const dp = t.closest("[data-delp]");
    if (dp) { grab(); edit.products.splice(Number(dp.dataset.delp), 1); return render(); }
    if (t.closest("#pmDel")) {
      if (!confirm(`'${edit.name}' 기획전을 지울까요?`)) return;
      try { await getJSON("/api/promos/" + edit.id, { method: "DELETE" }); edit = null; await load(); } catch (er) { alert(er.message); }
      return render();
    }
  });
  V.addEventListener("keydown", (e) => {
    if (e.target.id === "pmProd" && e.key === "Enter") { e.preventDefault(); addProduct(); }
    if (e.target.id === "pmProd" && e.key === "Backspace" && !e.target.value && edit.products.length) { grab(); edit.products.pop(); render(); V.querySelector("#pmProd")?.focus(); }
    if (e.key === "Escape" && edit) { edit = null; render(); }
  });
  V.addEventListener("submit", async (e) => {
    e.preventDefault();
    addProduct();
    grab();
    const body = { ch: edit.ch, name: edit.name, start: edit.start, end: edit.end, apply_by: edit.apply_by, status: edit.status, products: edit.products, owner: edit.owner, link: edit.link, memo: edit.memo };
    if (body.start && body.end && body.end < body.start) return alert("끝나는 날이 시작일보다 빨라요");
    try {
      await getJSON(edit.id ? "/api/promos/" + edit.id : "/api/promos", { method: edit.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      edit = null;
      await load();
    } catch (er) { alert(er.message); }
    render();
  });

  if (location.hash.replace(/^#\/?/, "") === "promo") window.promoOpen();
})();
