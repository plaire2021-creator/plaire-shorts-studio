import { Composition, CalculateMetadataFunction } from "remotion";
import { Shorts, ShortsProps, totalFrames } from "./Shorts";

const meta: CalculateMetadataFunction<ShortsProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
  fps: props.fps ?? 30,
});

const defaults: ShortsProps = { fps: 30, guides: false, brand: "PLAIRE 플레르가구", scenes: [] };

export const RemotionRoot = () => (
  <>
    <Composition id="Shorts" component={Shorts} width={1080} height={1920} fps={30} durationInFrames={450} defaultProps={defaults} calculateMetadata={meta} />
    {/* 유튜브 쇼츠 UI 가림 영역을 빨갛게 겹쳐 보는 확인용 */}
    <Composition id="ShortsGuides" component={Shorts} width={1080} height={1920} fps={30} durationInFrames={450} defaultProps={{ ...defaults, guides: true }} calculateMetadata={meta} />
  </>
);
