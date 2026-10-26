# -*- coding: utf-8 -*-
r"""
월간 매출 통계 — 한 번에 실행 + 오류 0% 검증
------------------------------------------------------------------
원본 파일을 받아 아래를 순서대로 하고, 어느 단계든 불일치가 나오면 **멈춘다**.

  1. 파일 판별 + 기간 확인 (네이버가 1일~말일 한 달치인지, 오집·자사몰 주문일이 그 달 안인지)
  2. 원본을 `{회사} 자료\YYYY-MM\` 에 사본 보관
  3. 월간판매데이터 생성  → `2026_{회사} 월간판매데이터 (M월).xlsx`
  4. [검증 A] 원본 ↔ 월간파일   (채널 합계·채널 시트 합·통합순위 합·결제수량)
  5. 연간 통합파일 작성   → `{회사}_2026_M월_매출통계.xlsx`
  6. [검증 B] 월간파일 ↔ 통합파일 (이번 달 블록 칸 단위 + 요약 칸 + **과거 이력이 한 칸도 안 바뀜**)

사용:
  python run_monthly.py --company 플레르가구 <네이버> <쿠팡> <오늘의집> <자사몰csv> --cafe24-net 6819780
  python run_monthly.py --company 가즈다가구 <네이버> <쿠팡> <오늘의집>

자사몰 순매출(--cafe24-net)은 카페24 관리자 → 통계 → 매출분석 → 월별 매출의 '순매출'.
주문내역 CSV에는 환불이 안 담겨 이 값을 만들 수 없다(인수인계 11절).
"""
import argparse
import calendar
import csv
import datetime as dt
import glob
import importlib.util
import os
import re
import shutil
import subprocess
import sys
import tempfile
import warnings

import openpyxl

warnings.filterwarnings("ignore")   # openpyxl 기본 스타일 경고(동작과 무관) 숨김

HERE = os.path.dirname(os.path.abspath(__file__))
YEAR = 2026


def load_engine():
    p = os.path.join(os.path.dirname(HERE), "주간 매출 통계", "generate_weekly_sales.py")
    spec = importlib.util.spec_from_file_location("weekly_engine", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def stop(msg):
    print(f"\n[중단] {msg}")
    sys.exit(1)


def run(args):
    env = dict(os.environ, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    r = subprocess.run([sys.executable, "-X", "utf8", "-W", "ignore"] + args,
                       cwd=HERE, env=env, capture_output=True, text=True, encoding="utf-8")
    out = (r.stdout or "") + (r.stderr or "")
    for line in out.strip().splitlines():
        print("    " + line)
    if r.returncode != 0:
        stop(f"{os.path.basename(args[0])} 실행 실패")
    return out


# ----------------------------------------------------------------------
# 1. 파일 판별 + 기간 확인
# ----------------------------------------------------------------------
def identify(gw, paths, company):
    tmp = tempfile.mkdtemp(prefix="monthly_")
    for p in paths:
        if not os.path.exists(p):
            stop(f"파일이 없습니다: {p}")
        shutil.copy(p, tmp)
    f = gw.classify_files(tmp)
    missing = [k for k, n in [("naver", "네이버"), ("coupang", "쿠팡"), ("ohouse", "오늘의집")]
               if not f.get(k)]
    if missing:
        stop("다음 파일을 알아보지 못했습니다: " + ", ".join(missing) +
             "\n  네이버는 '상품별' 판매통계(sales_YYYYMMDD-YYYYMMDD_*.xlsx, 헤더에 채널상품명)여야 합니다."
             "\n  토스 '전체주문조회'·네이버 '카테고리별' 통계는 안 됩니다.")
    if company == "가즈다가구" and f.get("cafe24"):
        stop("가즈다는 자사몰이 없는데 카페24 CSV가 섞여 있습니다. 플레르 파일인지 확인하세요.")
    return tmp, f


def naver_month(path):
    m = re.search(r"(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})", os.path.basename(path))
    if not m:
        stop("네이버 파일명에서 기간을 읽지 못했습니다(sales_YYYYMMDD-YYYYMMDD_…).")
    y1, m1, d1, y2, m2, d2 = map(int, m.groups())
    last = calendar.monthrange(y1, m1)[1]
    if not (y1 == y2 and m1 == m2 and d1 == 1 and d2 == last):
        stop(f"네이버 기간이 한 달치가 아닙니다: {y1}.{m1:02d}.{d1:02d}~{y2}.{m2:02d}.{d2:02d}\n"
             f"  {y1}.{m1:02d}.01 ~ {y1}.{m1:02d}.{last} 로 다시 받으세요.")
    return y1, m1


def check_dates(gw, f, year, month, pw):
    """오늘의집 '주문결제완료일', 자사몰 '발주일'이 모두 그 달 안인지."""
    problems = []
    wb = gw.load_workbook_any(f["ohouse"], password=pw)
    ws = wb.worksheets[0]
    m = gw.header_map(ws)
    c = m.get("주문결제완료일")
    if c:
        bad = 0
        for r in range(2, ws.max_row + 1):
            v = ws.cell(r, c).value
            if v is None:
                continue
            d = v if isinstance(v, (dt.datetime, dt.date)) else None
            if d is None:
                mm = re.search(r"(\d{4})[-./](\d{1,2})", str(v))
                if mm:
                    d = dt.date(int(mm.group(1)), int(mm.group(2)), 1)
            if d and (d.year, d.month) != (year, month):
                bad += 1
        if bad:
            problems.append(f"오늘의집: 주문결제완료일이 {month}월이 아닌 행 {bad}개")
    if f.get("cafe24"):
        with open(f["cafe24"], encoding="utf-8-sig", newline="") as fh:
            rows = list(csv.reader(fh))
        h = {x.strip(): i for i, x in enumerate(rows[0])}
        i = h.get("발주일")
        if i is not None:
            bad = sum(1 for r in rows[1:] if r and len(r) > i and r[i][:7] != f"{year}-{month:02d}")
            if bad:
                problems.append(f"자사몰: 발주일이 {month}월이 아닌 주문 {bad}행")
    return problems


# ----------------------------------------------------------------------
# 검증 도구
# ----------------------------------------------------------------------
class Check:
    def __init__(self, name):
        self.name, self.n, self.bad, self.msgs = name, 0, 0, []

    def eq(self, label, a, b):
        self.n += 1
        if a != b:
            self.bad += 1
            if len(self.msgs) < 15:
                self.msgs.append(f"      {label}: {a!r} ≠ {b!r}")

    def report(self):
        mark = "OK" if self.bad == 0 else "불일치"
        print(f"  [{mark}] {self.name}: {self.n:,}건 대조, 불일치 {self.bad}건")
        for m in self.msgs:
            print(m)
        return self.bad


def col_of(ws, label, row=3):
    for c in range(2, ws.max_column + 1):
        if str(ws.cell(row, c).value or "").strip() == label:
            return c
    return None


def sum_col(ws, header, r0=4):
    c = col_of(ws, header)
    if c is None:
        return None
    return sum(v for v in (ws.cell(r, c).value for r in range(r0, ws.max_row + 1))
               if isinstance(v, (int, float)))


# ----------------------------------------------------------------------
# [검증 A] 원본 ↔ 월간파일
# ----------------------------------------------------------------------
def verify_monthly(gw, f, monthly, month, cafe24_net, pw):
    sys.path.insert(0, HERE)
    import generate_monthly_sales as gm

    n_tot, n_ps = gw.parse_naver(f["naver"])
    c_tot, c_ps = gw.parse_coupang(f["coupang"])
    o_tot, o_ps = gw.parse_ohouse(f["ohouse"], password=pw)
    k_tot, k_ps = (gw.parse_cafe24(f["cafe24"]) if f.get("cafe24") else (None, []))

    wb = openpyxl.load_workbook(monthly)
    s = wb["매출데이터"]
    mcol = col_of(s, f"{month}월")
    rows = {str(s.cell(r, 1).value or "").strip(): r for r in range(4, 10)}
    val = lambda ch: s.cell(rows[ch], mcol).value if ch in rows and mcol else None

    A = Check("원본 ↔ 월간파일 채널 합계")
    A.eq("네이버", val("네이버"), int(round(n_tot)))
    A.eq("쿠팡", val("쿠팡"), int(round(c_tot)))
    A.eq("오늘의집", val("오늘의집"), int(round(o_tot)))
    if f.get("cafe24"):
        A.eq("자사몰(카페24 순매출)", val("자사몰"), cafe24_net)
    chans = [ch for ch in ("네이버", "쿠팡", "오늘의집", "자사몰") if ch in rows]
    A.eq("합계", val("합계"), sum(val(ch) or 0 for ch in chans))
    bad = A.report()

    # 쿠팡 순위표는 매출 0 이하(환불) 옵션을 뺀다 → 그 금액만큼 차이가 나는 게 정상
    c_neg = 0
    ws = gw.load_workbook_any(f["coupang"]).worksheets[0]
    hm = gw.header_map(ws)
    ca = gw.col(hm, "매출(원)")
    c_neg = sum(v for v in (gw.num(ws.cell(r, ca).value) for r in range(2, ws.max_row + 1)) if v <= 0)

    B = Check("원본 ↔ 채널 시트 금액 합")
    B.eq("네이버 시트 '금액' 합", sum_col(wb["네이버"], "금액"), int(round(n_tot)))
    B.eq("쿠팡 시트 '결제금액' 합", sum_col(wb["쿠팡"], "결제금액"), int(round(c_tot - c_neg)))
    B.eq("오늘의집 시트 '결제금액' 합", sum_col(wb["오늘의집"], "결제금액"), int(round(o_tot)))
    if f.get("cafe24"):
        B.eq("자사몰 시트 '금액' 합", sum_col(wb["자사몰"], "금액"), int(round(k_tot)))
    bad += B.report()

    # 통합순위
    u = wb["통합순위"]
    cols = {str(u.cell(3, c).value or "").strip(): c for c in range(1, u.max_column + 1)}
    tot = {k: 0 for k in ("네이버", "쿠팡", "오늘의집", "합계", "결제수량")}
    zero_qty = []
    for r in range(4, u.max_row + 1):
        if not u.cell(r, 2).value:
            continue
        for k in tot:
            if k in cols:
                tot[k] += u.cell(r, cols[k]).value or 0
        if (u.cell(r, cols["합계"]).value or 0) == 0 and (u.cell(r, cols["결제수량"]).value or 0) != 0:
            zero_qty.append(u.cell(r, 2).value)

    nq = gm.naver_quantities(gw, f["naver"])
    oq = gm.ohouse_quantities(gw, f["ohouse"], pw)
    cq = sum(o.get("판매수", 0) for p in c_ps for o in p["옵션들"])
    C = Check("월간파일 통합순위")
    C.eq("네이버 합", tot["네이버"], int(round(n_tot)))
    C.eq("쿠팡 합(환불 옵션 제외)", tot["쿠팡"], int(round(c_tot - c_neg)))
    C.eq("오늘의집 합", tot["오늘의집"], int(round(o_tot)))
    C.eq("합계 열 = 채널 합", tot["합계"], tot["네이버"] + tot["쿠팡"] + tot["오늘의집"])
    C.eq("결제수량 합 = 원본 순수량", tot["결제수량"], int(round(sum(nq.values()) + cq + sum(oq.values()))))
    C.eq("매출 0원인데 수량 있는 행", len(zero_qty), 0)
    bad += C.report()

    totals = {ch: val(ch) for ch in chans}
    totals["합계"] = val("합계")
    return bad, A.n + B.n + C.n, totals, {"쿠팡환불": -c_neg, "자사몰CSV": k_tot}


# ----------------------------------------------------------------------
# [검증 B] 월간파일 ↔ 통합파일 (+ 과거 이력 보존)
# ----------------------------------------------------------------------
def verify_master(prev_master, new_master, monthly, month, company):
    sys.path.insert(0, HERE)
    import build_master as bm

    D = openpyxl.load_workbook(monthly)
    W = openpyxl.load_workbook(new_master)
    P = openpyxl.load_workbook(prev_master) if prev_master else None

    X = Check("월간파일 ↔ 통합파일 이번 달 블록")
    regions = {}
    for sheet, src, width, _t in bm.RANK_SHEETS:
        if src not in D.sheetnames:
            continue
        ws = W[sheet]
        c0 = bm.find_block(ws, month)
        if c0 is None:
            X.eq(f"{sheet} {month}월 블록", "없음", "있음")
            continue
        regions[sheet] = (c0, c0 + width - 1)
        # 1행 기간 표기는 없어야 한다(사용자 요청)
        X.eq(f"{sheet} 1행 기간 표기 수", sum(1 for c in range(1, ws.max_column + 1)
                                             if bm.PERIOD_RE.match(str(ws.cell(1, c).value or ""))), 0)
        _h, rows = bm.read_rank(D[src], width)
        got = []
        for r in range(4, ws.max_row + 1):
            v = [ws.cell(r, c).value for c in range(c0, c0 + width)]
            if all(x is None for x in v):
                continue
            got.append(v)
        X.eq(f"{sheet} 행 수", len(got), len(rows))
        for i in range(max(len(got), len(rows))):
            a = got[i] if i < len(got) else [None] * width
            b = rows[i] if i < len(rows) else [None] * width
            for j in range(width):
                X.eq(f"{sheet} {i + 4}행 {j + 1}열", a[j], b[j])

    s = W[company]
    d = D["매출데이터"]
    mcol_d = col_of(d, f"{month}월")
    totals = {str(d.cell(r, 1).value or "").strip(): d.cell(r, mcol_d).value for r in range(4, 9)}
    lcol, col = bm.summary_layout(s, month)
    touched = set()
    for r in range(4, s.max_row + 1):
        ch = bm.SUMMARY_MAP.get(bm.mall_key(s.cell(r, lcol).value))
        if ch and ch in totals and totals[ch] is not None:
            X.eq(f"요약 {s.cell(r, lcol).value} {month}월", s.cell(r, col).value, totals[ch])
            touched.add((company, r, col))
    bad = X.report()

    if P is None:
        print("  [건너뜀] 과거 이력 보존 검사: 이전 통합파일 없음(새로 만듦)")
        return bad, X.n

    Y = Check("과거 이력 보존 (이번 달 외 모든 칸이 그대로인지)")
    for name in P.sheetnames:
        if name not in W.sheetnames:
            Y.eq(f"시트 '{name}'", "삭제됨", "있음")
            continue
        a, b = P[name], W[name]
        lo, hi = regions.get(name, (0, -1))
        for r in range(1, max(a.max_row, b.max_row) + 1):
            for c in range(1, max(a.max_column, b.max_column) + 1):
                if lo <= c <= hi and r >= 2:
                    continue                      # 이번 달 블록
                if r == 1 and bm.PERIOD_RE.match(str(a.cell(r, c).value or "")) and b.cell(r, c).value in (None, ""):
                    continue                      # 1행 기간 표기를 지운 칸(의도한 변경)
                if (name, r, c) in touched:
                    continue                      # 이번 달 요약 칸
                # 빈 칸(None)과 빈 문자열('')은 엑셀에서 똑같이 빈 칸이다(저장하며 표기만 바뀜)
                bv, av = b.cell(r, c).value, a.cell(r, c).value
                # 소수는 엑셀이 15자리까지만 저장해서 다시 저장하면 끝자리가 바뀔 수 있다 → 15자리로 맞춰 비교
                if isinstance(bv, float) and isinstance(av, (int, float)) and float(f"{bv:.15g}") == float(f"{av:.15g}"):
                    bv = av
                Y.eq(f"{name}!{openpyxl.utils.get_column_letter(c)}{r}",
                     None if bv == "" else bv, None if av == "" else av)
    bad += Y.report()
    return bad, X.n + Y.n


# ----------------------------------------------------------------------
def main():
    ap = argparse.ArgumentParser(description="월간 매출 통계 실행 + 검증")
    ap.add_argument("--company", required=True, choices=["플레르가구", "가즈다가구"])
    ap.add_argument("files", nargs="+", help="원본 파일들 (순서 무관)")
    ap.add_argument("--cafe24-net", type=int,
                    help="자사몰 순매출 (카페24 관리자 > 통계 > 매출분석 > 월별 매출 '순매출')")
    ap.add_argument("--no-cafe24", action="store_true", help="이번 달 자사몰 판매 없음")
    a = ap.parse_args()

    company = a.company
    gw = load_engine()
    pw = gw.DEFAULT_OHOUSE_PW

    print(f"=== {company} 월간 매출 통계 ===")
    print("[1] 파일 판별")
    tmp, f = identify(gw, a.files, company)
    year, month = naver_month(f["naver"])
    for k, n in [("naver", "네이버"), ("coupang", "쿠팡"), ("ohouse", "오늘의집"), ("cafe24", "자사몰")]:
        if f.get(k):
            print(f"    {n:5} {os.path.basename(f[k])}")
    print(f"    대상: {year}년 {month}월")

    if company == "플레르가구":
        if a.no_cafe24:
            f["cafe24"] = None
        elif not f.get("cafe24"):
            stop("플레르 자사몰(카페24) CSV가 없습니다. 이번 달 자사몰 판매가 없었다면 --no-cafe24.")
        elif a.cafe24_net is None:
            stop("자사몰 순매출(--cafe24-net)이 필요합니다.\n"
                 "  카페24 관리자 > 통계 > 매출분석 > 월별 매출 에서 해당 월의 '순매출' 값을 넣으세요.\n"
                 "  (주문내역 CSV에는 환불이 안 담겨 순매출을 만들 수 없습니다)")

    probs = check_dates(gw, f, year, month, pw)
    if probs:
        stop("원본 기간이 맞지 않습니다:\n  " + "\n  ".join(probs))
    print("    기간 확인 OK (오늘의집 결제완료일" + ("·자사몰 발주일" if f.get("cafe24") else "")
          + " 모두 그 달 안)")

    # 2. 원본 사본 보관
    arch = os.path.join(HERE, f"{company} 자료", f"{year}-{month:02d}")
    os.makedirs(arch, exist_ok=True)
    for k in ("naver", "coupang", "ohouse", "cafe24"):
        if f.get(k):
            dst = os.path.join(arch, os.path.basename(f[k]))
            shutil.copy(f[k], dst)
            f[k] = dst
    shutil.rmtree(tmp, ignore_errors=True)
    print(f"[2] 원본 사본 보관: {company} 자료\\{year}-{month:02d}\\")

    # 3. 월간파일
    monthly = os.path.join(HERE, f"{year}_{company} 월간판매데이터 ({month}월).xlsx")
    prev_monthly = os.path.join(HERE, f"{year}_{company} 월간판매데이터 ({month - 1}월).xlsx")
    args = ["generate_monthly_sales.py", "--brand", company,
            "--naver", f["naver"], "--coupang", f["coupang"], "--ohouse", f["ohouse"],
            "--out", monthly]
    if os.path.exists(prev_monthly):
        args += ["--base", prev_monthly]
    if f.get("cafe24"):
        args += ["--cafe24", f["cafe24"], "--cafe24-net", str(a.cafe24_net)]
    print(f"[3] 월간판매데이터 생성")
    run(args)

    # 4. 검증 A
    print("[4] 검증 A — 원본 ↔ 월간파일")
    bad_a, n_a, totals, extra = verify_monthly(gw, f, monthly, month, a.cafe24_net, pw)
    if bad_a:
        stop(f"검증 A 불일치 {bad_a}건. 통합파일은 만들지 않았습니다.")

    # 5. 통합파일
    # 베이스 통합파일 고르기 — 연간 이력(과거 연도·다른 몰)이 들어 있으므로 절대 새로 만들지 않는다.
    #   ① 이번 달 통합파일이 이미 있으면 그것(같은 달 재실행)
    #   ② 없으면 그 이전 달 중 가장 최근 것
    #   ③ 하나도 없을 때만 새로 만든다
    master = os.path.join(HERE, f"{company}_{year}_{month}월_매출통계.xlsx")
    if os.path.exists(master):
        prev_master = master
    else:
        def mnum(p):
            return int(re.search(r"_(\d+)월_", os.path.basename(p)).group(1))
        cands = [p for p in glob.glob(os.path.join(HERE, f"{company}_{year}_*월_매출통계.xlsx"))
                 if mnum(p) < month]
        prev_master = max(cands, key=mnum) if cands else None
    label = ("같은 달 재실행" if prev_master == master
             else os.path.basename(prev_master) if prev_master else "없음 → 새로 만듦")
    print(f"[5] 연간 통합파일 작성 (베이스: {label})")
    # 채널 4칸(스마트스토어·쿠팡·오늘의집·카페24)은 원본으로 검증된 값이므로 덮어쓴다.
    # 다른 몰 칸·수식·과거 이력은 build_master 가 원래 건드리지 않는다.
    margs = ["build_master.py", "--month", str(month), "--brand", company,
             "--data", monthly, "--out", master, "--overwrite"]
    margs += ["--master", prev_master] if prev_master else ["--create"]
    # 이전 통합파일을 검증용으로 미리 떠 둔다(같은 파일에 덮어쓰는 경우 대비)
    snap = None
    if prev_master:
        snap = os.path.join(tempfile.gettempdir(), f"_prev_master_{company}.xlsx")
        shutil.copy(prev_master, snap)
    run(margs)

    # 6. 검증 B
    print("[6] 검증 B — 월간파일 ↔ 통합파일 (+ 과거 이력 보존)")
    bad_b, n_b = verify_master(snap, master, monthly, month, company)
    if snap:
        os.remove(snap)

    # 7. 매출통계 토탈 (두 회사 월 합계를 한 장에) + 검증 C
    print("[7] 매출통계 토탈 작성 + 검증 C")
    sys.path.insert(0, HERE)
    import build_total
    bad_c, n_c, total_file = build_total.build(company, month, master)

    # 공통 서식(글꼴·크기·테두리·정렬) — 주간 파일·구글 시트와 같은 모양으로
    import sheet_style
    for p in (monthly, master, total_file):
        if p and os.path.exists(p):
            sheet_style.normalize_file(p)
    print("[8] 서식 맞춤: 월간파일·통합파일·토탈")

    total = n_a + n_b + n_c
    bad = bad_a + bad_b + bad_c
    print("\n[요약]")
    for ch in ("네이버", "쿠팡", "오늘의집", "자사몰", "합계"):
        if ch in totals and totals[ch] is not None:
            print(f"  {ch:6} {totals[ch]:>14,}")
    if extra.get("쿠팡환불"):
        print(f"  (쿠팡 환불 옵션 {int(extra['쿠팡환불']):,}원은 순위표에서 제외 — 정상)")
    if extra.get("자사몰CSV") is not None and a.cafe24_net is not None:
        print(f"  (자사몰 순위표 합 {int(extra['자사몰CSV']):,} = 주문 기준 / 매출데이터 {a.cafe24_net:,} = 순매출 — 정상)")
    print(f"\n[검증] 총 {total:,}건 대조, 불일치 {bad}건 → 오류율 {bad / max(total, 1) * 100:.4f}%")
    print(f"[결과] {os.path.basename(master)}")
    if total_file:
        print(f"       {os.path.basename(total_file)}")
    print(f"       {os.path.basename(monthly)}")
    if bad:
        stop("불일치가 있습니다. 위 목록을 확인하세요.")


if __name__ == "__main__":
    main()
