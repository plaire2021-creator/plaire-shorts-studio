"""스마트스토어(브랜드스토어) 상품 링크 → 상품명·상세페이지 이미지 내려받기.

  python smartstore_fetch.py <상품 링크> <저장 폴더>   → 마지막 줄에 JSON

네이버는 일반 요청(curl·헤드리스)을 막아서(429·시스템오류) 이 PC의 실제 크롬을 화면 밖 창으로 띄우고
개발자 도구(CDP)로 페이지를 연 뒤 window.__PRELOADED_STATE__ 에서 상품 정보를 읽는다.
상세페이지 이미지는 <저장 폴더>/001.jpg … (위→아래 순서), 대표·추가 이미지는 <저장 폴더>/_대표/ 에 받는다.
결과 JSON: {"name", "brand_store", "detail_images": [...], "main_images": [...], "price", "options": [...]}
"""
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

import websocket

CHROME = [
    os.path.join(os.environ.get("PROGRAMFILES", r"C:\Program Files"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Google", "Chrome", "Application", "chrome.exe"),
    os.path.join(os.environ.get("LOCALAPPDATA", ""), "Google", "Chrome", "Application", "chrome.exe"),
]
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"


def fail(msg):
    print(json.dumps({"error": msg}, ensure_ascii=False))
    sys.exit(0)


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def check_url(u):
    u = u.strip()
    m = re.search(r"https?://(?:m\.)?(smartstore|brand)\.naver\.com/[^/\s]+/products/(\d+)", u)
    if not m:
        fail("스마트스토어 상품 링크가 아니에요 (smartstore.naver.com/…/products/번호 또는 brand.naver.com/…/products/번호)")
    return m.group(0).replace("://m.", "://")


class Tab:
    def __init__(self, port):
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{port}/json", timeout=2))
                page = next(t for t in tabs if t.get("type") == "page")
                break
            except Exception:
                time.sleep(0.3)
        else:
            fail("크롬을 열지 못했어요")
        self.ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30, suppress_origin=True)
        self.n = 0

    def call(self, method, **params):
        self.n += 1
        self.ws.send(json.dumps({"id": self.n, "method": method, "params": params}))
        while True:
            r = json.loads(self.ws.recv())
            if r.get("id") == self.n:
                return r.get("result", {})

    def js(self, expr):
        r = self.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
        if r.get("exceptionDetails") and os.environ.get("SS_DEBUG"):
            print("JS 오류:", json.dumps(r["exceptionDetails"], ensure_ascii=False)[:400], file=sys.stderr)
        return r.get("result", {}).get("value")


READ = r"""
(() => {
  const S = window.__PRELOADED_STATE__;
  if (!S) return null;
  const P = (S.product && S.product.name ? S.product : (S.product || {}).A) || {};  // 스토어마다 product 바로 아래 또는 product.A
  const Q = ((S.simpleProductForDetailPage || {}).A) || {};
  // 상품명: 상태 값이 비어 있는 스토어가 있어서 페이지 제목(og:title "상품명 : 스토어명")도 본다
  const og = (document.querySelector('meta[property="og:title"]') || {}).content || document.title || "";
  const parts = og.split(" : ");
  const name = P.name || Q.name || (parts.length > 1 ? parts.slice(0, -1).join(" : ") : og).trim();
  const storeName = (P.channel || {}).channelName || (parts.length > 1 ? parts[parts.length - 1].trim() : "");
  const ogImg = (document.querySelector('meta[property="og:image"]') || {}).content;
  const main = (P.productImages || Q.productImages || []).map(x => x.url).filter(Boolean);
  if (!main.length && ogImg) main.push(ogImg);
  // 상세페이지는 스마트에디터 화면으로 늦게 그려진다 → 화면에 그려진 이미지(지연 로딩이면 data-src)를 위→아래로
  const detail = [...document.querySelectorAll(".se-main-container img, .se-component img, .detail_content img")]
    .map(i => i.getAttribute("data-src") || i.getAttribute("src") || "").filter(u => /pstatic\.net/.test(u));
  const opts = (P.optionCombinations || Q.optionCombinations || []).map(o => [o.optionName1, o.optionName2, o.optionName3].filter(Boolean).join(" / ")).slice(0, 40);
  return { name, price: (P.benefitsView || {}).discountedSalePrice || P.discountedSalePrice || P.salePrice || null,
           store: storeName, detail: [...new Set(detail)], main, options: opts };
})()
"""


def download(urls, folder, prefix=""):
    os.makedirs(folder, exist_ok=True)
    out = []
    for i, u in enumerate(urls, 1):
        u = re.sub(r"\?type=[^&]*", "", u)               # 원본 크기로
        ext = os.path.splitext(u.split("?")[0])[1].lower()
        ext = ext if ext in (".jpg", ".jpeg", ".png", ".gif", ".webp") else ".jpg"
        p = os.path.join(folder, f"{prefix}{i:03d}{ext}")
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Referer": "https://smartstore.naver.com/"})
            with urllib.request.urlopen(req, timeout=30) as r, open(p, "wb") as f:
                shutil.copyfileobj(r, f)
            out.append(p)
        except Exception:
            pass
    return out


def main():
    url = check_url(sys.argv[1])
    folder = os.path.abspath(sys.argv[2])
    exe = next((c for c in CHROME if os.path.exists(c)), None)
    if not exe:
        fail("이 PC에 크롬이 없어서 스마트스토어 링크를 읽지 못해요. 상세페이지 이미지를 직접 넣어 주세요")
    port = free_port()
    prof = tempfile.mkdtemp(prefix="plaire_ss_")
    # 헤드리스는 네이버가 막아서 일반 창을 화면 밖에 띄운다
    proc = subprocess.Popen([exe, f"--remote-debugging-port={port}", f"--user-data-dir={prof}", "--no-first-run", "--no-default-browser-check",
                             "--window-position=-32000,-32000", "--window-size=1280,900", "--disable-extensions", "about:blank"],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        t = Tab(port)
        t.call("Page.enable")
        t.call("Page.navigate", url=url)
        info, last = None, -1
        time.sleep(2)
        for k in range(40):                                  # 아래로 내리며 상세페이지 이미지가 다 그려질 때까지 (최대 약 30초)
            t.js(f"window.scrollTo(0, document.body.scrollHeight * {min(1.0, (k + 1) / 12):.2f})")
            time.sleep(0.7)
            info = t.js(READ)
            n = len((info or {}).get("detail") or [])
            if info and info.get("name") and n and n == last and k >= 12:
                break
            last = n
        if not info or not info.get("name"):
            body = t.js("document.body ? document.body.innerText.slice(0, 200) : ''") or ""
            if "접속이 불가" in body or "시스템오류" in body or "잠시 후" in body:
                fail("네이버가 잠시 접속을 막았어요. 몇 분 뒤 다시 해 주세요")
            fail("상품 정보를 읽지 못했어요. 링크를 확인해 주세요")
        detail = download(info.get("detail") or [], folder)
        main_imgs = download(info.get("main") or [], os.path.join(folder, "_대표"), "m")
        if not detail and not main_imgs:
            fail("상세페이지 이미지를 받지 못했어요")
        print(json.dumps({"name": info["name"], "brand_store": info.get("store", ""), "price": info.get("price"), "options": info.get("options", []),
                          "detail_images": detail, "main_images": main_imgs, "url": url}, ensure_ascii=False))
    finally:
        try:
            t.call("Browser.close")
        except Exception:
            pass
        time.sleep(0.5)
        proc.kill()
        shutil.rmtree(prof, ignore_errors=True)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    if len(sys.argv) < 3:
        sys.exit("사용: smartstore_fetch.py <상품 링크> <저장 폴더>")
    main()
