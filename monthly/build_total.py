# -*- coding: utf-8 -*-
"""
매출통계 토탈 — 회사별 연간 통합파일의 '그 달 회사 합계'를 `{연}_{M}월_매출통계_토탈.xlsx`에 써 넣고 검증한다.

  토탈 파일 '총연간매출통계' 시트
    - '01.플레르가구' / '02.가즈다가구' 행의 그 달 칸 = 각 회사 통합파일 요약 시트의 '{연}년 매출' 행 그 달 값
      (요약 시트의 몰 행들(다른 몰·직거래 포함)을 모두 더한 값. 수식 칸은 숫자 사칙연산만 계산한다)
    - 'OS매출' 행·과거 연도·수식·차트는 건드리지 않는다(사람이 넣는 칸)

베이스: 이번 달 토탈이 있으면 그것(같은 달 재실행), 없으면 이전 달 중 가장 최근 토탈을 복사해 쓴다.

검증 C
  1) 쓴 칸 = 회사 통합파일에서 다시 계산한 그 달 합계
  2) 이번에 쓴 칸 말고 모든 칸이 베이스와 같음(과거 이력·다른 회사·OS매출·수식 보존)

사용(보통 run_monthly.py 가 부른다):
  python build_total.py --company 플레르가구 --month 9 --master 플레르가구_2026_9월_매출통계.xlsx
"""
import argparse
import glob
import os
import re
import shutil
import sys

import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
YEAR = 2026
SHEET = "총연간매출통계"
ROW_LABEL = {"플레르가구": "플레르가구", "가즈다가구": "가즈다가구"}


def num(v):
    """칸 값 → 숫자. 빈 칸 0, 숫자 그대로, '=123-45' 같은 숫자 사칙연산 수식은 계산. 그 밖의 수식은 오류."""
    if v is None or v == "":
        return 0
    if isinstance(v, (int, float)):
        return v
    s = str(v).strip()
    if s.startswith("=") and re.fullmatch(r"=[\d+\-*/(). ]+", s):
        return eval(s[1:], {"__builtins__": {}})  # 숫자·연산자만 통과한 식
    raise ValueError(f"계산할 수 없는 칸 값: {s}")


def header(ws, first="몰이름", max_r=15):
    """'몰이름' 칸을 찾아 (머리글 행, 이름 열, {'N월': 열})"""
    for r in range(1, min(ws.max_row, max_r) + 1):
        for c in range(1, min(ws.max_column, 30) + 1):
            if str(ws.cell(r, c).value or "").strip() == first:
                cols = {str(ws.cell(r, c2).value or "").strip(): c2 for c2 in range(c + 1, ws.max_column + 1)}
                return r, c, cols
    raise ValueError(f"'{ws.title}' 시트에서 '{first}' 머리글을 찾지 못했습니다")


def company_total(master, company, month):
    """회사 통합파일 요약 시트에서 그 달 회사 합계 (= '{연}년 매출' 행 = 위 몰 행들의 합)"""
    s = openpyxl.load_workbook(master)[company]
    hr, lc, cols = header(s)
    c = cols.get(f"{month}월")
    if not c:
        raise ValueError(f"{company} 요약 시트에 '{month}월' 열이 없습니다")
    tr = next((r for r in range(hr + 1, s.max_row + 1)
               if re.fullmatch(rf"{YEAR}년\s*매출", str(s.cell(r, lc).value or "").strip())), None)
    if not tr:
        raise ValueError(f"{company} 요약 시트에 '{YEAR}년 매출' 행이 없습니다")
    return int(round(sum(num(s.cell(r, c).value) for r in range(hr + 1, tr))))


def find_base(month):
    me = os.path.join(HERE, f"{YEAR}_{month}월_매출통계_토탈.xlsx")
    if os.path.exists(me):
        return me
    cands = []
    for p in glob.glob(os.path.join(HERE, f"{YEAR}_*월_매출통계_토탈.xlsx")):
        m = re.search(r"_(\d+)월_매출통계_토탈", os.path.basename(p))
        if m and not os.path.basename(p).startswith("~$") and int(m.group(1)) < month:
            cands.append((int(m.group(1)), p))
    return max(cands)[1] if cands else None


def same(a, b):
    a = None if a == "" else a
    b = None if b == "" else b
    if isinstance(a, float) and isinstance(b, (int, float)):
        return float(f"{a:.15g}") == float(f"{b:.15g}")
    return a == b


def build(company, month, master):
    """토탈 파일을 쓰고 (불일치 수, 대조 수, 파일 경로)를 돌려준다."""
    out = os.path.join(HERE, f"{YEAR}_{month}월_매출통계_토탈.xlsx")
    base = find_base(month)
    if not base:
        print(f"  [중단] 토탈 베이스 파일({YEAR}_N월_매출통계_토탈.xlsx)이 없습니다")
        return 1, 1, None
    snap = os.path.join(HERE, "~토탈_베이스_검증용.xlsx")
    shutil.copy(base, snap)
    if base != out:
        shutil.copy(base, out)
    total = company_total(master, company, month)

    wb = openpyxl.load_workbook(out)
    ws = wb[SHEET]
    hr, lc, cols = header(ws)
    col = cols.get(f"{month}월")
    row = next((r for r in range(hr + 1, ws.max_row + 1) if ROW_LABEL[company] in str(ws.cell(r, lc).value or "")), None)
    if not col or not row:
        os.remove(snap)
        print(f"  [중단] 토탈 시트에서 '{month}월' 열 또는 '{ROW_LABEL[company]}' 행을 찾지 못했습니다")
        return 1, 1, None
    ws.cell(row, col).value = total
    wb.save(out)
    print(f"    {os.path.basename(out)} (베이스: {'같은 달 재실행' if base == out else os.path.basename(base)})")
    print(f"      {ws.cell(row, lc).value} {month}월 = {total:,}")

    # ---------- 검증 C ----------
    bad = n = 0
    W = openpyxl.load_workbook(out)[SHEET]
    P = openpyxl.load_workbook(snap)[SHEET]
    again = company_total(master, company, month)
    n += 1
    if W.cell(row, col).value != again:
        bad += 1
        print(f"      [불일치] 토탈 {month}월 {ROW_LABEL[company]}: {W.cell(row, col).value} ≠ 통합파일 {again}")
    keep_bad = []
    for r in range(1, max(W.max_row, P.max_row) + 1):
        for c in range(1, max(W.max_column, P.max_column) + 1):
            if (r, c) == (row, col):
                continue
            n += 1
            if not same(W.cell(r, c).value, P.cell(r, c).value):
                bad += 1
                keep_bad.append(f"{openpyxl.utils.get_column_letter(c)}{r}: {P.cell(r, c).value} → {W.cell(r, c).value}")
    os.remove(snap)
    tag = "OK" if not bad else "불일치"
    print(f"  [{tag}] 토탈 파일 (이번 달 칸 + 나머지 칸 보존): {n:,}건 대조, 불일치 {bad}건")
    for k in keep_bad[:15]:
        print("      " + k)
    return bad, n, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--company", required=True, choices=list(ROW_LABEL))
    ap.add_argument("--month", required=True, type=int)
    ap.add_argument("--master", required=True)
    a = ap.parse_args()
    bad, _, _ = build(a.company, a.month, a.master)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
