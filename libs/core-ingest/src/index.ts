// Logic thuần cho tsmc-ingest CLI (ADR-0013 mục 1) — probe/rank, kế thừa
// metadata, gộp catalog. KHÔNG import @tsmc/core-mtproto (xem gateway-port.ts)
// và KHÔNG gọi child_process/ffmpeg/ffprobe trực tiếp — apps/tsmc-ingest nối
// gateway thật + I/O thật vào, package này chỉ chứa hàm thuần test được bằng
// fixture (libs/vitest.config.ts nhặt test package này miễn phí, cùng khuôn
// libs/core-index, libs/core-sync...).
export const LIB_NAME = '@tsmc/core-ingest' as const;

export type { IngestGateway, IngestResolvedChannel, IngestPinnedCatalog, IngestVideoUploadInput } from './gateway-port';

export { classifyCompatRank, deriveCompat } from './compat-rank';
export type { CompatRank, CompatLabel, CompatRankResult, Container, ProbeResult, ProbeVideoStream, ProbeAudioStream, ProbeSubtitleStream } from './compat-rank';

export { seedMetadataFromFilename, inheritMetadata } from './metadata-inherit';

export { assertChannelWritable, buildCatalogEnvelope, mergeCatalogItems, NotChannelOwnerError, parseExistingCatalogItems } from './catalog-merge';
export type { CatalogChannelRef } from './catalog-merge';

export { matchSidecarSubtitles } from './sidecar-subtitles';
export type { SidecarSubtitleMatch } from './sidecar-subtitles';

export { composeCaption } from './caption-hashtags';

export { flattenMetadataTree, seasonGroupKey, seriesGroupKey } from './metadata-tree';
export type { FlatMetadataRow } from './metadata-tree';

export {
  bitsPerPixel,
  chooseDefaultStrategy,
  computeTargetVideoBitrateBps,
  MIN_VIDEO_BITRATE_BPS,
  planSizeCap,
  REENCODE_AUDIO_BITRATE_BPS,
  REENCODE_DEFAULT_MAX_REDUCTION,
  type SizeCapPlan,
  type SizeCapStrategy
} from './size-normalize';

export {
  AUDIO_BITRATE_CHOICES_BPS,
  ABR_FLOOR_BITS_PER_PIXEL,
  AUTO_MIN_BITS_PER_PIXEL,
  calibrateTargetBps,
  isBelowAbrFloor,
  minAbrVideoBitrateBps,
  chooseAutoResolution,
  estimateFromSamples,
  estimateReencodeRangeBytes,
  qualityLevel,
  reencodeQuality,
  resolutionChoices,
  scaledSize,
  type EstimateSample,
  type QualityLevel,
  type ReencodeEstimate,
  type ReencodePlan
} from './reencode-plan';

export { assignToSeries, findRepresentativeEpisode, listSeriesNames, suggestNextEpisode } from './series-registry';
