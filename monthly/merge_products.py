# -*- coding: utf-8 -*-
"""
채널 합산 통합 순위 — 제품 매칭 엔진
------------------------------------------------------------------
네이버 / 쿠팡 / 오늘의집은 같은 제품이라도 상품명이 완전히 다르다.
  네이버 : '편한 아일랜드 식탁의자 높은 패브릭 홈바 의자 슈리 58cm'
  쿠팡   : '슈리 편한 아일랜드 식탁의자 높은 패브릭 홈바 의자 53cm'
  오집   : '슈리 편한 홈바의자 아일랜드식탁 패브릭 높은 의자 5colors'
공통분모는 **모델명(슈리)** 뿐이다. 그래서 매칭은 2단 조건으로 한다.

  ① 일반 키워드(세라믹·템바보드·식탁·의자·대형·화이트·2600 …)를 모두 걷어내고
     남은 토큰(≈ 모델명)이 겹치는가?
  ② 카테고리(거실장 / 거실테이블 / 의자 / 침대 …)가 같은가?

②가 꼭 필요하다. 모델명만 보면 '플라토 TV거실장'과 '플라토 소파테이블'처럼
같은 모델 시리즈의 서로 다른 제품이 한 줄로 잘못 합쳐진다.

자동 매칭은 어디까지나 '제안'이다. 표기가 다른 모델(까펠로/카펠라)은 기계가 못 묶으므로
`통합_제품맵_{회사}.csv` 를 만들어 두고, 사용자가 통합제품명 열을 고치면
다음 실행부터 그 값이 자동 매칭보다 우선한다.
"""
import csv
import os
import re


# ----------------------------------------------------------------------
# 1) 토큰화 — 일반 키워드를 걷어내고 모델명만 남긴다
# ----------------------------------------------------------------------
# 가구 카테고리어·수식어·마케팅어·브랜드어. 여기 있는 단어는 제품 식별에 쓸모가 없다.
GENERIC_WORDS = """
세라믹 템바보드 거실장 티비장 티비다이 tv다이 tv장 tv장식장 장식장 티비선반 tv선반 선반
식탁 테이블 탁자 의자 체어 침대 베드 책상 소파 쇼파 서랍 서랍장 수납 수납장 책장 협탁
프레임 헤드보드 매트리스 깔판 받침대 사이드테이블 거실테이블 쇼파테이블 소파테이블
거실탁자 좌식탁자 커피테이블 다이닝체어 다이닝 사이드 거실 주방 베란다 창가 침실 방 좁은방
대형 미니 소형 중형 넓은 좁은 폭넓은 폭좁은 낮은 높은 긴 큰 편한 허리편한 예쁜 인테리어
고급 신형 와이드 슬림 모던 심플 북유럽 우드 원목 패브릭 가죽 실리콘 인조가죽 철제 스틸
홈바 아일랜드 바텐 바의자 바 학생 공부 서재 부부 싱글 업소용 카페 가정용 사무실 병원
1인용 2인용 3인용 4인용 접이식 폴딩 회전 이동식 벽걸이 붙박이
플레르가구 가즈다가구 플레르 가즈다 무료배송 사은품 당일발송 특가 할인 이벤트 신상 인기
노트북 간이 보조 보조책상 맞춤 주문제작 공간활용 휴대용 좌식 등받이 세트 타원형 원형
벤치형 벤치의자 평상형 무헤드 호텔 트윈 아기 주니어 성인 기숙사 이층 폭 높이 인치 사이즈
colors color size 신혼 과외 미드센츄리 비스포크 기능성 꿀잠 하드 소프트 허리 허리디스크
허리가 허리에 편안 딱딱 단단 푹신
""".split()
GENERIC = set(GENERIC_WORDS)

# 모델명이 아니라 '수식어'인 토큰을 걸러내는 어미 패턴.
# 예: 딱딱한·단단한·허리에좋은·넓은 → 제품 식별력이 없다.
# (모델명 슈리·플라토·피네·까펠로·솔리브 … 는 이 어미로 끝나지 않는다)
ADJ_TAIL = re.compile(r"(한|좋은|편안|디스크|스러운)$")

# 카테고리 판정 — 위에서부터 먼저 걸리는 것이 이긴다(순서가 곧 우선순위).
# '식탁의자'가 '식탁'보다 먼저 걸려야 하므로 의자류를 위에 둔다.
CATEGORY_RULES = [
    ("매트리스", ["매트리스"]),
    ("의자", ["의자", "체어", "스툴"]),
    ("사이드테이블", ["사이드테이블", "협탁"]),
    ("거실장(TV장)", ["거실장", "티비장", "티비다이", "tv다이", "tv장", "장식장",
                   "티비선반", "tv선반", "tv거실장"]),
    ("거실테이블", ["거실테이블", "소파테이블", "쇼파테이블", "거실탁자", "좌식탁자",
                 "커피테이블", "소파거실테이블"]),
    ("침대", ["침대", "베드", "헤드보드", "깔판", "침대프레임", "받침대"]),
    ("수납장", ["수납장", "서랍장", "책장", "서류장", "행거", "옷장", "선반"]),
    # 사무가구는 같은 회의테이블을 채널마다 '회의테이블 / 회의실책상 / 회의용 상담 테이블'로
    # 달리 부른다. 책상·테이블보다 먼저 잡아야 한 제품이 둘로 갈라지지 않는다.
    ("회의테이블", ["회의테이블", "회의용테이블", "회의실책상", "회의실테이블",
                 "상담테이블", "회의용", "회의실"]),
    ("식탁", ["식탁", "다이닝테이블"]),
    ("책상", ["책상"]),
    ("소파", ["소파", "쇼파"]),
    ("테이블", ["테이블"]),
]


# 바/홈바 의자는 일반 식탁의자와 엄연히 다른 제품인데, 같은 모델명(샤프·슈리)으로
# 두 종류를 다 판다. '의자류이면서 + 바 키워드'일 때만 바의자로 갈라야
# '아일랜드 식탁'(테이블)까지 끌려오지 않는다.
_CHAIR_WORDS = ["의자", "체어", "스툴"]
_BAR_WORDS = ["홈바", "아일랜드", "바텐", "바체어", "바의자", "바스툴"]


# 통합순위 시트에 '표시'할 때만 쓰는 카테고리 묶음 (2026-10 사용자 확정).
# 매칭에는 절대 쓰지 않는다 — 세부 카테고리로 갈라놔야
# '샤프 식탁의자'와 '샤프 회전 홈바의자'가 한 줄로 잘못 합쳐지지 않는다.
DISPLAY_CATEGORY = {
    "바의자": "의자",
    "매트리스": "침대",
    "식탁": "테이블",
    "책상": "테이블",
    "회의테이블": "테이블",
}


def display_category(cat):
    """세부 카테고리 → 통합순위 표시용 카테고리."""
    return DISPLAY_CATEGORY.get(cat, cat)


def categorize(name):
    """상품명 → 카테고리. 띄어쓰기를 지운 문자열로 판정한다.
    ('소파 거실 테이블'과 '소파거실테이블'을 같게 보기 위함)"""
    s = str(name).lower().replace(" ", "")
    if any(w in s for w in _CHAIR_WORDS) and any(w in s for w in _BAR_WORDS):
        return "바의자"
    for cat, words in CATEGORY_RULES:
        if any(w in s for w in words):
            return cat
    return "기타"


def model_tokens(name, is_color, is_size):
    """제품명에서 일반어·색상·사이즈·숫자를 빼고 남은 토큰(≈ 모델명) 목록.
    is_color / is_size 는 주간 스크립트의 판정 함수를 그대로 받아 쓴다."""
    s = str(name).lower()
    s = re.sub(r"[\[\](){}·/,~\-_+|]", " ", s)
    out = []
    for t in s.split():
        if t in GENERIC:
            continue
        if re.fullmatch(r"\d+(mm|cm|인치|colors?|size|색|단|개|입)?", t):
            continue
        if re.fullmatch(r"\d+x\d+", t):                 # 1600x2000
            continue
        if is_color(t) or is_size(t):
            continue
        if ADJ_TAIL.search(t):                           # 딱딱한·단단한·허리에좋은 …
            continue
        if any(g in t for g in GENERIC if len(g) >= 2):  # '세라믹거실장' 같은 합성어
            continue
        if len(t) < 2:
            continue
        if t not in out:
            out.append(t)
    return out


def similarity(a, b):
    """토큰 겹침 비율(작은 쪽 기준). 모델명 1개끼리 맞으면 1.0."""
    A, B = set(a), set(b)
    if not A or not B:
        return 0.0
    return len(A & B) / min(len(A), len(B))


# ----------------------------------------------------------------------
# 2) 클러스터링 — 채널을 가로질러 같은 제품을 묶는다
# ----------------------------------------------------------------------
SIM_THRESHOLD = 0.5


def cluster(items):
    """items: [{채널, 제품명, 금액, 토큰, 카테고리}] (금액 내림차순 아니어도 됨)
    반환: [{통합제품명, 카테고리, members:[item…]}]  (금액 큰 클러스터부터)

    금액이 큰 상품이 대표가 되도록 내림차순으로 훑고,
    '카테고리 동일 + 대표 토큰과 겹침 ≥ 0.5' 이면 그 클러스터에 합류시킨다.
    대표 토큰은 고정한다(합류할 때마다 토큰을 합치면 클러스터가 번져 오매칭이 난다).
    """
    clusters = []
    for it in sorted(items, key=lambda x: -x["금액"]):
        if not it["토큰"]:                       # 모델명이 없는 상품은 절대 자동병합하지 않음
            clusters.append({"통합제품명": it["제품명"], "카테고리": it["카테고리"],
                             "토큰": [], "members": [it]})
            continue
        hit = None
        for c in clusters:
            if not c["토큰"] or c["카테고리"] != it["카테고리"]:
                continue
            if similarity(it["토큰"], c["토큰"]) < SIM_THRESHOLD:
                continue
            # 겹친 토큰이 어느 한쪽의 '대표 토큰'(첫 잔여 토큰 = 사실상 모델명)이어야 한다.
            # 이 조건이 없으면 '듀에토 … 바른자세 컴퓨터 책상의자'와
            # '아스피 … 바른자세 컴퓨터 …'가 수식어만으로 한 제품이 되어버린다.
            if c["토큰"][0] in it["토큰"] or it["토큰"][0] in c["토큰"]:
                hit = c
                break
        if hit:
            hit["members"].append(it)
        else:
            clusters.append({"통합제품명": it["제품명"], "카테고리": it["카테고리"],
                             "토큰": list(it["토큰"]), "members": [it]})
    return clusters


# ----------------------------------------------------------------------
# 3) 사용자 매핑 CSV — 자동 매칭을 사람이 덮어쓸 수 있게
# ----------------------------------------------------------------------
CSV_HEADER = ["채널", "원본제품명", "통합제품명", "카테고리", "자동제안"]


def _read_map(path):
    """CSV → {(채널, 원본제품명): (통합제품명, 자동제안)}"""
    out = {}
    if not path or not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            ch = (row.get("채널") or "").strip()
            src = (row.get("원본제품명") or "").strip()
            if ch and src:
                out[(ch, src)] = ((row.get("통합제품명") or "").strip(),
                                  (row.get("자동제안") or "").strip())
    return out


def load_map(path):
    """사람이 직접 고친 매핑만 반환한다.

    통합제품명이 그때의 자동제안과 **다를 때만** 사람 손이 닿은 것으로 본다.
    (그냥 통합제품명을 다 존중하면, 지난 실행의 자동값이 CSV에 굳어버려서
     매칭 로직을 개선해도 옛 결과가 계속 되살아난다.)
    """
    return {k: dst for k, (dst, auto) in _read_map(path).items() if dst and dst != auto}


def save_map(path, rows):
    """rows: [(채널, 원본제품명, 통합제품명, 카테고리, 자동제안)]
    사람이 고친 행은 그대로 두고, 나머지는 이번 자동 결과로 갱신한다.
    한 번 등장한 상품 행은 지우지 않는다(지난달에 해 둔 매핑이 사라지지 않게)."""
    old = _read_map(path)
    merged = {k: [k[0], k[1], v[0], "", v[1]] for k, v in old.items()}
    for ch, src, dst, cat, auto in rows:
        key = (ch, src)
        prev = old.get(key)
        edited = prev and prev[0] and prev[0] != prev[1]     # 사람이 고친 행인가
        merged[key] = [ch, src, prev[0] if edited else dst, cat, auto]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(CSV_HEADER)
        for key in sorted(merged, key=lambda k: (k[0], k[1])):
            w.writerow(merged[key])


# ----------------------------------------------------------------------
# 4) 통합 순위 만들기
# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
# 3-2) 카테고리 수정표 — 자동 분류가 틀렸을 때 사람이 고친 값을 계속 유지
# ----------------------------------------------------------------------
CAT_HEADER = ["통합제품명", "카테고리", "자동분류"]


def load_category_map(path):
    """사람이 고친 카테고리만 {통합제품명: 카테고리}로 반환.
    (제품맵과 같은 방식 — `자동분류` 열과 값이 다를 때만 '사람이 고쳤다'로 본다.
     그래야 분류 규칙을 개선해도 손댄 행만 남고 나머지는 새 결과로 갱신된다.)"""
    if not path or not os.path.exists(path):
        return {}
    out = {}
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            nm = (row.get("통합제품명") or "").strip()
            cat = (row.get("카테고리") or "").strip()
            auto = (row.get("자동분류") or "").strip()
            if nm and cat and cat != auto:
                out[nm] = cat
    return out


def save_category_map(path, rows):
    """rows: [(통합제품명, 최종카테고리, 자동분류)]. 사람이 고친 행은 그대로 보존."""
    old = {}
    if os.path.exists(path):
        with open(path, "r", encoding="utf-8-sig", newline="") as f:
            for row in csv.DictReader(f):
                nm = (row.get("통합제품명") or "").strip()
                if nm:
                    old[nm] = ((row.get("카테고리") or "").strip(),
                               (row.get("자동분류") or "").strip())
    merged = {nm: [nm, v[0], v[1]] for nm, v in old.items()}
    for nm, cat, auto in rows:
        prev = old.get(nm)
        edited = prev and prev[0] and prev[0] != prev[1]
        merged[nm] = [nm, prev[0] if edited else cat, auto]
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(CAT_HEADER)
        for nm in sorted(merged):
            w.writerow(merged[nm])


def build_unified(channel_products, is_color, is_size, map_path=None,
                  cat_path=None):
    """channel_products: [(채널명, products), …] — 채널 수는 자유(3채널/자사몰 포함 4채널).
    반환: (rows, csv_rows)
      rows     : [{통합제품명, 카테고리, <채널명>…, 합계, 결제수량, 채널수, 상품수}]
      csv_rows : 매핑 CSV에 쓸 행들
    """
    channels = [ch for ch, _ in channel_products]
    items = []
    for ch, plist in channel_products:
        for p in plist:
            nm = p["제품명"]
            items.append({
                "채널": ch, "제품명": nm, "금액": float(p["총합계"]),
                "수량": float(p.get("총수량", 0) or 0),
                "토큰": model_tokens(nm, is_color, is_size), "카테고리": categorize(nm),
            })

    clusters = cluster(items)

    # 여러 상품이 묶인 행은 대표명에서 **사이즈를 뗀다**.
    # 대표명은 그 묶음에서 금액이 가장 큰 상품의 이름이라, 안 떼면
    # 53·58·63cm가 다 합쳐진 행이 '…58cm'로 표시된다. 그러면 채널 시트의
    # 58cm 행 금액과 통합순위 쿠팡 값이 어긋난 것처럼 보인다.
    # 행 이름이 실제 내용과 다른 게 문제이므로 이름 쪽을 고친다.
    #  - 1개짜리 행은 건드리지 않는다('1인용 폴딩 베드'가 '폴딩 베드'가 되는 것 방지)
    #  - 'N인용'은 사이즈가 아니라 인원이므로 떼지 않는다
    #  - 떼고 나서 다른 행과 이름이 겹치면 원래 이름을 유지한다(서로 다른 제품이 합쳐지면 안 됨)
    taken = {c["통합제품명"] for c in clusters}
    for c in clusters:
        if len(c["members"]) < 2:
            continue
        toks = [t for t in str(c["통합제품명"]).split()
                if not (is_size(t) and not t.endswith("인용"))]
        new = " ".join(toks).strip()
        if new and new != c["통합제품명"] and new not in taken:
            taken.discard(c["통합제품명"])
            taken.add(new)
            c["통합제품명"] = new

    # 자동 제안값 확정
    auto = {}
    for c in clusters:
        for m in c["members"]:
            auto[(m["채널"], m["제품명"])] = c["통합제품명"]

    # 사람이 고쳐 둔 매핑을 덮어씌운다
    manual = load_map(map_path)
    final = {}
    for key, a in auto.items():
        final[key] = manual.get(key, a)

    # 최종 통합명 기준으로 다시 집계
    agg = {}
    for it in items:
        name = final[(it["채널"], it["제품명"])]
        g = agg.setdefault(name, dict({"통합제품명": name,
                                       "카테고리": display_category(it["카테고리"]),
                                       "상품수": 0, "결제수량": 0, "_ch": set()},
                                      **{c: 0.0 for c in channels}))
        g[it["채널"]] += it["금액"]
        g["결제수량"] += it["수량"]
        g["상품수"] += 1
        g["_ch"].add(it["채널"])

    rows = []
    for g in agg.values():
        g["합계"] = sum(g[c] for c in channels)
        g["채널수"] = len(g["_ch"])
        g.pop("_ch")
        rows.append(g)
    rows.sort(key=lambda r: -r["합계"])

    # 사람이 고쳐 둔 카테고리를 덮어씌운다
    cat_manual = load_category_map(cat_path)
    cat_rows = []
    for r in rows:
        auto_cat = r["카테고리"]
        r["카테고리"] = cat_manual.get(r["통합제품명"], auto_cat)
        cat_rows.append((r["통합제품명"], r["카테고리"], auto_cat))
    if cat_path:
        save_category_map(cat_path, cat_rows)

    csv_rows = [(ch, nm, final[(ch, nm)], categorize(nm), auto[(ch, nm)])
                for (ch, nm) in sorted(auto)]
    return rows, csv_rows
