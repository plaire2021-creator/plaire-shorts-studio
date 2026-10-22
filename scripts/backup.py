"""플레르 MS팀 업무 도구 백업·되살리기.

  python backup.py make <백업폴더>            → <백업폴더>\\백업_YYYYMMDD-HHMM.zip (최근 14개만 남김)
  python backup.py restore <zip>             → 그 백업으로 되살림(되살리기 전 지금 상태를 먼저 백업)
  python backup.py list <백업폴더>            → 백업 목록(JSON)

백업에 넣는 것 (zip 안 경로)
  data/매출 통계/**          주간·월간 통합파일·CSV·원본 사본 (다음 집계가 이어 쓰는 핵심)
  data/config.json, tokens.json   앱 설정·유튜브/인스타/틱톡 연결
  data/review-runs/**, weekly-runs/**, monthly-runs/**   리뷰 답글·집계 기록
  data/jobs/*/job.json      영상 작업 기록 (영상 파일은 용량이 커서 빼고, 채널에 이미 올라가 있음)
  secrets/*                 구글 시트 키·오늘의집 파일 비밀번호
마지막 줄에 결과 JSON을 출력한다.
"""
import json
import os
import shutil
import sys
import zipfile
from datetime import datetime

HOME = os.path.expanduser("~")
DATA = os.environ.get("PLAIRE_SHORTS_HOME") or os.path.join(HOME, "plaire-shorts")
SECRETS = os.path.join(HOME, ".secrets")
KEEP = 14


def items():
    """(디스크 경로, zip 안 경로) 목록"""
    out = []
    for sub in ("매출 통계", "review-runs", "weekly-runs", "monthly-runs"):
        base = os.path.join(DATA, sub)
        for root, _dirs, files in os.walk(base):
            for f in files:
                if f.startswith("~$"):
                    continue  # 엑셀 잠금 파일
                p = os.path.join(root, f)
                out.append((p, "data/" + os.path.relpath(p, DATA).replace("\\", "/")))
    for f in ("config.json", "tokens.json"):
        p = os.path.join(DATA, f)
        if os.path.isfile(p):
            out.append((p, "data/" + f))
    jobs = os.path.join(DATA, "jobs")
    if os.path.isdir(jobs):
        for d in os.listdir(jobs):
            p = os.path.join(jobs, d, "job.json")
            if os.path.isfile(p):
                out.append((p, f"data/jobs/{d}/job.json"))
    for f in ("google-sheets-key.json", "ohouse_pw.txt"):
        p = os.path.join(SECRETS, f)
        if os.path.isfile(p):
            out.append((p, "secrets/" + f))
    return out


def make(dest, tag=""):
    os.makedirs(dest, exist_ok=True)
    # 초까지 넣고, 혹시 같은 이름이 있으면 번호를 붙여 절대 덮어쓰지 않는다
    stem = "백업_" + datetime.now().strftime("%Y%m%d-%H%M%S") + tag
    name = stem + ".zip"
    k = 2
    while os.path.exists(os.path.join(dest, name)):
        name = f"{stem}_{k}.zip"
        k += 1
    tmp = os.path.join(dest, name + ".part")
    n = 0
    with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as z:
        for p, arc in items():
            try:
                z.write(p, arc)
                n += 1
            except OSError:
                pass  # 쓰는 중이라 잠긴 파일 등은 건너뜀
    final = os.path.join(dest, name)
    os.replace(tmp, final)
    old = sorted(f for f in os.listdir(dest) if f.startswith("백업_") and f.endswith(".zip"))
    for f in old[:-KEEP]:
        os.remove(os.path.join(dest, f))
    return {"ok": True, "file": final, "files": n, "size": os.path.getsize(final)}


def restore(zpath):
    if not zipfile.is_zipfile(zpath):
        raise SystemExit("백업 파일이 아니에요: " + zpath)
    # 고른 백업을 먼저 임시로 복사해 둔다(아래 안전 백업이 오래된 백업을 정리하다 지워도 괜찮게)
    import tempfile
    work = os.path.join(tempfile.gettempdir(), "plaire_restore.zip")
    shutil.copyfile(zpath, work)
    # 되살리기 전에 지금 상태를 같은 폴더에 따로 한 번 더 백업(다른 이름)
    safety = make(os.path.dirname(zpath), tag="_되살리기전")
    n = 0
    with zipfile.ZipFile(work) as z:
        for info in z.infolist():
            arc = info.filename
            if arc.startswith("data/"):
                dst = os.path.join(DATA, *arc[5:].split("/"))
            elif arc.startswith("secrets/"):
                dst = os.path.join(SECRETS, *arc[8:].split("/"))
            else:
                continue
            dst = os.path.normpath(dst)
            if not (dst.startswith(os.path.normpath(DATA)) or dst.startswith(os.path.normpath(SECRETS))):
                continue  # 경로 탈출 방지
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with z.open(info) as src, open(dst, "wb") as out:
                shutil.copyfileobj(src, out)
            n += 1
    return {"ok": True, "restored": n, "safety": safety["file"]}


def listing(dest):
    if not os.path.isdir(dest):
        return {"ok": True, "items": []}
    rows = []
    for f in sorted(os.listdir(dest), reverse=True):
        if f.startswith("백업_") and f.endswith(".zip"):
            p = os.path.join(dest, f)
            rows.append({"name": f, "size": os.path.getsize(p), "time": datetime.fromtimestamp(os.path.getmtime(p)).isoformat(timespec="minutes")})
    return {"ok": True, "items": rows}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd, arg = sys.argv[1], sys.argv[2]
    res = {"make": make, "restore": restore, "list": listing}[cmd](arg)
    print(json.dumps(res, ensure_ascii=False))
