(function(){
// 팀장님 매뉴얼의 화면 코드를 옮기고, 저장만 서버(/api/launch)로 바꿨다 — 팀 모두가 같은 내용을 본다
let S = null, PID = null, VER = 0, rev = 0, savedRev = 0, saving = false, saveErr = '', saveTimer = null;
let ART = null, readOnly = false, dirty = false, tab = 'dash', openSt = new Set(), workMode = 'prog', goalMode = 'goal', OWN = '', calMonth = null, perfCp = 'W1', resetArm = false, delPlat = -1, editPeriod = -1;
let calHide = {}, calColor = 'st';
let expSel = 'all', expEdit = '', expMonth = null, expHide = {};
let CF = {}, SORT = {key:'step', dir:1}, openCol = null, cfQ = '';
const STS = ['대기','진행중','완료','보류'];
const PCOL = ['var(--accent)','var(--x0)','var(--warn)','var(--x2)','var(--x3)','var(--info)','var(--muted)','var(--ok)'];
const pcol = ci => PCOL[ci % PCOL.length];
const STC = {완료:'var(--ok)',진행중:'var(--info)',대기:'var(--accent)',보류:'var(--warn)',지연:'var(--bad)'};
const ROOT = document.getElementById('launchView');
const OWNERS = ['MS팀','김은하','박주혁','방채원'];
const BRANDS = ['플레르가구','가즈다가구']; // 서버 lib/launch.js와 같게
let newBrand = (()=>{ try{ return BRANDS.includes(localStorage.getItem('fleur-launch-brand')) ? localStorage.getItem('fleur-launch-brand') : BRANDS[0]; }catch(_){ return BRANDS[0]; } })();
const brandTag = b => `<span class="tag ${b==='가즈다가구'?'amber':'blue'} ln-btag">${b==='가즈다가구'?'가즈다':'플레르'}</span>`;
const prodBrand = () => S.product.brand || S.product.sheet?.matches?.[0]?.brand || ''; // 예전 제품은 시트에서 찾은 브랜드로 // 담당은 이 중에서 고른다 (서버 lib/launch.js와 같게)
function ownerSel(id, attrs, v){
  const list = v && !OWNERS.includes(v) ? [...OWNERS, v] : OWNERS; // 예전에 손으로 적은 이름도 남겨 둔다
  return `<select id="${id}" ${attrs} aria-label="담당">${v?'':'<option value="" selected>미정</option>'}${list.map(o=>`<option ${o===v?'selected':''}>${esc(o)}</option>`).join('')}</select>`;
}
const $ = s => ROOT.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const won = n => (Math.round(n)||0).toLocaleString('ko-KR');
const man = n => { n = Math.round(n)||0; return (n/10000).toLocaleString('ko-KR',{maximumFractionDigits:1})+'만'; };
const pct = (a,b) => b ? Math.round(a/b*100) : 0;
const parse = s => { const [y,m,d] = s.split('-').map(Number); return Date.UTC(y,m-1,d); };
const fmt = t => new Date(t).toISOString().slice(0,10);
const addD = (s,n) => fmt(parse(s)+n*864e5);
const md = s => { const d=new Date(parse(s)); return (d.getUTCMonth()+1)+'/'+d.getUTCDate(); };
const WD = ['일','월','화','수','목','금','토'];
const wd = s => WD[new Date(parse(s)).getUTCDay()];
const kd = s => { const d=new Date(parse(s)); return (d.getUTCMonth()+1)+'월 '+d.getUTCDate()+'일'; };
const TODAY = (()=>{ const n=new Date(); return n.getFullYear()+'-'+String(n.getMonth()+1).padStart(2,'0')+'-'+String(n.getDate()).padStart(2,'0'); })();
const dnum = s => Math.round((parse(s)-parse(S.product.launch))/864e5);
const dlabel = n => n===0 ? 'D-day' : (n>0 ? 'D+'+n : 'D'+n);
const tStart = t => addD(S.product.launch, t.s);
const tEnd = t => addD(S.product.launch, t.e);
const isLate = t => t.st!=='완료' && t.st!=='보류' && tEnd(t) < TODAY;
const stepNo = n => String(n).padStart(2,'0');
const stepName = n => S.steps[n-1] || '';
// 플랫폼별 리스트의 항목 하나 = 진행현황 업무 하나 (같은 객체를 함께 씀)
const defp = (o,k,v) => Object.defineProperty(o,k,{value:v,writable:true,configurable:true,enumerable:false});
function TK(){ const out=[]; S.checklists.forEach((c,ci)=>c.items.forEach((it,ii)=>{ defp(it,'ch',c.name); defp(it,'_ci',ci); defp(it,'_ii',ii); out.push(it); })); return out; }
const bare = n => String(n||'').replace(/^\s*\[\d+\]\s*/,'');
const stepOfName = n => { const m=String(n||'').match(/^\s*\[(\d+)\]/); return m?+m[1]:0; };
const withStep = (n,st) => st ? '['+stepNo(st)+'] '+bare(n) : bare(n);
function newItem(name, step){ step = step || stepOfName(name); const r=stepRange(step)||{s:0,e:30};
  return {name: withStep(name, step), step, owner:S.product.team, s:r.s, e:r.e, st:'대기', memo:'', rec: weeklyStep(step)?'weekly':null}; }
function setDone(it, on){ if(on){ if(it.st!=='완료') defp(it,'_prev',it.st); it.st='완료'; } else if(it.st==='완료'){ it.st=(it._prev&&it._prev!=='완료')?it._prev:'대기'; } }
// 예전 형식(항목 t/done + 별도 tasks) 저장본을 열었을 때
function migrate(){ S.checklists.forEach(c=>c.items.forEach(it=>{ if(it.name==null){ it.name=it.t; delete it.t; }
  if(it.step==null) it.step=stepOfName(it.name); if(!it.st) it.st=it.done?'완료':'대기'; delete it.done;
  if(it.s==null){ it.s=0; it.e=30; } if(it.owner==null) it.owner=S.product.team; if(it.memo==null) it.memo=''; if(it.rec===undefined) it.rec=weeklyStep(it.step)?'weekly':null; }));
  delete S.tasks; }
const stepTasks = n => TK().filter(t=>t.step===n);
// 단계 번호를 박아 두지 않는다: 이름에 '체험단'이 든 단계 = 체험단 탭에서 관리, '체크'가 든 단계 = 매주 월요일 반복
const EXPN = () => S.steps.findIndex(n=>n.includes('체험단'))+1 || -1;
const weeklyStep = n => /체크/.test(S.steps[n-1]||'');
function stepRange(n){ const ts=stepTasks(n); if(!ts.length) return null; return {s:Math.min(...ts.map(t=>t.s)), e:Math.max(...ts.map(t=>t.e))}; }
function stepStatus(n){ const ts=stepTasks(n); if(!ts.length) return '대기';
  if(ts.every(t=>t.st==='완료')) return '완료'; if(ts.every(t=>t.st==='완료'||t.st==='보류')) return ts.some(t=>t.st==='완료') ? '완료' : '보류'; if(ts.some(isLate)) return '지연'; if(ts.some(t=>t.st==='진행중'||t.st==='완료'||t.st==='보류')) return '진행중'; if(ts.every(t=>t.st==='보류')) return '보류'; return '대기'; }
const EXPST = ['대기','진행중','완료','보류'];
const PST = ['섭외중','확정','발송완료','게시완료','취소'];
const xStart = (x,st) => addD(x.start, st.s);
const xEnd = (x,st) => addD(x.start, st.e);
const xLate = (x,st) => xOn(x) && st.st!=='완료' && st.st!=='보류' && xEnd(x,st) < TODAY;
const GO = ['진행','검토중','미진행'];
const goOf = x => x.go || '검토중';
const xOn = x => goOf(x) !== '미진행';
const segGo = (xi,x) => `<span class="lseg" role="group" aria-label="${esc(x.name)} 진행 여부">${GO.map(g=>`<button data-go="${g}" data-goi="${xi}" aria-pressed="${goOf(x)===g}">${g}</button>`).join('')}</span>`;
const posts = x => (x.results||[]).length; // 체험단 결과에 적은 게시 수
const pLate = p => p.plan && p.plan < TODAY && p.st!=='게시완료' && p.st!=='취소';
function expRange(){ let a=null,b=null; S.exp.filter(xOn).forEach(x=>x.steps.forEach(st=>{ const s1=xStart(x,st), e1=xEnd(x,st); if(!a||s1<a)a=s1; if(!b||e1>b)b=e1; })); return a?{a,b}:null; }
const kdr = (a,b) => kd(a)+(b&&b!==a?' ~ '+kd(b):'');
const periodTxt = t => kd(tStart(t))+(t.e!==t.s?' ~ '+kd(tEnd(t)):'');

function markDirty(){ dirty = true; rev++; renderTop(); queueSave(); }
function renderTop(){
  if(!S) return;
  setCrumb(S.product.name);
  const m = $('#lnSave'); if(!m) return;
  m.textContent = saveErr || (saving ? '저장 중…' : dirty ? '저장 대기 중…' : '모두 저장됨');
  m.className = 'tag ' + (saveErr ? 'red' : (saving||dirty) ? 'amber' : 'green');
}
function renderInfo(){
  $('#lnInfo').innerHTML = `<div class="li-head"><h3>제품 정보</h3><select id="pf-brand" class="li-brand ${prodBrand()==='가즈다가구'?'gz':''}" aria-label="브랜드">${prodBrand()?'':'<option value="" selected>브랜드 고르기</option>'}${BRANDS.map(b=>`<option ${b===prodBrand()?'selected':''}>${b}</option>`).join('')}</select>${S.product.memo?`<span class="tag amber" title="${esc(S.product.memo)}">예시</span>`:''}<span class="tag" id="lnSave"></span></div>
  <div class="prodform li-form">
    <label>제품명<input id="pf-name" type="text" value="${esc(S.product.name)}"></label>
    <label>상품 코드 (옵션코드)<input id="pf-code" type="text" class="${S.product.code?'':'need'}" value="${esc(S.product.code||'')}" placeholder="예: 블랑누아거실장2600"></label>
    <label>출시일 (상품 등록일, D-day)<input id="pf-launch" type="date" value="${S.product.launch}"></label>
    <label>카테고리<input id="pf-cat" type="text" value="${esc(S.product.category)}"></label>
  </div><p class="note li-need ${S.product.code?'':'on'}">상품 코드(구글 시트 「상품등록 현황」의 옵션코드)를 꼭 넣어 주세요. 넣어야 시트를 보고 상품등록이 자동으로 체크돼요.</p>`;
}
// 상품 코드로 구글 시트(플레르가구·가즈다가구 상품등록 현황)에서 찾은 결과를 화면에 띄우지 않고 제품에만 저장해 둔다
// (S.product.sheet.matches[].channels = 네이버·쿠팡·오늘의집 등록 여부 → 나중에 플랫폼별 상품등록 완료 확인에 쓸 것). sheetBox()는 지금 안 씀
let lookingUp = false, lookErr = '';
function sheetBox(){
  const sh = S.product.sheet;
  if(lookingUp) return `<div class="li-sheet"><p class="note">구글 시트에서 '${esc(S.product.code)}'을(를) 찾는 중…</p></div>`;
  if(lookErr) return `<div class="li-sheet bad"><p>${esc(lookErr)}</p><button class="btn small" id="lnLookup">다시 찾기</button></div>`;
  if(!S.product.code) return `<div class="li-sheet"><p class="note">상품 코드를 넣으면 구글 시트 「플레르가구 상품등록 현황」·「가즈다가구 상품등록 현황」에서 어떤 제품인지 찾아 보여 줘요.</p></div>`;
  if(!sh || sh.query !== S.product.code) return `<div class="li-sheet"><button class="btn small" id="lnLookup">구글 시트에서 찾기</button></div>`;
  if(!sh.matches.length) return `<div class="li-sheet bad"><p>두 시트 어디에도 '${esc(sh.query)}'이(가) 없어요. 옵션코드를 다시 확인해 주세요.</p><button class="btn small" id="lnLookup">다시 찾기</button></div>`;
  const brands = [...new Set(sh.matches.map(m=>m.brand))], names = [...new Set(sh.matches.map(m=>m.name.replace(/,\s*[^,]*$/,'')))];
  return `<div class="li-sheet"><div class="ls-head"><b>구글 시트 확인</b>${brands.map(b=>`<span class="tag ${b==='가즈다가구'?'amber':'blue'}">${esc(b)}</span>`).join('')}<span class="ls-name">${esc(names[0])}${names.length>1?` 외 ${names.length-1}개`:''}</span><span class="note">옵션 ${sh.total}개${sh.total>sh.matches.length?` 중 ${sh.matches.length}개 표시`:''} · ${sh.by}로 찾음 · ${esc(String(sh.at||'').slice(5,16).replace('T',' '))} 기준</span><button class="btn small" id="lnLookup">새로 확인</button></div>
    <div class="tw"><table class="ls-tbl"><thead><tr><th>옵션코드</th><th>사이즈</th><th>색상</th>${sh.matches[0].channels.map(c=>`<th class="num">${c.ch}</th>`).join('')}</tr></thead><tbody>${sh.matches.map(m=>`<tr><td>${esc(m.code)}</td><td>${esc(m.size)}</td><td>${esc(m.color)}</td>${m.channels.map(c=>`<td class="num">${c.on?`<span class="pill st-완료">등록</span> ${esc(c.price)}`:'<span class="note">미등록</span>'}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
// 시트에서 네이버·쿠팡·오늘의집 등록 여부가 모든 옵션 O면, 그 채널의 '상품등록' 업무를 완료로 바꾼다 (완료를 되돌리지는 않는다)
// 상품등록 업무는 사람이 체크하지 않는다 — 구글 시트(상품등록 현황)의 등록 여부(O)를 그대로 따라간다
// 업무 이름(없으면 채널 이름)으로 어느 스토어인지 정한다
const SHEET_CH = [['스마트스토어','네이버'],['네이버','네이버'],['쿠팡','쿠팡'],['오늘의집','오늘의집'],['11번가','11번가'],['ESM','ESM'],['롯데온','롯데온'],['한샘몰','한샘몰']];
const regTask = it => (S.steps[it.step-1]||'').includes('상품등록') || bare(it.name).includes('상품등록');
const sheetChOf = (it, chName) => { const nm = bare(it.name), f = SHEET_CH.find(([k])=>nm.includes(k)) || SHEET_CH.find(([k])=>String(chName||'').includes(k)); return f && f[1]; };
const sheetCh = (it,c) => sheetChOf(it, c.name);
const bySheet = (it, chName) => regTask(it) && !!sheetChOf(it, chName ?? it.ch); // 시트가 정하는 업무인지
function sheetPending(){ return S.checklists.some(c=>c.items.some(it=>it.st!=='완료' && bySheet(it, c.name))); }
function applySheet(){
  const ms = (S.product.sheet?.matches || []).filter(m=>!prodBrand() || m.brand===prodBrand()), done = [];
  if(!ms.length) return done;
  S.checklists.forEach(c=>c.items.forEach(it=>{
    const k = bySheet(it, c.name) && sheetCh(it,c); if(!k) return;
    const on = ms.every(m=>(m.channels.find(x=>x.ch===k)||{}).on);
    if(on && it.st!=='완료'){ setDone(it, true); done.push(bare(it.name)); }
    else if(!on && it.st==='완료'){ it.st = '대기'; } // 시트에서 O가 빠지면 체크도 풀린다
  }));
  return done;
}
async function lookupCode(){
  const code = (S.product.code||'').trim(); if(!code) return;
  const pid = PID; lookingUp = true; lookErr = ''; render();
  try{
    const r = await fetch('/api/launch/lookup?code=' + encodeURIComponent(code));
    const j = await r.json().catch(()=>({}));
    if(pid !== PID) return;
    if(!r.ok) throw new Error(j.error || '구글 시트를 읽지 못했어요');
    S.product.sheet = { query: code, by: j.by, total: j.total, matches: j.matches, at: new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString() };
    const auto = applySheet();
    markDirty();
  }catch(e){ if(pid === PID) lookErr = e.message; }
  finally{ if(pid === PID){ lookingUp = false; render(); } }
}

/* ---------- 계산 ---------- */
function chCalc(c){
  const sales = c.price*c.qty, mg = c.margin*c.qty, cost = c.ad+c.promo+c.etc;
  const be = c.margin>0 ? c.price/c.margin : 0;
  return {sales, mg, cost, net: mg-cost, ratio: sales? cost/sales:0, be, tgt: be*S.roasMult};
}
function chTotals(){
  const t = {qty:0,sales:0,mg:0,cost:0,ad:0,net:0};
  S.channels.forEach(c=>{ const r=chCalc(c); t.qty+=c.qty; t.sales+=r.sales; t.mg+=r.mg; t.cost+=r.cost; t.ad+=c.ad; t.net+=r.net; });
  return t;
}
function perfRow(cp, c){
  const d = (S.perf[cp]||{})[c.name] || {qty:0,sales:0,ad:0,adSales:0,cost:0};
  const days = S.checkpoints.find(x=>x.key===cp).d;
  const goal = c.qty*days/30;
  const roas = d.ad>0 ? d.adSales/d.ad : null;
  const r = chCalc(c);
  const net = d.qty*c.margin - d.ad - d.cost;
  let j = '점검';
  if(d.ad>0){ j = roas>=r.tgt ? '확대' : (roas>=r.be ? '유지' : '하향'); }
  else if(d.qty>=goal && goal>0) j = '유지';
  return {d, goal, roas, be:r.be, tgt:r.tgt, net, j, ach: goal? d.qty/goal : 0};
}
function hasPerf(cp){ const p=S.perf[cp]; return p && Object.values(p).some(v=>v.qty||v.sales||v.ad); }
function jLabel(j){ return {확대:'예산 확대',유지:'유지',하향:'입찰 하향',점검:'원인 점검'}[j]; }

/* ---------- 탭: 오늘 (지금 할 일부터) ---------- */
const mine = t => !OWN || (t.owner||'')===OWN;   // 담당 필터 (지금은 늘 전체)
const xMine = st => !OWN || (st.owner||'')===OWN;
const dLeft = d => Math.round((parse(d)-parse(TODAY))/864e5);
function expStepStatus(){ const all=S.exp.filter(xOn).flatMap(x=>x.steps.map(a=>({x,a})));
  if(!all.length) return '대기'; if(all.every(o=>o.a.st==='완료')) return '완료'; if(all.some(o=>xLate(o.x,o.a))) return '지연'; if(all.some(o=>o.a.st!=='대기')) return '진행중'; return '대기'; }
// 단계마다 그 일을 하는 업무 도구로 바로 가는 버튼 (단계 이름으로 고른다, 맞는 도구가 없으면 버튼 없음)
const TOOL_LINKS = [
  [/콘텐츠 제작|블로그/, [['블로그 작성 도우미','#/blog'],['숏츠 제작 및 업로드','#/shorts']]],
  // 쿠팡 윙 주소는 로그인 화면이 매번 새 주소(state)를 만들어서 첫 화면으로 둔다 — 로그인 안 돼 있으면 알아서 로그인 화면으로 감
  [/콘텐츠 등록/, [['쿠팡 윙','https://wing.coupang.com/'],['오늘의집 오로라','https://orora.ohou.se/signin?redirectUrl=%2F']]],
  [/숏츠/, [['숏츠 제작 및 업로드','#/shorts'],['제작된 숏츠 업로드','#/upload']]],
  [/노출 순위|광고 효율/, [['성과 분석','perf'],['주간 매출 통계','#/weekly-sales']]],
];
function toolLinks(stepName){
  const f = TOOL_LINKS.find(([re])=>re.test(stepName)); if(!f) return '';
  const nextCp = (S.checkpoints.find(c=>addD(S.product.launch,c.d)>=TODAY) || S.checkpoints[S.checkpoints.length-1]).key;
  return `<div class="ds-foot">${f[1].map(([l,to])=>to==='perf' ? `<button class="btn small" data-goperf="${nextCp}">${l} →</button>` : (/^https?:/.test(to) ? `<a class="btn small" href="${to}" target="_blank" rel="noopener">${l} ↗</a>` : `<a class="btn small" href="${to}">${l} →</a>`)).join('')}</div>`;
}
// 콘텐츠 단계(이름에 '콘텐츠'·'숏츠'): 업무마다 게시물 링크 칸, 링크를 넣으면 완료로 체크
const contentStep = n => /콘텐츠|숏츠/.test(S.steps[n-1]||'');
function vDash(){
  const T = TK(), done = T.filter(t=>t.st==='완료').length, late = T.filter(isLate).length;
  const stepSt = n => n===EXPN() ? expStepStatus() : stepStatus(n);
  const doneSteps = S.steps.filter((_,i)=>stepSt(i+1)==='완료').length;
  // 위쪽: 업무 진행 카드 + 상태별로 나눈 진행도 막대
  // 보류는 완료와 똑같이 진행도에 넣는다 (지연은 따로 나누지 않음)
  const ing = T.filter(t=>t.st==='진행중').length, hold = T.filter(t=>t.st==='보류').length, closed = done + hold, wait = T.length - closed - ing, p = pct(closed,T.length);
  const seg = (c,k) => k ? `<span class="${c}" style="width:${k/T.length*100}%" title="${k}건"></span>` : '';
  let h = `<div class="ds-sum"><div class="tile"><div class="k">업무 진행</div><div class="v">${p}%</div><div class="s">완료 ${done}${hold?` · 보류 ${hold}`:''} / ${T.length}건</div></div>
  <div class="tile dm"><div class="dm-head"><span class="k">업무 진행도</span><b>${p}%</b><span class="s">${T.length-closed}건 남음</span></div>
  <div class="dm-bar">${seg('ok',done)}${seg('bad',hold)}${seg('ing',ing)}</div>
  <div class="dm-scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100%</span></div>
  <div class="dm-lg"><span><i class="ok"></i>완료 ${done}</span><span><i class="bad"></i>보류 ${hold}</span><span><i class="ing"></i>진행중 ${ing}</span><span><i></i>대기 ${wait}</span></div></div></div>`;
  h += `<div class="panel ds-main"><div class="ds-head"><h3>업무 진행 순서</h3></div><div class="ds-list">`;
  S.steps.forEach((nm,i)=>{
    const n = i+1, st = stepSt(n), open = openSt.has(n);
    let d, tot, rng, chans, owners, body = '';
    if(n===EXPN()){
      const all = S.exp.filter(xOn).flatMap(x=>x.steps.map(a=>({x,a}))), r = expRange();
      d = all.filter(o=>o.a.st==='완료').length; tot = all.length; rng = r ? md(r.a)+' ~ '+md(r.b) : '진행하는 체험단 없음';
      chans = S.exp.map(x=>`<span class="ds-ch ${goOf(x)==='진행'?'on':''}">${esc(x.name)} <em>${goOf(x)}</em></span>`).join('');
      owners = [...new Set(all.map(o=>o.a.owner).filter(Boolean))];
      if(open) body = S.exp.map(x=>{ const xd=x.steps.filter(a=>a.st==='완료').length, po=posts(x), lt=x.steps.some(a=>xLate(x,a));
        return `<div class="td-row"><span class="td-t">${esc(x.name)}<small>${esc(x.ch)} · ${goOf(x)}</small></span><span class="td-d ${lt?'bad':''}">${xd}/${x.steps.length}단계 · 게시 ${po}건 · 인원 ${x.target}명</span></div>`; }).join('')
        + `<div class="ds-foot"><button class="btn small" data-goexp="all">체험단 탭에서 관리</button></div>`;
    } else {
      const ts = stepTasks(n), r = stepRange(n);
      d = ts.filter(t=>t.st==='완료'||t.st==='보류').length; tot = ts.length; rng = r ? md(addD(S.product.launch,r.s))+' ~ '+md(addD(S.product.launch,r.e)) : '업무 없음';
      chans = ts.map(t=>`<span class="ds-ch ${t.st==='완료'?'on':(t.st==='보류'||isLate(t))?'bad':''}" title="${esc(t.ch)} · ${esc(t.owner||'담당 미정')}${t.st==='보류'?' · 보류':''}">${t.st==='완료'?'✓ ':t.st==='보류'?'보류 · ':''}${esc(bare(t.name))}</span>`).join('');
      owners = [...new Set(ts.map(t=>t.owner).filter(Boolean))];
      const sheetOnly = ts.length && ts.every(t=>bySheet(t));
      if(open && sheetOnly){
        const sh = S.product.sheet, at = sh?.at ? `마지막 확인 ${String(sh.at).slice(5,10).replace('-','/')} ${String(sh.at).slice(11,16)}` : '';
        body = `<div class="reg-list">${ts.map(t=>`<span class="reg ${t.st==='완료'?'on':''}">${t.st==='완료'?'✓':'○'} ${esc(bare(t.name).replace(/\s*상품등록$/,''))}</span>`).join('')}</div>
          <p class="reg-note">${S.product.code ? `구글 시트 「상품등록 현황」에 등록(O)하면 자동으로 체크돼요.${at?' · '+at:''} <button class="linkbtn" id="lnLookup">지금 확인</button>` : '제품 정보에 상품 코드를 넣으면 구글 시트 「상품등록 현황」을 보고 자동으로 체크돼요.'}</p>`;
      } else if(open) body = ts.map(t=>{ const lt = isLate(t), s2 = lt ? '지연' : t.st;
        if(contentStep(n)) return `<div class="td-row"><input type="checkbox" id="ck-${t._ci}-${t._ii}" data-ck="${t._ci}-${t._ii}" ${t.st==='완료'?'checked':''} aria-label="완료"><span class="td-t">${esc(bare(t.name))}<small>${esc(t.ch)}</small></span>${ownerSel(`ow-${t._ci}-${t._ii}`, `class="td-owner" data-own2="${t._ci}-${t._ii}"`, t.owner)}${lt?`<span class="td-d bad">${dnum(TODAY)-t.e}일 지남</span>`:''}<span class="td-linkbox">${t.url?`<a class="td-open" href="${esc(t.url)}" target="_blank" rel="noopener" title="${esc(t.url)}">열기 ↗</a>`:''}<input class="td-link" type="url" id="lk-${t._ci}-${t._ii}" data-lnk="${t._ci}-${t._ii}" value="${esc(t.url||'')}" placeholder="게시물 링크 붙여넣기" aria-label="${esc(bare(t.name))} 링크"></span><button class="pill st-${s2} hold-t" data-hold="${t._ci}-${t._ii}" title="${t.st==='보류'?'누르면 보류를 풀어요':'누르면 보류로 바꿔요'}">${s2}</button></div>`;
        return `<label class="td-row"><input type="checkbox" id="ck-${t._ci}-${t._ii}" data-ck="${t._ci}-${t._ii}" ${t.st==='완료'?'checked':''} aria-label="완료"><span class="td-t">${esc(bare(t.name))}<small>${esc(t.ch)}${t.rec==='weekly'?' · 매주 월요일':''}</small></span>${ownerSel(`ow-${t._ci}-${t._ii}`, `class="td-owner" data-own2="${t._ci}-${t._ii}"`, t.owner)}${lt?`<span class="td-d bad">${dnum(TODAY)-t.e}일 지남</span>`:''}<button class="pill st-${s2} hold-t" data-hold="${t._ci}-${t._ii}" title="${t.st==='보류'?'누르면 보류를 풀어요':'누르면 보류로 바꿔요'}">${s2}</button></label>`; }).join('')
        + toolLinks(nm);
    }
    h += `<div class="ds-row s-${st} ${open?'open':''}"><button class="ds-top" data-dsopen="${n}" aria-expanded="${open}"><span class="ds-no">${stepNo(n)}</span><span class="ds-nm">${esc(nm)}<small>${rng}</small></span><span class="ds-chs">${chans}</span><span class="ds-prog"><span class="bar"><i style="width:${pct(d,tot)}%"></i></span><em>${d}/${tot}</em></span><span class="pill st-${st}">${st}</span><span class="ds-caret" aria-hidden="true">${open?'▴':'▾'}</span></button>${open?`<div class="ds-body">${body}</div>`:''}</div>`;
  });
  h += `</div></div>`;
  return h;
}
// (안 씀) 업무 탭: 진행현황표 + 채널별 체크리스트 + 업무 순서 — 사용자 요청으로 탭을 없앴고, 담당은 대시보드에서 고른다
function vWork(){
  const M = [['prog','진행현황표'],['check','채널별 체크리스트'],['flow','업무 순서']];
  return `<div class="seg ln-sub">${M.map(([k,l])=>`<button data-wmode="${k}" class="${workMode===k?'on':''}">${l}</button>`).join('')}</div>` + ({prog:vProg, check:vCheck, flow:vFlow}[workMode])();
}
// 목표·성과 = 판매 목표·비용 + 성과 분석
function vGP(){
  const M = [['goal','판매 목표·비용'],['perf','성과 분석']];
  return `<div class="seg ln-sub">${M.map(([k,l])=>`<button data-gmode="${k}" class="${goalMode===k?'on':''}">${l}</button>`).join('')}</div>` + ({goal:vGoal, perf:vPerf}[goalMode])();
}

/* ---------- 탭: 업무 순서 ---------- */
function vFlow(){
  let h = `<h2>신제품 출시 후 업무 순서</h2><p class="lead">상품 페이지를 등록한 날(D-day)부터 아래 순서대로 진행합니다. 기간은 출시일 기준으로 자동 계산됩니다.</p><ol class="seq">`;
  S.steps.forEach((nm,i)=>{ const n=i+1, r=stepRange(n), xr=(n===EXPN())?expRange():null;
    const pd = xr ? kdr(xr.a,xr.b) : (r?kd(addD(S.product.launch,r.s))+(r.e!==r.s?' ~ '+kd(addD(S.product.launch,r.e)):''):'');
    h += `<li><span class="no">${stepNo(n)}</span><span class="nm">${esc(nm)}${n===EXPN()?'<button class="mgr" data-goexp="all">체험단 탭에서 관리 →</button>':''}</span><span class="pd">${pd}</span></li>`; });
  return h + `</ol>`;
}

/* ---------- 탭: 체크리스트 (편집 가능) ---------- */
function vCheck(){
  let h = `<h2>채널별 체크리스트</h2><p class="lead">여기 항목이 그대로 「진행현황표」 업무가 됩니다. 체크하면 진행현황 상태가 '완료'로, 진행현황에서 완료로 바꾸면 여기도 체크됩니다. 항목 앞의 [번호]는 업무 순서 번호입니다. 순서는 항목을 마우스로 끌어 놓아 바꿉니다.</p><div class="grid g3">`;
  S.checklists.forEach((c,ci)=>{ const d=c.items.filter(i=>i.st==='완료').length;
    h += `<div class="ck" data-card="${ci}"><div class="hd"><input type="text" id="pn-${ci}" data-pname="${ci}" value="${esc(c.name)}" aria-label="플랫폼 이름"><span>${d}/${c.items.length}</span></div><div class="bar" style="margin-bottom:8px"><i style="width:${pct(d,c.items.length)}%"></i></div>`;
    c.items.forEach((it,ii)=>{ if(!mine(it)) return; h += `<div class="ckrow ${it.st==='완료'?'on':''}" draggable="true" data-drag="${ci}-${ii}"><span class="grip" title="끌어서 순서 변경" aria-hidden="true">⠿</span><input type="checkbox" id="ck-${ci}-${ii}" data-ck="${ci}-${ii}" ${it.st==='완료'?'checked':''} ${bySheet(it,c.name)?'disabled title="구글 시트에 등록하면 자동으로 체크돼요"':''} aria-label="완료"><input type="text" id="ct-${ci}-${ii}" data-ct="${ci}-${ii}" value="${esc(it.name)}" aria-label="항목 내용" draggable="false">${it.st!=='완료'&&it.st!=='대기'?`<span class="pill st-${isLate(it)?'지연':it.st}" style="flex:none;font-size:11px">${isLate(it)?'지연':it.st}</span>`:(isLate(it)?'<span class="pill st-지연" style="flex:none;font-size:11px">지연</span>':'')}<button class="btn ghost" data-delit="${ci}-${ii}" aria-label="항목 삭제">✕</button></div>`; });
    h += `<div class="ckadd"><input type="text" id="na-${ci}" data-newit="${ci}" placeholder="+ 새 항목 입력 후 Enter"><button class="btn small" data-addit="${ci}">추가</button></div>
      <div class="ckfoot">${delPlat===ci?`<button class="btn small danger" data-delplat="${ci}">정말 삭제 (항목 ${c.items.length}개 포함)</button> <button class="btn small" id="delPlatCancel">취소</button>`:`<button class="btn small ghost" data-delplat="${ci}">플랫폼 삭제</button>`}</div></div>`; });
  h += `<div class="ck" style="display:flex;flex-direction:column;justify-content:center;gap:8px"><b>플랫폼 추가</b><div class="ckadd" style="margin:0"><input type="text" id="newPlat" placeholder="예: 카카오 선물하기"><button class="btn small" id="addPlat">추가</button></div></div>`;
  return h + `</div>`;
}

/* ---------- 탭: 체험단 ---------- */
// 체험단: 종류마다 카드 한 장 → 누르면 아래에 참여자·진행 상황·체험단 결과. 표·전용 달력은 없앴다 (마감은 일정 탭 달력에 나옴)
let expOpen = null;
const GO_TAG = {진행:'green', 검토중:'amber', 미진행:''};
function expCard(x, xi){
  const go = goOf(x), tot = x.steps.length, d = x.steps.filter(a=>a.st==='완료'||a.st==='보류').length;
  const po = posts(x), late = xOn(x) && x.steps.some(a=>xLate(x,a));
  const r = tot ? {a:addD(x.start,Math.min(...x.steps.map(a=>a.s))), b:addD(x.start,Math.max(...x.steps.map(a=>a.e)))} : null;
  const nx = x.steps.find(a=>a.st!=='완료'&&a.st!=='보류');
  const next = go==='검토중' ? '<span class="note">진행할지 정해 주세요</span>' : go==='미진행' ? '<span class="note">이번 제품은 진행 안 함</span>'
    : !tot ? '<span class="note">진행 상황을 추가해 주세요</span>' : nx ? `다음 · ${esc(nx.name||'(이름 없음)')} <span class="${xLate(x,nx)?'bad':'note'}">~${md(xEnd(x,nx))}${xLate(x,nx)?' 지남':''}</span>` : '<span class="note">모두 끝났어요</span>';
  return `<button class="xc ${expOpen===x.key?'on':''} ${go==='미진행'?'off':''}" data-xopen="${x.key}">
    <span class="xc-top"><b>${esc(x.name)}</b><span class="note">${esc(x.ch)}</span><span class="tag ${GO_TAG[go]}">${go}</span></span>
    <span class="xc-bar"><span class="bar"><i style="width:${pct(d,tot)}%"></i></span><span class="note">${tot?d+'/'+tot:'진행 상황 없음'}</span></span>
    <span class="xc-meta"><span>인원 ${x.target}명 · 게시 ${po}건</span><span class="note">${r?md(r.a)+' ~ '+md(r.b):''}</span></span>
    <span class="xc-next ${late?'late':''}">${next}</span></button>`;
}
function vExp(){
  // 미진행도 자리는 그대로 두고 카드만 흑백으로
  let h = `<div class="xc-grid">${S.exp.map((x,xi)=>expCard(x,xi)).join('')}</div>`;
  const xi = S.exp.findIndex(x=>x.key===expOpen);
  if(xi < 0) return h + `<p class="note xc-hint">카드를 누르면 참여자·진행 상황·체험단 결과를 볼 수 있어요.</p>`;
  const x = S.exp[xi];
  h += `<div class="panel xd"><div class="xd-head"><b>${esc(x.name)}</b><span class="note">${esc(x.purpose||'')}</span><span class="xd-go">${segGo(xi,x)}</span></div>
    <div class="xd-set"><label>시작 <input type="date" class="mc-date" data-xset="${xi}" data-f="start" value="${x.start}"></label>
    <label>인원 <input type="number" class="xd-num" data-xset="${xi}" data-f="target" value="${x.target}" min="0" max="50"> 명</label>
    <label>예산 <input type="number" class="xd-num xd-money" data-xset="${xi}" data-f="budget" value="${x.budget}" min="0" step="10000"> 원</label></div>`;
  // 참여자: 체험단을 하는 사람 기록. 칸 수 = 인원
  while(x.people.length < (+x.target||0)) x.people.push({name:'', url:''});
  h += `<div class="xd-sec">참여자 <span class="note">${x.people.filter(p=>p.name||p.url).length} / ${x.target}명</span></div>`;
  x.people.slice(0, +x.target||0).forEach((p,pi)=>{
    const key = xi+'-'+pi;
    h += `<div class="xd-p"><span class="xd-no">${pi+1}</span><input type="text" class="xd-in" data-xq="${key}" data-f="name" value="${esc(p.name||'')}" placeholder="이름 / @계정" aria-label="${pi+1}번 참여자 이름">
      <input type="url" class="xd-in xd-url" data-xq="${key}" data-f="url" value="${esc(p.url||'')}" placeholder="계정 링크 붙여넣기" aria-label="${pi+1}번 참여자 계정 링크">${p.url?`<a class="td-open" href="${esc(p.url)}" target="_blank" rel="noopener">열기 ↗</a>`:''}</div>`;
  });
  if(!(+x.target)) h += `<p class="note">위에서 인원을 정하면 참여자 칸이 생겨요.</p>`;
  // 진행 상황: 직접 하나씩 추가
  h += `<div class="xd-sec">진행 상황</div>`;
  x.steps.forEach((st,si)=>{
    const lt = xLate(x,st), s2 = lt ? '지연' : st.st, key = xi+'-'+si;
    h += `<div class="td-row xd-row ${st.st==='완료'?'done':''}"><input type="checkbox" id="xk-${key}" data-xck="${key}" ${st.st==='완료'?'checked':''} aria-label="완료"><input type="text" class="xd-in xd-step" id="xp-${key}-name" data-xp="${key}" data-f="name" value="${esc(st.name)}" placeholder="할 일을 적어 주세요">${ownerSel(`xo-${key}`, `class="td-owner" data-xp="${key}" data-f="owner"`, st.owner)}<input type="date" class="mc-date" data-xpd="${key}" data-f="e" value="${xEnd(x,st)}" aria-label="마감일"><button class="pill st-${s2} hold-t" data-xhold="${key}" title="${st.st==='보류'?'누르면 보류를 풀어요':'누르면 보류로 바꿔요'}">${s2}</button><button class="btn small ghost" data-xpdel="${key}" aria-label="항목 삭제">✕</button></div>`;
  });
  if(!x.steps.length) h += `<p class="note">아직 적은 진행 상황이 없어요.</p>`;
  h += `<div class="ds-foot"><button class="btn small" data-xpadd="${xi}">+ 항목 추가</button></div>`;
  // 체험단 결과: 누가 어디에 뭘 올렸는지
  const rs = x.results = x.results || [], names = x.people.map(p=>p.name).filter(Boolean);
  h += `<div class="xd-sec">체험단 결과 <span class="note">${rs.length}건</span></div>`;
  rs.forEach((r,ri)=>{
    const key = xi+'-'+ri;
    h += `<div class="xd-p"><input type="text" class="xd-in" list="xr-names-${xi}" data-xr="${key}" data-f="who" value="${esc(r.who||'')}" placeholder="누가" aria-label="누가">
      <input type="text" class="xd-in xd-where" data-xr="${key}" data-f="where" value="${esc(r.where||'')}" placeholder="어디에 (블로그·인스타 등)" aria-label="어디에">
      <input type="text" class="xd-in xd-url" data-xr="${key}" data-f="what" value="${esc(r.what||'')}" placeholder="무엇을 (게시물 링크나 내용)" aria-label="무엇을">${/^https?:\/\//.test(r.what||'')?`<a class="td-open" href="${esc(r.what)}" target="_blank" rel="noopener">열기 ↗</a>`:''}
      <input type="date" class="mc-date" data-xr="${key}" data-f="date" value="${r.date||''}" aria-label="올린 날">
      <button class="btn small ghost" data-xrdel="${key}" aria-label="결과 삭제">✕</button></div>`;
  });
  h += `<datalist id="xr-names-${xi}">${names.map(n=>`<option value="${esc(n)}">`).join('')}</datalist>`;
  if(!rs.length) h += `<p class="note">게시물이 올라오면 하나씩 추가해 주세요.</p>`;
  h += `<div class="ds-foot"><button class="btn small" data-xradd="${xi}">+ 결과 추가</button></div></div>`;
  return h;
}

/* ---------- 탭: 판매목표·비용 ---------- */
function vGoal(){
  const t = chTotals();
  let h = `<h2>채널별 판매 목표와 마케팅 비용</h2><p class="lead">출시 후 1개월 기준으로 채널마다 목표 수량과 비용을 정합니다. 노란 칸을 입력하면 아래 결과표가 바로 계산됩니다.</p>
  <div class="example">예시값입니다. 1개당 마진은 구글 시트 「플레르가구 상품등록 현황」 채널별 시트의 '회원 구매 수익'을 넣으세요.</div>`;
  h += `<div class="panel"><h3>① 입력</h3><div class="tw"><table><thead><tr><th>채널</th><th class="num">판매가</th><th class="num">1개당 마진</th><th class="num">목표 수량</th><th class="num">광고비</th><th class="num">체험단·협찬비</th><th class="num">기타 비용</th><th></th></tr></thead><tbody>`;
  S.channels.forEach((c,i)=>{
    h += `<tr><td><input type="text" class="in" id="ch-${i}-name" data-ch="${i}" data-f="name" value="${esc(c.name)}"></td>`;
    ['price','margin','qty','ad','promo','etc'].forEach(f=>{ h += `<td><input type="number" class="in" id="ch-${i}-${f}" data-ch="${i}" data-f="${f}" value="${c[f]}" min="0" step="${f==='qty'?1:1000}"></td>`; });
    h += `<td><button class="btn small" data-delch="${i}" aria-label="${esc(c.name)} 삭제">삭제</button></td></tr>`; });
  h += `</tbody></table></div><div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap"><button class="btn small" id="addCh">+ 채널 추가</button><label class="note">목표 ROAS = 손익분기 ROAS × <input type="number" id="roasMult" value="${S.roasMult}" step="0.1" min="1" style="width:60px;border:1px solid var(--line);border-radius:4px;padding:2px 4px" class="in"></label></div></div>`;
  h += `<div class="panel" style="margin-top:16px"><h3>② 결과 (1개월)</h3><div class="tw"><table><thead><tr><th>채널</th><th class="num">목표 매출</th><th class="num">총 마진</th><th class="num">마케팅비 합계</th><th class="num">순이익</th><th class="num">매출 대비 비용</th><th class="num">손익분기 ROAS</th><th class="num">목표 ROAS</th></tr></thead><tbody>`;
  S.channels.forEach(c=>{ const r=chCalc(c);
    h += `<tr><td>${esc(c.name)}</td><td class="num">${won(r.sales)}</td><td class="num">${won(r.mg)}</td><td class="num">${won(r.cost)}</td><td class="num" style="color:${r.net<0?'var(--bad)':'inherit'}">${won(r.net)}</td><td class="num">${(r.ratio*100).toFixed(1)}%</td><td class="num">${r.be?Math.round(r.be*100)+'%':'-'}</td><td class="num">${c.ad>0&&r.tgt?Math.round(r.tgt*100)+'%':'-'}</td></tr>`; });
  h += `<tr class="total"><td>합계</td><td class="num">${won(t.sales)}</td><td class="num">${won(t.mg)}</td><td class="num">${won(t.cost)}</td><td class="num">${won(t.net)}</td><td class="num">${t.sales?(t.cost/t.sales*100).toFixed(1):0}%</td><td class="num">-</td><td class="num">-</td></tr></tbody></table></div>
  <p class="note">손익분기 ROAS = 판매가 ÷ 1개당 마진 (광고비 1원으로 이만큼 팔아야 본전). 광고비가 0인 채널은 목표 ROAS를 표시하지 않습니다.</p></div>`;
  h += `<div class="grid g2" style="margin-top:16px"><div class="panel"><h3>목표 설정 순서</h3><ol class="rules">
    <li>채널별 판매가와 1개당 마진(회원 구매 수익)을 확정합니다.</li>
    <li>최근 비슷한 제품의 첫 달 판매량을 참고해 채널별 목표 수량을 잡습니다.</li>
    <li>광고비는 판매 비중이 큰 채널(네이버)부터 배분하고, 체험단·협찬비는 리뷰가 필요한 채널에 둡니다.</li>
    <li>순이익이 마이너스인 채널은 비용을 줄이거나 목표 수량을 다시 봅니다.</li>
    <li>광고 운영 기준은 목표 ROAS(손익분기 × ${S.roasMult})로 정합니다.</li></ol></div>
    <div class="panel"><h3>비용 배분 기준</h3><ol class="rules">
    <li>출시 첫 2주: 리뷰 확보 전이라 롱테일 키워드 위주, 일예산 낮게.</li>
    <li>리뷰 10건 이후: 메인 키워드 입찰을 단계적으로 올립니다.</li>
    <li>매주 월요일 ROAS가 손익분기 미만인 키워드·소재는 하향 또는 제외합니다.</li>
    <li>목표 ROAS를 2주 연속 넘는 채널은 예산을 20%씩 늘립니다.</li></ol></div></div>`;
  return h;
}

/* ---------- 탭: 성과 분석 ---------- */
function vPerf(){
  const cp = S.checkpoints.find(c=>c.key===perfCp);
  let h = `<h2>성과 분석</h2><p class="lead">점검일마다 출시일부터 그날까지의 누적 실적을 입력합니다. 기간 목표는 1개월 목표 수량을 일수로 나눠 계산합니다.</p>
  <div class="filters">${S.checkpoints.map(c=>`<button class="chip" data-cp="${c.key}" aria-pressed="${c.key===perfCp}">${c.name} · D+${c.d} (${md(addD(S.product.launch,c.d))})</button>`).join('')}</div>`;
  if(perfCp==='W1' && S.perfExample) h += `<div class="example">1주차 실적은 예시값입니다.</div>`;
  h += `<div class="panel"><h3>① ${cp.name} 실적 입력 (누적)</h3><div class="tw"><table><thead><tr><th>채널</th><th class="num">판매 수량</th><th class="num">매출</th><th class="num">광고비</th><th class="num">광고 전환매출</th><th class="num">체험단·기타 집행비</th></tr></thead><tbody>`;
  S.channels.forEach((c,i)=>{ const d=((S.perf[perfCp]||{})[c.name])||{};
    h += `<tr><td>${esc(c.name)}</td>${['qty','sales','ad','adSales','cost'].map(f=>`<td><input type="number" class="in" id="pf-${perfCp}-${i}-${f}" data-pf="${i}" data-f="${f}" value="${d[f]||0}" min="0" step="${f==='qty'?1:1000}"></td>`).join('')}</tr>`; });
  h += `</tbody></table></div></div>`;
  h += `<div class="panel" style="margin-top:16px"><h3>② ${cp.name} 목표 대비 결과</h3><div class="tw"><table><thead><tr><th>채널</th><th class="num">기간 목표</th><th class="num">달성률</th><th class="num">ROAS</th><th class="num">손익분기</th><th class="num">목표 ROAS</th><th class="num">순이익</th><th>다음 액션</th></tr></thead><tbody>`;
  let sq=0,sg=0,sad=0,sads=0,snet=0;
  S.channels.forEach(c=>{ const r=perfRow(perfCp,c); sq+=r.d.qty; sg+=r.goal; sad+=r.d.ad; sads+=r.d.adSales; snet+=r.net;
    h += `<tr><td>${esc(c.name)}</td><td class="num">${r.goal.toFixed(1)}대</td><td class="num" style="color:${r.ach<0.7&&r.goal>0?'var(--bad)':'inherit'}">${Math.round(r.ach*100)}%</td><td class="num">${r.roas==null?'-':Math.round(r.roas*100)+'%'}</td><td class="num">${Math.round(r.be*100)}%</td><td class="num">${c.ad>0?Math.round(r.tgt*100)+'%':'-'}</td><td class="num" style="color:${r.net<0?'var(--bad)':'inherit'}">${won(r.net)}</td><td><span class="pill j-${r.j}">${jLabel(r.j)}</span></td></tr>`; });
  h += `<tr class="total"><td>합계</td><td class="num">${sg.toFixed(1)}대</td><td class="num">${pct(sq,sg)}%</td><td class="num">${sad?Math.round(sads/sad*100)+'%':'-'}</td><td class="num">-</td><td class="num">-</td><td class="num">${won(snet)}</td><td></td></tr></tbody></table></div>
  <p class="note">순이익 = 판매 수량 × 1개당 마진 − 광고비 − 체험단·기타 집행비. 판정: ROAS ≥ 목표 → 예산 확대 / 손익분기 ≤ ROAS &lt; 목표 → 유지 / ROAS &lt; 손익분기 → 입찰 하향 / 광고 없이 판매 부진 → 원인 점검(상세페이지·가격·노출).</p></div>`;
  h += `<div class="panel" style="margin-top:16px"><h3>③ 노출·콘텐츠 지표</h3><div class="tw"><table><thead><tr><th>지표</th><th>목표</th>${S.checkpoints.map(c=>`<th>${c.name}</th>`).join('')}</tr></thead><tbody>`;
  S.kpiItems.forEach((k,ki)=>{ h += `<tr><td>${esc(k)}</td><td><input type="text" class="in" id="kg-${ki}" data-kg="${ki}" value="${esc(S.kpiGoal[k]||'')}"></td>${S.checkpoints.map(c=>`<td><input type="text" class="in" id="kv-${c.key}-${ki}" data-kv="${c.key}" data-ki="${ki}" value="${esc(((S.kpi[c.key]||{})[k])||'')}"></td>`).join('')}</tr>`; });
  h += `</tbody></table></div></div>`;
  h += `<div class="panel" style="margin-top:16px"><h3>④ 점검일별 추이</h3><div class="tw"><table><thead><tr><th>점검</th><th class="num">판매 수량</th><th class="num">매출</th><th class="num">광고비</th><th class="num">ROAS</th><th class="num">달성률</th><th class="num">순이익</th></tr></thead><tbody>`;
  S.checkpoints.forEach(c=>{ if(!hasPerf(c.key)){ h+=`<tr><td>${c.name}</td><td colspan="6" class="note">미입력</td></tr>`; return; }
    let q=0,s=0,a=0,as=0,g=0,n=0; S.channels.forEach(ch=>{ const r=perfRow(c.key,ch); q+=r.d.qty; s+=r.d.sales; a+=r.d.ad; as+=r.d.adSales; g+=r.goal; n+=r.net; });
    h += `<tr><td>${c.name}</td><td class="num">${q}</td><td class="num">${won(s)}</td><td class="num">${won(a)}</td><td class="num">${a?Math.round(as/a*100)+'%':'-'}</td><td class="num">${pct(q,g)}%</td><td class="num">${won(n)}</td></tr>`; });
  h += `</tbody></table></div></div>`;
  return h;
}

/* ---------- 탭: 진행현황 ---------- */
const COLS = [['step','단계'],['name','업무'],['ch','채널'],['owner','담당'],['period','기간'],['st','상태'],['memo','메모']];
const EMPTY = '(비어 있음)';
function colVal(t,k){
  if(k==='step') return t.step ? stepNo(t.step)+' '+stepName(t.step) : '(단계 없음)';
  if(k==='name') return bare(t.name)||EMPTY;
  if(k==='period') return kd(tEnd(t))+' 마감';
  if(k==='st') return isLate(t)?'지연':t.st;
  const v=(t[k]||'').trim(); return v||EMPTY;
}
function colSortKey(t,k){ if(k==='step') return (t.step||99)*1e6+t._ci*1000+t._ii; if(k==='period') return t.e*1000+t.s; if(k==='st') return ['지연','대기','진행중','완료','보류'].indexOf(colVal(t,'st')); return colVal(t,k); }
function colOptions(k){
  const m=new Map(); TK().forEach(t=>{ const v=colVal(t,k); m.set(v,(m.get(v)||0)+1); });
  const arr=[...m.keys()];
  if(k==='ch'){ const ord=S.checklists.map(c=>c.name); arr.sort((a,b)=>ord.indexOf(a)-ord.indexOf(b)); } else if(k==='step') arr.sort(); else if(k==='period') arr.sort((a,b)=>{ const ta=TK().find(t=>colVal(t,k)===a), tb=TK().find(t=>colVal(t,k)===b); return ta.e-tb.e; });
  else if(k==='st') arr.sort((a,b)=>['지연','대기','진행중','완료','보류'].indexOf(a)-['지연','대기','진행중','완료','보류'].indexOf(b));
  else arr.sort((a,b)=>a===EMPTY?1:b===EMPTY?-1:a.localeCompare(b,'ko'));
  return arr.map(v=>({v,n:m.get(v)}));
}
function progRows(){
  let rows = TK().map((t,i)=>({t,i})).filter(({t})=>mine(t) && COLS.every(([k])=>!CF[k] || CF[k].includes(colVal(t,k))));
  const k=SORT.key, d=SORT.dir;
  rows.sort((a,b)=>{ const x=colSortKey(a.t,k), y=colSortKey(b.t,k); return (typeof x==='number'? x-y : String(x).localeCompare(String(y),'ko'))*d || (a.t.step||99)-(b.t.step||99) || a.t._ci-b.t._ci || a.t._ii-b.t._ii; });
  return rows;
}
function vProg(){
  const rows = progRows();
  let h = `<h2>진행현황표</h2><p class="lead">「채널별 체크리스트」의 항목이 업무 순서대로 나옵니다. 여기서 상태를 '완료'로 바꾸면 플랫폼별 리스트에도 체크되고, 반대도 같습니다. 완료된 업무는 초록색, 마감이 지났는데 끝나지 않은 업무는 빨간색으로 표시됩니다. 머리글의 ▾를 누르면 그 열로 필터·정렬할 수 있고, 기간을 누르면 날짜를 바꿀 수 있습니다.</p>`;
  const act = COLS.filter(([k])=>CF[k]);
  h += `<div class="cfbar"><span>${rows.length} / ${TK().length}건 표시</span>${act.length?`<span>· 필터: ${act.map(([k,l])=>`<b style="color:var(--accent)">${l}</b>`).join(', ')}</span><button class="btn small" id="cfClearAll">모든 필터 해제</button>`:''}</div>`;
  h += `<div class="panel"><div class="tw"><table><thead><tr>${COLS.map(([k,l])=>`<th><button class="colf ${CF[k]?'on':''}" data-col="${k}" aria-haspopup="true" aria-expanded="${openCol===k}">${l}<span class="ar">${SORT.key===k?(SORT.dir>0?'▲':'▼'):'▾'}</span></button></th>`).join('')}<th></th></tr></thead><tbody>`;
  rows.forEach(({t,i})=>{ const late=isLate(t);
    h += `<tr class="${t.st==='완료'?'done':(late?'late':'')}">
      <td class="stepc"><select id="tk-${i}-step" data-tk="${i}" data-f="step" aria-label="단계" style="min-width:200px">${t.step?'':'<option value="0" selected>단계 없음</option>'}${S.steps.map((n,k)=>k+1===EXPN()?'':`<option value="${k+1}" ${t.step===k+1?'selected':''}>${stepNo(k+1)} ${esc(n)}</option>`).join('')}</select></td>
      <td style="min-width:200px"><input type="text" id="tk-${i}-name" data-tk="${i}" data-f="name" value="${esc(bare(t.name))}">${late?`<span class="pill st-지연" style="margin-top:3px">지연 ${dnum(TODAY)-t.e}일</span>`:''}</td>
      <td style="min-width:110px"><select id="tk-${i}-ch" data-tk="${i}" data-f="ch" aria-label="채널(플랫폼)">${S.checklists.map((c,k)=>`<option value="${k}" ${t._ci===k?'selected':''}>${esc(c.name)}</option>`).join('')}</select></td>
      <td style="min-width:96px">${ownerSel(`tk-${i}-owner`, `data-tk="${i}" data-f="owner"`, t.owner)}</td>
      <td>${editPeriod===i?`<div class="pedit"><input type="date" id="tk-${i}-ds" data-tkd="${i}" data-f="s" value="${tStart(t)}" aria-label="시작일"><input type="date" id="tk-${i}-de" data-tkd="${i}" data-f="e" value="${tEnd(t)}" aria-label="마감일"><button class="btn small" id="periodDone">확인</button></div>`
        :`<button class="period" data-period="${i}" title="눌러서 날짜 변경">${periodTxt(t)}</button>${t.rec==='weekly'?'<div class="note">매주 월요일</div>':''}`}</td>
      <td style="min-width:96px"><select id="tk-${i}-st" data-tk="${i}" data-f="st" class="s-${t.st}" ${bySheet(t)?'disabled title="구글 시트에 등록하면 자동으로 바뀌어요"':''}>${STS.map(s=>`<option ${s===t.st?'selected':''}>${s}</option>`).join('')}</select></td>
      <td style="min-width:150px"><input type="text" id="tk-${i}-memo" data-tk="${i}" data-f="memo" value="${esc(t.memo||'')}"></td>
      <td><button class="btn small ghost" data-deltk="${i}" aria-label="업무 삭제">✕</button></td></tr>`; });
  if(!rows.length) h += `<tr><td colspan="8" class="empty">조건에 맞는 업무가 없습니다. 머리글 필터를 풀어 보세요.</td></tr>`;
  h += `</tbody></table></div><div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap"><select id="newPlat2" aria-label="플랫폼" style="border:1px solid var(--line);border-radius:4px;padding:4px">${S.checklists.map((c,k)=>`<option value="${k}">${esc(c.name)}</option>`).join('')}</select><select id="newStep" aria-label="단계" style="border:1px solid var(--line);border-radius:4px;padding:4px">${S.steps.map((n,k)=>k+1===EXPN()?'':`<option value="${k+1}">${stepNo(k+1)} ${esc(n)}</option>`).join('')}</select><button class="btn small" id="addTk">+ 업무 추가</button><span class="note">추가한 업무는 플랫폼별 리스트에도 생깁니다. 체험단 진행 단계는 「체험단」 탭에서 관리합니다.</span></div></div>
  <div class="legend"><span><span class="sw" style="background:var(--ok-soft);border:1px solid var(--ok)"></span>완료</span><span><span class="sw" style="background:var(--bad-soft);border:1px solid var(--bad)"></span>마감 지남</span><span><span class="sw" style="background:var(--info-soft);border:1px solid var(--info)"></span>진행중</span></div>
  <div id="cfdrop" class="cfdrop" hidden></div>`;
  return h;
}
function renderDrop(keepFocus){
  const el=document.getElementById('cfdrop'); if(!el) return;
  if(!openCol){ el.hidden=true; return; }
  const btn=document.querySelector(`.colf[data-col="${openCol}"]`); if(!btn){ openCol=null; el.hidden=true; return; }
  const k=openCol, opts=colOptions(k), sel=CF[k], q=cfQ.trim().toLowerCase();
  const shown=opts.filter(o=>!q||o.v.toLowerCase().includes(q));
  const allOn=!sel, someOn=sel&&sel.length>0;
  el.innerHTML = `<div class="srt"><button class="btn small" data-srt="1" aria-pressed="${SORT.key===k&&SORT.dir>0}">▲ 오름차순</button><button class="btn small" data-srt="-1" aria-pressed="${SORT.key===k&&SORT.dir<0}">▼ 내림차순</button></div>
    ${opts.length>6?`<input type="text" id="cfq" value="${esc(cfQ)}" placeholder="값 검색" aria-label="값 검색">`:''}
    <div class="vals"><label><input type="checkbox" id="cfall" ${allOn?'checked':''}><span><b>전체 선택</b></span></label>
    ${shown.map((o,ix)=>`<label><input type="checkbox" data-cfv="${esc(o.v)}" ${(!sel||sel.includes(o.v))?'checked':''}><span title="${esc(o.v)}">${esc(o.v)}</span><em>${o.n}</em></label>`).join('')}
    ${!shown.length?'<div class="note" style="padding:6px">일치하는 값이 없습니다.</div>':''}</div>
    <div class="ft"><button class="btn small" id="cfReset">이 열 필터 해제</button><button class="btn small primary" id="cfClose">닫기</button></div>`;
  el.hidden=false;
  const allBox=document.getElementById('cfall'); if(allBox) allBox.indeterminate = !allOn && someOn;
  const r=btn.getBoundingClientRect(), w=el.offsetWidth, vw=document.documentElement.clientWidth;
  el.style.left=Math.max(16, Math.min(r.left, vw-w-16))+'px'; el.style.top=(r.bottom+4)+'px';
  if(keepFocus){ const qi=document.getElementById('cfq'); if(qi){ qi.focus(); qi.setSelectionRange(qi.value.length,qi.value.length); } }
}
function setColVal(k,v,on){
  const all=colOptions(k).map(o=>o.v); let cur=CF[k]?[...CF[k]]:[...all];
  if(on){ if(!cur.includes(v)) cur.push(v); } else cur=cur.filter(x=>x!==v);
  CF[k] = cur.length===all.length ? undefined : cur; if(!CF[k]) delete CF[k];
}
function closeDrop(){ if(openCol){ openCol=null; cfQ=''; render(); } }

/* ---------- 탭: 일정 (달력) ---------- */
// 칸에는 '마감'만, 같은 날 같은 단계는 한 줄로 묶는다. 매주 반복 업무는 월요일에 '주간 체크' 한 줄. 날짜를 누르면 아래에 그날 업무.
let calSel = null;
function calDays(){
  const days = {}, L = S.product.launch;
  const grp = (d,k,o) => { const m = (days[d] = days[d] || new Map()); if(!m.has(k)) m.set(k, {...o, items:[]}); return m.get(k); };
  TK().forEach(t=>{
    const it = {name:bare(t.name), ch:t.ch, owner:t.owner, st:t.st, late:isLate(t), ref:'t-'+t._ci+'-'+t._ii};
    if(t.rec==='weekly') return; // 매주 반복 업무는 달력에 안 넣는다
    grp(tEnd(t), 's'+t.step, {order:t.step||98, label:stepName(t.step)||'기타'}).items.push(it);
  });
  const xn = EXPN();
  S.exp.forEach((x,xi)=>{ if(goOf(x)!=='진행') return; x.steps.forEach((st,si)=>{ // '검토중' 체험단은 달력에 안 넣는다
    grp(xEnd(x,st), 'x', {order:xn, label:S.steps[xn-1]||'체험단'}).items.push({name:'['+x.name+'] '+st.name, ch:x.ch, owner:st.owner, st:st.st, late:xLate(x,st), ref:'x-'+xi+'-'+si});
  }); });
  for(const m of Object.values(days)) for(const g of m.values()){
    const closed = g.items.every(i=>i.st==='완료'||i.st==='보류');
    g.state = closed ? 'done' : g.items.some(i=>i.late) ? 'late' : 'todo';
  }
  return days;
}
function vCal(){
  if(!calMonth) calMonth = TODAY.slice(0,7);
  const [y,m] = calMonth.split('-').map(Number);
  const first = Date.UTC(y,m-1,1), startDow = new Date(first).getUTCDay(), days = calDays();
  const cells = (startDow + new Date(Date.UTC(y,m,0)).getUTCDate()) > 35 ? 42 : 35;
  let h = `<div class="mc-head"><button class="btn small" id="calPrev" aria-label="이전 달">◀</button><b>${y}년 ${m}월</b><button class="btn small" id="calNext" aria-label="다음 달">▶</button><button class="btn small" id="calToday">오늘</button>
    <span class="mc-lg"><span><i class="todo"></i>마감</span><span><i class="late"></i>마감 지남</span><span><i class="done"></i>끝남</span></span></div>
    <div class="mcal">${WD.map(w=>`<div class="mc-wd">${w}</div>`).join('')}`;
  for(let i=0;i<cells;i++){
    const t = first + (i-startDow)*864e5, d = fmt(t), dt = new Date(t), out = dt.getUTCMonth()!==m-1;
    const gs = [...(days[d]||new Map()).values()].sort((a,b)=>a.order-b.order);
    const isL = d===S.product.launch;
    h += `<button class="mc-day ${out?'out':''} ${d===TODAY?'today':''} ${isL?'launch':''} ${calSel===d?'sel':''}" data-calday="${d}" aria-label="${kd(d)}${gs.length?' 마감 '+gs.length+'개':''}">
      <span class="mc-dn">${dt.getUTCDate()}${isL?'<em>출시</em>':''}</span>
      ${gs.slice(0,3).map(g=>`<span class="mc-ev ${g.state} ${g.weekly?'mc-wkly':''}">${g.weekly?'↻':'<i></i>'}${esc(g.label)}</span>`).join('')}${gs.length>3?`<span class="mc-more">+${gs.length-3}</span>`:''}</button>`;
  }
  h += `</div>`;
  // 달력 아래: 모든 업무를 순서대로, 마감일을 바로 정하면 달력에 반영. 달력에서 고른 날 마감인 업무는 강조
  const xn = EXPN();
  h += `<div class="panel mc-list"><h3>업무별 마감일</h3>`;
  S.steps.forEach((nm,i)=>{
    const n = i+1;
    if(n===xn){ h += `<div class="ml-step"><b>${esc(nm)}</b><span class="note">체험단마다 일정이 달라서 체험단 탭에서 정해요</span><button class="btn small" data-goexp="all">체험단 탭 →</button></div>`; return; }
    const ts = stepTasks(n); if(!ts.length) return;
    h += `<div class="ml-step"><b>${esc(nm)}</b></div>` + ts.map(t=>{
      const lt = isLate(t), s2 = lt ? '지연' : t.st, hl = calSel && tEnd(t)===calSel;
      return `<div class="ml-row ${t.st==='완료'?'done':''} ${hl?'hl':''}"><span class="ml-name">${esc(bare(t.name))}</span><span class="note ml-ch">${esc(t.ch)}</span>${t.rec==='weekly'
        ? `<span class="note ml-wk">매주 월요일</span>`
        : `<input type="date" class="mc-date" data-tdate="t-${t._ci}-${t._ii}" value="${tEnd(t)}" aria-label="${esc(bare(t.name))} 마감일">`}<span class="pill st-${s2}">${s2}</span></div>`;
    }).join('');
  });
  h += `</div>`;
  return h;
}

/* ---------- 렌더·이벤트 ---------- */
const TABS = [['dash','대시보드',vDash],['sched','일정',vCal],['exp','체험단',vExp],['gp','목표·성과',vGP]];
function shell(){
  ROOT.innerHTML = `<div class="welcome" id="lnWelcome"><h1>신제품 출시 매뉴얼</h1><p>제품마다 상품을 등록한 날(D-day)부터 채널별 할 일·체험단·판매 목표·성과를 한곳에서 챙겨요. 고친 내용은 자동으로 저장되고 팀 모두에게 똑같이 보여요.</p></div>
  <div id="lnList" class="ln-stack"></div>
  <div id="lnProduct" class="ln-stack hidden">
  <section class="card ln-info" id="lnInfo"></section>
  <div class="seg ln-tabs" role="tablist">${TABS.map(([k,l])=>`<button role="tab" data-tab="${k}" class="${k===tab?'on':''}">${l}</button>`).join('')}</div>
  <section id="lnView" class="ln-stack"></section></div>`;
}
function render(focusId){
  ROOT.querySelectorAll('.ln-tabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===tab));
  renderInfo();
  $('#lnView').innerHTML = TABS.find(x=>x[0]===tab)[2]();
  renderTop();
  if(tab==='work' && workMode==='prog') renderDrop();
  if(focusId){ const el=document.getElementById(focusId); if(el){ el.focus(); if(el.setSelectionRange && el.type==='text'){ const l=el.value.length; el.setSelectionRange(l,l);} } }
}
function num(v){ const n=parseFloat(v); return isNaN(n)?0:n; }
function addItem(ci){ const el=document.getElementById('na-'+ci); const v=(el&&el.value||'').trim(); if(!v) return; S.checklists[ci].items.push(newItem(v)); markDirty(); render('na-'+ci); }
function addPlat(){ const el=$('#newPlat'); const v=(el&&el.value||'').trim(); if(!v) return; S.checklists.push({key:'p'+Date.now(),name:v,items:[]}); markDirty(); render('na-'+(S.checklists.length-1)); }
document.addEventListener('click', e=>{
  if(!ROOT.contains(e.target)) return;
  const row = e.target.closest('[data-lnopen]');
  if(row && !e.target.closest('button')){ openProduct(row.dataset.lnopen); return; }
  const b = e.target.closest('button'); if(!b) return;
  if(b.id==='lnBack'){ backToList(); return; }
  if(b.id==='lnLookup'){ lookupCode(); return; }
  if(b.dataset.wmode){ workMode=b.dataset.wmode; editPeriod=-1; openCol=null; render(); return; }
  if(b.dataset.gmode){ goalMode=b.dataset.gmode; render(); return; }
  if(b.dataset.hold){ const [ci,ii]=b.dataset.hold.split('-').map(Number), it=S.checklists[ci].items[ii];
    if(it.st==='보류') it.st = (it._prev && it._prev!=='보류') ? it._prev : (it.url ? '완료' : '대기');
    else { defp(it,'_prev',it.st); it.st='보류'; }
    markDirty(); render(); return; }
  if(b.dataset.dsopen){ const n=+b.dataset.dsopen; openSt.has(n)?openSt.delete(n):openSt.add(n); render(); return; }
  if(b.dataset.goperf){ tab='gp'; goalMode='perf'; perfCp=b.dataset.goperf; render(); window.scrollTo(0,0); return; }
  if(b.dataset.gostep){ const n=+b.dataset.gostep; if(n===EXPN()){ tab='exp'; expSel='all'; } else { tab='dash'; openSt.add(n); } render(); return; }
  if(b.id==='lnAdd'){ addProduct(); return; }
  if(b.dataset.lnbrand){ newBrand=b.dataset.lnbrand; try{localStorage.setItem('fleur-launch-brand',newBrand);}catch(_){} ROOT.querySelectorAll('[data-lnbrand]').forEach(x=>{ x.classList.toggle('on', x.dataset.lnbrand===newBrand); x.setAttribute('aria-checked', x.dataset.lnbrand===newBrand); }); return; }
  if(b.dataset.lndel){ delProduct(b.dataset.lndel, b.dataset.name); return; }
  if(b.dataset.tab){ tab=b.dataset.tab; editPeriod=-1; openCol=null; render(); try{localStorage.setItem('fleur-launch-tab',tab);}catch(_){} return; }
  if(b.dataset.goexp){ tab='exp'; expSel=b.dataset.goexp; render(); return; }
  if(b.dataset.exps){ expSel=b.dataset.exps; expEdit=''; render(); return; }
  if(b.id==='xcPrev'||b.id==='xcNext'){ let [y,m]=expMonth.split('-').map(Number); m+= b.id==='xcNext'?1:-1; if(m<1){m=12;y--;} if(m>12){m=1;y++;} expMonth=y+'-'+String(m).padStart(2,'0'); render(); return; }
  if(b.id==='xcToday'){ expMonth=TODAY.slice(0,7); render(); return; }
  if(b.id==='xcStart'){ const r=expRange(); if(r) expMonth=r.a.slice(0,7); render(); return; }
  if(b.dataset.xopen){ expOpen = expOpen===b.dataset.xopen ? null : b.dataset.xopen; render(); return; }
  if(b.dataset.xhold){ const [xi,si]=b.dataset.xhold.split('-').map(Number), st=S.exp[xi].steps[si];
    if(st.st==='보류') st.st=(st._prev&&st._prev!=='보류')?st._prev:'대기'; else { defp(st,'_prev',st.st); st.st='보류'; }
    markDirty(); render(); return; }
  if(b.dataset.goi!=null){ S.exp[+b.dataset.goi].go=b.dataset.go; markDirty(); render(); return; }
  if(b.dataset.xhide){ const k=b.dataset.xhide; expHide[k]=!expHide[k]; render(); return; }
  if(b.dataset.xper){ expEdit=b.dataset.xper; render('xp-'+expEdit+'-ds'); return; }
  if(b.id==='xpDone'){ expEdit=''; render(); return; }
  if(b.dataset.xpadd!=null){ const x=S.exp[+b.dataset.xpadd]; const last=x.steps[x.steps.length-1]; const s0=last?last.e:0; const t0=Math.max(0,Math.round((parse(TODAY)-parse(x.start))/864e5)); x.steps.push({name:'',s:t0,e:Math.max(t0,s0),st:'대기',owner:x.owner||'',memo:''}); markDirty(); render('xp-'+b.dataset.xpadd+'-'+(x.steps.length-1)+'-name'); return; }
  if(b.dataset.xpdel){ const [xi,si]=b.dataset.xpdel.split('-').map(Number); S.exp[xi].steps.splice(si,1); expEdit=''; markDirty(); render(); return; }
  if(b.dataset.xradd!=null){ const x=S.exp[+b.dataset.xradd]; (x.results=x.results||[]).push({who:'',where:'',what:'',date:TODAY}); markDirty(); render(); return; }
  if(b.dataset.xrdel){ const [xi,ri]=b.dataset.xrdel.split('-').map(Number); S.exp[xi].results.splice(ri,1); markDirty(); render(); return; }
  if(b.dataset.xqadd!=null){ const x=S.exp[+b.dataset.xqadd]; x.people.push({name:'',ship:'',plan:'',posted:'',st:'섭외중',url:'',memo:''}); markDirty(); render('xq-'+b.dataset.xqadd+'-'+(x.people.length-1)+'-name'); return; }
  if(b.dataset.xqdel){ const [xi,pi]=b.dataset.xqdel.split('-').map(Number); S.exp[xi].people.splice(pi,1); markDirty(); render(); return; }
  if(b.dataset.cp){ perfCp=b.dataset.cp; render(); return; }
  if(b.dataset.col){ const k=b.dataset.col; openCol = openCol===k ? null : k; cfQ=''; render(); return; }
  if(b.dataset.srt){ SORT={key:openCol, dir:+b.dataset.srt}; render(); return; }
  if(b.id==='cfReset'){ delete CF[openCol]; render(); return; }
  if(b.id==='cfClose'){ closeDrop(); return; }
  if(b.id==='cfClearAll'){ CF={}; render(); return; }
  if(b.dataset.period!=null){ editPeriod=+b.dataset.period; render('tk-'+editPeriod+'-ds'); return; }
  if(b.id==='periodDone'){ editPeriod=-1; render(); return; }
  if(b.id==='calPrev'||b.id==='calNext'){ let [y,m]=calMonth.split('-').map(Number); m+= b.id==='calNext'?1:-1; if(m<1){m=12;y--;} if(m>12){m=1;y++;} calMonth=y+'-'+String(m).padStart(2,'0'); render(); return; }
  if(b.dataset.cplat){ const k=b.dataset.cplat, now=Date.now();
    if(window.__lastPlat===k && now-window.__lastPlatT<400){ const keys=[...S.checklists.map(c=>c.key),'__exp','__cp']; calHide={}; keys.forEach(x=>{ if(x!==k) calHide[x]=true; }); }
    else calHide[k]=!calHide[k];
    window.__lastPlat=k; window.__lastPlatT=now; render(); return; }
  if(b.id==='calAll'){ calHide={}; render(); return; }
  if(b.dataset.ccol){ calColor=b.dataset.ccol; render(); return; }
  if(b.id==='calToday'){ calMonth=TODAY.slice(0,7); calSel=TODAY; render(); return; }
  if(b.dataset.calday){ calSel = calSel===b.dataset.calday ? null : b.dataset.calday; render(); return; }
  if(b.id==='calLaunch'){ calMonth=S.product.launch.slice(0,7); render(); return; }
  if(b.id==='addCh'){ S.channels.push({name:'새 채널',price:0,margin:0,qty:0,ad:0,promo:0,etc:0}); markDirty(); render(); return; }
  if(b.dataset.delch!=null){ S.channels.splice(+b.dataset.delch,1); markDirty(); render(); return; }
  if(b.dataset.addit!=null){ addItem(+b.dataset.addit); return; }
  if(b.dataset.delit){ const [ci,ii]=b.dataset.delit.split('-').map(Number); S.checklists[ci].items.splice(ii,1); markDirty(); render(); return; }
  if(b.dataset.delplat!=null){ const ci=+b.dataset.delplat; if(delPlat!==ci){ delPlat=ci; render(); return; } S.checklists.splice(ci,1); delPlat=-1; markDirty(); render(); return; }
  if(b.id==='delPlatCancel'){ delPlat=-1; render(); return; }
  if(b.id==='addPlat'){ addPlat(); return; }
  if(b.id==='addTk'){ const step=+$('#newStep').value, ci=+$('#newPlat2').value; const it=newItem('새 업무', step); S.checklists[ci].items.push(it);
    CF={}; markDirty(); render(); const i=TK().indexOf(it); const el=document.getElementById('tk-'+i+'-name'); if(el){ el.focus(); el.select(); } return; }
  if(b.dataset.deltk!=null){ const t=TK()[+b.dataset.deltk]; S.checklists[t._ci].items.splice(t._ii,1); editPeriod=-1; markDirty(); render(); return; }
  if(b.id==='resetBtn'){ if(!resetArm){ resetArm=true; render(); return; }
    resetArm=false; TK().forEach(t=>{t.st='대기'; t.memo='';}); S.perf={}; S.kpi={}; S.perfExample=false; S.exp.forEach(x=>{ x.steps.forEach(a=>{a.st='대기'; a.memo='';}); x.people=[]; x.go='검토중'; });
    S.product.name='새 제품명을 입력하세요'; S.product.memo='새 제품 출시 진행 중입니다.'; markDirty(); render(); return; }
  if(b.id==='resetCancel'){ resetArm=false; render(); return; }
});
document.addEventListener('keydown', e=>{
  if(e.key!=='Enter' || e.isComposing || !ROOT.contains(e.target)) return;
  const el=e.target;
  if(el.dataset && el.dataset.newit!=null){ e.preventDefault(); addItem(+el.dataset.newit); }
  else if(el.id==='newPlat'){ e.preventDefault(); addPlat(); }
});
let dragSrc=null;
function clearDrag(){ document.querySelectorAll('.ckrow.over,.ck.overend,.ckrow.dragging').forEach(e=>e.classList.remove('over','overend','dragging')); }
document.addEventListener('dragstart', e=>{ if(!ROOT.contains(e.target)) return; const r=e.target.closest&&e.target.closest('.ckrow[data-drag]'); if(!r) return; dragSrc=r.dataset.drag.split('-').map(Number); r.classList.add('dragging'); try{ e.dataTransfer.effectAllowed='move'; e.dataTransfer.setData('text/plain', r.dataset.drag); }catch(_){} });
document.addEventListener('dragover', e=>{ if(!dragSrc) return; const r=e.target.closest('.ckrow[data-drag]'), c=e.target.closest('.ck[data-card]'); if(!r&&!c) return; e.preventDefault();
  document.querySelectorAll('.ckrow.over,.ck.overend').forEach(x=>x.classList.remove('over','overend')); if(r) r.classList.add('over'); else c.classList.add('overend'); });
document.addEventListener('drop', e=>{ if(!dragSrc) return; const r=e.target.closest('.ckrow[data-drag]'), c=e.target.closest('.ck[data-card]'); if(!r&&!c){ dragSrc=null; clearDrag(); return; } e.preventDefault();
  const [sc,si]=dragSrc; const item=S.checklists[sc].items.splice(si,1)[0]; let tc, ti;
  if(r){ [tc,ti]=r.dataset.drag.split('-').map(Number); if(tc===sc && ti>si) ti--; } else { tc=+c.dataset.card; ti=S.checklists[tc].items.length; }
  S.checklists[tc].items.splice(ti,0,item); dragSrc=null; markDirty(); render(); });
document.addEventListener('dragend', ()=>{ dragSrc=null; clearDrag(); });
document.addEventListener('mousedown', e=>{ if(openCol && !e.target.closest('#cfdrop') && !e.target.closest('.colf')) closeDrop(); });
document.addEventListener('keydown', e=>{ if(e.key==='Escape' && openCol) closeDrop(); });
window.addEventListener('scroll', ()=>{ if(openCol) renderDrop(); }, {passive:true});
window.addEventListener('resize', ()=>{ if(openCol) renderDrop(); });
let qTimer=null;
document.addEventListener('input', e=>{
  if(e.target.id==='cfq'){ cfQ=e.target.value; renderDrop(true); }
});
document.addEventListener('change', e=>{
  if(!ROOT.contains(e.target)) return;
  const el = e.target, ds = el.dataset;
  if(el.id==='cfall'){ if(el.checked) delete CF[openCol]; else CF[openCol]=[]; render(); return; }
  if(ds.cfv!=null){ setColVal(openCol, ds.cfv, el.checked); render(); return; }
  if(ds.xset!=null){ const x=S.exp[+ds.xset]; if(ds.f==='start'){ if(el.value) x.start=el.value; } else x[ds.f]= ds.f==='owner'?el.value:num(el.value);
    if(ds.f==='target'){ const n=Math.max(0,Math.min(50,Math.round(x.target)||0)); x.target=n; const cut=x.people.slice(n).filter(p=>p.name||p.url);
      if(cut.length && !confirm(`참여자 ${cut.length}명이 적혀 있는 칸이 지워져요. 인원을 줄일까요?`)){ x.target=x.people.length; render(); return; }
      x.people=x.people.slice(0,n); } markDirty(); render(); return; }
  if(ds.xpd && el.value){ const [xi,si]=ds.xpd.split('-').map(Number), x=S.exp[xi], st=x.steps[si]; st[ds.f]=Math.round((parse(el.value)-parse(x.start))/864e5); if(st.e<st.s){ if(ds.f==='s') st.e=st.s; else st.s=st.e; } markDirty(); render(el.id); return; }
  if(ds.xp){ const [xi,si]=ds.xp.split('-').map(Number); S.exp[xi].steps[si][ds.f]=el.value; markDirty(); if(ds.f==='st') render(); else renderTop(); return; }
  if(ds.xr){ const [xi,ri]=ds.xr.split('-').map(Number), r=S.exp[xi].results[ri]; let v=el.value.trim();
    if(ds.f==='what' && v && !/^https?:\/\//i.test(v) && /^[^\s]+\.[a-z]{2,}(\/\S*)?$/i.test(v)) v='https://'+v;
    r[ds.f]=v; markDirty(); if(ds.f==='what') render(); else renderTop(); return; }
  if(ds.xq){ const [xi,pi]=ds.xq.split('-').map(Number), p=S.exp[xi].people[pi]; p[ds.f]=el.value; if(ds.f==='posted'&&el.value&&p.st!=='취소') p.st='게시완료';
    if(ds.f==='url'){ let v=el.value.trim(); if(v && !/^https?:\/\//i.test(v) && /^[^\s]+\.[^\s]+$/.test(v)) v='https://'+v; p.url=v; } markDirty(); if(['st','plan','posted','url'].includes(ds.f)) render(); else renderTop(); return; }
  if(ds.lnk){ const [ci,ii]=ds.lnk.split('-').map(Number), it=S.checklists[ci].items[ii]; let v=el.value.trim();
    if(v && !/^https?:\/\//i.test(v) && /^[^\s]+\.[^\s]+$/.test(v)) v='https://'+v; // 주소만 붙여넣어도
    it.url = v; if(/^https?:\/\/\S+$/i.test(v)) setDone(it,true); else if(!v && it.st==='완료') it.st='대기';
    markDirty(); render(); return; }
  if(ds.own2){ const [ci,ii]=ds.own2.split('-').map(Number); S.checklists[ci].items[ii].owner=el.value; markDirty(); render(); return; }
  if(ds.tdate || ds.gdate){ // 달력 날짜 상세에서 마감일 바꾸기 (시작일이 마감보다 늦어지면 같이 당긴다)
    if(!el.value) return;
    (ds.tdate ? [ds.tdate] : ds.gdate.split(',')).forEach(ref=>{
      const [k,a,b2] = ref.split('-'), A = +a, B = +b2;
      if(k==='t'){ const it = S.checklists[A].items[B]; it.e = dnum(el.value); if(it.s > it.e) it.s = it.e; }
      else { const x = S.exp[A], st = x.steps[B]; st.e = Math.round((parse(el.value)-parse(x.start))/864e5); if(st.s > st.e) st.s = st.e; }
    });
    calSel = el.value; calMonth = el.value.slice(0,7); markDirty(); render(); return; }
  if(ds.xck){ const [xi,si]=ds.xck.split('-').map(Number); S.exp[xi].steps[si].st = el.checked?'완료':'대기'; markDirty(); render(); return; }
  if(ds.ck){ const [c0,i0]=ds.ck.split('-').map(Number); if(bySheet(S.checklists[c0].items[i0], S.checklists[c0].name)){ render(); return; } }
  if(ds.ck){ const [ci,ii]=ds.ck.split('-').map(Number); setDone(S.checklists[ci].items[ii], el.checked); markDirty(); render(); return; }
  if(ds.ct){ const [ci,ii]=ds.ct.split('-').map(Number); const v=el.value.trim(); if(v){ const it=S.checklists[ci].items[ii]; it.name=v; const n=stepOfName(v); if(n) it.step=n; } else S.checklists[ci].items.splice(ii,1); markDirty(); render(); return; }
  if(ds.pname!=null){ const v=el.value.trim(); if(v){ S.checklists[+ds.pname].name=v; markDirty(); } render(); return; }
  if(ds.ch!=null){ const c=S.channels[+ds.ch]; const old=c.name; c[ds.f]= ds.f==='name'?el.value:num(el.value);
    if(ds.f==='name'){ Object.values(S.perf).forEach(p=>{ if(p[old]){ p[el.value]=p[old]; delete p[old]; } }); }
    markDirty(); render(); return; }
  if(el.id==='roasMult'){ S.roasMult=num(el.value)||1.3; markDirty(); render(); return; }
  if(ds.pf!=null){ const c=S.channels[+ds.pf]; S.perf[perfCp]=S.perf[perfCp]||{}; const r=S.perf[perfCp][c.name]=S.perf[perfCp][c.name]||{qty:0,sales:0,ad:0,adSales:0,cost:0}; r[ds.f]=num(el.value); S.perfExample=false; markDirty(); render(); return; }
  if(ds.kg!=null){ S.kpiGoal[S.kpiItems[+ds.kg]]=el.value; markDirty(); return; }
  if(ds.kv){ S.kpi[ds.kv]=S.kpi[ds.kv]||{}; S.kpi[ds.kv][S.kpiItems[+ds.ki]]=el.value; markDirty(); return; }
  if(ds.tkd!=null && el.value){ const t=TK()[+ds.tkd]; t[ds.f]=dnum(el.value); if(t.e<t.s){ if(ds.f==='s') t.e=t.s; else t.s=t.e; } markDirty(); render(el.id); return; }
  if(ds.tk!=null){ const t=TK()[+ds.tk];
    if(ds.f==='st'){ if(el.value==='완료') setDone(t,true); else t.st=el.value; }
    else if(ds.f==='step'){ t.step=+el.value; t.name=withStep(t.name,t.step); t.rec = weeklyStep(t.step)?'weekly':t.rec; }
    else if(ds.f==='name'){ t.name=withStep(el.value.trim()||'새 업무', t.step); }
    else if(ds.f==='ch'){ const to=+el.value; if(to!==t._ci){ S.checklists[t._ci].items.splice(t._ii,1); S.checklists[to].items.push(t); } }
    else t[ds.f]=el.value;
    markDirty(); if(['st','step','ch'].includes(ds.f)) render(); else renderTop(); return; }
  if(el.id==='pf-brand'){ S.product.brand=el.value; applySheet(); markDirty(); render(); return; }
  if(el.id==='pf-code'){ S.product.code=el.value.trim(); lookErr=''; markDirty(); lookupCode(); return; }
  if(el.id==='pf-name'){ S.product.name=el.value; markDirty(); return; }
  if(el.id==='pf-launch' && el.value){ S.product.launch=el.value; calMonth=null; markDirty(); render(); return; }
  if(el.id==='pf-cat'){ S.product.category=el.value; markDirty(); return; }
  if(el.id==='pf-team'){ S.product.team=el.value; markDirty(); return; }
});

/* ---------- 저장 (서버, 자동) ---------- */
const purl = () => '/api/launch/products/' + encodeURIComponent(PID);
function queueSave(){ clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); }
async function save(){
  if(!dirty || !PID) return;
  if(saving){ queueSave(); return; }
  saving = true; renderTop();
  const sent = rev, pid = PID;
  try{
    const r = await fetch('/api/launch/products/' + encodeURIComponent(pid), {method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({version: VER, state: S})});
    const j = await r.json().catch(()=>({}));
    if(pid !== PID){ saving = false; return; }
    if(r.status===409){
      S = j.state; VER = j.version; migrate(); dirty = false; savedRev = rev;
      saveErr = '다른 분이 먼저 고쳐서 최신 내용으로 다시 불러왔어요. 방금 바꾼 칸은 다시 입력해 주세요.';
      saving = false; render(); return;
    }
    if(!r.ok) throw new Error(j.error || 'save');
    VER = j.version; savedRev = sent; dirty = rev !== savedRev; saveErr = '';
  }catch(_){ saveErr = '저장하지 못했어요. 잠시 후 다시 저장할게요.'; setTimeout(queueSave, 5000); }
  saving = false; renderTop();
  if(dirty && !saveErr) queueSave();
}
// 다른 제품·목록으로 가기 전에 남은 변경을 저장한다
async function flush(){
  clearTimeout(saveTimer);
  for(let i=0; i<50 && (dirty||saving) && !saveErr; i++){ if(saving) await new Promise(r=>setTimeout(r,150)); else await save(); }
}
async function load(){
  const r = await fetch(purl());
  if(!r.ok) throw new Error('load');
  const j = await r.json();
  S = j.state; VER = j.version; migrate();
}
function setCrumb(t){ const c = document.getElementById('crumb'); if(c) c.textContent = t || ''; }

/* ---------- 제품 목록 ---------- */
const dOf = d => Math.round((parse(TODAY)-parse(d))/864e5);
async function showList(){
  PID = null; S = null; setCrumb('');
  $('#lnProduct').classList.add('hidden'); $('#lnWelcome').classList.remove('hidden');
  const box = $('#lnList'); box.classList.remove('hidden');
  let list = [];
  try{ const r = await fetch('/api/launch/products'); if(!r.ok) throw 0; list = (await r.json()).products; }
  catch(_){ box.innerHTML = '<div class="err-box">제품 목록을 불러오지 못했어요. 업무 도구 서버가 켜져 있는지 확인하고 새로고침해 주세요.</div>'; return; }
  const keep = { name: $('#lnNewName')?.value || '', launch: $('#lnNewLaunch')?.value || TODAY };
  box.innerHTML = `<section class="card"><div class="card-head"><h2>새 제품 추가</h2></div>
    <div class="ln-new">
      <div class="fg"><span class="fg-label">브랜드</span><div class="seg ln-brand" role="radiogroup" aria-label="브랜드">${BRANDS.map(b=>`<button type="button" role="radio" data-lnbrand="${b}" aria-checked="${b===newBrand}" class="${b===newBrand?'on':''}">${b}</button>`).join('')}</div></div>
      <div class="fg"><label class="fg-label" for="lnNewName">제품명</label><input class="field" id="lnNewName" placeholder="예: 블랑누아 월넛 거실장 2600" value="${esc(keep.name)}"></div>
      <div class="fg"><label class="fg-label" for="lnNewLaunch">출시일 <small>상품 등록일 = D-day</small></label><input class="field" type="date" id="lnNewLaunch" value="${keep.launch}"></div>
    </div>
    <p class="err" id="lnNewErr"></p>
    <button class="btn-dark wide" id="lnAdd">제품 추가</button></section>
  ${lnRows('진행 중인 제품', list.filter(p=>!pastP(p)), '아직 등록한 제품이 없어요. 위에서 제품을 추가하세요.')}
  ${list.some(pastP) ? `<details class="ln-past"><summary>지난 제품 ${list.filter(pastP).length}개 <span class="muted">출시 60일이 지났거나 업무를 다 끝낸 제품</span></summary>${lnRows('', list.filter(pastP), '')}</details>` : ''}`;
}
const pastP = p => dOf(p.launch) > 60 || (p.total && p.done === p.total);
function lnRows(title, list, empty){
  const rows = list.map(p=>{
    const all = p.total && p.done===p.total, c = p.late ? 'red' : all ? 'green' : 'amber';
    return `<div class="active-row ${c}" data-lnopen="${esc(p.id)}" role="button" tabindex="0"><span class="name">${p.brand?brandTag(p.brand):''}${esc(p.name)}</span><span class="muted ln-meta">출시 ${p.launch.replace(/-/g,'.')}</span><span class="ln-bar" title="완료 ${p.done}/${p.total}"><i style="width:${pct(p.done,p.total)}%"></i></span><span class="tag ${c}">완료 ${p.done}/${p.total}${p.late?` · 지연 ${p.late}`:''}</span><span class="go">열기</span><button class="del" data-lndel="${esc(p.id)}" data-name="${esc(p.name)}">삭제</button></div>`; }).join('');
  return `<section class="active-jobs">${title?`<div class="active-head">${title} <span class="count-badge">${list.length}</span></div>`:''}${rows || (empty?`<p class="active-empty">${empty}</p>`:'')}</section>`;
}
async function openProduct(id){
  await flush();
  PID = id; S = null; lookingUp = false; lookErr = ''; VER = 0; rev = savedRev = 0; dirty = false; saveErr = '';
  calMonth = null; calSel = null; expSel = 'all'; expEdit = ''; expMonth = null; expHide = {}; calHide = {}; CF = {}; openCol = null; editPeriod = -1; delPlat = -1; perfCp = 'W1'; resetArm = false;
  try{ await load(); }catch(_){ alert('이 제품을 불러오지 못했어요. 목록을 다시 볼게요.'); return showList(); }
  openSt = new Set(S.steps.map((_,i)=>i+1).filter(n=>n!==EXPN() && stepStatus(n)==='지연'));
  const shAt = Date.parse((S.product.sheet?.at||'').replace(/Z?$/,'Z')) + new Date().getTimezoneOffset()*6e4;
  if(S.product.code && sheetPending() && !(Date.now() - shAt < 30*60e3)) setTimeout(lookupCode, 300);
  $('#lnList').classList.add('hidden'); $('#lnWelcome').classList.add('hidden'); $('#lnProduct').classList.remove('hidden');
  render(); window.scrollTo(0,0);
}
async function backToList(){ await flush(); showList(); window.scrollTo(0,0); }
async function addProduct(){
  const name = $('#lnNewName').value.trim(), launch = $('#lnNewLaunch').value, err = $('#lnNewErr');
  if(!name){ err.textContent = '제품명을 입력해 주세요'; return; }
  if(!launch){ err.textContent = '출시일을 골라 주세요'; return; }
  const b = $('#lnAdd'); b.disabled = true;
  try{
    const r = await fetch('/api/launch/products', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({name, launch, brand: newBrand})});
    const j = await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.error || '추가하지 못했어요');
    $('#lnNewName').value = '';
    await openProduct(j.id);
  }catch(e){ err.textContent = e.message; }
  finally{ b.disabled = false; }
}
async function delProduct(id, name){
  if(!confirm(`'${name}' 제품의 매뉴얼(체크·일정·실적)을 지울까요?`)) return;
  const r = await fetch('/api/launch/products/' + encodeURIComponent(id), {method:'DELETE'});
  if(!r.ok) alert('지우지 못했어요. 잠시 후 다시 해 주세요.');
  showList();
}

/* ---------- 시작 ---------- */
try{ const t=localStorage.getItem('fleur-launch-tab'); if(t && TABS.some(x=>x[0]===t)) tab=t; }catch(_){}
// 사이드바·홈에서 이 화면을 열면 늘 제품 목록부터 (보던 제품의 남은 변경은 먼저 저장)
window.launchOpen = async function(){
  if(!ROOT.dataset.ready){ shell(); ROOT.dataset.ready = '1'; }
  await flush();
  showList(); window.scrollTo(0,0);
};
// 이미 이 화면에서 사이드바 항목을 다시 누르면 제품 목록으로
document.addEventListener('click', e=>{ if(e.target.closest('a[href="#/launch"]') && location.hash.replace(/^#\/?/,'')==='launch' && PID) backToList(); });
// 주소가 처음부터 #/launch면 app.js의 첫 화면 전환이 이 파일보다 먼저 돌아서 여기서 연다
if(location.hash.replace(/^#\/?/,'')==='launch') window.launchOpen();
window.addEventListener('beforeunload', ()=>{ if(dirty && PID) fetch(purl(), {method:'PUT', keepalive:true, headers:{'Content-Type':'application/json'}, body: JSON.stringify({version: VER, state: S})}); });
})();
