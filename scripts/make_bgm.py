"""리빙 숏츠용 BGM + 효과음 합성 (저작권 없는 자체 생성 음원).

120BPM이면 1박 = 15프레임(30fps). 장면 길이를 15의 배수로 잡으면 전환이 박자에 맞는다.

사용:
  python make_bgm.py --out public/bgm.wav --duration 15.5 --cuts 2.5,5,7.5,9.5,11.5 --end 11.5 --style jazz
    --style : jazz(기본, 로즈 피아노·묵직한 베이스·스윙 라이드의 재즈 하우스) | pop(가벼운 플럭 하우스)
    --cuts  : 장면 전환 시각(초). 각 전환 직전에 휙(whoosh) 효과음
    --end   : 엔딩 카드 시작 시각(초). 직전 1박 드럼 필, 시작에 임팩트 + 마무리 코드
"""
import argparse
import os
import wave
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--duration", type=float, default=15.0)
ap.add_argument("--bpm", type=float, default=120)
ap.add_argument("--cuts", default="")
ap.add_argument("--end", type=float, default=None)
ap.add_argument("--style", choices=["jazz", "pop"], default="jazz")
ap.add_argument("--seed", type=int, default=7)
args = ap.parse_args()

SR = 44100
BEAT = 60 / args.bpm
BAR = BEAT * 4
SWING = 0.62  # 스윙 8분음: 뒷박을 박 길이의 62% 지점에
DUR = args.duration + 0.5
N = int(SR * DUR)
rng = np.random.default_rng(args.seed)
cuts = [float(x) for x in args.cuts.split(",") if x.strip()]
end = args.end

# 트랙: 드럼·베이스(펌핑 받음) / 건반(트레몰로) / 효과음(그대로)
TRK = {k: np.zeros((N, 2)) for k in ("main", "keys", "fx")}


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def add(sig, t0, pan=0.0, gain=1.0, trk="main"):
    i = int(round(t0 * SR))
    if i >= N or i + len(sig) <= 0:
        return
    if i < 0:
        sig, i = sig[-i:], 0
    sig = sig[: N - i] * gain
    TRK[trk][i : i + len(sig), 0] += sig * np.sqrt(1 - pan)
    TRK[trk][i : i + len(sig), 1] += sig * np.sqrt(1 + pan)


def env(n, a=0.005, d=0.2, s=0.0, rel=0.05):
    t = np.arange(n) / SR
    e = np.where(t < a, t / a, s + (1 - s) * np.exp(-(t - a) / d))
    tail = int(rel * SR)
    if tail and n > tail:
        e[-tail:] *= np.linspace(1, 0, tail)
    return e


def hp(x, k=1.0):
    return x - np.concatenate([[0], x[:-1]]) * k


def smooth(x, a):
    # 1차 저역통과, 블록 단위로 계수를 바꿀 수 있게 a는 스칼라
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += a * (v - acc)
        y[i] = acc
    return y


# ---------- 드럼 ----------
def kick(g=0.9, deep=False):
    n = int((0.5 if deep else 0.35) * SR)
    t = np.arange(n) / SR
    f = (42 if deep else 50) + (80 if deep else 90) * np.exp(-t * (24 if deep else 30))
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * (6 if deep else 9))
    click = hp(rng.standard_normal(n)) * np.exp(-t * 400) * 0.15
    return np.tanh((body + click) * 1.4) * g


def clap():
    n = int(0.25 * SR)
    t = np.arange(n) / SR
    noise = hp(rng.standard_normal(n), 0.6)
    e = np.exp(-t * 18) + 0.5 * np.exp(-((t - 0.012) ** 2) / 1e-5)
    return noise * e * 0.22


def snare(g=0.18):
    n = int(0.18 * SR)
    t = np.arange(n) / SR
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    noise = hp(rng.standard_normal(n), 0.8) * np.exp(-t * 22)
    return (body * 0.6 + noise) * g


def brush(g=0.12):
    # 브러시 스네어: 어두운 노이즈 스윕
    n = int(0.22 * SR)
    t = np.arange(n) / SR
    noise = smooth(rng.standard_normal(n), 0.35)
    return hp(noise, 0.7) * (np.exp(-t * 14) + 0.3 * np.exp(-t * 4)) * g


def rim(g=0.10):
    n = int(0.06 * SR)
    t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1700 * t) + 0.6 * np.sin(2 * np.pi * 820 * t)) * np.exp(-t * 90) * g


def hat(open_=False):
    n = int((0.18 if open_ else 0.05) * SR)
    t = np.arange(n) / SR
    return hp(rng.standard_normal(n)) * np.exp(-t * (14 if open_ else 70)) * 0.09


def ride(g=0.06):
    # 금속성 비배음 + 노이즈로 라이드 심벌 느낌
    n = int(0.5 * SR)
    t = np.arange(n) / SR
    ratios = [1.0, 1.47, 1.92, 2.61, 3.18]
    s = sum(np.sin(2 * np.pi * 3100 * r * t + k) for k, r in enumerate(ratios)) / len(ratios)
    s = s * np.exp(-t * 7) + hp(rng.standard_normal(n)) * np.exp(-t * 30) * 0.5
    return s * g


# ---------- 화성 악기 ----------
def rhodes(midis, length, vel=1.0):
    # FM 방식 일렉트릭 피아노: 어택에서 금속성 배음이 빠르게 사라짐
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in midis:
        f = hz(m)
        idx = 2.2 * np.exp(-t * 5) + 0.25
        mod = np.sin(2 * np.pi * f * t)
        tone = np.sin(2 * np.pi * f * t + idx * mod) + 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 3)
        s += tone
    rel = np.minimum(1, (length - t) / 0.08)
    return s * np.exp(-t * 1.3) * rel * 0.065 * vel


def upright(midi, length, g=0.36):
    # 묵직한 베이스: 기음 + 약한 배음, 살짝 포화
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.45 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 6) + 0.15 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 10)
    e = env(n, a=0.006, d=0.35, s=0.5, rel=0.04)
    return np.tanh(s * e * 1.6) * g


def pluck(midi, length=0.35):
    n = int(length * SR)
    t = np.arange(n) / SR
    f = hz(midi)
    s = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sin(2 * np.pi * 3 * f * t)
    return s * env(n, a=0.003, d=0.12) * 0.15


def pad(midis, length, g=0.02):
    n = int(length * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for m in midis:
        for det in (-0.12, 0.12):
            f = hz(m + det)
            s += np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    return s * np.minimum(1, t / 0.25) * np.minimum(1, (length - t) / 0.3) * g


# ---------- 효과음 ----------
def whoosh(length=0.32):
    n = int(length * SR)
    t = np.linspace(0, 1, n)
    noise = rng.standard_normal(n)
    out = np.zeros(n)
    acc = 0.0
    for s0 in range(0, n, 512):
        a = 0.02 + 0.5 * (s0 / n) ** 2
        for i in range(s0, min(n, s0 + 512)):
            acc += a * (noise[i] - acc)
            out[i] = acc
    return hp(out, 0.5) * (t**1.6) * 0.9


def impact():
    n = int(0.7 * SR)
    t = np.arange(n) / SR
    return np.sin(2 * np.pi * np.cumsum(38 + 60 * np.exp(-t * 12)) / SR) * np.exp(-t * 4.5) * 0.55


def chime(midis=(84, 88, 91, 96)):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    s = np.zeros(n)
    for k, m in enumerate(midis):
        d = int(k * 0.06 * SR)
        f = hz(m)
        tone = (np.sin(2 * np.pi * f * t) + 0.4 * np.sin(2 * np.pi * 2.76 * f * t) * np.exp(-t * 6)) * np.exp(-t * 2.2)
        s[d:] += tone[: n - d]
    return s * 0.09


def crackle(n, density=6.0, g=0.012):
    # 아주 옅은 LP 잡음으로 재즈 질감
    out = np.zeros(n)
    k = rng.poisson(density * n / SR)
    pos = rng.integers(0, n - 200, k)
    for p in pos:
        out[p : p + 40] += rng.standard_normal(40) * np.exp(-np.arange(40) / 6) * rng.uniform(0.3, 1)
    return smooth(rng.standard_normal(n), 0.05) * 0.15 * g + out * g


bars = int(np.ceil(args.duration / BAR))
sw = lambda tb: tb + BEAT * SWING  # 스윙 뒷박 위치

if args.style == "jazz":
    # Eb장조 ii-V-I-vi : Fm9 - Bb13 - Ebmaj9 - Cm9 (베이스는 낮게, 건반은 중음역 텐션 보이싱)
    CH = [
        (29, [56, 60, 63, 67]),  # Fm9  : Ab C Eb G
        (34, [56, 60, 62, 67]),  # Bb13 : Ab C D G
        (39, [55, 58, 62, 65]),  # Ebmaj9: G Bb D F
        (36, [55, 58, 62, 63]),  # Cm9  : G Bb D Eb
    ]
    for bar in range(bars):
        t0 = bar * BAR
        root, v = CH[bar % 4]
        nxt = CH[(bar + 1) % 4][0]
        add(pad(v, BAR + 0.2, g=0.012), t0, trk="keys")
        # 건반 컴핑: 1박, 2박 뒷박(스윙), 4박 뒷박 앞당김
        add(rhodes(v, BEAT * 1.4, 1.0), t0, trk="keys")
        add(rhodes(v, BEAT * 0.9, 0.7), sw(t0 + BEAT), trk="keys")
        add(rhodes([x + 12 for x in v[1:3]], BEAT * 0.5, 0.5), sw(t0 + 3 * BEAT), trk="keys")
        # 워킹 베이스: 근음 - 5도 - 옥타브 - 다음 근음 반음 접근
        walk = [root, root + 7, root + 12, nxt + (1 if nxt < root + 6 else -1)]
        for b, m in enumerate(walk):
            add(upright(m, BEAT * 0.92), t0 + b * BEAT)
        for b in range(4):
            tb = t0 + b * BEAT
            add(kick(0.95, deep=True), tb)
            if b in (1, 3):
                add(brush(0.14), tb, pan=0.1)
                add(rim(0.07), tb, pan=-0.15)
            # 라이드: 매 박 + 2·4박 스윙 뒷박
            add(ride(0.08), tb, pan=0.35)
            if b in (1, 3):
                add(ride(0.055), sw(tb), pan=0.35)
            add(hat(), sw(tb), pan=-0.3, gain=0.5)
    end_chord = [x + 12 for x in CH[2][1]]  # Ebmaj9 높은 보이싱
else:
    CH = [(41, [65, 69, 72, 76]), (45, [64, 67, 69, 72]), (38, [62, 65, 69, 72]), (46, [62, 65, 69, 70])]
    ARP = [0, 2, 1, 3, 2, 1, 3, 2]
    for bar in range(bars):
        t0 = bar * BAR
        root, notes = CH[bar % 4]
        add(pad(notes, BAR + 0.2), t0, trk="keys")
        for b in range(4):
            tb = t0 + b * BEAT
            add(kick(), tb)
            if b in (1, 3):
                add(clap(), tb)
            add(hat(open_=True), tb + BEAT / 2, pan=0.3)
            add(hat(), tb + BEAT / 4, pan=-0.3, gain=0.6)
            add(hat(), tb + 3 * BEAT / 4, pan=-0.3, gain=0.6)
            add(upright(root + 12, BEAT * 0.45, g=0.28), tb)
        for k in range(8):
            add(pluck(notes[ARP[k]]), t0 + k * BEAT / 2, pan=(-0.4 if k % 2 else 0.4), trk="keys")
    end_chord = None

if end:
    for k in range(4):
        add(snare(0.08 + 0.035 * k), end - BEAT + k * BEAT / 4, trk="fx")
    add(impact(), end, trk="fx")
    if end_chord:
        add(rhodes(end_chord, 2.5, 1.6), end, trk="fx")
    else:
        add(chime(), end, trk="fx")
    add(hat(open_=True) * 2.5, end)

for c in cuts:
    if end and abs(c - end) < 1e-3:
        continue
    w = whoosh()
    add(w, c - len(w) / SR, pan=-0.2, gain=0.5, trk="fx")
    add(w, c - len(w) / SR, pan=0.2, gain=0.5, trk="fx")

t = np.arange(N) / SR
main = TRK["main"]
keys = TRK["keys"]
# 건반: 좌우 트레몰로 + 스테레오 딜레이
trem = 0.22 * np.sin(2 * np.pi * 4.0 * t)
keys[:, 0] *= 1 + trem
keys[:, 1] *= 1 - trem
d = int(BEAT * 0.75 * SR)
for _ in range(2):
    keys[d:, 0] += keys[:-d, 1] * 0.14
    keys[d:, 1] += keys[:-d, 0] * 0.14
pump = (1 - (0.15 if args.style == "jazz" else 0.22) * np.exp(-(t % BEAT) * 10))[:, None]
mix = main * pump + keys * pump + TRK["fx"]
if args.style == "jazz":
    cr = crackle(N)
    mix += np.stack([cr, np.roll(cr, 300)], axis=1)

fade = np.ones(N)
fi = int(0.03 * SR)
fade[:fi] = np.linspace(0, 1, fi)
fo1 = int(args.duration * SR)
fo0 = fo1 - int(1.2 * SR)
fade[fo0:fo1] = np.linspace(1, 0, fo1 - fo0)
fade[fo1:] = 0
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) + 1e-9
mix = np.tanh(mix * 1.6) / np.tanh(1.6)
mix *= 0.89

os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
with wave.open(args.out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype(np.int16).tobytes())
print("saved", os.path.abspath(args.out))
