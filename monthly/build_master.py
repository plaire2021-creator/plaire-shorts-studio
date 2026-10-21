# -*- coding: utf-8 -*-
"""
연간 매출통계 통합파일 작성기 — `플레르가구_YYYY_M월_매출통계.xlsx` 양식
------------------------------------------------------------------
월간판매데이터 파일(`2026_{회사} 월간판매데이터 (N월).xlsx`)을 읽어
연간 통합파일의 해당 월 자리에 그대로 써 넣는다. 매달 손으로 붙여넣던 작업을 대신한다.

통합파일 구조 (업로드본 기준)
  · `플레르가구`        : 몰이름(행) × 월(열). B=작년/12월, C=1월 … N=12월, O=총계, P=평균
  · `네이버 매출순위`   : 월별 블록을 좌→우. 블록폭 8 + 간격 1 (= 9)
  · `쿠팡 매출순위`     : 블록폭 7 + 간격 1 (= 8)
  · `오늘의집 매출순위` : 블록폭 7 + 간격 1 (= 8)
  · `자사몰 매출순위`   : 블록폭 6 + 간격 1 (= 7)
  각 블록: 2행=제목, 3행=헤더, 4행~=데이터. 1열은 순위(제품 첫 행에만).

안전장치
  · 요약 시트는 **채널 4칸(스마트스토어·쿠팡·오늘의집·카페24)만** 쓴다.
    나머지 몰(11번가·ESM·한샘몰·토스·직거래건 등)은 자료가 없으므로 건드리지 않는다.
  · 이미 값이 있는 칸은 `--overwrite` 없이는 덮어쓰지 않는다(손으로 넣은 수치 보호).
  · 같은 달 블록이 이미 있으면 그 자리에 다시 쓴다(새 블록을 만들지 않는다).

사용:
  python build_master.py --month 9 --data "2026_플레르가구 월간판매데이터 (9월).xlsx" \
      --master "플레르가구_2026_9월_매출통계.xlsx" --out "플레르가구_2026_9월_매출통계.xlsx"
"""
import argparse
import calendar
from copy import copy
import os
import re
import shutil

import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HDR_FILL = PatternFill("solid", fgColor="D9E1F2")
HDR_FONT = Font(bold=True)
TITLE_FONT = Font(bold=True, size=12)
CENTER = Alignment(horizontal="center", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")

# 순위 시트: (통합파일 시트명, 월간파일 시트명, 블록폭, 제목형식)
RANK_SHEETS = [
    ("네이버 매출순위", "네이버", 8, "{brand} 네이버 매출 TOP 20 상품 리스트 ({m}월)"),
    ("쿠팡 매출순위", "쿠팡", 7, "{short} 쿠팡 매출 TOP 20 상품 리스트 ({m}월)"),
    ("오늘의집 매출순위", "오늘의집", 7, "{short} 오늘의집 매출 TOP 20 상품 리스트 ({m}월)"),
    ("자사몰 매출순위", "자사몰", 6, "{short} 자사몰 매출 상품 리스트 ({m}월)"),
]

# 요약 시트에서 자동으로 채우는 몰 ↔ 월간파일 채널.
# 앞의 번호(01. 04. …)는 회사마다 다르므로 떼고 **몰 이름으로** 맞춘다.
SUMMARY_MAP = {"스마트스토어": "네이버", "쿠팡": "쿠팡",
               "오늘의 집": "오늘의집", "오늘의집": "오늘의집", "카페24": "자사몰"}
# 새 통합파일을 만들 때 쓸 몰 이름 (월간파일에 있는 채널만 넣는다)
NEW_MALL_NAME = {"네이버": "스마트스토어", "쿠팡": "쿠팡",
                 "오늘의집": "오늘의 집", "자사몰": "카페24"}


def mall_key(name):
    """'01. 스마트스토어' → '스마트스토어'"""
    return re.sub(r"^\s*\d+\s*\.\s*", "", str(name or "")).strip()


def month_col(month):
    """요약 시트의 월 열 번호. C(3)=1월 … N(14)=12월."""
    return month + 2


def summary_layout(ws, month):
    """요약 시트에서 (몰 이름 열, 이번 달 열)을 머리글 글자로 찾는다.
    회사마다 표가 A열에서 시작하기도(플레르) B열에서 시작하기도(가즈다) 해서 위치를 고정하지 않는다.
    '몰이름' 칸이 있는 행이 머리글이고, 같은 행에서 'N월' 칸이 이번 달 열이다. 못 찾으면 예전 고정 위치."""
    for r in range(1, min(ws.max_row, 15) + 1):
        for c in range(1, min(ws.max_column, 30) + 1):
            if str(ws.cell(r, c).value or "").strip() == "몰이름":
                for c2 in range(c + 1, ws.max_column + 1):
                    if str(ws.cell(r, c2).value or "").strip() == f"{month}월":
                        return c, c2
    return 1, month_col(month)


def find_block(ws, month):
    """2행에서 '(N월)' 제목을 찾아 그 블록의 시작 열을 돌려준다. 없으면 None."""
    pat = re.compile(rf"\(\s*{month}\s*월\s*\)")
    for c in range(1, ws.max_column + 1):
        v = ws.cell(2, c).value
        if v and pat.search(str(v)):
            return c
    return None


def next_block_col(ws, width):
    """마지막 블록 오른쪽에 새 블록을 놓을 열. 블록이 하나도 없으면 1열."""
    last = 0
    for c in range(1, ws.max_column + 1):
        v = ws.cell(2, c).value
        if v and re.search(r"\(\s*\d+\s*월\s*\)", str(v)):
            last = c
    return 1 if last == 0 else last + width + 1


def read_rank(ws, width):
    """월간파일 순위 시트 → 헤더, 데이터행들."""
    header = [ws.cell(3, c).value for c in range(1, width + 1)]
    rows = []
    for r in range(4, ws.max_row + 1):
        vals = [ws.cell(r, c).value for c in range(1, width + 1)]
        if all(v is None for v in vals):
            continue
        rows.append(vals)
    return header, rows


PERIOD_RE = re.compile(r"^\s*\d{4}\.\d{2}\.\d{2}\s*~\s*\d{4}\.\d{2}\.\d{2}\s*$")


def month_period(year, month):
    """1행 기간 표기: '2026.09.01~2026.09.30'"""
    last = calendar.monthrange(year, month)[1]
    return f"{year}.{month:02d}.01~{year}.{month:02d}.{last:02d}"


def clear_periods(ws):
    """순위 시트 1행의 기간 표기('2026.09.01~2026.09.30')와 그 병합을 모두 지운다(사용자 요청: 1행 표기 없음)."""
    n = 0
    for rng in list(ws.merged_cells.ranges):
        if rng.min_row == 1 and rng.max_row == 1 and PERIOD_RE.match(str(ws.cell(1, rng.min_col).value or "")):
            ws.unmerge_cells(str(rng))
    for c in range(1, ws.max_column + 1):
        if PERIOD_RE.match(str(ws.cell(1, c).value or "")):
            ws.cell(1, c).value = None
            n += 1
    return n


def write_block(ws, col0, title, header, rows, width):
    """통합파일에 한 달치 블록을 쓴다(제목 2행 / 헤더 3행 / 데이터 4행~)."""
    # 블록 영역에 걸친 병합을 먼저 푼다(병합 셀은 값을 못 쓴다). 1행은 건드리지 않는다
    for rng in list(ws.merged_cells.ranges):
        if rng.max_row >= 2 and rng.min_col <= col0 + width - 1 and rng.max_col >= col0:
            ws.unmerge_cells(str(rng))

    # 기존 블록 자리를 비운다(이전 달 잔재가 남지 않게)
    for r in range(2, ws.max_row + 1):
        for c in range(col0, col0 + width):
            ws.cell(r, c).value = None

    t = ws.cell(2, col0, title)
    t.font = TITLE_FONT
    ws.merge_cells(start_row=2, start_column=col0,
                   end_row=2, end_column=col0 + width - 1)   # 제목은 블록 폭만큼 병합
    for i, h in enumerate(header):
        cell = ws.cell(3, col0 + i, h)
        cell.font = HDR_FONT
        cell.fill = HDR_FILL
        cell.alignment = CENTER
        cell.border = BOX
    for j, vals in enumerate(rows):
        r = 4 + j
        for i, v in enumerate(vals):
            cell = ws.cell(r, col0 + i, v)
            cell.border = BOX
            if isinstance(v, (int, float)) and i >= 3:
                cell.number_format = "#,##0"
                cell.alignment = RIGHT
            elif i == 0:
                cell.alignment = CENTER
    # 열너비는 월간파일 것을 따라간다
    return len(rows)


def create_master(path, brand, channels):
    """빈 연간 통합파일을 만든다(플레르 양식과 같은 구조).
    몰 목록은 월간파일에 들어 있는 채널만 넣는다 — 모르는 몰을 지어내지 않는다."""
    wb = openpyxl.Workbook()
    s = wb.active
    s.title = brand
    s["A1"] = f"㈜{brand} 2026 연간 매출통계"
    s["A1"].font = Font(bold=True, size=14)
    s.merge_cells(start_row=1, start_column=1, end_row=1, end_column=15)

    head = ["몰이름", "작년/12월"] + [f"{i}월" for i in range(1, 13)] + ["총계", "평균"]
    for i, h in enumerate(head, 1):
        cell = s.cell(3, i, h)
        cell.font = HDR_FONT
        cell.fill = HDR_FILL
        cell.alignment = CENTER
        cell.border = BOX

    r = 4
    for ch in channels:
        s.cell(r, 1, f"{r - 3:02d}. {NEW_MALL_NAME[ch]}").border = BOX
        s.cell(r, 15, f"=SUM(C{r}:N{r})").number_format = "#,##0"
        s.cell(r, 16, f"=SUM(O{r}/12)").number_format = "#,##0"
        for c in range(2, 17):
            s.cell(r, c).border = BOX
            if c <= 14:
                s.cell(r, c).number_format = "#,##0"
        r += 1
    last = r - 1
    s.cell(r, 1, "2026년 매출").font = HDR_FONT
    for c in range(2, 15):
        L = openpyxl.utils.get_column_letter(c)
        s.cell(r, c, f"=SUM({L}4:{L}{last})").number_format = "#,##0"
    s.cell(r, 15, f"=SUM(C{r}:N{r})").number_format = "#,##0"
    s.cell(r, 16, f"=SUM(O{r}/12)").number_format = "#,##0"
    for c in range(1, 17):
        s.cell(r, c).border = BOX
        s.cell(r, c).fill = HDR_FILL
    s.column_dimensions["A"].width = 18
    for c in range(2, 17):
        s.column_dimensions[openpyxl.utils.get_column_letter(c)].width = 14

    for sheet_name, src, _w, _t in RANK_SHEETS:
        if src in ("자사몰",) and "자사몰" not in channels:
            continue
        wb.create_sheet(sheet_name)
    wb.save(path)
    return path


def main():
    ap = argparse.ArgumentParser(description="연간 매출통계 통합파일 작성기")
    ap.add_argument("--data", required=True, help="2026_{회사} 월간판매데이터 (N월).xlsx")
    ap.add_argument("--master", help="연간 통합파일(입력). 없으면 --create 로 새로 만든다")
    ap.add_argument("--create", action="store_true",
                    help="통합파일이 없을 때 양식대로 새로 만든다")
    ap.add_argument("--out", help="결과 파일 (기본: master 덮어쓰기)")
    ap.add_argument("--month", type=int, required=True, help="월 숫자 (예: 9)")
    ap.add_argument("--brand", default="플레르가구")
    ap.add_argument("--year", type=int, default=2026, help="연도 (1행 기간 표기용)")
    ap.add_argument("--summary-sheet", default=None, help="요약 시트명 (기본: 브랜드명)")
    ap.add_argument("--overwrite", action="store_true",
                    help="요약 시트에 이미 값이 있어도 덮어쓴다")
    a = ap.parse_args()

    out = a.out or a.master
    if not out:
        raise SystemExit("--out 또는 --master 중 하나는 있어야 합니다.")

    D = openpyxl.load_workbook(a.data)
    if a.master and os.path.exists(a.master):
        if os.path.abspath(out) != os.path.abspath(a.master):
            shutil.copyfile(a.master, out)
    elif a.create or not os.path.exists(out):
        d = D["매출데이터"]
        chans = [str(d.cell(r, 1).value or "").strip() for r in range(4, 9)]
        chans = [c for c in chans if c in NEW_MALL_NAME]
        create_master(out, a.brand, chans)
        print(f"[새로 만듦] {out}  (몰: {', '.join(NEW_MALL_NAME[c] for c in chans)})")
    else:
        raise SystemExit(f"통합파일을 찾을 수 없습니다: {a.master}")
    W = openpyxl.load_workbook(out)
    short = a.brand.replace("가구", "")
    m = a.month

    print(f"[{a.brand} {m}월] 통합파일: {os.path.basename(out)}")

    for sheet_name, src_name, width, title_fmt in RANK_SHEETS:
        if src_name not in D.sheetnames:
            print(f"  - {sheet_name}: 월간파일에 '{src_name}' 시트 없음 → 건너뜀")
            continue
        if sheet_name not in W.sheetnames:
            W.create_sheet(sheet_name)
        ws = W[sheet_name]
        header, rows = read_rank(D[src_name], width)
        col0 = find_block(ws, m)
        where = "덮어씀" if col0 else "새 블록"
        if col0 is None:
            col0 = next_block_col(ws, width)
        title = title_fmt.format(brand=a.brand, short=short, m=m)
        n = write_block(ws, col0, title, header, rows, width)
        print(f"  - {sheet_name}: {openpyxl.utils.get_column_letter(col0)}열 {where}, {n}행")

    # 순위 시트 1행 기간 표기 지우기
    for sheet_name, _src, _w, _t in RANK_SHEETS:
        if sheet_name in W.sheetnames:
            k = clear_periods(W[sheet_name])
            if k:
                print(f"  - {sheet_name}: 1행 기간 표기 {k}개 지움")

    # 요약 시트
    sname = a.summary_sheet or a.brand
    if sname in W.sheetnames:
        s = W[sname]
        d = D["매출데이터"]
        # 월간파일 매출데이터에서 이번 달 열 찾기
        mcol = None
        for c in range(2, d.max_column + 1):
            if str(d.cell(3, c).value or "").strip() == f"{m}월":
                mcol = c
        totals = {}
        if mcol:
            for r in range(4, 9):
                k = str(d.cell(r, 1).value or "").strip()
                if k:
                    totals[k] = d.cell(r, mcol).value
        lcol, col = summary_layout(s, m)
        print(f"  - {sname}: {openpyxl.utils.get_column_letter(col)}열")
        for r in range(1, s.max_row + 1):
            name = str(s.cell(r, lcol).value or "").strip()
            ch = SUMMARY_MAP.get(mall_key(name))
            if not ch:
                continue
            new = totals.get(ch)
            cur = s.cell(r, col).value
            if new is None:
                continue
            if cur not in (None, "") and not a.overwrite:
                mark = "같음" if cur == new else f"**다름** (파일 {cur:,} / 집계 {new:,})"
                print(f"      {name:16} 기존값 유지 — {mark}")
                continue
            s.cell(r, col, int(new)).number_format = "#,##0"
            print(f"      {name:16} {int(new):>12,} 기록")
    else:
        print(f"  - 요약 시트 '{sname}' 없음 → 건너뜀")

    W.save(out)
    print(f"[저장] {out}")


if __name__ == "__main__":
    main()
