"""MS팀 주간업무 계획표 엑셀 → 업무 목록 JSON (홈 화면 '이번 주 업무'용).

  python plan_parse.py <엑셀>   → 마지막 줄에 JSON

양식이 조금씩 바뀌어도 읽히게 고정 칸 대신 찾아서 읽는다:
- 시트: 이름에 '업무'가 든 시트 중 가장 뒤(최신 주차). 없으면 '주간업무 계획표'라는 글이 있는 시트.
- 기간: 'YYYY.MM.DD' 두 개가 든 칸 (예: 2026.10.19(월) ~ 2026.10.23(금)).
- 휴가: '연차·휴가·반차·월차' 뒤에 오는 이름들 (예: '/ 연차 : 방채원').
- 머리글 줄: '플레르'와 '가즈다'가 함께 있는 줄. 그 왼쪽 칸 = 항목 이름, '비고'·'링크' 칸도 찾는다.
- 칸 안 글: '1. …' 줄이 업무 하나, 그 아래 '1) …' 줄은 세부 업무(각각 체크). 번호 없는 줄은 한 줄이 업무 하나. '-'로 시작하는 줄은 바로 위 업무에 덧붙인다.
- 플레르·가즈다 칸이 합쳐져 있으면 '공통'.
"""
import json
import re
import sys

import openpyxl

LEAVE_RE = re.compile(r"(연차|휴가|반차|월차|오전반차|오후반차)\s*[:：]?\s*([가-힣·,/\s]+)")
DATE_RE = re.compile(r"(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})")


def cell_text(v):
    return "" if v is None else str(v).replace("\r", "").strip()


def items_of(text):
    """칸 글 → [{"t": 업무 문장, "link": 칸에 같이 적힌 주소}]"""
    out = []
    st = {"p": None, "num": False, "sub": False, "link": ""}

    def flush():
        if st["p"] and not st["sub"]:
            out.append({"t": st["p"], "link": st["link"]})
        st.update(p=None, num=False, sub=False, link="")

    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            if st["p"] and not st["num"]:
                flush()  # 빈 줄 = 번호 없는 묶음의 끝
            continue
        if re.match(r"^https?://\S+$", line):  # 주소만 있는 줄은 업무가 아니라 바로 위 업무의 링크
            if st["p"] and not st["sub"]:
                st["link"] = st["link"] or line
            elif out:
                out[-1]["link"] = out[-1]["link"] or line
            continue
        m_top = re.match(r"^(\d+)\s*[.．]\s*(.*)$", line)
        m_sub = re.match(r"^(\d+)\s*\)\s*(.*)$", line)
        if m_top:
            flush()
            st.update(p=m_top.group(2).strip(), num=True)
        elif m_sub:
            if st["p"]:
                out.append({"t": f"{st['p']} · {m_sub.group(2).strip()}", "link": ""})
                st["sub"] = True
            else:
                out.append({"t": m_sub.group(2).strip(), "link": ""})
        elif line.startswith(("-", "→", "*")) and (st["p"] or out):
            note = line.lstrip("-→* ").strip()
            if st["p"] and not st["sub"]:
                st["p"] += f" ({note})"
            elif out:
                out[-1]["t"] += f" ({note})"
        elif st["p"] and st["num"] and not st["sub"]:
            st["p"] += f" ({line})"  # 번호 업무 아래 설명 줄
        elif st["p"] and not st["num"]:
            st["p"] += f" · {line}"  # 번호 없는 줄들은 빈 줄 전까지 한 업무
        else:
            flush()
            st.update(p=line, num=False)
    flush()
    return [o for o in out if o["t"]]


def pick_sheet(wb):
    cands = [ws for ws in wb.worksheets if "업무" in ws.title and "매출" not in ws.title]
    if cands:
        return cands[-1]
    for ws in wb.worksheets:
        for row in ws.iter_rows(min_row=1, max_row=5, values_only=True):
            if any("업무 계획" in cell_text(v) or "업무계획" in cell_text(v) for v in row):
                return ws
    return wb.worksheets[0]


def goals_of(wb, year):
    """'월간목표매출' 시트: <플레르가구>/<가즈다가구> 묶음의 '목표매출' 표 → {브랜드: {"YYYY-MM": {채널: 원}}}"""
    ws = next((w for w in wb.worksheets if "목표" in w.title and "월간" in w.title), None)
    if not ws or not year:
        return {}
    out, brand, cols, on = {}, None, None, False
    for row in ws.iter_rows(min_row=1, max_row=min(ws.max_row, 80), max_col=20, values_only=True):
        t = [cell_text(v) for v in row]
        b = next((x for x in t if x.startswith("<") and ("플레르" in x or "가즈다" in x)), None)
        if b:
            brand, on = ("플레르가구" if "플레르" in b else "가즈다가구"), False
            continue
        if t and t[0] in ("목표매출", "달성매출"):
            on = t[0] == "목표매출"
            cols = {i: int(re.match(r"(\d+)월", x).group(1)) for i, x in enumerate(t) if re.fullmatch(r"\d+월", x)}
            continue
        ch = t[1] if len(t) > 1 else ""
        if on and brand and cols and ch in ("스마트스토어", "쿠팡", "오늘의집"):
            for i, m in cols.items():
                v = row[i]
                if isinstance(v, (int, float)) and v > 0:
                    out.setdefault(brand, {}).setdefault("%04d-%02d" % (year, m), {})[ch] = int(v)
    return out


def main():
    wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
    ws = pick_sheet(wb)
    merged = {}
    for rng in ws.merged_cells.ranges:
        merged[(rng.min_row, rng.min_col)] = (rng.max_col - rng.min_col + 1)
    period, leave, hdr, title = None, [], None, ""
    for r in range(1, min(ws.max_row, 15) + 1):
        texts = [(c, cell_text(ws.cell(r, c).value)) for c in range(1, min(ws.max_column, 30) + 1)]
        for c, t in texts:
            if not t:
                continue
            if not title and ("계획" in t):
                title = t
            ds = DATE_RE.findall(t)
            if len(ds) >= 2 and not period:
                period = ["%04d-%02d-%02d" % tuple(map(int, d)) for d in ds[:2]]
            for m in LEAVE_RE.finditer(t):
                for n in re.split(r"[,/·\s]+", m.group(2)):
                    n = re.sub(r"(사원|대리|주임|과장|팀장|매니저|실장)?님?$", "", n.strip())
                    if 2 <= len(n) <= 4 and n not in [x["name"] for x in leave]:
                        leave.append({"name": n, "kind": m.group(1)})
        cols = {t: c for c, t in texts if t}
        if hdr is None and any("플레르" in t for t in cols) and any("가즈다" in t for t in cols):
            pc = next(c for t, c in cols.items() if "플레르" in t)
            gc = next(c for t, c in cols.items() if "가즈다" in t)
            hdr = {"row": r, "plaire": pc, "gazda": gc, "cat": min(pc, gc) - 1,
                   "note": next((c for t, c in cols.items() if "비고" in t), None),
                   "link": next((c for t, c in cols.items() if "링크" in t), None)}
    if not hdr:
        print(json.dumps({"error": "'플레르가구'·'가즈다가구' 칸이 있는 업무 표를 찾지 못했어요"}, ensure_ascii=False))
        return
    rows = []
    for r in range(hdr["row"] + 1, ws.max_row + 1):
        cat = cell_text(ws.cell(r, hdr["cat"]).value)
        pt, gt = cell_text(ws.cell(r, hdr["plaire"]).value), cell_text(ws.cell(r, hdr["gazda"]).value)
        note = cell_text(ws.cell(r, hdr["note"]).value) if hdr["note"] else ""
        link = cell_text(ws.cell(r, hdr["link"]).value) if hdr["link"] else ""
        if not (cat or pt or gt):
            continue
        common = merged.get((r, hdr["plaire"]), 1) > 1 and hdr["gazda"] == hdr["plaire"] + 1
        row = {"cat": cat or "기타", "note": note, "ref": link, "common": common,
               "plaire": items_of(pt), "gazda": [] if common else items_of(gt)}
        rows.append(row)
    goals = goals_of(wb, int(period[0][:4]) if period else None)
    print(json.dumps({"sheet": ws.title, "title": title, "period": period, "leave": leave, "rows": rows, "goals": goals}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(json.dumps({"error": f"업무 계획표를 읽지 못했어요: {e}"}, ensure_ascii=False))
