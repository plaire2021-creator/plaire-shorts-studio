// 홈 화면(#/) = 한눈에 보는 두 카드: 이번 주 업무 달성(/api/plans) + 브랜드별 월간 목표 매출 달성률(/api/goals)
(function () {
  const D = document.getElementById("homeDash");
  if (!D) return;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const WD = ["일", "월", "화", "수", "목", "금", "토"];
  const md = (d) => { const t = new Date(d + "T00:00:00"); return `${t.getMonth() + 1}/${t.getDate()}`; };
  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const iso = (t) => `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
  // 금액: 1억 이상은 '2.31억', 그 아래는 '4,880만'
  const won = (v) => (v >= 1e8 ? (v / 1e8).toFixed(2).replace(/\.?0+$/, "") + "억" : Math.round(v / 1e4).toLocaleString() + "만");
  const BR = { "플레르가구": "플레르", "가즈다가구": "가즈다" };
  let plan = null, goals = null, month = iso(new Date()).slice(0, 7), editing = null, planErr = "", timer = null;

  async function getJSON(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "서버에 연결하지 못했어요");
    return j;
  }
  async function loadPlan() {
    try {
      const r = await getJSON("/api/plans");
      plan = r.plans[0] ? await getJSON("/api/plans/" + r.plans[0].id) : null;
      planErr = "";
    } catch (e) { planErr = e.message; }
  }
  async function loadGoals() {
    goals = { loading: true, month };
    render();
    try { goals = await getJSON("/api/goals?month=" + month); }
    catch (e) { goals = { month, error: e.message, targets: {}, actual: {}, through: {}, channels: [] }; }
  }
  window.homeDashOpen = async function () {
    await Promise.all([loadPlan(), loadGoals()]);
    render();
    clearInterval(timer);
    timer = setInterval(async () => {
      if (D.closest(".hidden") || editing) return;
      await loadPlan();
      render();
    }, 30000);
  };

  // ---------- 주간 업무 달성 ----------
  function ring(p, cls) {
    return `<div class="hd-ring ${cls || ""}" style="--p:${Math.min(p, 100)}"><b>${p}<small>%</small></b></div>`;
  }
  function planCard() {
    if (planErr) return `<section class="card hd-card"><h2>이번 주 업무</h2><p class="muted">${esc(planErr)}</p></section>`;
    if (!plan) return `<section class="card hd-card"><h2>이번 주 업무</h2><p class="muted">아직 올린 주간 업무 계획표가 없어요.</p><a class="hd-more" href="#/plan">주간 업무에서 계획표 올리기</a></section>`;
    const all = [], by = { plaire: [0, 0], gazda: [0, 0] };
    const cats = plan.rows.map((r) => {
      const its = [...r.plaire, ...r.gazda];
      for (const s of ["plaire", "gazda"]) for (const i of r[s]) { by[s][1]++; if (i.done) by[s][0]++; }
      all.push(...its);
      return { cat: r.cat, done: its.filter((i) => i.done).length, total: its.length };
    }).filter((c) => c.total);
    const done = all.filter((i) => i.done).length, p = pct(done, all.length);
    const today = iso(new Date());
    const off = plan.leave.flatMap((l) => (l.days?.[today] ? [`${l.name} ${l.days[today]}`] : []));
    const per = plan.period ? `${md(plan.period[0])} ~ ${md(plan.period[1])}` : "";
    return `<section class="card hd-card">
      <div class="hd-head"><h2>이번 주 업무</h2><span class="muted">${per}</span><a class="hd-more" href="#/plan">주간 업무 열기</a></div>
      <div class="hd-week">
        <div class="hd-week-sum">
          ${ring(p, p >= 100 ? "full" : "")}
          <div class="hd-count"><b>${done}</b> / ${all.length}건 완료</div>
          <div class="hd-split">
            <span><i class="dot pl"></i>플레르 ${by.plaire[0]}/${by.plaire[1]}</span>
            <span><i class="dot gz"></i>가즈다 ${by.gazda[0]}/${by.gazda[1]}</span>
          </div>
          <div class="hd-off">${off.length ? "오늘 휴가 · " + off.map(esc).join(", ") : "오늘 휴가 없음"}</div>
        </div>
        <div class="hd-cats">
          ${cats.map((c) => { const cp = pct(c.done, c.total); return `<div class="hd-cat ${cp >= 100 ? "full" : ""}"><span class="hd-cat-n">${esc(c.cat)}</span><span class="hd-bar"><i style="width:${cp}%"></i></span><span class="hd-cat-v">${c.done}/${c.total}</span></div>`; }).join("")}
        </div>
      </div>
    </section>`;
  }

  // ---------- 월간 목표 매출 ----------
  function brandPanel(brand) {
    const g = goals, chs = g.channels?.length ? g.channels : ["스마트스토어", "쿠팡", "오늘의집"];
    const t = g.targets?.[brand] || {}, a = g.actual?.[brand] || {};
    const tt = chs.reduce((s, c) => s + (t[c] || 0), 0), at = chs.reduce((s, c) => s + (a[c] || 0), 0);
    const p = pct(at, tt);
    // 같은 기간 목표: 주간 파일이 반영된 날까지의 비율만큼 (10/18까지 반영 → 31일 중 18일)
    const [y, m] = g.month.split("-").map(Number), dim = new Date(y, m, 0).getDate();
    const thr = g.through?.[brand];
    const upto = thr && thr.slice(0, 7) === g.month ? Number(thr.slice(8)) : thr && thr > g.month ? dim : 0;
    const pace = Math.round((upto / dim) * 100);
    const ahead = upto ? p - pace : null;
    if (editing === brand)
      return `<div class="hd-brand editing"><div class="hd-bhead"><b>${BR[brand]}</b><span class="muted">${m}월 목표 (원)</span></div>
        <div class="hd-edit">${chs.map((c) => `<label><span>${c}</span><input inputmode="numeric" data-tg="${c}" value="${t[c] ? t[c].toLocaleString() : ""}" placeholder="0"></label>`).join("")}</div>
        <div class="hd-eact"><button class="btn primary sm" data-gsave="${brand}">저장</button><button class="btn sm" data-gcancel>취소</button></div></div>`;
    return `<div class="hd-brand">
      <div class="hd-bhead"><b>${BR[brand]}</b><button class="hd-lk" data-gedit="${brand}">${tt ? "목표 수정" : "목표 넣기"}</button></div>
      ${tt ? `<div class="hd-big"><b>${p}<small>%</small></b><span>${won(at)} <em>/ ${won(tt)}</em></span></div>
      <div class="hd-track" title="채운 막대 = 달성, 세로선 = ${upto ? md(thr) + "까지 목표 진도" : ""}"><i style="width:${Math.min(p, 100)}%" class="${ahead != null && ahead < 0 ? "behind" : ""}"></i>${upto ? `<u style="left:${pace}%"></u>` : ""}</div>
      <div class="hd-pace">${upto ? (ahead >= 0 ? `<span class="up">진도보다 ${ahead}%p 앞서요</span>` : `<span class="down">진도보다 ${-ahead}%p 뒤져요</span>`) + `<span class="muted">${md(thr)}까지 반영</span>` : '<span class="muted">이번 달 주간 매출 통계가 아직 없어요</span>'}</div>
      <div class="hd-chs">${chs.map((c) => { const cp = pct(a[c] || 0, t[c] || 0); return `<div class="hd-ch"><span class="hd-ch-n">${c}</span><span class="hd-bar"><i style="width:${Math.min(cp, 100)}%"></i></span><span class="hd-ch-v">${t[c] ? cp + "%" : "-"}</span><span class="hd-ch-w muted">${won(a[c] || 0)} / ${t[c] ? won(t[c]) : "목표 없음"}</span></div>`; }).join("")}</div>
      ${a["자사몰"] ? `<div class="muted hd-extra">자사몰 ${won(a["자사몰"])} (목표 밖 별도)</div>` : ""}`
      : `<p class="muted hd-empty">${m}월 목표가 아직 없어요. 주간 업무 계획표의 '월간목표매출' 시트가 올라오면 자동으로 채워지고, 직접 넣을 수도 있어요.</p>`}
    </div>`;
  }
  function goalCard() {
    const [y, m] = month.split("-").map(Number);
    const body = goals?.loading ? `<div class="gen-load hd-load"><span class="gen-spin"></span><span>이번 달 매출을 모으는 중…</span></div>`
      : goals?.error && !Object.keys(goals.targets || {}).length ? `<p class="muted">${esc(goals.error)}</p>`
      : `<div class="hd-brands">${["플레르가구", "가즈다가구"].map(brandPanel).join("")}</div>${goals?.error ? `<p class="muted">${esc(goals.error)}</p>` : ""}`;
    return `<section class="card hd-card">
      <div class="hd-head"><h2>${y}년 ${m}월 목표 매출</h2><span class="muted">스마트스토어 · 쿠팡 · 오늘의집 합계</span>
        <span class="hd-mnav"><button class="hd-lk" data-mv="-1" aria-label="이전 달">‹</button><button class="hd-lk" data-mv="1" aria-label="다음 달">›</button></span></div>
      ${body}
    </section>`;
  }

  function render() {
    const t = new Date();
    D.innerHTML = `<div class="hd-top"><img class="home-logo" src="img/plaire-logo.png" alt="PLAIRE FURNITURE"><span class="muted">${t.getMonth() + 1}월 ${t.getDate()}일 ${WD[t.getDay()]}요일</span></div>
      ${planCard()}${goals ? goalCard() : ""}`;
  }

  D.addEventListener("click", async (e) => {
    const mv = e.target.closest("[data-mv]");
    if (mv) {
      const [y, m] = month.split("-").map(Number);
      month = iso(new Date(y, m - 1 + Number(mv.dataset.mv), 1)).slice(0, 7);
      editing = null;
      await loadGoals();
      return render();
    }
    const ed = e.target.closest("[data-gedit]");
    if (ed) { editing = ed.dataset.gedit; render(); return D.querySelector("[data-tg]")?.focus(); }
    if (e.target.closest("[data-gcancel]")) { editing = null; return render(); }
    const sv = e.target.closest("[data-gsave]");
    if (sv) {
      const targets = {};
      D.querySelectorAll("[data-tg]").forEach((i) => (targets[i.dataset.tg] = i.value.replace(/[^\d]/g, "")));
      try {
        goals.targets = await getJSON("/api/goals", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ month, brand: sv.dataset.gsave, targets }) });
        editing = null;
      } catch (er) { alert(er.message); }
      return render();
    }
  });
  // 목표 입력칸: 치는 대로 천 단위 쉼표, Enter = 저장
  D.addEventListener("input", (e) => {
    const i = e.target.closest("[data-tg]");
    if (!i) return;
    const n = i.value.replace(/[^\d]/g, "");
    i.value = n ? Number(n).toLocaleString() : "";
  });
  D.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.closest("[data-tg]")) D.querySelector("[data-gsave]")?.click();
    if (e.key === "Escape" && editing) { editing = null; render(); }
  });

  if (!location.hash.replace(/^#\/?/, "")) window.homeDashOpen();
})();
