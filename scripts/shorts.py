"""플레르 제품 숏츠 제작 CLI.

  python shorts.py sheets  <제품폴더> [--out 작업폴더]   사진·상세페이지·기타 이미지를 훑어볼 시트 생성
  python shorts.py lineup  <라인업이미지> [--out 작업폴더] 가로 라인업 사진에서 제품별 가로 위치(x) 후보 표시
  python shorts.py prepare <shorts.json>                  crops 대로 9:16 크롭 → public/, 크롭 미리보기 시트
  python shorts.py bgm     <shorts.json>                  장면 길이에서 전환 시각을 계산해 BGM 생성
  python shorts.py guides  <shorts.json>                  쇼츠 UI 가림 영역을 겹친 확인용 스틸 시트
  python shorts.py render  <shorts.json>                  최종 mp4 렌더 + 길이·오디오 검사
  python shorts.py all     <shorts.json>                  prepare → bgm → guides → render
  python shorts.py intake  <영상> --out <폴더>             이미 만든 영상: 업로드용 mp4(H.264·AAC) + 장면 프레임 시트

shorts.json 은 Remotion props(scenes 등)에 아래 키를 더한 파일. 상대경로는 json 위치 기준.
  source_dir : 원본 사진 폴더            public_dir : 크롭·음원이 들어갈 폴더 (기본 ./public)
  output     : 결과 mp4 (기본 ./숏츠.mp4)  crops : {이름: {file, cx, cy, zoom}}  (결과는 public/이름.jpg)
  copy       : {public 파일명: 원본 상대경로} 크롭 없이 그대로 복사할 이미지 (라인업 등)
  music      : {style: jazz|pop, bpm: 120}
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(os.path.dirname(HERE), "engine")
TW, TH = 1296, 2304  # 1080x1920의 1.2배 (줌 여유)
IMG_EXT = (".jpg", ".jpeg", ".png", ".webp")


def font(size):
    for p in ("C:/Windows/Fonts/malgun.ttf", "C:/Windows/Fonts/gulim.ttc"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def load(path, max_side=None):
    im = Image.open(path)
    if max_side:
        im.draft("RGB", (max_side, max_side))
    return im.convert("RGB")


def npx():
    return "npx.cmd" if os.name == "nt" else "npx"


def run(cmd, cwd=None):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if r.returncode != 0:
        print(r.stdout[-3000:], r.stderr[-3000:])
        sys.exit(f"실패: {' '.join(cmd[:4])} ...")
    return r.stdout


# ---------- sheets ----------
def contact(files, out, cols=7, cell=300, label=True):
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * cell, rows * (cell + 24)), "white")
    d = ImageDraw.Draw(sheet)
    f = font(16)
    for i, p in enumerate(files):
        im = load(p, cell * 2)
        im.thumbnail((cell, cell))
        x, y = (i % cols) * cell, (i // cols) * (cell + 24)
        sheet.paste(im, (x, y))
        if label:
            w, h = Image.open(p).size
            d.text((x + 4, y + cell + 3), f"{os.path.basename(p)} {w}x{h}", fill="black", font=f)
    sheet.save(out, quality=82)


def cmd_sheets(a):
    root = os.path.abspath(a.product)
    out = os.path.abspath(a.out or os.path.join(root, "숏츠_영상", "_시트"))
    os.makedirs(out, exist_ok=True)
    imgs = [p for p in glob.glob(os.path.join(root, "**", "*"), recursive=True) if p.lower().endswith(IMG_EXT) and "숏츠_영상" not in p and "블로그" not in p]
    groups = {}
    for p in imgs:
        groups.setdefault(os.path.dirname(p), []).append(p)
    for folder, files in sorted(groups.items()):
        files.sort()
        name = os.path.relpath(folder, root).replace(os.sep, "_").replace(".", "루트")
        # 상세페이지 분할 이미지처럼 세로로 긴 이미지가 연속이면 글을 읽을 수 있게 세로로 이어 붙임
        tall = [p for p in files if Image.open(p).size[1] > 0 and Image.open(p).size[0] <= 1200]
        is_detail = os.path.basename(folder) in DETAIL_DIRS or (len(tall) >= 0.7 * len(files) and len(files) >= 5)
        if is_detail:
            W = 450
            cols, cur, hh = [], [], 0
            for p in files:
                im = load(p)
                im = im.resize((W, int(im.size[1] * W / im.size[0])))
                if hh + im.size[1] > 1900 and cur:
                    cols.append(cur)
                    cur, hh = [], 0
                cur.append(im)
                hh += im.size[1]
            cols.append(cur)
            for k in range(0, len(cols), 4):
                grp = cols[k : k + 4]
                sh = Image.new("RGB", ((W + 10) * len(grp), 1900), "white")
                for c, col in enumerate(grp):
                    y = 0
                    for im in col:
                        sh.paste(im, (c * (W + 10), y))
                        y += im.size[1]
                path = os.path.join(out, f"상세_{name}_{k // 4}.jpg")
                sh.save(path, quality=85)
                print("상세페이지 시트:", path)
        else:
            for k in range(0, len(files), 28):
                path = os.path.join(out, f"사진_{name}_{k // 28}.jpg")
                contact(files[k : k + 28], path)
                print("사진 시트:", path)


# ---------- intake (이미 만든 영상) ----------
def cmd_intake(a):
    """올라온 영상을 채널 업로드에 맞는 mp4로 맞추고, 문구를 쓸 수 있게 장면 프레임 시트를 만든다."""
    ensure_engine()
    src = os.path.abspath(a.video)
    out = os.path.abspath(a.out)
    os.makedirs(out, exist_ok=True)
    info = json.loads(run([npx(), "remotion", "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height:format=duration", "-of", "json", src], cwd=ENGINE))
    v = next((x for x in info.get("streams", []) if x.get("codec_type") == "video"), {})
    au = next((x for x in info.get("streams", []) if x.get("codec_type") == "audio"), None)
    dur = float(info.get("format", {}).get("duration") or 0)
    dst = os.path.join(out, "업로드용.mp4")
    ok = src.lower().endswith(".mp4") and v.get("codec_name") == "h264" and (au is None or au.get("codec_name") == "aac")
    if ok:
        shutil.copyfile(src, dst)
    else:  # 아이폰 HEVC·mov 등은 인스타·틱톡이 거절할 수 있어서 H.264로 다시 저장
        run([npx(), "remotion", "ffmpeg", "-y", "-v", "error", "-i", src, "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dst], cwd=ENGINE)
    # 장면 프레임 9장 (처음·끝 살짝 피해서 고르게)
    frames = []
    n = 9
    for i in range(n):
        t = dur * (i + 0.5) / n if dur else i
        f = os.path.join(out, f"_frame_{i}.jpg")
        run([npx(), "remotion", "ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}", "-i", dst, "-frames:v", "1", "-vf", "scale=360:-2", f], cwd=ENGINE)
        if os.path.exists(f):
            frames.append((f, t))
    cell_w, cell_h = 360, 640
    sheet = Image.new("RGB", (cell_w * 3, (cell_h + 26) * 3), "white")
    d = ImageDraw.Draw(sheet)
    for k, (f, t) in enumerate(frames):
        im = Image.open(f).convert("RGB")
        im.thumbnail((cell_w, cell_h))
        x, y = (k % 3) * cell_w, (k // 3) * (cell_h + 26)
        sheet.paste(im, (x, y))
        d.text((x + 6, y + cell_h + 4), f"{t:.1f}초", fill="black", font=font(18))
        os.remove(f)
    sheet_path = os.path.join(out, "_장면_프레임.jpg")
    sheet.save(sheet_path, quality=85)
    print(json.dumps({"upload_video": dst, "sheet": sheet_path, "duration": round(dur, 1), "width": v.get("width"), "height": v.get("height"), "codec": v.get("codec_name"), "audio": bool(au), "converted": not ok}, ensure_ascii=False))


# ---------- detail ----------
DETAIL_DIRS = ("분할_JPG", "상세페이지_등록")


def cmd_detail(a):
    """스튜디오에서 따로 올린 상세페이지 이미지를 올린 순서대로 저장한다.
    통으로 긴 이미지는 시트에서 잘리지 않게 세로 2:1 정도씩 나눈다."""
    dest = os.path.abspath(a.dest)
    os.makedirs(dest, exist_ok=True)
    k = 0
    for src in a.files:
        im = load(src)
        w, h = im.size
        step = w * 2
        for top in range(0, h, step):
            k += 1
            im.crop((0, top, w, min(h, top + step))).save(os.path.join(dest, f"상세_{k:03d}.jpg"), quality=90)
    print(json.dumps({"files": k, "dir": dest}, ensure_ascii=False))


# ---------- unzip ----------
def cmd_unzip(a):
    """윈도우 '압축 폴더'로 만든 zip은 한글 파일명이 CP949라 그대로 풀면 깨진다. 이름을 복원해서 푼다."""
    import zipfile

    dest = os.path.abspath(a.dest)
    os.makedirs(dest, exist_ok=True)
    n = 0
    with zipfile.ZipFile(a.zip) as z:
        for info in z.infolist():
            name = info.filename
            if not info.flag_bits & 0x800:
                try:
                    name = name.encode("cp437").decode("cp949")
                except (UnicodeEncodeError, UnicodeDecodeError):
                    pass
            if name.startswith("__MACOSX") or os.path.basename(name).startswith("._"):
                continue
            target = os.path.normpath(os.path.join(dest, name))
            if not target.startswith(dest):
                continue  # zip 경로 탈출 방지
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(info) as src, open(target, "wb") as out:
                shutil.copyfileobj(src, out)
            n += 1
    # 최상위 폴더가 하나뿐이면 그 안을 제품 폴더로 본다
    entries = [e for e in os.listdir(dest) if not e.startswith(".")]
    root = os.path.join(dest, entries[0]) if len(entries) == 1 and os.path.isdir(os.path.join(dest, entries[0])) else dest
    print(json.dumps({"files": n, "product_dir": root}, ensure_ascii=False))


# ---------- lineup ----------
def cmd_lineup(a):
    im = load(a.image)
    W, H = im.size
    out = a.out or os.path.dirname(os.path.abspath(a.image))
    prev = im.copy()
    prev.thumbnail((1800, 1800))
    d = ImageDraw.Draw(prev)
    sw, sh = prev.size
    for i in range(0, 101, 5):
        major = i % 10 == 0
        x = int(sw * i / 100)
        d.line([(x, 0), (x, sh)], fill=(255, 0, 0) if major else (255, 170, 170), width=2 if major else 1)
        y = int(sh * i / 100)
        d.line([(0, y), (sw, y)], fill=(0, 90, 255) if major else (160, 190, 255), width=2 if major else 1)
        if major:
            d.text((x + 3, 4), f"{i / 100:.1f}", fill=(255, 0, 0), font=font(22))
            d.text((4, y + 2), f"{i / 100:.1f}", fill=(0, 90, 255), font=font(22))
    path = os.path.join(out, "lineup_눈금.jpg")
    prev.save(path, quality=85)
    print("눈금 미리보기:", path, "(빨간 숫자 = 가로 위치 x → items[].x, 파란 숫자 = 세로 위치 → 제품 몸체 y0~y1)")
    print("가로 비율(aspect):", round(W / H, 4))


# ---------- prepare ----------
def cfg_load(path):
    path = os.path.abspath(path)
    c = json.load(open(path, encoding="utf-8"))
    base = os.path.dirname(path)
    rel = lambda p: p if os.path.isabs(p) else os.path.normpath(os.path.join(base, p))
    c["_path"] = path
    c["_base"] = base
    c["_public"] = rel(c.get("public_dir", "public"))
    c["_src"] = rel(c.get("source_dir", "."))
    c["_out"] = rel(c.get("output", "숏츠.mp4"))
    c["_work"] = os.path.join(base, "_검수")
    os.makedirs(c["_public"], exist_ok=True)
    os.makedirs(c["_work"], exist_ok=True)
    return c


def crop916(im, cx=0.5, cy=0.5, zoom=1.0):
    w, h = im.size
    r = TW / TH
    cw, ch = (h * r, h) if w / h > r else (w, w / r)
    cw, ch = cw / zoom, ch / zoom
    x = min(max(cx * w - cw / 2, 0), w - cw)
    y = min(max(cy * h - ch / 2, 0), h - ch)
    return im.crop((int(x), int(y), int(x + cw), int(y + ch))).resize((TW, TH), Image.LANCZOS)


def cmd_prepare(c):
    thumbs = []
    for name, spec in c.get("crops", {}).items():
        im = load(os.path.join(c["_src"], spec["file"]), 3000)
        out = crop916(im, spec.get("cx", 0.5), spec.get("cy", 0.5), spec.get("zoom", 1.0))
        out.save(os.path.join(c["_public"], f"{name}.jpg"), quality=90)
        t = out.copy()
        t.thumbnail((240, 427))
        thumbs.append((name, t))
    for dst, src in c.get("copy", {}).items():
        load(os.path.join(c["_src"], src)).save(os.path.join(c["_public"], dst), quality=92)
    if thumbs:
        sh = Image.new("RGB", (250 * len(thumbs), 455), "white")
        d = ImageDraw.Draw(sh)
        for i, (n, t) in enumerate(thumbs):
            sh.paste(t, (i * 250, 0))
            d.text((i * 250 + 4, 432), n, fill="black", font=font(16))
        p = os.path.join(c["_work"], "크롭_미리보기.jpg")
        sh.save(p, quality=85)
        print("크롭 미리보기:", p)


# ---------- bgm ----------
def timeline(c):
    fps = c.get("fps", 30)
    t, cuts, end = 0, [], None
    for sc in c["scenes"]:
        if t > 0:
            cuts.append(t / fps)
        if sc["type"] == "end":
            end = t / fps
        t += sc["frames"]
    return t, fps, cuts, end


def cmd_bgm(c):
    total, fps, cuts, end = timeline(c)
    m = c.get("music", {})
    bgm = c.get("bgm", "bgm.wav")
    c["bgm"] = bgm
    args = [sys.executable, os.path.join(HERE, "make_bgm.py"), "--out", os.path.join(c["_public"], bgm), "--duration", str(total / fps), "--style", m.get("style", "jazz"), "--bpm", str(m.get("bpm", 120)), "--cuts", ",".join(f"{x:g}" for x in cuts)]
    if end is not None:
        args += ["--end", f"{end:g}"]
    print(run(args).strip())
    beat = 60 / m.get("bpm", 120) * fps
    off = [sc["frames"] for sc in c["scenes"] if abs(sc["frames"] / beat - round(sc["frames"] / beat)) > 1e-6]
    if off:
        print(f"주의: 박자({beat:g}프레임)의 배수가 아닌 장면 길이 {off} — 전환이 박자에서 어긋남")


def props_file(c, guides=False):
    keep = {k: v for k, v in c.items() if not k.startswith("_") and k not in ("crops", "copy", "source_dir", "public_dir", "output", "music")}
    keep["guides"] = guides
    p = os.path.join(c["_work"], "props.json")
    json.dump(keep, open(p, "w", encoding="utf-8"), ensure_ascii=False)
    return p


def ensure_engine():
    if not os.path.isdir(os.path.join(ENGINE, "node_modules")):
        print("엔진 의존성 설치 중...")
        run(["npm.cmd" if os.name == "nt" else "npm", "install", "--no-audit", "--no-fund"], cwd=ENGINE)


# ---------- guides ----------
def check_safe(c):
    """자막이 넘치지 않는지 간단 점검 (글자 수 기준)."""
    warn = []
    for i, sc in enumerate(c["scenes"]):
        for line in sc.get("caption", []) + sc.get("title", []):
            n = len(line.replace("**", ""))
            if n > 11:
                warn.append(f"장면{i + 1} '{line}' {n}자 — 한 줄 11자 이하 권장(넘으면 오른쪽 버튼 영역 침범 위험)")
        if sc.get("sub") and len(sc["sub"]) > 20:
            warn.append(f"장면{i + 1} 보조자막 {len(sc['sub'])}자 — 20자 이하 권장")
    for w in warn:
        print("주의:", w)


def cmd_guides(c):
    ensure_engine()
    check_safe(c)
    p = props_file(c, guides=True)
    total, fps, _, _ = timeline(c)
    frames, t = [0], 0
    for sc in c["scenes"]:
        frames += [t + sc["frames"] // 2, t + sc["frames"] - 4]
        t += sc["frames"]
    frames = sorted(set(min(total - 1, f) for f in frames))
    ims = []
    for f in frames:
        o = os.path.join(c["_work"], f"g{f:04d}.png")
        run([npx(), "remotion", "still", "src/index.ts", "ShortsGuides", o, f"--frame={f}", "--scale=0.35", f"--props={p}", f"--public-dir={c['_public']}"], cwd=ENGINE)
        ims.append((f, Image.open(o)))
    w, h = ims[0][1].size
    cols = 7
    rows = (len(ims) + cols - 1) // cols
    sh = Image.new("RGB", ((w + 8) * cols, (h + 30) * rows), "white")
    d = ImageDraw.Draw(sh)
    for i, (f, im) in enumerate(ims):
        x, y = (i % cols) * (w + 8), (i // cols) * (h + 30)
        sh.paste(im, (x, y))
        d.text((x + 4, y + h + 4), f"{f / fps:.1f}s", fill="black", font=font(18))
    out = os.path.join(c["_work"], "안전영역_검수.jpg")
    sh.save(out, quality=86)
    for f, _ in ims:
        os.remove(os.path.join(c["_work"], f"g{f:04d}.png"))
    print("안전영역 검수 시트:", out, "(빨간 영역 = 쇼츠 UI에 가려지는 곳. 자막·제품이 겹치면 안 됨)")


# ---------- render ----------
def cmd_render(c):
    ensure_engine()
    p = props_file(c, guides=False)
    os.makedirs(os.path.dirname(c["_out"]), exist_ok=True)
    run([npx(), "remotion", "render", "src/index.ts", "Shorts", c["_out"], f"--props={p}", f"--public-dir={c['_public']}", "--codec=h264", "--crf=18", "--audio-bitrate=192k"], cwd=ENGINE)
    # 검사: 길이·오디오 유무
    probe = run([npx(), "remotion", "ffprobe", "-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "compact", c["_out"]], cwd=ENGINE)
    tmp = os.path.join(c["_work"], "_audio.wav")
    run([npx(), "remotion", "ffmpeg", "-y", "-v", "error", "-i", c["_out"], "-vn", "-ac", "1", "-ar", "8000", tmp], cwd=ENGINE)
    wv = wave.open(tmp)
    a = np.frombuffer(wv.readframes(wv.getnframes()), np.int16) / 32767
    wv.close()
    os.remove(tmp)
    print(probe.strip())
    print(f"오디오 rms {np.sqrt((a ** 2).mean()):.3f}" + ("  ← 무음! 확인 필요" if np.abs(a).max() < 0.01 else ""))
    print("완성:", c["_out"], f"{os.path.getsize(c['_out']) / 1e6:.1f}MB")
    upload_copy(c)


def upload_copy(c):
    """브라우저 자동 업로드(파일 1회 10MB 제한)용으로 9MB 이하 사본을 만든다."""
    limit = 9.0e6
    dst = os.path.splitext(c["_out"])[0] + "_업로드용.mp4"
    if os.path.getsize(c["_out"]) <= limit:
        shutil.copyfile(c["_out"], dst)
    else:
        total, fps, _, _ = timeline(c)
        kbps = int(limit * 8 / (total / fps) / 1000) - 192 - 150
        run([npx(), "remotion", "ffmpeg", "-y", "-v", "error", "-i", c["_out"], "-c:v", "libx264", "-preset", "slow", "-b:v", f"{kbps}k", "-maxrate", f"{kbps}k", "-bufsize", f"{kbps * 2}k", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", dst], cwd=ENGINE)
    print("업로드용:", dst, f"{os.path.getsize(dst) / 1e6:.1f}MB")


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sheets")
    s.add_argument("product")
    s.add_argument("--out")
    s = sub.add_parser("lineup")
    s.add_argument("image")
    s.add_argument("--out")
    s = sub.add_parser("unzip")
    s.add_argument("zip")
    s.add_argument("dest")
    s = sub.add_parser("intake")
    s.add_argument("video")
    s.add_argument("--out", required=True)
    s = sub.add_parser("detail")
    s.add_argument("dest")
    s.add_argument("files", nargs="+")
    for n in ("prepare", "bgm", "guides", "render", "all", "upload_copy"):
        sub.add_parser(n).add_argument("config")
    a = ap.parse_args()
    if a.cmd == "sheets":
        return cmd_sheets(a)
    if a.cmd == "lineup":
        return cmd_lineup(a)
    if a.cmd == "unzip":
        return cmd_unzip(a)
    if a.cmd == "detail":
        return cmd_detail(a)
    if a.cmd == "intake":
        return cmd_intake(a)
    c = cfg_load(a.config)
    steps = {"prepare": [cmd_prepare], "bgm": [cmd_bgm], "guides": [cmd_bgm, cmd_guides], "render": [cmd_bgm, cmd_render], "all": [cmd_prepare, cmd_bgm, cmd_guides, cmd_render], "upload_copy": [upload_copy]}[a.cmd]
    for fn in steps:
        fn(c)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
