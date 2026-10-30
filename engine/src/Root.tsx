import { Composition, CalculateMetadataFunction } from "remotion";
import { Shorts, ShortsProps, totalFrames } from "./Shorts";
import { Editorial, EditorialProps, totalFramesEd } from "./Editorial";

const meta: CalculateMetadataFunction<ShortsProps> = ({ props }) => ({
  durationInFrames: totalFrames(props),
  fps: props.fps ?? 30,
});

const metaEd: CalculateMetadataFunction<EditorialProps> = ({ props }) => ({
  durationInFrames: totalFramesEd(props),
  fps: props.fps ?? 30,
});

const defaults: ShortsProps = { fps: 30, guides: false, brand: "PLAIRE 플레르가구", scenes: [] };

export const RemotionRoot = () => (
  <>
    <Composition id="Shorts" component={Shorts} width={1080} height={1920} fps={30} durationInFrames={450} defaultProps={defaults} calculateMetadata={meta} />
    {/* 유튜브 쇼츠 UI 가림 영역을 빨갛게 겹쳐 보는 확인용 */}
    <Composition id="ShortsGuides" component={Shorts} width={1080} height={1920} fps={30} durationInFrames={450} defaultProps={{ ...defaults, guides: true }} calculateMetadata={meta} />
    {/* 에디토리얼 스타일: 잔잔한 카메라 무빙 + 명조 카피 + 컬러 칩 엔딩 */}
    <Composition id="ShortsEditorial" component={Editorial} width={1080} height={1920} fps={30} durationInFrames={300} defaultProps={{ fps: 30, scenes: [] } as EditorialProps} calculateMetadata={metaEd} />
  </>
);
