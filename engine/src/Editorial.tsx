import React from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, Easing } from "remotion";
import { loadFont as loadBatang } from "@remotion/google-fonts/GowunBatang";
import { loadFont as loadCormorant } from "@remotion/google-fonts/CormorantGaramond";
import { loadFont as loadJost } from "@remotion/google-fonts/Jost";

// '에디토리얼' 스타일 숏츠: 잔잔한 카메라 무빙 장면(AI 영상 또는 사진) + 왼쪽 위 명조 카피 + 작은 영문 머리말 + 부드러운 겹침 전환.
// 마지막 장면은 제품명 + 컬러 칩 + "N COLORS". (기존 Shorts.tsx 의 형광펜·라인업 스타일과 별개)
const { fontFamily: serif } = loadBatang("normal", { weights: ["400", "700"] });
const { fontFamily: italic } = loadCormorant("italic", { weights: ["500"] });
const { fontFamily: sans } = loadJost("normal", { weights: ["500"] });

const INK = "#2b2a28";
const SUB = "#77716a";
const XF = 12; // 장면 겹침(프레임)
const LEFT = 96;
const TOP = 300; // 유튜브 위쪽 가림(~150px) 아래

export type EdScene = {
  type: "clip" | "photo";
  src: string;
  frames: number;
  eyebrow?: string; // 작은 영문 머리말 (예: Home Bar Collection)
  title: string[]; // 명조 카피 1~2줄
  sub?: string; // 작은 설명 한 줄
  end?: { chips: string[]; label?: string }; // 마지막 장면: 컬러 칩 + "5 COLORS"
  zoom?: [number, number];
  trim?: number; // 영상 앞부분 건너뛸 프레임
};
export type EditorialProps = { fps?: number; scenes: EdScene[]; bgm?: string; bgmVolume?: number };

export const totalFramesEd = (p: EditorialProps) => Math.max(1, p.scenes.reduce((s, sc) => s + sc.frames, 0) - Math.max(0, p.scenes.length - 1) * XF);

const Media: React.FC<{ sc: EdScene; first: boolean }> = ({ sc, first }) => {
  const f = useCurrentFrame();
  const [z0, z1] = sc.zoom ?? (sc.type === "clip" ? [1.0, 1.03] : [1.0, 1.08]);
  const p = interpolate(f, [0, sc.frames], [0, 1], { extrapolateRight: "clamp" });
  const opacity = first ? 1 : interpolate(f, [0, XF], [0, 1], { extrapolateRight: "clamp", easing: Easing.inOut(Easing.quad) });
  const style: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z0 + (z1 - z0) * p})` };
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#f4f3f0" }}>
      {sc.type === "clip" ? <OffthreadVideo src={staticFile(sc.src)} muted startFrom={sc.trim ?? 0} style={style} /> : <Img src={staticFile(sc.src)} style={style} />}
      {/* 글자가 잘 읽히도록 위쪽만 아주 옅게 밝힘 */}
      <AbsoluteFill style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.32) 0%, rgba(255,255,255,0.12) 34%, rgba(255,255,255,0) 52%)" }} />
    </AbsoluteFill>
  );
};

// 한 요소가 살짝 흐렸다가 또렷하게 떠오르는 등장
const Rise: React.FC<{ at: number; out: number; children: React.ReactNode; y?: number }> = ({ at, out, children, y = 14 }) => {
  const f = useCurrentFrame();
  const a = interpolate(f, [at, at + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const o = interpolate(f, [out - 8, out], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <div style={{ opacity: a * o, transform: `translateY(${(1 - a) * y}px)`, filter: `blur(${(1 - a) * 6}px)` }}>{children}</div>;
};

const Copy: React.FC<{ sc: EdScene; last: boolean }> = ({ sc, last }) => {
  const f = useCurrentFrame();
  const out = last ? sc.frames + 100 : sc.frames - 4; // 마지막 장면 글자는 끝까지
  const start = 8;
  const lineW = interpolate(f, [start, start + 16], [0, 70], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  const big = last && sc.end;
  return (
    <AbsoluteFill style={{ left: LEFT, top: TOP, right: 150 }}>
      {sc.eyebrow && (
        <Rise at={start} out={out} y={6}>
          <div style={{ display: "flex", alignItems: "center", gap: 22, marginBottom: 30 }}>
            <span style={{ display: "inline-block", width: lineW, height: 1.5, backgroundColor: INK, opacity: 0.7 }} />
            <span style={{ fontFamily: italic, fontStyle: "italic", fontWeight: 500, fontSize: 34, color: INK, letterSpacing: 1 }}>{sc.eyebrow}</span>
          </div>
        </Rise>
      )}
      {sc.title.map((t, i) => (
        <Rise key={i} at={start + 8 + i * 7} out={out}>
          <div style={{ fontFamily: serif, fontWeight: big ? 700 : 400, fontSize: big ? 84 : 64, lineHeight: 1.32, color: INK, letterSpacing: big ? 2 : -0.5, whiteSpace: "nowrap", textShadow: "0 0 24px rgba(255,255,255,0.55)" }}>{t}</div>
        </Rise>
      ))}
      {sc.sub && (
        <Rise at={start + 24} out={out} y={8}>
          <div style={{ fontFamily: serif, fontSize: 28, color: SUB, marginTop: 18, letterSpacing: 0.5 }}>{sc.sub}</div>
        </Rise>
      )}
      {sc.end && (
        <div style={{ display: "flex", alignItems: "center", gap: 26, marginTop: 26 }}>
          {sc.end.chips.map((c, i) => (
            <Rise key={c + i} at={start + 22 + i * 4} out={out} y={8}>
              <span style={{ display: "block", width: 46, height: 46, borderRadius: 999, backgroundColor: c, boxShadow: "0 0 0 4px rgba(255,255,255,0.95), 0 2px 8px rgba(0,0,0,0.12)" }} />
            </Rise>
          ))}
          {sc.end.label && (
            <Rise at={start + 22 + sc.end.chips.length * 4} out={out} y={8}>
              <span style={{ fontFamily: sans, fontWeight: 500, fontSize: 30, letterSpacing: 5, color: INK, marginLeft: 18 }}>{sc.end.label}</span>
            </Rise>
          )}
        </div>
      )}
    </AbsoluteFill>
  );
};

export const Editorial: React.FC<EditorialProps> = (props) => {
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: "#f4f3f0" }}>
      {props.scenes.map((sc, i) => {
        const from = at;
        at += sc.frames - XF;
        const last = i === props.scenes.length - 1;
        return (
          <Sequence key={i} from={from} durationInFrames={sc.frames}>
            <Media sc={sc} first={i === 0} />
            <Copy sc={sc} last={last} />
          </Sequence>
        );
      })}
      {props.bgm && <Audio src={staticFile(props.bgm)} volume={props.bgmVolume ?? 0.7} />}
    </AbsoluteFill>
  );
};
