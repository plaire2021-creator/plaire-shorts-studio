# -*- coding: utf-8 -*-
"""
주간 판매 데이터 자동 생성기
------------------------------------------------------------------
네이버 스마트스토어 / 쿠팡 / 오늘의집 주문(통계) 엑셀 3개를 넣으면
'주간판매데이터' 양식(매출데이터 + 네이버/쿠팡/오집 TOP20)을 자동 생성한다.

사용법:
    python generate_weekly_sales.py \
        --naver  "sales_YYYYMMDD-YYYYMMDD_xxx.xlsx" \
        --coupang "SELLER_INSIGHTS_VENDOR_ITEM_METRICS_(0).xlsx" \
        --ohouse "주문배송 내역 (NN).xlsx" \
        --ohouse-pw "비밀번호" \
        --week "8월3주차" \
        --base "이전 주간판매데이터.xlsx"   (선택: 매출데이터 누적용) \
        --out  "결과.xlsx"

검증 기준(2026-08-12, 8월3주차 실데이터로 확인):
    - 네이버 매출 합계 = 상품행 '판매금액(순)' 합  → 양식 합계와 일치
    - 쿠팡  매출 합계 = 옵션별 '매출(원)' 합       → 양식 합계와 일치
    - 오집  매출 합계 = 주문별 '판매가*수량' 합
    - 네이버 TOP20 제품금액 = '판매금액(총)' 합 (셀단위 일치 확인)
"""
import argparse
import os
import re
import io
from collections import defaultdict

import importlib.util

import openpyxl
from openpyxl.styles import Font, Alignment, PatternFill, Border, Side

# 자사몰(카페24) 주문내역 파서 — 주간·월간 공용 단일 출처
_cafe24_spec = importlib.util.spec_from_file_location(
    "cafe24", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cafe24.py"))
cafe24 = importlib.util.module_from_spec(_cafe24_spec)
_cafe24_spec.loader.exec_module(cafe24)


# ----------------------------------------------------------------------
# 공통 유틸
# ----------------------------------------------------------------------
def num(v):
    """문자/None 섞인 셀 값을 안전하게 float으로."""
    if v is None:
        return 0.0
    try:
        return float(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def header_map(ws, header_row=1):
    """헤더 행을 읽어 {헤더명: 1-indexed 열번호} 반환."""
    m = {}
    for c in range(1, ws.max_column + 1):
        v = ws.cell(header_row, c).value
        if v is not None:
            m[str(v).strip()] = c
    return m


def col(m, *names):
    """여러 후보 헤더명 중 존재하는 첫 번째 열번호. 없으면 KeyError."""
    for n in names:
        if n in m:
            return m[n]
    raise KeyError(f"헤더를 찾을 수 없음: {names} / 실제 헤더: {list(m.keys())}")


def load_workbook_any(path, password=None):
    """일반/암호걸린 xlsx 모두 로드."""
    if not password and is_encrypted(path):
        raise ValueError("오늘의집 파일에 비밀번호가 걸려 있는데 비밀번호 파일이 없어요: "
                         "%USERPROFILE%\\.secrets\\ohouse_pw.txt (설치 키트로 다시 설치하거나 이 파일을 만들어 주세요)")
    if password:
        import msoffcrypto
        buf = io.BytesIO()
        with open(path, "rb") as f:
            off = msoffcrypto.OfficeFile(f)
            off.load_key(password=password)
            off.decrypt(buf)
        buf.seek(0)
        return openpyxl.load_workbook(buf, data_only=True)
    return openpyxl.load_workbook(path, data_only=True)


def date_range_from_naver_name(path):
    """sales_20260803-20260809_... → '2026.08.03~2026.08.09'."""
    base = os.path.basename(path)
    m = re.search(r"(\d{4})(\d{2})(\d{2})-(\d{4})(\d{2})(\d{2})", base)
    if not m:
        return ""
    y1, m1, d1, y2, m2, d2 = m.groups()
    return f"{y1}.{m1}.{d1}~{y2}.{m2}.{d2}"


# ----------------------------------------------------------------------
# 플랫폼별 집계
# ----------------------------------------------------------------------
def parse_naver(path):
    """
    반환:
      total_net      : 매출데이터용 순매출 합 (판매금액 순)
      products       : [ {제품명, 총합계, 옵션들:[{옵션, 상품코드, 결제수, 결제상품수량, 금액}]} ]  (총합계 desc)
    """
    wb = load_workbook_any(path)
    ws = wb["SALES"] if "SALES" in wb.sheetnames else wb.worksheets[0]
    m = header_map(ws)
    c_nm = col(m, "채널상품명")
    c_no = col(m, "채널상품번호")
    # 제품 기준 = '채널상품명'(각 채널상품을 개별 집계). 사용자 확정(2026-08).
    # 과거엔 '그룹상품명'으로 옵션을 묶었으나, 그 열이 다운로드에 없을 때가 잦고
    # 채널상품명 단위 개별 추출을 원해 그룹 묶음은 사용하지 않는다.
    # (되돌리려면 아래를 m.get("그룹상품명")으로 바꾸면 옵션 묶음 방식으로 복귀)
    c_grp = None
    c_cnt = col(m, "상품결제건수")
    c_amt_g = col(m, "판매금액(총)")
    c_amt_n = col(m, "판매금액(순)")
    c_qty = col(m, "결제상품수량")

    # 옵션(=채널상품번호) 단위 주간 누적
    opt = {}            # code -> dict
    total_net = 0.0
    for r in range(2, ws.max_row + 1):
        name = ws.cell(r, c_nm).value
        if name is None or str(name).strip() == "전체":
            continue  # 일별 '전체' 요약행 제외
        code = str(ws.cell(r, c_no).value).strip()
        grp = ws.cell(r, c_grp).value if c_grp else None
        grp = "" if grp is None or str(grp).strip() in ("-", "") else str(grp).strip()
        total_net += num(ws.cell(r, c_amt_n).value)
        if code not in opt:
            opt[code] = {
                "채널상품명": str(name).strip(),
                "그룹상품명": grp,
                "결제수": 0.0, "결제상품수량": 0.0, "금액": 0.0,
            }
        opt[code]["결제수"] += num(ws.cell(r, c_cnt).value)
        opt[code]["결제상품수량"] += num(ws.cell(r, c_qty).value)
        # 금액/총합계는 매출데이터 합계와 동일하게 '판매금액(순)'(환불 반영) 사용.
        # (결제수·수량은 총 기준. 양식 셀단위 검증으로 확정: '엘론' 환불건에서 확인)
        opt[code]["금액"] += num(ws.cell(r, c_amt_n).value)
        # 그룹명은 나중 행에서 채워질 수도
        if grp and not opt[code]["그룹상품명"]:
            opt[code]["그룹상품명"] = grp

    # 제품(그룹) 단위로 묶기: '색상을 뺀 제품명'이 같으면 한 제품(사이즈 다르면 다른 제품).
    # 색상만 옵션(C)으로 분리, 사이즈·소재는 제품명(B, 그룹키)에 남는다.
    groups = {}
    for code, d in opt.items():
        gkey, opt_txt = group_and_option(d["채널상품명"])   # 테이블류는 사이즈 무관 묶음+사이즈옵션
        g = groups.setdefault(gkey, {"제품명": gkey, "옵션들": []})
        g["옵션들"].append({
            "옵션": opt_txt, "상품코드": code,
            "결제수": d["결제수"], "결제상품수량": d["결제상품수량"], "금액": d["금액"],
        })

    products = []
    for g in groups.values():
        g["옵션들"].sort(key=lambda o: -o["금액"])   # 옵션은 금액 큰 순
        g["총합계"] = sum(o["금액"] for o in g["옵션들"])  # H = 그룹 전체 옵션 합
        products.append(g)
    products.sort(key=lambda p: -p["총합계"])          # 순위 = 그룹 총합계 기준
    return total_net, products


def parse_coupang(path):
    """반환: total_sales, products[{제품명, 총합계, 옵션들:[{옵션,옵션코드,결제금액,판매수}]}].
    원본 '상품명'(사이즈 포함 기본명)으로 그룹핑, 옵션명에서 색상만 옵션으로 추출.
    """
    wb = load_workbook_any(path)
    ws = wb["vendor item metrics"] if "vendor item metrics" in wb.sheetnames else wb.worksheets[0]
    m = header_map(ws)
    c_oid = col(m, "옵션 ID", "옵션ID")
    c_onm = col(m, "옵션명")
    c_pnm = col(m, "상품명")             # 기본 상품명(그룹 기준)
    c_amt = col(m, "매출(원)")
    c_qty = col(m, "판매량")

    groups, total = {}, 0.0
    for r in range(2, ws.max_row + 1):
        oid = ws.cell(r, c_oid).value
        if oid is None:
            continue
        amt = num(ws.cell(r, c_amt).value)
        total += amt                     # 매출데이터 합계는 전체(0 포함) 기준
        if amt <= 0:
            continue                     # 순위표는 매출 0 제외(기존 동작)
        pnm = str(ws.cell(r, c_pnm).value or "").strip()
        onm = ws.cell(r, c_onm).value
        if _is_table(pnm):                       # 테이블류: 사이즈 무관 묶음, 옵션=사이즈+색상
            gkey, _sz = _split_trailing_size(pnm)
            opt_txt = extract_size_color(onm)
        else:
            gkey, opt_txt = pnm, extract_color_only(onm)
        g = groups.setdefault(gkey, {"제품명": gkey, "옵션들": []})
        g["옵션들"].append({
            "옵션": opt_txt, "옵션코드": str(oid).strip(),
            "결제금액": amt, "판매수": num(ws.cell(r, c_qty).value),
        })

    products = []
    for g in groups.values():
        g["옵션들"].sort(key=lambda o: -o["결제금액"])
        g["총합계"] = sum(o["결제금액"] for o in g["옵션들"])
        products.append(g)
    products.sort(key=lambda p: -p["총합계"])
    return total, products


def clean_ohouse_name(nm):
    """오집 상품명 앞의 'N% 즉시할인' / 'N% 즉시할인ㅣ' 프로모션 접두어 제거."""
    s = str(nm).strip()
    s = re.sub(r"^\s*\d+\s*%\s*즉시할인\s*[ㅣ|/]?\s*", "", s)
    return s.strip()


def parse_ohouse(path, password=None, exclude_cancel=False):
    """반환: total, products[{제품명, 상품아이디, 총합계, 옵션들:[{옵션,결제수,결제금액}]}].
    상품명(할인접두어 제거)으로 그룹, 옵션명에서 색상만 옵션으로. 색상 없으면 옵션 빈칸.
    """
    wb = load_workbook_any(path, password=password)
    ws = wb["Sheet1"] if "Sheet1" in wb.sheetnames else wb.worksheets[0]
    m = header_map(ws)
    c_nm = col(m, "상품명")
    c_amt = col(m, "판매가 * 수량", "판매가*수량")
    c_status = m.get("주문상태")
    c_id = m.get("상품아이디")
    c_opnm = m.get("옵션명")

    # groups[상품명] = {상품아이디, colors:{color:{결제수,결제금액}}}
    groups = {}
    total = 0.0
    for r in range(2, ws.max_row + 1):
        nm = ws.cell(r, c_nm).value
        if nm is None:
            continue
        if exclude_cancel and c_status:
            st = str(ws.cell(r, c_status).value or "")
            if "취소" in st or "반품" in st:
                continue
        amt = num(ws.cell(r, c_amt).value)
        total += amt
        base = clean_ohouse_name(nm)
        opval = ws.cell(r, c_opnm).value if c_opnm else ""
        if _is_table(base):                      # 테이블류: 사이즈 무관 묶음, 옵션=사이즈+색상
            key, _sz = _split_trailing_size(base)
            optkey = " ".join(x for x in [extract_ohouse_size(opval),
                                          extract_ohouse_color(opval)] if x)
        else:
            key = base
            optkey = extract_ohouse_color(opval)
        g = groups.setdefault(key, {"상품아이디": "", "colors": {}})
        if c_id and not g["상품아이디"]:
            v = ws.cell(r, c_id).value
            g["상품아이디"] = str(v).strip() if v is not None else ""
        cc = g["colors"].setdefault(optkey, {"결제수": 0, "결제금액": 0.0})
        cc["결제수"] += 1
        cc["결제금액"] += amt

    products = []
    for pnm, g in groups.items():
        opts = [{"옵션": opt, "결제수": v["결제수"], "결제금액": v["결제금액"]}
                for opt, v in g["colors"].items()]
        opts.sort(key=lambda o: -o["결제금액"])
        products.append({
            "제품명": pnm, "상품아이디": g["상품아이디"], "옵션들": opts,
            "총합계": sum(o["결제금액"] for o in opts),
        })
    products.sort(key=lambda p: -p["총합계"])
    return total, products


def parse_cafe24(path):
    """자사몰(카페24) CSV → (total, products). 두 형식 자동 판별:
      ① '상품별 매출 분석'(집계본): 헤더에 판매금액 + 상품(번호).
      ② '주문내역'(원본): `cafe24.py` 가 처리 — 금액=F열 총 주문금액, 제품명=I열,
         옵션=J열, G열 총 결제금액 0원은 취소건으로 제외. (2026-10 사용자 확정 규칙)
    """
    import csv
    with open(path, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return 0.0, []
    hdr = {str(h).strip(): i for i, h in enumerate(rows[0])}
    if "판매금액" in hdr and ("상품 번호" in hdr or "상품번호" in hdr):
        return _parse_cafe24_sales(rows, hdr)
    return cafe24.parse(path, group_and_option)


def _finalize_cafe24(groups, total):
    products = []
    for g in groups.values():
        g["옵션들"].sort(key=lambda o: -o["금액"])
        g["총합계"] = sum(o["금액"] for o in g["옵션들"])
        products.append(g)
    products.sort(key=lambda p: -p["총합계"])
    return total, products


def _parse_cafe24_sales(rows, hdr):
    """① '상품별 매출 분석': 상품 번호=상품코드, 상품명, 판매건수=결제수, 판매물품수, 판매금액=금액."""
    def ci(*names):
        for n in names:
            if n in hdr:
                return hdr[n]
        return None
    i_no, i_nm = ci("상품 번호", "상품번호"), ci("상품명")
    i_cnt, i_qty, i_amt = ci("판매건수"), ci("판매물품수"), ci("판매금액")

    def cell(row, i):
        return row[i] if (i is not None and i < len(row)) else ""

    groups, total = {}, 0.0
    for row in rows[1:]:
        nm = str(cell(row, i_nm)).strip()
        amt = num(cell(row, i_amt))
        total += amt                              # 자사몰 합계 = 전체 판매금액
        if amt <= 0 or not nm:
            continue                              # 순위표는 판매금액>0만
        gkey, opt_txt = group_and_option(nm)
        g = groups.setdefault(gkey, {"제품명": gkey, "옵션들": []})
        g["옵션들"].append({
            "옵션": opt_txt, "상품코드": str(cell(row, i_no)).strip(),
            "결제수": num(cell(row, i_cnt)), "결제상품수량": num(cell(row, i_qty)), "금액": amt,
        })
    return _finalize_cafe24(groups, total)


# ----------------------------------------------------------------------
# 엑셀 출력
# ----------------------------------------------------------------------
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HDR_FILL = PatternFill("solid", fgColor="D9E1F2")
BAND_FILL = PatternFill("solid", fgColor="EDF3FB")   # 그룹 구분용 연한 밴딩(교차 배경)
LATEST_FILL = PatternFill("solid", fgColor="FFF2CC")  # 매출데이터 최신 주차 강조(연한 노랑)
NO_FILL = PatternFill(fill_type=None)                 # 배경 제거(이전 주차 강조색 클리어)
GROUP_TOP = Side(style="medium", color="9DB7D9")     # 그룹 시작 구분선
TITLE_FONT = Font(bold=True, size=14)
HDR_FONT = Font(bold=True)
CENTER = Alignment(horizontal="center", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")


def _band(ws, r0, r1, ncols, on):
    """r0~r1 행, 1~ncols 열에 그룹 밴딩(연한 배경) + 그룹 시작행 상단 구분선."""
    for r in range(r0, r1 + 1):
        for c in range(1, ncols + 1):
            cell = ws.cell(r, c)
            if on:
                cell.fill = BAND_FILL
            if r == r0:                              # 그룹 첫 행 위에 얇은 구분선
                b = cell.border
                cell.border = Border(left=b.left, right=b.right,
                                     top=GROUP_TOP, bottom=b.bottom)


# 옵션 추출 --------------------------------------------------------------
# 색상 키워드(부분일치): 토큰에 하나라도 들어가면 색상(월넛블랙·실버프레임 등 합성 포함).
_COLOR_WORDS = [
    "화이트", "블랙", "그레이", "그린", "네이비", "옐로우", "오렌지", "민트",
    "카멜", "초코", "아이보리", "월넛", "오크", "실버", "골드", "브라운",
    "베이지", "핑크", "블루", "레드", "내추럴", "내츄럴", "크림", "로즈골드",
]
# 소재/원목 종류(부분일치): 옵션 영역에 있으면 유지.
_MATERIAL_WORDS = [
    "실리콘가죽", "인조가죽", "천연가죽", "패브릭", "극세사", "벨벳", "메쉬",
    "라탄", "린넨", "가죽", "원목", "우드", "멀바우", "애쉬", "에쉬",
    "고무나무", "자작나무", "등나무",
]
# 의자일 때 제품명 전체에서 끌어와 앞에 붙일 소재(가죽/패브릭류). 원목·우드는 흔해서 제외.
_MATERIAL_PHRASES = [
    "실리콘가죽", "실리콘 가죽", "인조가죽", "천연가죽", "패브릭",
    "극세사", "벨벳", "메쉬", "라탄", "린넨", "가죽",
]


def _is_color(tok):
    return any(w in tok for w in _COLOR_WORDS)


def group_and_color(name):
    """제품명을 (그룹키, 색상)으로 분리.
    - 색상 토큰만 옵션(색상)으로 떼어내고, 나머지(사이즈·소재 포함)는 그룹키로 남긴다.
    - 콤마가 있으면 콤마 뒤에서 색상만 분리(콤마 앞 + 콤마뒤 비색상은 그룹키).
    - 콤마가 없으면 뒤쪽에 붙은 색상 연속 구간만 분리.
    => 색상만 다른 제품은 같은 그룹키, 사이즈가 다르면 다른 그룹키가 된다.
    """
    name = str(name).strip()
    if "," in name:
        head, tail = name.split(",", 1)
        tail_tokens = [t for t in re.split(r"[,\s]+", tail.strip()) if t]
        colors = [t for t in tail_tokens if _is_color(t)]
        non_colors = [t for t in tail_tokens if not _is_color(t)]
        group = head.strip()
        if non_colors:                                   # 사이즈 등은 그룹키에 유지
            group = (group + " " + " ".join(non_colors)).strip()
        return group.strip(" ,"), " ".join(colors)
    tokens = name.split()
    i = len(tokens)
    while i > 0 and _is_color(tokens[i - 1]):
        i -= 1
    return " ".join(tokens[:i]).strip(), " ".join(tokens[i:])


def extract_color_only(name):
    """옵션 = 색상만 (사이즈·소재·수량 제외)."""
    return group_and_color(name)[1]


def extract_ohouse_color(opt):
    """오늘의집 옵션명에서 색상만 추출. '_'·'/'·'색상:' 등 다양한 구분자 대응.
    (예: '거실테이블1200_화이트'→화이트, '색상: 월넛 / 사이즈: L'→월넛, '퀸(1500x2000)'→'')
    """
    s = str(opt or "").strip()
    if not s:
        return ""
    m = re.search(r"색상\s*[:：]\s*([^/]+)", s)     # '색상: X' 우선
    src = m.group(1) if m else s
    toks = re.split(r"[,\s/_:：()]+", src)
    seen = []
    for t in toks:
        if t and _is_color(t) and t not in seen:
            seen.append(t)
    return " ".join(seen)


# 식탁·테이블·책상: 사이즈 무관하게 묶고, 옵션에 '사이즈+색상' 표기 -------------
_TABLE_WORDS = ["식탁", "테이블", "책상"]


def _is_table(name):
    """식탁·테이블·책상류 여부(의자는 제외 — 식탁의자 등은 의자로 취급)."""
    s = str(name)
    return any(w in s for w in _TABLE_WORDS) and "의자" not in s


def _split_trailing_size(text):
    """뒤쪽 사이즈 연속 구간 분리 → (사이즈뺀부분, 사이즈문자열)."""
    toks = str(text).split()
    i = len(toks)
    while i > 0 and _is_size(toks[i - 1]):
        i -= 1
    return " ".join(toks[:i]).strip(), " ".join(toks[i:]).strip()


def group_and_option(name):
    """(그룹키, 옵션) 반환.
    - 기본: 그룹=색상뺀 제품명(사이즈 유지), 옵션=색상만. (사이즈 다르면 다른 제품)
    - 식탁·테이블·책상: 사이즈도 그룹키에서 빼서 **사이즈 무관 묶음**, 옵션=사이즈+색상.
    """
    group, color = group_and_color(name)
    if _is_table(name):
        group2, size = _split_trailing_size(group)
        return group2, " ".join(x for x in [size, color] if x)
    return group, color


def extract_size_color(name):
    """옵션명에서 '사이즈 + 색상' 추출(테이블용). (예: '…책상, 1600mm, 오크' → '1600mm 오크')"""
    group, color = group_and_color(name)
    _, size = _split_trailing_size(group)
    return " ".join(x for x in [size, color] if x)


def extract_ohouse_size(opt):
    """오늘의집 옵션명에서 사이즈 추출('사이즈: X' 우선, 없으면 사이즈성 토큰)."""
    s = str(opt or "")
    m = re.search(r"사이즈[^:：]*[:：]\s*([^/]+)", s)
    if m:
        return re.sub(r"^\s*\d+\)\s*", "", m.group(1).strip())  # '2)슈퍼싱글…' 앞 번호 제거
    toks = re.split(r"[,\s/_:：()]+", s)
    return " ".join(t for t in toks if t and _is_size(t))


def _is_material(tok):
    return any(w in tok for w in _MATERIAL_WORDS)


def _is_size(tok, bed=False):
    t = tok.strip()
    # 폭950 / 1800mm / 58cm / 600 / 2400사이즈 / 4인용 / 85인치 / 3단 / 5colors
    if re.fullmatch(r"(폭)?\d+(mm|cm|MM|CM|사이즈|인용|인치|단|색|colors?)?", t):
        return not re.fullmatch(r"\d+개(입)?", t)      # 수량(N개)은 사이즈 아님
    if re.fullmatch(r"[SMLsml]사이즈", t):
        return True
    if bed and re.fullmatch(r"(SS|CK|LK|EK|[SDQKsdqk])(\(.*\))?", t):  # 침대 알파벳: S, Q(퀸)…
        return True
    return False


def _is_optionword(tok, bed=False):
    return _is_color(tok) or _is_material(tok) or _is_size(tok, bed=bed)


_BAR_WORDS = ["홈바", "바의자", "바 의자", "바텐", "바체어", "아일랜드"]


def _is_bar_chair(name):
    """바/홈바 의자 여부 — 이 경우 좌석 높이(cm)가 중요한 옵션."""
    return ("의자" in name) and any(w in name for w in _BAR_WORDS)


def _materials_of_chair(name):
    """의자 제품명 전체에서 소재(가죽/패브릭류)를 찾아 정규화·중복제거해 반환."""
    found = []
    for w in _MATERIAL_PHRASES:
        if w in name:
            norm = w.replace(" ", "")           # '실리콘 가죽' → '실리콘가죽'
            if norm not in found:
                found.append(norm)
    # 부분문자열 중복 제거: '가죽'은 '실리콘가죽'이 있으면 버림
    return [m for m in found if not any(m != o and m in o for o in found)]


def extract_option(name):
    """제품명에서 옵션을 추출한다.
    - 옵션 영역: 콤마가 있으면 '첫 콤마 뒤', 없으면 '뒤쪽 색상/사이즈/소재 연속 구간'.
    - 그 영역에서 색상·사이즈·소재만 남기고 수량(N개)·제품단어(거실장 등)는 제거.
    - 의자면 제품명 어디에 있든 소재(실리콘가죽·패브릭 등)를 앞에 한 번 더 표기.
    """
    if not name:
        return ""
    name = str(name).strip()
    bed = ("침대" in name) or ("매트리스" in name) or ("프레임" in name)
    chair = "의자" in name

    if "," in name:                              # 콤마 뒤가 옵션 영역
        region = name.split(",", 1)[1]
        region_tokens = [t for t in re.split(r"[,\s]+", region.strip()) if t]
    else:                                        # 뒤쪽 옵션 토큰 연속 구간
        run = []
        for t in reversed(name.split()):
            if _is_optionword(t, bed=bed):
                run.append(t)
            else:
                break
        region_tokens = list(reversed(run))

    kept = [t for t in region_tokens if _is_optionword(t, bed=bed)]  # 색상/사이즈/소재만
    if chair:                                    # 의자는 소재를 앞에 보강
        prefix = [m for m in _materials_of_chair(name) if m not in kept]
        if _is_bar_chair(name):                  # 바/홈바 의자는 좌석 높이(cm)도 넣음
            for cm in re.findall(r"\d+cm", name):
                if cm not in kept and cm not in prefix:
                    prefix.append(cm)
        kept = prefix + kept
    return " ".join(kept)


def style_header_row(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row, c)
        cell.font = HDR_FONT
        cell.fill = HDR_FILL
        cell.alignment = CENTER
        cell.border = BORDER


def _write_title(ws, date_range, title, headers):
    ws["A1"] = date_range
    ws["A2"] = title
    ws["A1"].font = Font(bold=True)
    ws["A2"].font = TITLE_FONT
    for c, h in enumerate(headers, 1):
        ws.cell(3, c, h)
    style_header_row(ws, 3, len(headers))


def write_naver_sheet(ws, date_range, products, top_n=None, title="네이버 판매순위"):
    headers = ["", "제품명", "옵션", "상품 코드", "결제수", "결제상품수량", "금액", "총합계"]
    _write_title(ws, date_range, title, headers)
    ncols = len(headers)
    r = 4
    for gi, (rank, p) in enumerate(enumerate(products[:top_n], 1)):
        r0 = r
        for first, o in enumerate(p["옵션들"]):
            if first == 0:
                ws.cell(r, 1, rank).alignment = CENTER
                ws.cell(r, 2, p["제품명"])
                ws.cell(r, 8, int(p["총합계"])).alignment = RIGHT
            ws.cell(r, 3, o["옵션"])          # 색상만
            ws.cell(r, 4, o["상품코드"])
            ws.cell(r, 5, int(o["결제수"])).alignment = CENTER
            ws.cell(r, 6, int(o["결제상품수량"])).alignment = CENTER
            ws.cell(r, 7, int(o["금액"])).alignment = RIGHT
            r += 1
    _autosize(ws, {2: 55, 3: 20, 4: 15, 5: 8, 6: 12, 7: 12, 8: 12})


def write_coupang_sheet(ws, date_range, products, top_n=None):
    headers = ["", "상품명", "옵션", "옵션코드", "결제금액", "판매수", "총합계"]
    _write_title(ws, date_range, "쿠팡 판매순위", headers)
    ncols = len(headers)
    r = 4
    for gi, (rank, p) in enumerate(enumerate(products[:top_n], 1)):
        r0 = r
        for first, o in enumerate(p["옵션들"]):
            if first == 0:
                ws.cell(r, 1, rank).alignment = CENTER
                ws.cell(r, 2, p["제품명"])
                ws.cell(r, 7, int(p["총합계"])).alignment = RIGHT
            ws.cell(r, 3, o["옵션"])          # 색상만
            ws.cell(r, 4, o["옵션코드"])
            ws.cell(r, 5, int(o["결제금액"])).alignment = RIGHT
            ws.cell(r, 6, int(o["판매수"])).alignment = CENTER
            r += 1
    _autosize(ws, {2: 55, 3: 20, 4: 15, 5: 12, 6: 8, 7: 12})


def write_ohouse_sheet(ws, date_range, products, top_n=None):
    headers = ["", "상품명", "상품아이디", "옵션", "결제수", "결제금액", "총합계"]
    _write_title(ws, date_range, "오늘의집 판매순위", headers)
    ncols = len(headers)
    r = 4
    for gi, (rank, p) in enumerate(enumerate(products[:top_n], 1)):
        r0 = r
        for first, o in enumerate(p["옵션들"]):
            if first == 0:
                ws.cell(r, 1, rank).alignment = CENTER
                ws.cell(r, 2, p["제품명"])
                ws.cell(r, 3, p.get("상품아이디", "")).alignment = CENTER
                ws.cell(r, 7, int(p["총합계"])).alignment = RIGHT
            ws.cell(r, 4, o["옵션"])          # 색상만
            ws.cell(r, 5, int(o["결제수"])).alignment = CENTER
            ws.cell(r, 6, int(o["결제금액"])).alignment = RIGHT
            r += 1
    _autosize(ws, {2: 50, 3: 12, 4: 18, 5: 8, 6: 12, 7: 12})


def write_cafe24_sheet(ws, date_range, products, top_n=None):
    # 자사몰: 상품코드·결제상품수량 열 제외 (2026-09 사용자 양식 변경)
    headers = ["", "제품명", "옵션", "결제수", "금액", "총합계"]
    _write_title(ws, date_range, "자사몰 판매순위", headers)
    r = 4
    for rank, p in enumerate(products[:top_n], 1):
        for first, o in enumerate(p["옵션들"]):
            if first == 0:
                ws.cell(r, 1, rank).alignment = CENTER
                ws.cell(r, 2, p["제품명"])
                ws.cell(r, 6, int(p["총합계"])).alignment = RIGHT
            ws.cell(r, 3, o["옵션"])          # 색상만
            ws.cell(r, 4, int(o["결제수"])).alignment = CENTER
            ws.cell(r, 5, int(o["금액"])).alignment = RIGHT
            r += 1
    _autosize(ws, {2: 55, 3: 20, 4: 8, 5: 12, 6: 12})


def _autosize(ws, widths):
    for c, w in widths.items():
        ws.column_dimensions[openpyxl.utils.get_column_letter(c)].width = w


def update_summary(ws, week_label, naver_net, coupang, ohouse, cafe24=0):
    """매출데이터 시트: 채널(네이버/쿠팡/오늘의집[/자사몰])×주차. 최신 주차 B열.
    행: 3=주차 / 4=네이버 / 5=쿠팡 / 6=오늘의집 / (7=자사몰) / 합계.
    자사몰 행은 자사몰 데이터가 있거나 base에 이미 있을 때만 표기(가즈다처럼 없으면 3채널).
    """
    has_row = ws.cell(7, 1).value == "자사몰"    # base에 이미 자사몰 행이 있는가
    use_cafe24 = has_row or cafe24 > 0
    if use_cafe24 and not has_row:                # 구파일(7행=합계) 업그레이드: 자사몰 행 삽입
        ws.insert_rows(7)
    chan_rows = (4, 5, 6, 7) if use_cafe24 else (4, 5, 6)
    sum_row = 8 if use_cafe24 else 7

    b3 = ws.cell(3, 2).value
    if str(b3).strip() != week_label:
        ws.insert_cols(2)           # B열 새로 확보 (기존은 오른쪽으로 밀림)
    # 라벨/행 헤더 보장
    ws.cell(3, 1, "")
    ws.cell(4, 1, "네이버")
    ws.cell(5, 1, "쿠팡")
    ws.cell(6, 1, "오늘의집")
    if use_cafe24:
        ws.cell(7, 1, "자사몰")
    ws.cell(sum_row, 1, "합계")
    ws.cell(3, 2, week_label)
    ws.cell(4, 2, int(round(naver_net)))
    ws.cell(5, 2, int(round(coupang)))
    ws.cell(6, 2, int(round(ohouse)))
    if use_cafe24:
        ws.cell(7, 2, int(round(cafe24)))
    ws.cell(sum_row, 2, int(round(sum(num(ws.cell(r, 2).value) for r in chan_rows))))
    for row in range(4, sum_row + 1):
        ws.cell(row, 2).alignment = RIGHT

    # 합계 행 전체를 리터럴로 재계산(수식 이동 방지). 각 주차 열의 채널행 합.
    for c in range(2, ws.max_column + 1):
        label = ws.cell(3, c).value
        if label is None or str(label).strip() == "":
            continue                       # 주차 라벨 없는 빈 열은 건너뜀
        total = sum(num(ws.cell(r, c).value) for r in chan_rows)
        ws.cell(sum_row, c, int(round(total)))
        ws.cell(sum_row, c).alignment = RIGHT

    # 최근 3주치만 유지 — 4번째 이후(오래된) 주차 열 삭제
    week_cols = [c for c in range(2, ws.max_column + 1)
                 if str(ws.cell(3, c).value or "").strip()]
    for c in sorted(week_cols[3:], reverse=True):
        ws.delete_cols(c, 1)

    # 서식 통일: 천단위 콤마 + 검은 테두리 + 열너비 (표 A3:마지막주차열 / 3~합계행)
    last_col = 1
    for c in range(2, ws.max_column + 1):
        if str(ws.cell(3, c).value or "").strip():
            last_col = c
    black = Side(style="thin", color="000000")
    box = Border(left=black, right=black, top=black, bottom=black)
    for c in range(1, last_col + 1):
        L = openpyxl.utils.get_column_letter(c)
        ws.column_dimensions[L].width = 12 if c == 1 else 16
        ws.column_dimensions[L].hidden = False
        for r in range(3, sum_row + 1):
            cell = ws.cell(r, c)
            cell.border = box
            if c >= 2 and r >= 4:
                cell.number_format = "#,##0"
                cell.alignment = RIGHT
            elif c >= 2 and r == 3:
                cell.alignment = CENTER

    # 최신 주차(B열)만 연한 색 강조, 나머지 주차 열은 배경 제거
    for c in range(2, last_col + 1):
        for r in range(3, sum_row + 1):
            ws.cell(r, c).fill = LATEST_FILL if c == 2 else NO_FILL

    # 표 아래 잔재 제거 (자사몰 없는 회사에서 이전 자사몰/합계 흔적 정리 포함)
    for r in range(sum_row + 1, 40):
        for c in range(1, 8):
            ws.cell(r, c).value = None
            ws.cell(r, c).fill = NO_FILL
            ws.cell(r, c).border = Border()


def write_analysis(ws, naver_products, coupang_products, ohouse_products):
    """매출데이터 표(3~7행) 아래에 ① 주간 매출 분석 ② 상품별 핵심 을 자동 작성."""
    cols = [c for c in range(2, ws.max_column + 1) if str(ws.cell(3, c).value or "").strip()]
    weeks = [{
        "label": str(ws.cell(3, c).value).strip(),
        "네이버": num(ws.cell(4, c).value), "쿠팡": num(ws.cell(5, c).value),
        "오늘의집": num(ws.cell(6, c).value), "합계": num(ws.cell(7, c).value),
    } for c in cols]

    for r in range(9, 40):                 # 아래 영역 정리(이전 잔재 제거)
        for c in range(1, 8):
            ws.cell(r, c).value = None
    if not weeks:
        return

    cur = weeks[0]
    lines = [("■ 주간 매출 분석 ({} 기준)".format(cur["label"]), True)]
    if len(weeks) >= 2:
        prev = weeks[1]
        d = cur["합계"] - prev["합계"]
        pct = (d / prev["합계"] * 100) if prev["합계"] else 0
        lines.append(("• 총 매출 {:,}원 — 전주({} {:,}원) 대비 {:+,}원 ({:+.1f}%)".format(
            int(cur["합계"]), prev["label"], int(prev["합계"]), int(d), pct), False))
        parts = []
        for k in ("네이버", "쿠팡", "오늘의집"):
            pv = prev[k]
            pp = (cur[k] - pv) / pv * 100 if pv else 0
            parts.append("{} {:+.1f}%".format(k, pp))
        lines.append(("• 채널별 전주 대비: " + " / ".join(parts), False))
        movers = [(k, cur[k] - prev[k]) for k in ("네이버", "쿠팡", "오늘의집")]
        up = max(movers, key=lambda x: x[1])
        dn = min(movers, key=lambda x: x[1])
        note = []
        if up[1] > 0:
            note.append("{} 증가(+{:,}원)가 상승 견인".format(up[0], int(up[1])))
        if dn[1] < 0:
            note.append("{} 감소({:,}원)".format(dn[0], int(dn[1])))
        if note:
            lines.append(("• " + ", ".join(note), False))
    else:
        lines.append(("• 총 매출 {:,}원".format(int(cur["합계"])), False))
    if len(weeks) >= 3:
        trend = " → ".join("{:,}".format(int(w["합계"])) for w in reversed(weeks))
        arrow = "증가세" if cur["합계"] >= weeks[-1]["합계"] else "감소세"
        lines.append(("• 최근 {}주 합계 추이: {} ({})".format(len(weeks), trend, arrow), False))

    for i, (text, bold) in enumerate(lines):
        cell = ws.cell(10 + i, 1, text)
        cell.font = Font(bold=bold, size=11 if bold else 10)
        cell.alignment = Alignment(horizontal="left", vertical="center")


def build(naver_path, coupang_path, ohouse_path, out_path,
          week_label, ohouse_pw=None, base_path=None,
          ohouse_exclude_cancel=False, brand="플레르가구", cafe24_path=None):
    date_range = date_range_from_naver_name(naver_path)

    naver_net, products = parse_naver(naver_path)
    coupang_total, coupang_items = parse_coupang(coupang_path)
    ohouse_total, ohouse_items = parse_ohouse(
        ohouse_path, password=ohouse_pw, exclude_cancel=ohouse_exclude_cancel)
    cafe24_total, cafe24_items = (parse_cafe24(cafe24_path) if cafe24_path else (0.0, []))

    # 베이스(이전 파일)에서 매출데이터 누적 + 기타 시트 보존
    if base_path and os.path.exists(base_path):
        wb = openpyxl.load_workbook(base_path)  # 값+서식 유지
    else:
        wb = openpyxl.Workbook()
        wb.active.title = "매출데이터"

    # 시트 확보 헬퍼
    def sheet(name, wipe=True):
        if name in wb.sheetnames:
            ws = wb[name]
            if wipe:
                idx = wb.sheetnames.index(name)
                wb.remove(ws)
                ws = wb.create_sheet(name, idx)
        else:
            ws = wb.create_sheet(name)
        return ws

    # 매출데이터
    if "매출데이터" not in wb.sheetnames:
        wb.create_sheet("매출데이터", 0)
    ws_sum = wb["매출데이터"]
    ws_sum["A1"] = f"{brand} 주간판매 데이터"      # 회사명(브랜드) 표기
    ws_sum["A1"].font = Font(bold=True, size=14)
    update_summary(ws_sum, week_label, naver_net, coupang_total, ohouse_total, cafe24_total)

    # 구 시트명(…TOP20) 파일과의 호환: 있으면 제거 후 새 이름으로 다시 만든다.
    for old in ("네이버TOP20", "쿠팡TOP20", "오집TOP20"):
        if old in wb.sheetnames:
            wb.remove(wb[old])

    # 판매순위 시트들 — 탭: 네이버 / 쿠팡 / 오늘의집 / 자사몰 (매주 새로 덮어씀)
    write_naver_sheet(sheet("네이버"), date_range, products)
    write_coupang_sheet(sheet("쿠팡"), date_range, coupang_items)
    write_ohouse_sheet(sheet("오늘의집"), date_range, ohouse_items)
    if cafe24_items:
        write_cafe24_sheet(sheet("자사몰"), date_range, cafe24_items)
    elif "자사몰" in wb.sheetnames:
        wb.remove(wb["자사몰"])          # 이번 주 자사몰 판매 없음 → base의 지난주 순위 제거

    # 시트 순서: 매출데이터 · 네이버 · 쿠팡 · 오늘의집 · 자사몰 · (가즈다 등 기타)
    desired = ["매출데이터", "네이버", "쿠팡", "오늘의집", "자사몰"]
    front = [wb[n] for n in desired if n in wb.sheetnames]
    others = [w for w in wb.worksheets if w.title not in desired]
    wb._sheets = front + others

    wb.save(out_path)

    # 콘솔 요약
    print(f"[완료] {out_path}")
    print(f"  기간: {date_range}  주차: {week_label}")
    print(f"  네이버(순): {int(naver_net):,}  |  쿠팡: {int(coupang_total):,}  |  "
          f"오늘의집: {int(ohouse_total):,}  |  자사몰: {int(cafe24_total):,}")
    print(f"  합계: {int(naver_net + coupang_total + ohouse_total + cafe24_total):,}")
    print(f"  네이버 {len(products)} / 쿠팡 {len(coupang_items)} / "
          f"오집 {len(ohouse_items)} / 자사몰 {len(cafe24_items)}")
    return out_path


def _load_ohouse_pw():
    """오늘의집 주문배송 엑셀 비밀번호. 코드에 두지 않고 각 PC의 %USERPROFILE%\\.secrets\\ohouse_pw.txt
    (또는 환경변수 OHOUSE_PW)에서 읽는다. 설치 키트가 이 파일을 넣어 준다."""
    v = os.environ.get("OHOUSE_PW")
    if v:
        return v.strip()
    try:
        with open(os.path.join(os.path.expanduser("~"), ".secrets", "ohouse_pw.txt"), encoding="utf-8") as f:
            return f.read().strip() or None
    except OSError:
        return None


DEFAULT_OHOUSE_PW = _load_ohouse_pw()


def is_encrypted(path):
    """암호 걸린 OOXML(xlsx)인지 판정."""
    try:
        import msoffcrypto
        with open(path, "rb") as f:
            return msoffcrypto.OfficeFile(f).is_encrypted()
    except Exception:
        return False


def classify_files(input_dir, ohouse_pw=DEFAULT_OHOUSE_PW):
    """
    입력 폴더의 엑셀들을 내부 시그니처로 자동 분류.
    반환: dict(naver=, coupang=, ohouse=, base=)  (없으면 None)
    파일명이 바뀌어도 내부 헤더/시트로 인식하므로 견고하다.
    """
    found = {"naver": None, "coupang": None, "ohouse": None, "base": None, "cafe24": None}
    files = []
    for fn in sorted(os.listdir(input_dir)):
        if fn.startswith("~$") or fn.startswith("."):
            continue
        low = fn.lower()
        if low.endswith(".csv"):                 # 자사몰(카페24) CSV — 두 형식 모두 인식
            try:
                with open(os.path.join(input_dir, fn), encoding="utf-8-sig", newline="") as fh:
                    head = fh.readline()
                is_sales = "판매금액" in head and ("상품 번호" in head or "상품번호" in head)
                is_orders = "판매가" in head and ("주문상품명" in head or "발주일" in head)
                if is_sales or is_orders:
                    found["cafe24"] = os.path.join(input_dir, fn)
            except Exception:
                pass
            continue
        if low.endswith((".xlsx", ".xlsm")):
            files.append(os.path.join(input_dir, fn))

    for path in files:
        # 1) 암호 걸린 파일 = 오늘의집
        if is_encrypted(path):
            found["ohouse"] = path
            continue
        # 2) 평문 파일: 시트/헤더 시그니처로 판정
        try:
            wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
        except Exception:
            continue
        names = set(wb.sheetnames)
        ws = wb.worksheets[0]
        hdr = set()
        for c in range(1, min(ws.max_column, 60) + 1):
            v = ws.cell(1, c).value
            if v is not None:
                hdr.add(str(v).strip())
        wb.close()

        if "매출데이터" in names:                       # 이전 주간판매데이터(=베이스)
            found["base"] = path
        elif "SALES" in names or "채널상품명" in hdr:      # 네이버 스마트스토어 통계
            found["naver"] = path
        elif "vendor item metrics" in names or "옵션 ID" in hdr:  # 쿠팡 인사이트
            found["coupang"] = path
        elif {"주문옵션번호", "판매가 * 수량"} & hdr:       # 오늘의집(암호 없는 경우)
            found["ohouse"] = path
    return found


def main():
    ap = argparse.ArgumentParser(description="주간 판매 데이터 자동 생성기")
    ap.add_argument("--input", default=None,
                    help="엑셀 3개(+이전 결과)가 든 폴더. 지정 시 파일 자동 인식")
    ap.add_argument("--naver")
    ap.add_argument("--coupang")
    ap.add_argument("--ohouse")
    ap.add_argument("--cafe24", help="자사몰(카페24) 상품별 매출 CSV")
    ap.add_argument("--ohouse-pw", default=DEFAULT_OHOUSE_PW)
    ap.add_argument("--week", default=None, help="예: 8월3주차 (미지정 시 기간에서 유추)")
    ap.add_argument("--base", default=None, help="이전 주간판매데이터.xlsx (누적/기타 시트 보존)")
    ap.add_argument("--brand", default="플레르가구", help="회사명 표기 (예: 플레르가구 / 가즈다가구)")
    ap.add_argument("--out", required=True)
    ap.add_argument("--ohouse-exclude-cancel", action="store_true")
    a = ap.parse_args()

    naver, coupang, ohouse, base = a.naver, a.coupang, a.ohouse, a.base
    cafe24 = a.cafe24
    if a.input:
        f = classify_files(a.input, ohouse_pw=a.ohouse_pw)
        naver = naver or f["naver"]
        coupang = coupang or f["coupang"]
        ohouse = ohouse or f["ohouse"]
        base = base or f["base"]
        cafe24 = cafe24 or f["cafe24"]

    missing = [n for n, v in [("네이버", naver), ("쿠팡", coupang), ("오늘의집", ohouse)] if not v]
    if missing:
        raise SystemExit(
            "다음 플랫폼 파일을 인식하지 못했습니다: " + ", ".join(missing) +
            "\n  - 네이버: 파일명 'sales_...' / 시트 'SALES'"
            "\n  - 쿠팡: 파일명 'SELLER_INSIGHTS...' / 시트 'vendor item metrics'"
            "\n  - 오늘의집: 파일명 '주문배송 내역...' (암호 파일)")

    # 주차 라벨: 미지정 시 '월요일(조회 시작일)의 월+일' 기준으로 산출.
    # 예) 2026.08.10(월)~08.16(일) → '8월 10주차'. (월요일 날짜를 그대로 라벨에 사용)
    week = a.week
    if not week:
        dr = date_range_from_naver_name(naver)  # 'YYYY.MM.DD~YYYY.MM.DD'
        if dr:
            start = dr.split("~")[0]            # 시작일 = 월요일
            _, mm, dd = start.split(".")
            week = f"{int(mm)}월 {int(dd)}주차"
        else:
            week = "이번주"

    build(naver, coupang, ohouse, a.out, week,
          ohouse_pw=a.ohouse_pw, base_path=base,
          ohouse_exclude_cancel=a.ohouse_exclude_cancel, brand=a.brand, cafe24_path=cafe24)


if __name__ == "__main__":
    main()
