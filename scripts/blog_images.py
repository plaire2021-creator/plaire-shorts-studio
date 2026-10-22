"""블로그용 사진 3:2 편집 + zip.

  python blog_images.py crop <crops.json> <출력폴더>

crops.json: [{"file": 원본경로, "cx": 0~1, "cy": 0~1, "zoom": 1.0이상}, ...]  (순서 = 본문 [사진 N] 순서)
결과: <출력폴더>/01.jpg … (1500×1000), <출력폴더>.zip, <출력폴더>/_검수.jpg(모아보기, zip에는 안 들어감)
마지막 줄에 결과 JSON.
"""
import json
import os
import sys
import zipfile

from PIL import Image, ImageDraw, ImageOps

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


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if sys.argv[1] != "crop":
        sys.exit("사용: blog_images.py crop <crops.json> <출력폴더>")
    main()
