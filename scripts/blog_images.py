"""블로그용 사진 3:2 편집 + zip, 움직이는 이미지(GIF 2개 + 16:9 10초 영상).

  python blog_images.py crop <crops.json> <출력폴더>
  python blog_images.py motion <motion.json> <출력폴더>

crops.json: [{"file": 원본경로, "cx": 0~1, "cy": 0~1, "zoom": 1.0이상}, ...]  (순서 = 본문 [사진 N] 순서)
결과: <출력폴더>/01.jpg … (1500×1000), <출력폴더>.zip, <출력폴더>/_검수.jpg(모아보기, zip에는 안 들어감)
motion.json:
  {"gifs": [{"kind": "fade", "shots": [{file,cx,cy,zoom}, ...3~4장]},      ← 컬러·각도 넘겨보기
            {"kind": "zoom", "shots": [{file,cx,cy}], "to": 1.7}],         ← 한 장에서 디테일(cx,cy)로 천천히 당기기
   "video": {"shots": [{file,cx,cy}, ...3~5장], "title": "제품명", "brand": "플레르가구"}}
결과: <출력폴더>/움직임_1.gif, 움직임_2.gif (720×480, 3초 안팎 반복), 영상_16x9.mp4 (1920×1080, 10초, 소리 없음),
      <출력폴더>/_움직임_검수.jpg (GIF·영상 장면 모아보기)
마지막 줄에 결과 JSON.
"""
import glob
import json
import os
import shutil
import subprocess
import sys
import zipfile

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H = 1500, 1000  # 3:2


def crop_one(src, cx=0.5, cy=0.5, zoom=1.0):
    im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
    iw, ih = im.size
    # 3:2 로 들어가는 가장 큰 상자 → zoom 만큼 줄임
    bw = min(iw, ih * 3 / 2)
    bh = bw * 2 / 3
    z = max(1.0, float(zoom or 1.0))
    bw, bh = bw / z, bh / z
    x0 = min(max(cx * iw - bw / 2, 0), iw - bw)
    y0 = min(max(cy * ih - bh / 2, 0), ih - bh)
    return im.crop((round(x0), round(y0), round(x0 + bw), round(y0 + bh))).resize((W, H), Image.LANCZOS)


def main():
    spec = json.load(open(sys.argv[2], encoding="utf-8"))
    out = os.path.abspath(sys.argv[3])
    os.makedirs(out, exist_ok=True)
    for f in os.listdir(out):
        if f.lower().endswith(".jpg"):
            os.remove(os.path.join(out, f))
    files = []
    for i, s in enumerate(spec, 1):
        name = f"{i:02d}.jpg"
        crop_one(s["file"], s.get("cx", 0.5), s.get("cy", 0.5), s.get("zoom", 1.0)).save(os.path.join(out, name), quality=90)
        files.append(name)
    # 모아보기(검수용)
    cols = 4
    tw, th = 375, 250
    rows = (len(files) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * tw, max(1, rows) * (th + 22)), "white")
    d = ImageDraw.Draw(sheet)
    for i, name in enumerate(files):
        im = Image.open(os.path.join(out, name)).resize((tw, th))
        x, y = (i % cols) * tw, (i // cols) * (th + 22)
        sheet.paste(im, (x, y))
        d.text((x + 4, y + th + 4), str(i + 1), fill="black")  # 기본 글꼴은 한글이 안 나와서 번호만
    sheet.save(os.path.join(out, "_검수.jpg"), quality=80)
    z = out + ".zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for name in files:
            zf.write(os.path.join(out, name), name)
    print(json.dumps({"ok": True, "images": files, "zip": z, "sheet": os.path.join(out, "_검수.jpg")}, ensure_ascii=False))


# ---------------- 움직이는 이미지 ----------------
HERE = os.path.dirname(os.path.abspath(__file__))
ENGINE = os.path.join(os.path.dirname(HERE), "engine")


def find_ffmpeg():
    """숏츠 엔진(Remotion)에 들어 있는 ffmpeg → imageio_ffmpeg → PATH 순서로 찾는다. 엔진이 아직 안 깔렸으면 설치."""
    def engine_ff():
        hit = glob.glob(os.path.join(ENGINE, "node_modules", "@remotion", "compositor-*", "ffmpeg*"))
        return next((h for h in hit if os.path.basename(h).lower() in ("ffmpeg", "ffmpeg.exe")), None)
    ff = engine_ff()
    if ff:
        return ff
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    if shutil.which("ffmpeg"):
        return shutil.which("ffmpeg")
    if os.path.isdir(ENGINE) and not os.path.isdir(os.path.join(ENGINE, "node_modules")):
        subprocess.run(["npm.cmd" if os.name == "nt" else "npm", "install", "--no-audit", "--no-fund"], cwd=ENGINE, check=False)
        ff = engine_ff()
        if ff:
            return ff
    raise SystemExit("ffmpeg를 찾지 못했어요 (숏츠 엔진 설치가 필요해요)")


_cache = {}


def load(src, maxw=2600):
    """원본을 한 번만 열어 적당한 크기로 줄여 둔다 (프레임마다 큰 원본을 다시 자르지 않게)"""
    if src not in _cache:
        im = ImageOps.exif_transpose(Image.open(src)).convert("RGB")
        if im.width > maxw:
            im = im.resize((maxw, round(im.height * maxw / im.width)), Image.LANCZOS)
        _cache[src] = im
    return _cache[src]


def frame(src, w, h, cx=0.5, cy=0.5, zoom=1.0):
    """원본에서 w:h 비율로 (cx,cy) 중심, zoom 배 당긴 장면"""
    im = load(src)
    iw, ih = im.size
    a = w / h
    bw = min(iw, ih * a)
    bh = bw / a
    z = max(1.0, float(zoom))
    bw, bh = bw / z, bh / z
    x0 = min(max(cx * iw - bw / 2, 0), iw - bw)
    y0 = min(max(cy * ih - bh / 2, 0), ih - bh)
    return im.resize((w, h), Image.BILINEAR, box=(x0, y0, x0 + bw, y0 + bh))


def ease(t):
    t = min(max(t, 0.0), 1.0)
    return t * t * (3 - 2 * t)


def gif_fade(shots, w=720, h=480, fps=12, hold=0.9, fade=0.4):
    """사진 여러 장을 천천히 넘기며 반복 (컬러·각도 보여 주기)"""
    pics = [frame(s["file"], w, h, s.get("cx", 0.5), s.get("cy", 0.5), s.get("zoom", 1.0)) for s in shots]
    out = []
    for i, a in enumerate(pics):
        b = pics[(i + 1) % len(pics)]
        out += [a] * round(hold * fps)
        n = max(2, round(fade * fps))
        out += [Image.blend(a, b, ease((k + 1) / (n + 1))) for k in range(n)]
    return out, fps


def gif_zoom(shot, to=1.7, w=720, h=480, fps=12, move=2.2, hold=0.9):
    """한 장에서 디테일(cx,cy)로 천천히 당겼다가 잠깐 멈춤 → 처음으로 (반복)"""
    cx, cy = shot.get("cx", 0.5), shot.get("cy", 0.5)
    z0 = max(1.0, float(shot.get("zoom", 1.0)))
    out = []
    n = round(move * fps)
    for k in range(n):
        t = ease(k / (n - 1))
        z = z0 + (to - z0) * t
        # 처음엔 전체(중심 0.5), 당길수록 디테일 쪽으로
        out.append(frame(shot["file"], w, h, 0.5 + (cx - 0.5) * t, 0.5 + (cy - 0.5) * t, z))
    out += [out[-1]] * round(hold * fps)
    out += [Image.blend(out[-1], out[0], ease((k + 1) / 5)) for k in range(4)]
    return out, fps


def save_gif(frames, fps, path):
    # 모든 프레임이 같은 팔레트를 쓰게 (깜빡임 줄이고 용량도 작게)
    pal = frames[len(frames) // 2].convert("P", palette=Image.ADAPTIVE, colors=128)
    ps = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    ps[0].save(path, save_all=True, append_images=ps[1:], duration=round(1000 / fps), loop=0, optimize=True, disposal=1)


def font(size, bold=False):
    for f in (["malgunbd.ttf", "malgun.ttf"] if bold else ["malgun.ttf"]):
        p = os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", f)
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def video(spec, path, w=1920, h=1080, fps=30, secs=10.0, fade=0.6):
    """16:9 10초: 사진 3~5장을 천천히 움직이며 넘기고, 마지막 장면에 제품명·브랜드"""
    shots = spec["shots"][:5]
    n = len(shots)
    total = round(secs * fps)
    step = total / n                                          # 장면이 바뀌는 간격
    F = round(fade * fps)                                     # 겹쳐 넘어가는 프레임 수 (각 장면 끝부분)
    seg = step + F                                            # 장면 하나가 화면에 있는 길이(겹침 포함)
    title, brand = str(spec.get("title") or ""), str(spec.get("brand") or "")
    ft, fb = font(64, True), font(32)
    # 숏츠 엔진의 ffmpeg는 날 프레임(rawvideo)을 못 받아서 장면을 jpg로 써 두고 이어 붙인다
    tmp = path + "_frames"
    shutil.rmtree(tmp, ignore_errors=True)
    os.makedirs(tmp)
    stills = []
    for f in range(total):
        def shot_at(i, pos):                                    # pos = 그 장면이 나타난 뒤 지난 프레임
            s = shots[i]
            t = min(max(pos / seg, 0.0), 1.0)
            z0, z1 = (1.0, 1.12) if i % 2 == 0 else (1.12, 1.0)   # 번갈아 당기고 물러나기
            z = max(1.0, float(s.get("zoom", 1.0))) * (z0 + (z1 - z0) * t)
            return frame(s["file"], w, h, s.get("cx", 0.5), s.get("cy", 0.5), z)
        i = min(int(f // step), n - 1)
        local = f - i * step
        im = shot_at(i, local + (F if i else 0))
        if i + 1 < n and local > step - F:                     # 끝부분에서 다음 장면이 겹쳐 들어온다
            k = local - (step - F)
            im = Image.blend(im, shot_at(i + 1, k), ease(k / F))
        last_start = total - round(2.8 * fps)
        if title and f >= last_start:                           # 끝 2.8초: 아래에 제품명·브랜드
            a = ease((f - last_start) / (0.6 * fps))
            ov = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            d = ImageDraw.Draw(ov)
            for y in range(h - 300, h):
                d.line([(0, y), (w, y)], fill=(0, 0, 0, int(150 * a * (y - (h - 300)) / 300)))
            d.text((96, h - 190), title, font=ft, fill=(255, 255, 255, int(255 * a)))
            if brand:
                d.text((98, h - 105), brand, font=fb, fill=(255, 255, 255, int(210 * a)))
            im = Image.alpha_composite(im.convert("RGBA"), ov).convert("RGB")
        if f in (0, total // 3, 2 * total // 3, total - 1):
            stills.append(im.resize((480, 270)))
        im.save(os.path.join(tmp, f"{f:04d}.jpg"), quality=94)
    r = subprocess.run([find_ffmpeg(), "-y", "-v", "error", "-framerate", str(fps), "-i", os.path.join(tmp, "%04d.jpg"),
                        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path],
                       capture_output=True, text=True)
    shutil.rmtree(tmp, ignore_errors=True)
    if r.returncode != 0:
        raise SystemExit("영상을 만들지 못했어요 (ffmpeg 오류): " + (r.stderr or "")[-300:])
    return stills


def motion():
    spec = json.load(open(sys.argv[2], encoding="utf-8"))
    out = os.path.abspath(sys.argv[3])
    os.makedirs(out, exist_ok=True)
    res = {"ok": True, "gifs": [], "video": None}
    sheet_parts = []
    for i, g in enumerate(spec.get("gifs", [])[:2], 1):
        frames, fps = gif_zoom(g["shots"][0], g.get("to", 1.7)) if g.get("kind") == "zoom" else gif_fade(g["shots"])
        name = f"움직임_{i}.gif"
        save_gif(frames, fps, os.path.join(out, name))
        mb = os.path.getsize(os.path.join(out, name)) / 1e6
        if mb > 9:                                              # 블로그에 올리기 버거우면 작게 다시
            frames = [f.resize((540, 360)) for f in frames]
            save_gif(frames, fps, os.path.join(out, name))
            mb = os.path.getsize(os.path.join(out, name)) / 1e6
        res["gifs"].append({"file": name, "mb": round(mb, 2), "secs": round(len(frames) / fps, 1)})
        sheet_parts += [frames[0].resize((480, 320)), frames[len(frames) // 2].resize((480, 320))]
    if spec.get("video"):
        name = "영상_16x9.mp4"
        stills = video(spec["video"], os.path.join(out, name))
        res["video"] = {"file": name, "mb": round(os.path.getsize(os.path.join(out, name)) / 1e6, 2), "secs": 10}
        sheet_parts += stills
    # 검수용 모아보기 (GIF 처음·중간, 영상 0·3·6·10초)
    if sheet_parts:
        cols = 4
        rows = (len(sheet_parts) + cols - 1) // cols
        sh = Image.new("RGB", (cols * 490, rows * 330), "white")
        for k, im in enumerate(sheet_parts):
            sh.paste(im, ((k % cols) * 490, (k // cols) * 330))
        sh.save(os.path.join(out, "_움직임_검수.jpg"), quality=80)
        res["sheet"] = os.path.join(out, "_움직임_검수.jpg")
    # 사진 zip이 있으면 GIF·영상도 함께 넣는다
    z = out + ".zip"
    if os.path.exists(z):
        with zipfile.ZipFile(z, "a", zipfile.ZIP_DEFLATED) as zf:
            have = set(zf.namelist())
            for x in [g["file"] for g in res["gifs"]] + ([res["video"]["file"]] if res["video"] else []):
                if x not in have:
                    zf.write(os.path.join(out, x), x)
    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1:2] == ["crop"]:
        main()
    elif sys.argv[1:2] == ["motion"]:
        motion()
    else:
        sys.exit("사용: blog_images.py crop <crops.json> <출력폴더> | motion <motion.json> <출력폴더>")
