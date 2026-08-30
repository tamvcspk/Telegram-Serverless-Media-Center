// Phân hạng tương thích A/B/C/D — ADR-0013 mục 1 "Bảng phân hạng tương thích".
// Input là kết quả ffprobe ĐÃ CHUẨN HOÁ (ProbeResult) — hàm ở đây thuần tuý,
// không gọi child_process/ffprobe thật (việc đó là của apps/tsmc-ingest/src/
// ffprobe.ts), nên test được bằng fixture JSON, không cần binary ffprobe lúc
// chạy `npm run test:libs`.
//
// Container là ĐIỀU KIỆN GATE trước tiên, không phải codec — đúng quy tắc đã
// chốt ở ADR-0010 § Cập nhật 2026-08-29: "MKV/container lạ luôn Hạng C/D bất
// kể codec bên trong". AVI/VC-1/RealVideo luôn Hạng D bất kể có remux được
// hay không — ADR liệt chúng cùng nhóm "video codec trình duyệt không giải
// được", không phải nhóm "remux được nhưng cần xác nhận".

export type Container = 'mp4' | 'matroska' | 'mpegts' | 'avi' | 'other';

export interface ProbeVideoStream {
  codec: string;
  width: number;
  height: number;
}

export interface ProbeAudioStream {
  codec: string;
  lang?: string;
  /** Stream index thô của ffprobe (`streams[].index`) — cần để CLI dựng `-map 0:<index>` lúc remux/extract. Không dùng bởi logic phân hạng ở đây. */
  index?: number;
}

export interface ProbeSubtitleStream {
  codec: string;
  lang?: string;
  /** Stream index thô của ffprobe — xem ProbeAudioStream. */
  index?: number;
}

/** Kết quả ffprobe đã rút gọn về đúng field CLI cần — apps/tsmc-ingest/src/ffprobe.ts sinh ra shape này từ JSON thô. */
export interface ProbeResult {
  container: Container;
  durationSec: number;
  video?: ProbeVideoStream;
  audio: ProbeAudioStream[];
  subtitles: ProbeSubtitleStream[];
}

export type CompatRank = 'A' | 'B' | 'C' | 'D';
export type CompatLabel = 'full' | 'partial' | 'unplayable';

export interface CompatRankResult {
  rank: CompatRank;
  reasons: string[];
}

const H264_CODECS = new Set(['h264', 'avc']);
const HEVC_AV1_CODECS = new Set(['hevc', 'h265', 'av1']);
/** Video codec trình duyệt không giải được — luôn Hạng D, không remux được (cần re-encode thật). */
const UNPLAYABLE_VIDEO_CODECS = new Set(['vc1', 'rv40', 'rv30', 'rv20', 'rv10', 'mpeg2video', 'msmpeg4v2', 'msmpeg4v3', 'wmv1', 'wmv2', 'wmv3']);

const AAC_CODECS = new Set(['aac']);
const PARTIAL_AUDIO_CODECS = new Set(['opus', 'eac3']);
const HEAVY_AUDIO_CODECS = new Set(['dts', 'truehd']);

function normalize(codec: string | undefined): string {
  return (codec ?? '').toLowerCase();
}

/**
 * Phân hạng để CLI quyết định HÀNH ĐỘNG (upload thẳng / remux / hỏi xác
 * nhận re-encode) — KHÔNG phải nhãn `compat` cuối cùng ghi vào catalog (xem
 * `deriveCompat()` bên dưới, chạy lại SAU khi remux xong để phản ánh đúng
 * codec THẬT SỰ đã upload, không phải codec gốc trước khi xử lý).
 */
export function classifyCompatRank(probe: ProbeResult): CompatRankResult {
  const videoCodec = normalize(probe.video?.codec);
  const audioCodecs = probe.audio.map((a) => normalize(a.codec));
  const hasPgsSubs = probe.subtitles.some((s) => normalize(s.codec).includes('pgs'));

  if (!probe.video) {
    return { rank: 'D', reasons: ['Không có video stream nào — không phải file phim hợp lệ.'] };
  }

  if (UNPLAYABLE_VIDEO_CODECS.has(videoCodec)) {
    return { rank: 'D', reasons: [`Video codec "${videoCodec}" trình duyệt không giải được — cần re-encode.`] };
  }

  if (probe.container === 'avi') {
    return { rank: 'D', reasons: ['Container AVI — luôn Hạng D bất kể codec bên trong (ADR-0013).'] };
  }

  if (probe.container === 'mp4') {
    if (H264_CODECS.has(videoCodec) && audioCodecs.every((a) => AAC_CODECS.has(a))) {
      return { rank: 'A', reasons: ['MP4 + H.264 + AAC — upload thẳng.'] };
    }
    return {
      rank: 'B',
      reasons: [`MP4 nhưng video "${videoCodec || 'không xác định'}"/audio [${audioCodecs.join(', ') || 'không có'}] không khớp Hạng A — đánh dấu compat "partial".`]
    };
  }

  if (probe.container === 'matroska' || probe.container === 'mpegts') {
    const reasons = [`Container "${probe.container}" — remux sang MP4 (copy video, encode audio AAC).`];
    if (audioCodecs.some((a) => HEAVY_AUDIO_CODECS.has(a))) {
      reasons.push(`Audio "${audioCodecs.join(', ')}" sẽ được encode sang AAC.`);
    }
    if (hasPgsSubs) {
      reasons.push('Phụ đề PGS (dạng ảnh) sẽ được rút ra file rời, không convert được sang text.');
    }
    return { rank: 'C', reasons };
  }

  return { rank: 'D', reasons: [`Container "${probe.container}" không nhận diện được — cần re-encode, không remux tự động.`] };
}

/**
 * Nhãn `compat` THẬT SỰ ghi vào catalog.json (catalog-spec.md) — tính từ
 * codec của file ĐÃ UPLOAD (sau remux/faststart nếu có), không phải file
 * gốc. Gọi lại hàm này sau khi ffprobe lại file output của ffmpeg, không tái
 * dùng `classifyCompatRank()` (hàm đó nhìn container để quyết định HÀNH
 * ĐỘNG, không phải nhãn cuối). Không có nhánh nào trả về ngầm định "full" khi
 * thiếu dữ liệu — catalog-spec.md: "Thiếu compat thì client KHÔNG được giả
 * định là full", nên ở đây mặc định an toàn là "partial" khi gặp codec lạ.
 */
export function deriveCompat(video: ProbeVideoStream | undefined, audio: ProbeAudioStream[]): CompatLabel {
  const videoCodec = normalize(video?.codec);
  const audioCodecs = audio.map((a) => normalize(a.codec));

  if (!video || UNPLAYABLE_VIDEO_CODECS.has(videoCodec)) {
    return 'unplayable';
  }

  const videoIsH264 = H264_CODECS.has(videoCodec);
  const audioAllAac = audioCodecs.length > 0 && audioCodecs.every((a) => AAC_CODECS.has(a));
  if (videoIsH264 && audioAllAac) {
    return 'full';
  }

  const videoIsHevcOrAv1 = HEVC_AV1_CODECS.has(videoCodec);
  const audioHasPartial = audioCodecs.some((a) => PARTIAL_AUDIO_CODECS.has(a));
  if (videoIsHevcOrAv1 || audioHasPartial || !audioAllAac) {
    return 'partial';
  }

  return 'partial';
}
