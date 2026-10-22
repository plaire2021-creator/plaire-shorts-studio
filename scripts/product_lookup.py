"""상품 코드(옵션코드)로 구글 시트 '플레르가구 상품등록 현황'·'가즈다가구 상품등록 현황'에서 제품을 찾는다.

  python product_lookup.py "<상품 코드>"   → 마지막 줄에 결과 JSON

두 시트의 첫 탭(브랜드명 상품등록)의 옵션코드 열에서 찾고, 없으면 상품명에서 찾는다.
띄어쓰기·대소문자는 무시하고 '포함'으로 찾는다 (예: 블랑누아거실장2600 → 색상별 옵션이 모두 나옴).
시트를 매번 읽으면 느려서 10분 동안은 읽어 둔 것을 쓴다.
"""
import json
import os
import sys
import tempfile
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "weekly"))

SHEETS = [
    ("플레르가구", "1JkatjKPw2wz6spB0Hxhu64wbE8f1YircK84WhGyXPzo", "플레르가구 상품등록"),
    ("가즈다가구", "1Ede_NyJMfKAaKU1oLfnTq7rU_0edhWYFiQQiaCo3FZo", "가즈다가구 상품등록"),
]
CACHE = os.path.join(tempfile.gettempdir(), "plaire_product_sheets_v3.json")  # 열을 늘리면 이름을 바꿔 옛 캐시를 안 쓰게
TTL = 600


def rows():
    try:
        c = json.load(open(CACHE, encoding="utf-8"))
        if time.time() - c["at"] < TTL:
            return c["rows"]
    except Exception:
        pass
    from sheets_client import open_sheet

    out = []
    for brand, key, tab in SHEETS:
        sh = open_sheet("https://docs.google.com/spreadsheets/d/" + key)
        ws = sh.worksheet(tab)
        # 한샘몰은 첫 탭에 등록 열이 없다 → '한샘몰' 탭(A 옵션코드 · B 한샘몰링크)에 링크가 있으면 등록
        hanssem = set()
        try:
            for h in sh.worksheet("한샘몰").get_values("A3:B5000"):
                if len(h) > 1 and h[0].strip() and h[1].strip().startswith("http"):
                    hanssem.add(h[0].strip())
        except Exception:
            pass
        # A 옵션코드 · B 상품명 · C 사이즈 · D 색상 · 그다음 채널마다 (등록 여부, 판매가): 네이버 쿠팡 오늘의집 11번가 ESM 토스 롯데온 하이마트
        for r in ws.get_values("A3:T5000"):
            r = (r + [""] * 20)[:20]
            if r[0].strip():
                out.append([brand] + [c.strip() for c in r] + ["O" if r[0].strip() in hanssem else "", ""])
    json.dump({"at": time.time(), "rows": out}, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    return out


def norm(s):
    return "".join(str(s).split()).lower()


def price(v):
    return v if v and not v.startswith("#") else ""


def main():
    q = norm(sys.argv[1] if len(sys.argv) > 1 else "")
    if len(q) < 2:
        print(json.dumps({"error": "상품 코드를 2글자 이상 넣어 주세요"}, ensure_ascii=False))
        return
    data = rows()
    hit = [r for r in data if q in norm(r[1])]
    by = "옵션코드"
    if not hit:
        hit = [r for r in data if q in norm(r[2])]
        by = "상품명"
    matches = [
        {
            "brand": r[0], "code": r[1], "name": r[2], "size": r[3], "color": r[4],
            "channels": [
                {"ch": ch, "on": r[i].upper() == "O", "price": price(r[i + 1])}
                for ch, i in (("네이버", 5), ("쿠팡", 7), ("오늘의집", 9), ("11번가", 11), ("ESM", 13), ("토스", 15), ("롯데온", 17), ("하이마트", 19), ("한샘몰", 21))
            ],
        }
        for r in hit[:30]
    ]
    print(json.dumps({"query": sys.argv[1], "by": by, "total": len(hit), "matches": matches}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as e:  # 키 없음·시트 공유 안 됨 등
        print(json.dumps({"error": f"구글 시트를 읽지 못했어요: {e}"}, ensure_ascii=False))
