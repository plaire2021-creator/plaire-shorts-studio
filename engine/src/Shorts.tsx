import React from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import { loadFont } from "@remotion/google-fonts/NotoSansKR";

const { fontFamily } = loadFont("normal", { weights: ["400", "500", "700", "900"] });

const INK = "#2a2926";
const SUBINK = "#6b665e";
const FADE = 8;
const DEFAULT_ACCENT = "#f2c94c";

// 유튜브 쇼츠: 위 ~150px(검색·메뉴), 아래 ~600px(제목·채널·설명), 오른쪽 ~150px(좋아요·댓글 버튼)이 가려짐.
// 자막은 위쪽 안전 영역(y 210~1320, x 64~930)에만 배치.
const SAFE = { top: 210, left: 64, width: 836 };

type Zoom = [number, number];
export type ColorItem = { src: string; name: string; hex: string };
// 자막 줄 안에서 **단어** 로 감싼 부분은 형광펜 강조
export type Scene =
  | { type: "flip"; frames: number; srcs: string[]; caption: string[]; sub?: string }
  // 가로로 긴 라인업 사진을 옆으로 훑는 장면. items[].x 는 사진 가로폭 대비 각 제품 중심 위치(0~1)
  | { type: "pan"; frames: number; src: string; aspect: number; height: number; top: number; bandTop: number; items: (ColorItem & { x: number })[]; caption: string[] }
  | { type: "photo"; src: string; frames: number; zoom?: Zoom; panY?: number; caption: string[]; sub?: string }
  | { type: "colors"; frames: number; caption: string[]; items: ColorItem[] }
  | { type: "end"; src: string; frames: number; zoom?: Zoom; title: string[]; spec?: string; chips?: string[]; cta?: string };

export type ShortsProps = {
  fps?: number;
  guides?: boolean;
  brand: string;
  accent?: string;
  bgm?: string;
  bgmVolume?: number;
  scenes: Scene[];
};

export const totalFrames = (p: ShortsProps) => Math.max(1, p.scenes.reduce((s, sc) => s + sc.frames, 0));

const AccentCtx = React.createContext(DEFAULT_ACCENT);

const Photo: React.FC<{ src: string; dur: number; zoom?: Zoom; panY?: number; fadeIn?: boolean }> = ({ src, dur, zoom = [1.0, 1.1], panY = 0, fadeIn = true }) => {
  const f = useCurrentFrame();
  const p = interpolate(f, [0, dur], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const scale = zoom[0] + (zoom[1] - zoom[0]) * p;
  const opacity = interpolate(f, [0, fadeIn ? FADE : 0.01, dur - 1, dur + FADE], [fadeIn ? 0 : 1, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <Img src={staticFile(src)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateY(${panY * p}px)` }} />
    </AbsoluteFill>
  );
};

// "**강조**" 문법을 조각으로 나눔
const parse = (line: string) => line.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((t) => (t.startsWith("**") ? { hl: true, t: t.slice(2, -2) } : { hl: false, t }));

const Line: React.FC<{ text: string; start: number; size: number; weight: number; color: string }> = ({ text, start, size, weight, color }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const accent = React.useContext(AccentCtx);
  const a = spring({ frame: f - start, fps, config: { damping: 18, stiffness: 180, mass: 0.6 } });
  const swipe = interpolate(f - start, [6, 16], [0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  return (
    <div style={{ overflow: "hidden", paddingBottom: 4 }}>
      <div style={{ fontFamily, fontWeight: weight, fontSize: size, lineHeight: 1.3, color, letterSpacing: size > 50 ? -2 : -1, whiteSpace: "nowrap", transform: `translateY(${(1 - a) * 100}%)`, opacity: Math.min(1, a * 1.5) }}>
        {parse(text).map((p, i) =>
          p.hl ? (
            <span key={i} style={{ backgroundImage: `linear-gradient(${accent}, ${accent})`, backgroundRepeat: "no-repeat", backgroundPosition: "0 88%", backgroundSize: `${swipe}% 42%`, padding: "0 4px", margin: "0 -4px" }}>{p.t}</span>
          ) : (
            <span key={i}>{p.t}</span>
          ),
        )}
      </div>
    </div>
  );
};

const Caption: React.FC<{ lines: string[]; sub?: string; dur: number; delay?: number; punch?: boolean }> = ({ lines, sub, dur, delay = 4, punch = false }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const box = punch ? 1 : spring({ frame: f - delay, fps, config: { damping: 200 } });
  const scale = punch ? interpolate(f, [0, 6], [1.12, 1], { extrapolateRight: "clamp", easing: Easing.out(Easing.back(2)) }) : 1;
  const exit = interpolate(f, [dur - 6, dur + 2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  // 후킹 자막은 0프레임부터 글자가 보여야 하므로 등장 애니메이션을 미리 진행시켜 둠
  const step = punch ? 2 : 5;
  if (punch) delay -= 8;
  return (
    <div style={{ position: "absolute", top: SAFE.top, left: SAFE.left, maxWidth: SAFE.width, opacity: box * exit, transform: `translateY(${(1 - box) * 30}px) scale(${scale})`, transformOrigin: "left top" }}>
      <div style={{ background: "rgba(255,255,255,0.88)", borderRadius: 28, padding: "34px 42px", boxShadow: "0 10px 40px rgba(0,0,0,0.10)" }}>
        {lines.map((l, i) => (
          <Line key={i} text={l} start={delay + i * step} size={punch ? 76 : 70} weight={800} color={INK} />
        ))}
        {sub && (
          <div style={{ marginTop: 14 }}>
            <Line text={sub} start={delay + lines.length * step + 2} size={38} weight={500} color={SUBINK} />
          </div>
        )}
      </div>
    </div>
  );
};

// 같은 구도에서 컬러만 박자에 맞춰 바뀌는 오프닝 후킹
const Flip: React.FC<{ scene: Extract<Scene, { type: "flip" }> }> = ({ scene }) => {
  const f = useCurrentFrame();
  const per = Math.floor(scene.frames / scene.srcs.length);
  const idx = Math.min(scene.srcs.length - 1, Math.floor(f / per));
  const local = f - idx * per;
  const kick = interpolate(local, [0, 5], [1.07, 1.0], { extrapolateRight: "clamp", easing: Easing.out(Easing.quad) });
  const flash = interpolate(local, [0, 3], [idx === 0 ? 0 : 0.35, 0], { extrapolateRight: "clamp" });
  const out = interpolate(f, [scene.frames - 1, scene.frames + FADE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Img src={staticFile(scene.srcs[idx])} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${kick})` }} />
      <AbsoluteFill style={{ background: "#fff", opacity: flash }} />
      <Caption lines={scene.caption} sub={scene.sub} dur={scene.frames} delay={0} punch />
    </AbsoluteFill>
  );
};

const Chips: React.FC<{ items: ColorItem[]; idx: number; top: number }> = ({ items, idx, top }) => {
  const small = items.length > 5;
  return (
    <div style={{ position: "absolute", top, left: SAFE.left, width: SAFE.width, display: "flex", flexWrap: "wrap", gap: small ? 10 : 14 }}>
      {items.map((c, i) => (
        <div key={c.name + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: small ? "10px 16px" : "12px 20px", borderRadius: 999, background: i === idx ? INK : "rgba(255,255,255,0.86)", color: i === idx ? "#fff" : INK, fontFamily, fontWeight: 700, fontSize: small ? 26 : 30, transform: `scale(${i === idx ? 1.06 : 1})` }}>
          <span style={{ width: 26, height: 26, borderRadius: 13, background: c.hex, border: "2px solid rgba(0,0,0,0.15)" }} />
          {c.name}
        </div>
      ))}
    </div>
  );
};

// 라인업 사진 위를 카메라가 옆으로 지나가는 트래킹 샷. 가운데 온 컬러의 칩이 켜짐
const Pan: React.FC<{ scene: Extract<Scene, { type: "pan" }> }> = ({ scene }) => {
  const f = useCurrentFrame();
  const w = scene.height * scene.aspect;
  const xs = scene.items.map((it) => it.x);
  const p = interpolate(f, [0, scene.frames - 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.inOut(Easing.sin) });
  const center = xs[0] + (xs[xs.length - 1] - xs[0]) * p;
  const idx = xs.reduce((best, x, i) => (Math.abs(x - center) < Math.abs(xs[best] - center) ? i : best), 0);
  const left = 540 - center * w;
  const out = interpolate(f, [scene.frames - 1, scene.frames + FADE], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out, background: "#efece6" }}>
      {/* 사진이 안 덮는 아래쪽은 흐린 사진으로 채움(쇼츠 UI에 가려지는 영역) */}
      <Img src={staticFile(scene.src)} style={{ position: "absolute", left: left, top: scene.top, width: w, height: scene.height, filter: "blur(40px)", transform: "scaleY(-1)", transformOrigin: `center ${scene.height}px` }} />
      <Img src={staticFile(scene.src)} style={{ position: "absolute", left, top: scene.top, width: w, height: scene.height }} />
      <Caption lines={scene.caption} dur={scene.frames} delay={0} punch />
      <Chips items={scene.items} idx={idx} top={scene.bandTop} />
    </AbsoluteFill>
  );
};

const ColorSection: React.FC<{ scene: Extract<Scene, { type: "colors" }> }> = ({ scene }) => {
  const f = useCurrentFrame();
  const per = Math.floor(scene.frames / scene.items.length);
  const idx = Math.min(scene.items.length - 1, Math.floor(f / per));
  // 컬러가 많으면 칩을 작게 해서 오른쪽 버튼 영역(x>930)을 넘지 않게
  const small = scene.items.length > 5;
  return (
    <AbsoluteFill>
      {scene.items.map((c, i) => (
        <Sequence key={c.src + i} from={i * per} durationInFrames={per + FADE}>
          <Photo src={c.src} dur={per} zoom={[1.04, 1.0]} />
        </Sequence>
      ))}
      <Caption lines={scene.caption} dur={scene.frames} delay={0} />
      <div style={{ position: "absolute", top: SAFE.top + 290, left: SAFE.left, width: SAFE.width, display: "flex", flexWrap: "wrap", gap: small ? 10 : 14 }}>
        {scene.items.map((c, i) => (
          <div key={c.name + i} style={{ display: "flex", alignItems: "center", gap: 10, padding: small ? "10px 16px" : "12px 20px", borderRadius: 999, background: i === idx ? INK : "rgba(255,255,255,0.86)", color: i === idx ? "#fff" : INK, fontFamily, fontWeight: 700, fontSize: small ? 26 : 30 }}>
            <span style={{ width: 26, height: 26, borderRadius: 13, background: c.hex, border: "2px solid rgba(0,0,0,0.15)" }} />
            {c.name}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

const EndCard: React.FC<{ scene: Extract<Scene, { type: "end" }>; brand: string }> = ({ scene, brand }) => {
  const f = useCurrentFrame();
  const { fps } = useVideoConfig();
  const a = spring({ frame: f - 4, fps, config: { damping: 200 } });
  const c = spring({ frame: f - 22, fps, config: { damping: 12, stiffness: 160 } });
  const pulse = 1 + 0.03 * Math.sin(Math.max(0, f - 40) / 6);
  return (
    <AbsoluteFill>
      <Photo src={scene.src} dur={scene.frames} zoom={scene.zoom ?? [1.12, 1.0]} />
      <div style={{ position: "absolute", top: SAFE.top, left: SAFE.left, maxWidth: SAFE.width, opacity: a, transform: `translateY(${(1 - a) * 30}px)` }}>
        <div style={{ background: "rgba(255,255,255,0.92)", borderRadius: 28, padding: "38px 44px" }}>
          <div style={{ fontFamily, fontWeight: 500, fontSize: 34, color: "#8a8378", letterSpacing: 4 }}>{brand}</div>
          <div style={{ marginTop: 10 }}>
            {scene.title.map((t, i) => (
              <Line key={i} text={t} start={6 + i * 5} size={64} weight={800} color={INK} />
            ))}
          </div>
          {scene.spec && <div style={{ fontFamily, fontWeight: 500, fontSize: 34, color: SUBINK, marginTop: 18 }}>{scene.spec}</div>}
          {scene.chips && scene.chips.length > 0 && (
            <div style={{ display: "flex", gap: 12, marginTop: 22 }}>
              {scene.chips.map((hex, i) => {
                const s = spring({ frame: f - 14 - i * 2, fps, config: { damping: 10, stiffness: 200 } });
                return <span key={hex + i} style={{ width: 40, height: 40, borderRadius: 20, background: hex, border: "2px solid rgba(0,0,0,0.15)", transform: `scale(${s})` }} />;
              })}
            </div>
          )}
        </div>
        {scene.cta && (
          <div style={{ marginTop: 26, display: "inline-flex", alignItems: "center", gap: 18, background: INK, color: "#fff", borderRadius: 999, padding: "24px 40px", fontFamily, fontWeight: 700, fontSize: 40, letterSpacing: -1, opacity: Math.min(1, c), transform: `scale(${c * pulse})`, transformOrigin: "left center", boxShadow: "0 12px 30px rgba(0,0,0,0.25)" }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
              <circle cx="10.5" cy="10.5" r="6.5" />
              <path d="M15.5 15.5 21 21" />
            </svg>
            <span>
              {parse(scene.cta).map((p, i) => (
                <span key={i} style={p.hl ? { color: DEFAULT_ACCENT } : undefined}>{p.t}</span>
              ))}
            </span>
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};

const Guides: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 150, background: "rgba(255,0,0,0.25)" }} />
    <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 600, background: "rgba(255,0,0,0.25)" }} />
    <div style={{ position: "absolute", top: 150, bottom: 600, right: 0, width: 150, background: "rgba(255,0,0,0.25)" }} />
  </AbsoluteFill>
);

export const Shorts: React.FC<ShortsProps> = (props) => {
  let at = 0;
  const last = props.scenes.length - 1;
  return (
    <AccentCtx.Provider value={props.accent ?? DEFAULT_ACCENT}>
      <AbsoluteFill style={{ background: "#f3f1ec" }}>
        {props.bgm && <Audio src={staticFile(props.bgm)} volume={props.bgmVolume ?? 0.8} />}
        {props.scenes.map((sc, i) => {
          const from = at;
          at += sc.frames;
          const dur = i === last ? sc.frames : sc.frames + FADE;
          return (
            <Sequence key={i} from={from} durationInFrames={dur}>
              {sc.type === "flip" && <Flip scene={sc} />}
              {sc.type === "pan" && <Pan scene={sc} />}
              {sc.type === "photo" && (
                <>
                  <Photo src={sc.src} dur={sc.frames} zoom={sc.zoom} panY={sc.panY} fadeIn={i !== 0} />
                  <Caption lines={sc.caption} sub={sc.sub} dur={sc.frames} delay={i === 0 ? 0 : 4} punch={i === 0} />
                </>
              )}
              {sc.type === "colors" && <ColorSection scene={sc} />}
              {sc.type === "end" && <EndCard scene={sc} brand={props.brand} />}
            </Sequence>
          );
        })}
        {props.guides && <Guides />}
      </AbsoluteFill>
    </AccentCtx.Provider>
  );
};
