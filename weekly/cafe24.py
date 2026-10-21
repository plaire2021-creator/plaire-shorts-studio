# -*- coding: utf-8 -*-
"""
자사몰(카페24) 주문내역 CSV 파서 — 월간용 확정 규칙 (2026-10 사용자 확정)
------------------------------------------------------------------
읽는 열 (헤더명으로 찾으므로 열 위치가 바뀌어도 안전):

  C 주문번호        주문 단위 묶기
  F 총 주문금액     **매출 금액의 기준** (주문 단위, 배송비 포함)
  G 총 결제금액     **0원이면 취소건 → 그 주문 전체 제외**
  I 주문상품명      **제품명**
  J 주문상품명(옵션포함)  **옵션 추출원**
  K 수량            주문 안에서 금액을 상품별로 나눌 때 사용
  L 판매가          위와 동일

왜 F(총 주문금액)인가: G(총 결제금액)는 쿠폰·할인이 빠진 실입금액이라 매출과 다르다.
취소 판정에만 G를 쓰고, 금액은 F로 잡는다.

F는 주문 전체 금액이라 한 주문에 상품이 여럿이면 상품별로 나눠야 한다.
`판매가 × 수량` 비중으로 안분하고, 나머지 1원 단위는 소수부가 큰 줄에 몰아줘서
**상품별 금액의 합이 그 주문의 F와 정확히 일치**하게 맞춘다.

옵션 추출 (J열):
  ① J 끝의 괄호 블록 — `(색상=초코, 사이즈=47cm)` → 색상만(식탁·테이블·책상이면 사이즈+색상)
                      `(상품선택=오즈토_세라믹테이블_화이트)` → 값 그대로
                      `(진그레이24)` (= 없음) → 내용 그대로
  ② 괄호가 없고 J가 I로 시작하면 → 뒤에 덧붙은 부분 (예: `… 슈리 63cm` + ` 진그레이`)
  ③ 그 외(J와 I가 같으면) → 옵션 없음
"""
import csv
import re
from collections import OrderedDict

TABLE_WORDS = ("식탁", "테이블", "책상")


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (ValueError, TypeError):
        return 0.0


def _trailing_paren(text):
    """문자열 끝의 괄호 블록 내용을 반환(괄호 중첩 대응). 없으면 None.
    '…월넛 내추럴(색상=사이드테이블 870(내추럴))' → '색상=사이드테이블 870(내추럴)'"""
    s = text.rstrip()
    if not s.endswith(")"):
        return None
    depth = 0
    for i in range(len(s) - 1, -1, -1):
        if s[i] == ")":
            depth += 1
        elif s[i] == "(":
            depth -= 1
            if depth == 0:
                return s[i + 1:-1].strip()
    return None


def extract_option(base, full):
    """I열(base)과 J열(full)로 옵션 문자열을 만든다."""
    base, full = str(base or "").strip(), str(full or "").strip()
    inner = _trailing_paren(full)
    if inner:
        if "=" in inner:
            pairs = {}
            for part in re.split(r",\s*(?=[^=,]+=)", inner):   # '색상=A, 사이즈=B' 분리
                if "=" in part:
                    k, v = part.split("=", 1)
                    pairs[k.strip()] = v.strip()
            color = pairs.get("색상", "")
            size = pairs.get("사이즈", "")
            if color or size:
                is_table = any(w in base for w in TABLE_WORDS) and "의자" not in base
                return " ".join(x for x in ([size, color] if is_table else [color]) if x)
            return " ".join(v for v in pairs.values() if v)    # 상품선택= 등 기타 키
        return inner                                           # '(진그레이24)' 형태
    if base and full.startswith(base):                         # 뒤에 덧붙은 옵션
        return full[len(base):].strip(" ,")
    return ""


def parse(path, group_fn=None, basis="order"):
    """CSV 경로 → (총매출, products). products는 주간 순위표와 같은 구조.
    products: [{제품명, 총합계, 옵션들:[{옵션, 상품코드, 결제수, 결제상품수량, 금액}]}]

    basis: 금액 기준
      "order" — F열 `총 주문금액`(할인 전, 배송비 포함). 기본값.
      "paid"  — G열 `총 결제금액`(쿠폰·할인 적용 후 실결제액).
      어느 쪽이든 G열이 0원인 주문은 취소로 보고 제외한다.

    group_fn: 주간 엔진의 `group_and_option` (제품명 → (색상뺀이름, 색상)).
      자사몰은 색상별로 상품번호를 따로 등록해 둔 게 있어서(슈리 63cm = 884·883·879·913),
      I열에 색상이 박힌 채로 들어온다. 그대로 두면 한 제품이 색상 수만큼 쪼개지므로
      **J열에서 옵션이 안 나오는 경우에 한해** 제품명 끝의 색상을 떼어 옵션으로 올린다.
      (J열 옵션이 있으면 제품명은 건드리지 않는다 — '[화프]샤프실리콘의자(진그6+카멜6+…)'
       처럼 이름 안에 색상어가 들어간 상품이 잘려나가는 사고를 막기 위함)
    """
    with open(path, encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows:
        return 0.0, []
    hdr = {str(h).strip(): i for i, h in enumerate(rows[0])}

    def ci(*names):
        for n in names:
            if n in hdr:
                return hdr[n]
        return None

    i_ord = ci("주문번호")
    i_tot = ci("총 주문금액", "총주문금액")          # F — 매출 기준
    i_paid = ci("총 결제금액", "총결제금액")          # G — 취소 판정용
    i_no = ci("상품번호", "상품 번호")
    i_base = ci("주문상품명")                        # I — 제품명
    i_full = ci("주문상품명(옵션포함)")               # J — 옵션
    i_qty, i_price = ci("수량"), ci("판매가")         # K, L

    missing = [n for n, i in [("총 주문금액", i_tot), ("총 결제금액", i_paid),
                              ("주문상품명", i_base), ("수량", i_qty)] if i is None]
    if missing:
        raise SystemExit("자사몰 CSV에서 다음 열을 찾지 못했습니다: " + ", ".join(missing))

    def cell(row, i):
        return row[i] if (i is not None and i < len(row)) else ""

    # 주문번호로 묶기 (F·G는 주문 단위 값이라 라인마다 같은 값이 반복된다)
    orders = OrderedDict()
    for row in rows[1:]:
        if not row or not str(cell(row, i_base)).strip():
            continue
        key = str(cell(row, i_ord)).strip() or f"_{len(orders)}"
        od = orders.setdefault(key, {"total": 0.0, "paid": 0.0, "lines": []})
        od["lines"].append(row)
        od["total"] = max(od["total"], _num(cell(row, i_tot)))
        od["paid"] = max(od["paid"], _num(cell(row, i_paid)))

    groups, grand = {}, 0
    for od in orders.values():
        if od["paid"] <= 0:                    # 총 결제금액 0원 = 취소건 → 주문 전체 제외
            continue
        amount = int(round(od["paid"] if basis == "paid" else od["total"]))
        grand += amount

        # 판매가×수량 비중으로 안분 + 나머지 배분(합이 F와 정확히 일치)
        weights = [_num(cell(r, i_price)) * (_num(cell(r, i_qty)) or 1) for r in od["lines"]]
        wsum = sum(weights)
        if wsum <= 0:
            weights = [1.0] * len(od["lines"])
            wsum = float(len(weights))
        raw = [amount * w / wsum for w in weights]
        share = [int(x) for x in raw]
        rest = amount - sum(share)
        for idx in sorted(range(len(raw)), key=lambda i: -(raw[i] - share[i]))[:rest]:
            share[idx] += 1

        for r, amt in zip(od["lines"], share):
            name = str(cell(r, i_base)).strip()
            opt = extract_option(name, cell(r, i_full))
            if not opt and group_fn:               # J열에 옵션이 없을 때만 이름에서 색상 분리
                name, opt = group_fn(name)
            qty = _num(cell(r, i_qty)) or 1
            g = groups.setdefault(name, {"제품명": name, "옵션들": []})
            hit = next((o for o in g["옵션들"] if o["옵션"] == opt), None)
            if hit:
                hit["결제수"] += 1
                hit["결제상품수량"] += qty
                hit["금액"] += amt
            else:
                g["옵션들"].append({
                    "옵션": opt, "상품코드": str(cell(r, i_no)).strip(),
                    "결제수": 1, "결제상품수량": qty, "금액": amt,
                })

    products = []
    for g in groups.values():
        g["옵션들"].sort(key=lambda o: -o["금액"])
        g["총합계"] = sum(o["금액"] for o in g["옵션들"])
        products.append(g)
    products.sort(key=lambda p: -p["총합계"])
    return grand, products
