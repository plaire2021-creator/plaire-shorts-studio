// 홈 화면 = 이번 주 업무판. 매주 올리는 'MS팀 주간업무계획표' 엑셀을 읽어 업무마다 체크·링크, 사람마다 휴가 표시.
// 서버: /api/plans (lib/plans.js, scripts/plan_parse.py)
(function () {
  const H = document.getElementById("homeBoard");
  const q = (s) => H.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const md = (d) => { const t = new Date(d + "T00:00:00"); return `${t.getMonth() + 1}/${t.getDate()}(${WD[t.getDay()]})`; };
  const isUrl = (s) => /^https?:\/\/\S+$/i.test(String(s || "").trim());
  let list = [], cur = null, members = [], editing = null, busy = false, timer = null, err = "";

  async function getJSON(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "서버에 연결하지 못했어요");
    return j;
  }
  async function refresh(keep) {
    const r = await getJSON("/api/plans");
    list = r.plans; members = r.members;
    const id = keep && cur && list.some((p) => p.id === cur.id) ? cur.id : list[0]?.id;
    cur = id ? await getJSON("/api/plans/" + id) : null;
  }
  window.homeOpen = async function () {
    try { await refresh(true); err = ""; } catch (e) { err = e.message; }
    render();
    clearInterval(timer);
    // 다른 사람이 체크한 것도 보이게 30초마다 다시 읽는다 (고치는 중이면 건너뜀)
    timer = setInterval(async () => {
      if (H.closest(".hidden") || busy || editing || document.activeElement?.closest("#homeBoard")) return;
      try { await refresh(true); render(); } catch {}
    }, 30000);
  };

  function item(it) {
    const ed = editing === it.id;
    return `<div class="hp-it ${it.done ? "done" : ""}">
      <label class="hp-chk"><input type="checkbox" data-done="${it.id}" ${it.done ? "checked" : ""}><span>${esc(it.t)}</span></label>
      ${it.link && !ed ? (isUrl(it.link) ? `<a class="hp-open" href="${esc(it.link)}" target="_blank" rel="noopener">열기 ↗</a>` : `<span class="hp-ltxt" title="${esc(it.link)}">${esc(it.link)}</span>`) : ""}
      ${ed ? `<input class="hp-link-in" data-link="${it.id}" value="${esc(it.link)}" placeholder="링크 붙여넣고 Enter">` : `<button class="hp-lk" data-editlink="${it.id}" title="${it.link ? "링크 바꾸기" : "링크 넣기"}">${it.link ? "✎" : "링크"}</button>`}
    </div>`;
  }
  function col(items, label) {
    return `<div class="hp-col"><span class="hp-brand">${label}</span>${items.length ? items.map(item).join("") : '<span class="muted hp-none">이번 주 업무 없음</span>'}</div>`;
  }
  function render() {
    if (!H) return;
    const up = `<label class="btn hp-up">계획표 올리기<input type="file" id="hpFile" accept=".xlsx" hidden></label>`;
    if (err) { H.innerHTML = `<div class="card"><p class="err">${esc(err)}</p></div>`; return; }
    if (!cur) {
      H.innerHTML = `<div class="hp-drop" id="hpDrop"><b>이번 주 업무 계획표를 올려 주세요</b><p class="muted">'MS팀 주간업무계획표' 엑셀을 여기에 끌어다 놓거나 버튼을 눌러 고르세요. 업무마다 체크하고 링크를 넣을 수 있게 정리해 드려요.</p>${up}${busy ? '<p class="muted">읽는 중…</p>' : ""}</div>`;
      return;
    }
    const items = cur.rows.flatMap((r) => [...r.plaire, ...r.gazda]), done = items.filter((i) => i.done).length;
    const p = items.length ? Math.round((done / items.length) * 100) : 0;
    const per = cur.period ? `${md(cur.period[0])} ~ ${md(cur.period[1])}` : "";
    H.innerHTML = `<div class="hp-head">
        <div><h2>이번 주 업무</h2><span class="muted">${per}${cur.file ? ` · ${esc(cur.file)}` : ""}</span></div>
        <div class="hp-tools">${list.length > 1 ? `<select id="hpWeek" aria-label="다른 주 보기">${list.map((x) => `<option value="${x.id}" ${x.id === cur.id ? "selected" : ""}>${x.period ? md(x.period[0]) + " 주" : x.id}</option>`).join("")}</select>` : ""}${up}</div>
      </div>
      ${busy ? '<p class="muted">계획표를 읽는 중…</p>' : ""}
      <div class="hp-sum card">
        <div class="hp-prog"><b>${p}%</b><span class="muted">완료 ${done} / ${items.length}건</span><span class="bar"><i style="width:${p}%"></i></span></div>
        <div class="hp-leave"><span class="muted">휴가</span>${cur.leave.map((l) => `<button class="hp-lv ${l.on ? "on" : ""}" data-leave="${esc(l.name)}" title="누르면 휴가 표시를 ${l.on ? "풀어요" : "해요"}">${esc(l.name)}${l.on ? ` <em>${esc(l.memo || "휴가")}</em>` : ""}</button>`).join("")}</div>
      </div>
      <div class="hp-board">${cur.rows.map((r) => `<section class="hp-row">
        <div class="hp-cat"><b>${esc(r.cat)}</b>${r.note ? `<small>${esc(r.note)}</small>` : ""}${r.ref ? (isUrl(r.ref) ? `<a class="hp-open" href="${esc(r.ref)}" target="_blank" rel="noopener">참고 링크 ↗</a>` : `<small class="hp-ref">${esc(r.ref)}</small>`) : ""}</div>
        <div class="hp-cols ${r.common ? "one" : ""}">${r.common ? col(r.plaire, "공통") : col(r.plaire, "플레르가구") + col(r.gazda, "가즈다가구")}</div>
      </section>`).join("")}</div>`;
    if (editing) H.querySelector(`[data-link="${editing}"]`)?.focus();
  }

  async function upload(f) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) return alert("엑셀(.xlsx) 파일만 넣을 수 있어요");
    busy = true; render();
    const fd = new FormData(); fd.append("file", f);
    try {
      const p = await getJSON("/api/plans", { method: "POST", body: fd });
      const r = await getJSON("/api/plans"); list = r.plans; members = r.members; cur = p; err = "";
    } catch (e) { alert(e.message); }
    busy = false; render();
  }
  function find(id) { for (const r of cur.rows) for (const it of [...r.plaire, ...r.gazda]) if (it.id === id) return it; }
  async function patch(id, body) {
    const it = find(id), before = { ...it };
    Object.assign(it, body); render();
    try { await getJSON(`/api/plans/${cur.id}/item`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ item: id, ...body }) }); }
    catch (e) { Object.assign(it, before); render(); alert("저장하지 못했어요: " + e.message); }
  }
  function saveLink(el) {
    let v = el.value.trim();
    if (v && !/^https?:\/\//i.test(v) && /^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) v = "https://" + v;
    editing = null;
    if (v !== find(el.dataset.link).link) patch(el.dataset.link, { link: v }); else render();
  }

  H?.addEventListener("click", async (e) => {
    const lk = e.target.closest("[data-editlink]");
    if (lk) { editing = lk.dataset.editlink; render(); return; }
    const lv = e.target.closest("[data-leave]");
    if (lv) {
      const l = cur.leave.find((x) => x.name === lv.dataset.leave); l.on = !l.on; render();
      try { cur.leave = await getJSON(`/api/plans/${cur.id}/leave`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: l.name, on: l.on }) }); render(); }
      catch (er) { l.on = !l.on; render(); alert(er.message); }
    }
  });
  H?.addEventListener("change", async (e) => {
    const el = e.target;
    if (el.id === "hpFile") return upload(el.files[0]);
    if (el.id === "hpWeek") { cur = await getJSON("/api/plans/" + el.value); editing = null; return render(); }
    if (el.dataset.done) return patch(el.dataset.done, { done: el.checked });
  });
  H?.addEventListener("keydown", (e) => {
    if (e.target.dataset?.link && e.key === "Enter" && !e.isComposing) { e.preventDefault(); saveLink(e.target); }
    if (e.target.dataset?.link && e.key === "Escape") { editing = null; render(); }
  });
  H?.addEventListener("focusout", (e) => { if (e.target.dataset?.link && editing) saveLink(e.target); });
  // 엑셀을 홈 화면 어디에나 끌어다 놓으면 올린다
  H?.addEventListener("dragover", (e) => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); H.classList.add("drag"); } });
  H?.addEventListener("dragleave", (e) => { if (!H.contains(e.relatedTarget)) H.classList.remove("drag"); });
  H?.addEventListener("drop", (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); H.classList.remove("drag"); upload(e.dataTransfer.files[0]); });

  // 주소가 처음부터 홈이면 app.js의 첫 화면 전환이 이 파일보다 먼저 돌아서 여기서 연다
  if (!location.hash.replace(/^#\/?/, "")) window.homeOpen();
})();
