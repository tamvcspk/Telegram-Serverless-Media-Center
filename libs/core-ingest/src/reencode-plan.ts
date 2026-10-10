// Giai đoạn 2 của kế hoạch chuẩn hoá dung lượng (ADR-0017 § addendum
// 2026-09-19): dự đoán + chế độ Tự động/Nâng cao của dialog tiền kiểm. Hàm
// thuần — mọi công thức nằm ở đây, Rust (`ingest-ffmpeg::reencode`) chỉ THỰC
// THI tham số nhận được (điều kiện bắt buộc #4).

import { bitsPerPixel, computeTargetVideoBitrateBps, MIN_VIDEO_BITRATE_BPS, MUX_OVERHEAD_FRACTION, REENCODE_AUDIO_BITRATE_BPS, SIZE_SAFETY_MARGIN } from './size-normalize';

/** Chất lượng không đổi (CRF) kèm trần VBV — khớp `CrfRate` (Rust). ADR-0023
 * quyết định 4: VBV giới hạn bitrate trung bình trên mọi cửa sổ dài bằng
 * `bufsizeBits`, nên dung lượng không vượt trần dù dự đoán RF sai. */
export interface CrfPlan {
  /** Rate factor kiểu HandBrake "RF" (thấp hơn = đẹp hơn, file to hơn). */
  rf: number;
  /** `maxrate` của x264 (bps). 0 = không đặt trần (không biết thời lượng). */
  maxrateBps: number;
  /** `bufsize` của x264 (bit). */
  bufsizeBits: number;
}

/** Tham số một lần re-encode do bước tiền kiểm quyết — khớp `ReencodeOptions`
 * (Rust) trừ `window`. `crf` ưu tiên hơn `targetVideoBitrateBps` (ABR). */
export interface ReencodePlan {
  targetVideoBitrateBps?: number;
  crf?: CrfPlan;
  /** Preset x264; bỏ trống = `fast` (preset "Fast" của HandBrake). */
  preset?: X264Preset;
  /** Hạ độ phân giải: chiều cao tối đa (px), giữ tỉ lệ khung hình. */
  maxHeight?: number;
  audioBitrateBps?: number;
}

/** Khớp `X264_PRESETS` ở `reencode.rs` — Rust từ chối tên lạ. */
export type X264Preset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';

/** RF mặc định theo CHIỀU CAO ĐẦU RA — đúng bảng preset "Fast" của HandBrake
 * (`preset_builtin.json`: 1080p30 → 22, 720p30 → 21, 576p25/480p30 → 20). ADR-0023
 * quyết định 3. Trên 1080p tạm dùng 22 (bảng HandBrake dừng ở 1080p). */
export function defaultRf(outputHeight: number): number {
  if (outputHeight >= 1080) {
    return 22;
  }
  return outputHeight >= 720 ? 21 : 20;
}

/** `bufsize` = 2× `maxrate` cho chế độ CRF (ADR-0023 quyết định 4): đủ rộng để x264 dồn bit
 * cho cảnh khó, đủ hẹp để trung bình trên cửa sổ dài bám trần. */
export const CRF_VBV_BUFSIZE_FACTOR = 2;

/**
 * CRF + trần VBV cho một lần re-encode vừa trần upload. `maxrateBps` = ngân sách bitrate
 * video vừa trần (`computeTargetVideoBitrateBps`, cùng margin 0.92 — chưa có số đo VBV trên
 * thực tế nên giữ margin thận trọng). `durationSec <= 0` (không biết thời lượng) → không đặt
 * trần: để `computeTargetVideoBitrateBps` trả sàn 100 kbps sẽ ép CRF xuống mức vô dụng.
 */
export function planCrf(input: { width: number; height: number; maxHeight?: number; maxUploadBytes: number; durationSec: number; audioBitrateBps?: number; rf?: number }): CrfPlan {
  const outHeight = scaledSize(input.width, input.height, input.maxHeight).height;
  const rf = input.rf ?? defaultRf(outHeight);
  if (!(input.durationSec > 0)) {
    return { rf, maxrateBps: 0, bufsizeBits: 0 };
  }
  const maxrateBps = computeTargetVideoBitrateBps(input.maxUploadBytes, input.durationSec, input.audioBitrateBps);
  return { rf, maxrateBps, bufsizeBits: maxrateBps * CRF_VBV_BUFSIZE_FACTOR };
}

/** Cận trên CHẮC CHẮN của dung lượng ở chế độ CRF: VBV giữ bitrate trung bình dưới `maxrate`.
 * Không phải dự đoán — dung lượng thật thường thấp hơn nhiều; chỉ đo bằng encode mẫu mới biết. */
export function crfCeilingBytes(input: { maxrateBps: number; audioBitrateBps?: number; durationSec: number }): number {
  const audio = input.audioBitrateBps ?? REENCODE_AUDIO_BITRATE_BPS;
  return ((input.maxrateBps + audio) * Math.max(input.durationSec, 0) * ESTIMATE_OVERHEAD) / 8;
}

/** Các mức bitrate audio panel Nâng cao cho chọn (bps). */
export const AUDIO_BITRATE_CHOICES_BPS: readonly number[] = [96_000, 128_000, 160_000, 192_000];

/** Thang chiều cao ứng viên cho chế độ Tự động/panel Nâng cao, cao → thấp. */
const HEIGHT_LADDER: readonly number[] = [2160, 1440, 1080, 720, 576, 480, 360];

/** Ngưỡng bits/pixel tối thiểu để chế độ Tự động còn giữ độ phân giải. THAM
 * KHẢO, chưa hiệu chỉnh trên `h264_mf` — điều chỉnh sau khi có dữ liệu thật. */
export const AUTO_MIN_BITS_PER_PIXEL = 0.06;

/** Nhãn đọc được cho chỉ báo bits/pixel — chỉ để hiển thị, không chặn. */
export type QualityLevel = 'low' | 'ok' | 'good';

export function qualityLevel(bpp: number | null): QualityLevel | null {
  if (bpp === null) {
    return null;
  }
  if (bpp < 0.04) {
    return 'low';
  }
  return bpp < AUTO_MIN_BITS_PER_PIXEL ? 'ok' : 'good';
}

/** Kích thước đầu ra khi hạ về `maxHeight` — PHẢI khớp cách Rust làm tròn
 * (`reencode.rs::scaled_dimensions`): giữ tỉ lệ, cả hai chiều làm tròn XUỐNG
 * số chẵn, không bao giờ phóng to. */
export function scaledSize(width: number, height: number, maxHeight?: number): { width: number; height: number } {
  const even = (n: number): number => Math.max(2, Math.floor(n) & ~1);
  if (maxHeight === undefined || !(maxHeight > 0) || !(height > 0) || maxHeight >= height) {
    return { width: even(width), height: even(height) };
  }
  return { width: even((width * maxHeight) / height), height: even(maxHeight) };
}

/** Các `maxHeight` hợp lệ cho nguồn cao `sourceHeight` (thấp hơn nguồn), cao → thấp. */
export function resolutionChoices(sourceHeight: number): number[] {
  return HEIGHT_LADDER.filter((h) => h < sourceHeight);
}

/** Chỉ báo chất lượng của một cấu hình re-encode (bits/pixel ở độ phân giải
 * ĐẦU RA). `null` nếu thiếu số liệu nguồn. */
export function reencodeQuality(input: { width: number; height: number; fps: number; videoBitrateBps: number; maxHeight?: number }): number | null {
  const size = scaledSize(input.width, input.height, input.maxHeight);
  return bitsPerPixel({ bitrateBps: input.videoBitrateBps, width: size.width, height: size.height, fps: input.fps });
}

/**
 * Chế độ Tự động (Option D): độ phân giải CAO NHẤT mà bits/pixel vẫn ≥
 * `AUTO_MIN_BITS_PER_PIXEL` ở bitrate video đã cho. `undefined` = giữ nguyên
 * độ phân giải gốc. Không mức nào đạt → mức thấp nhất trong thang.
 */
export function chooseAutoResolution(input: { width: number; height: number; fps: number; videoBitrateBps: number }): number | undefined {
  const { width, height, fps, videoBitrateBps } = input;
  if (!(height > 0) || !(width > 0) || !(fps > 0)) {
    return undefined;
  }
  const meets = (h: number | undefined): boolean => {
    const bpp = reencodeQuality({ width, height, fps, videoBitrateBps, maxHeight: h });
    return bpp !== null && bpp >= AUTO_MIN_BITS_PER_PIXEL;
  };
  if (meets(undefined)) {
    return undefined;
  }
  const choices = resolutionChoices(height);
  return choices.find((h) => meets(h)) ?? choices[choices.length - 1];
}

/** Khoảng ước tính TỨC THÌ của dung lượng khi nén theo bitrate mục tiêu.
 * SPIKE-11 đo actual/target dao động 0.3x-3x tuỳ nội dung; khoảng ở đây hẹp
 * hơn có chủ đích (điểm bắt đầu, chưa có dữ liệu thật) — chính vì thế có nút
 * "ước tính chính xác" (encode thử, `estimateFromSamples()`). */
export const ESTIMATE_RANGE_LOW = 0.5;
export const ESTIMATE_RANGE_HIGH = 1.5;

/** Overhead container — cùng giá trị `MUX_OVERHEAD_FRACTION` ở size-normalize.ts. */
const ESTIMATE_OVERHEAD = 1.02;

export function estimateReencodeRangeBytes(input: { targetVideoBitrateBps: number; audioBitrateBps?: number; durationSec: number }): { minBytes: number; maxBytes: number } {
  const duration = Math.max(input.durationSec, 0);
  const videoBytes = (input.targetVideoBitrateBps * duration) / 8;
  const audioBytes = ((input.audioBitrateBps ?? REENCODE_AUDIO_BITRATE_BPS) * duration) / 8;
  return {
    minBytes: (videoBytes * ESTIMATE_RANGE_LOW + audioBytes) * ESTIMATE_OVERHEAD,
    maxBytes: (videoBytes * ESTIMATE_RANGE_HIGH + audioBytes) * ESTIMATE_OVERHEAD
  };
}

/** Dưới ngưỡng bits/pixel này `h264_mf` ABR có MỨC SÀN: file ra TO HƠN target
 * mà VMAF sụp (ADR-0017 § addendum 2026-10-04: phim 1080p đặt 600 kbps ra thực
 * 1291 kbps, VMAF 23.7). Số đo đầu tiên, chưa phải hiệu chỉnh bằng mắt người. */
export const ABR_FLOOR_BITS_PER_PIXEL = 0.045;

/** Bitrate video tối thiểu mà ABR còn bám target ở độ phân giải đầu ra này. 0 nếu thiếu số liệu. */
export function minAbrVideoBitrateBps(input: { width: number; height: number; fps: number; maxHeight?: number }): number {
  const size = scaledSize(input.width, input.height, input.maxHeight);
  const pixelsPerSec = size.width * size.height * input.fps;
  return pixelsPerSec > 0 ? Math.ceil(pixelsPerSec * ABR_FLOOR_BITS_PER_PIXEL) : 0;
}

/** `true` nếu target thấp hơn mức sàn ABR ở độ phân giải đầu ra — nén sẽ ra file lớn hơn dự kiến, hình tệ. */
export function isBelowAbrFloor(input: { width: number; height: number; fps: number; videoBitrateBps: number; maxHeight?: number }): boolean {
  const floor = minAbrVideoBitrateBps(input);
  return floor > 0 && input.videoBitrateBps < floor;
}

/** Chặn CỨNG: dưới mức sàn ABR thì không cho nén lại ở độ phân giải này. Trả độ
 * phân giải CAO NHẤT trong thang mà target còn ≥ sàn (`maxHeight` giữ nguyên nếu
 * đã đạt), hoặc `null` nếu không mức nào đạt — lúc đó chỉ còn chia phần/bỏ qua.
 * `undefined` trong `resolution` = giữ độ phân giải gốc. */
export function resolveAbrFloor(input: { width: number; height: number; fps: number; videoBitrateBps: number; maxHeight?: number }): { resolution: number | undefined } | null {
  const { width, height, fps, videoBitrateBps } = input;
  const ok = (h: number | undefined): boolean => !isBelowAbrFloor({ width, height, fps, videoBitrateBps, maxHeight: h });
  if (ok(input.maxHeight)) {
    return { resolution: input.maxHeight };
  }
  const lower = resolutionChoices(input.maxHeight ?? height).find((h) => ok(h));
  return lower === undefined ? null : { resolution: lower };
}

/** Nén lại KHÔNG giảm gì khi target không thấp hơn bitrate video của chính file
 * nguồn (xấp xỉ: bitrate tổng trừ audio nguồn ~ `REENCODE_AUDIO_BITRATE_BPS`).
 * Chỉ so với NGUỒN — mức `h264_mf` tự chọn khi không đặt target chưa đo được
 * (ADR-0017 § addendum 2026-10-04: ~840 kbps với nguồn 1504 kbps), cần mẫu
 * không-target mới so chính xác hơn. Đã hạ độ phân giải thì nén lại vẫn có tác
 * dụng nên không cảnh báo. */
export function isReencodeFutile(input: { targetVideoBitrateBps: number; sourceBytes: number; durationSec: number; maxHeight?: number; sourceHeight: number }): boolean {
  if (!(input.durationSec > 0) || !(input.sourceBytes > 0)) {
    return false;
  }
  if (input.maxHeight !== undefined && input.maxHeight < input.sourceHeight) {
    return false;
  }
  const sourceVideoBps = (input.sourceBytes * 8) / input.durationSec - REENCODE_AUDIO_BITRATE_BPS;
  return sourceVideoBps > 0 && input.targetVideoBitrateBps >= sourceVideoBps * 0.9;
}

/** Hệ số r kẹp trong khoảng này — ngoài khoảng là mẫu hỏng, không tin để hiệu chỉnh. */
const CALIBRATION_R_MIN = 0.5;
const CALIBRATION_R_MAX = 2;

/**
 * Hiệu chỉnh target ABR theo mẫu thử: `r` = dung lượng VIDEO đo được / dự kiến
 * theo target, trả `target / r` (ADR-0017 § addendum 2026-10-04 §3.1). Chỉ đúng
 * với ABR (sai số ngoại suy ≲3%); `rate_control=quality` lệch −10…−30% nên KHÔNG
 * dùng hàm này. `null` nếu không có mẫu hợp lệ. Dung lượng mẫu gồm audio +
 * overhead container nên trừ đi trước khi so với phần video.
 */
export function calibrateTargetBps(input: { targetVideoBitrateBps: number; audioBitrateBps?: number; samples: readonly EstimateSample[]; desiredVideoBitrateBps?: number }): number | null {
  const valid = input.samples.filter((s) => s.mediaSec > 0 && s.outBytes >= 0);
  if (valid.length === 0 || !(input.targetVideoBitrateBps > 0)) {
    return null;
  }
  const totalMedia = valid.reduce((a, s) => a + s.mediaSec, 0);
  const totalBytes = valid.reduce((a, s) => a + s.outBytes, 0);
  const audioBps = input.audioBitrateBps ?? REENCODE_AUDIO_BITRATE_BPS;
  const videoBps = ((totalBytes / totalMedia) * 8) / ESTIMATE_OVERHEAD - audioBps;
  if (!(videoBps > 0)) {
    return null;
  }
  // `desired` = mức video bps MUỐN đạt; mặc định = target (đúng khi plan CHƯA hiệu
  // chỉnh). Plan đã hiệu chỉnh PHẢI truyền `desired` riêng: so với chính target
  // hiện tại sẽ chia cho cùng một r thêm lần nữa mỗi lần đo lại → target trôi
  // lên/xuống vô hạn (lỗi thật 2026-10-05: 3.8→4.07→4.38→4.74 GB).
  const desired = input.desiredVideoBitrateBps ?? input.targetVideoBitrateBps;
  const r = Math.min(CALIBRATION_R_MAX, Math.max(CALIBRATION_R_MIN, videoBps / desired));
  return Math.floor(input.targetVideoBitrateBps / r);
}

/** Dung lượng dự kiến SAU khi đổi target `from` → `to` theo ABR tuyến tính (phần
 * video tỉ lệ target, audio + overhead giữ nguyên). Chỉ là ngoại suy từ số đã
 * đo, không phải đo mới — UI phải gắn nhãn "dự kiến" tới khi user đo lại. */
export function rescaleEstimateBytes(input: { estimatedBytes: number; durationSec: number; fromVideoBps: number; toVideoBps: number; audioBitrateBps?: number }): number {
  const { estimatedBytes, durationSec, fromVideoBps, toVideoBps } = input;
  if (!(durationSec > 0) || !(fromVideoBps > 0)) {
    return estimatedBytes;
  }
  const audioBytes = ((input.audioBitrateBps ?? REENCODE_AUDIO_BITRATE_BPS) * durationSec) / 8;
  const videoBytes = Math.max(estimatedBytes / ESTIMATE_OVERHEAD - audioBytes, 0);
  return (videoBytes * (toVideoBps / fromVideoBps) + audioBytes) * ESTIMATE_OVERHEAD;
}

/** Một đoạn encode thử (khớp `EstimateSampleDto`, Rust). */
export interface EstimateSample {
  /** Dung lượng file đầu ra của đoạn thử. */
  outBytes: number;
  /** Độ dài đoạn media đã encode (giây). */
  mediaSec: number;
  /** Thời gian tường để encode đoạn đó (giây). */
  wallSec: number;
}

export interface ReencodeEstimate {
  /** Dung lượng đầu ra ngoại suy cho cả file. */
  estimatedBytes: number;
  /** Tốc độ trung bình (x-realtime). */
  speedXRealtime: number;
  /** Thời gian nén dự kiến cho cả file (giây). */
  etaSec: number;
}

/** Ngoại suy từ các đoạn encode thử: byte/giây media và tốc độ trung bình (tổng
 * media / tổng thời gian tường — không phải trung bình các tỉ số, để đoạn
 * chậm không bị đánh giá thấp). Không có mẫu hợp lệ → `null`. */
export function estimateFromSamples(samples: readonly EstimateSample[], durationSec: number): ReencodeEstimate | null {
  const valid = samples.filter((s) => s.mediaSec > 0 && s.wallSec > 0 && s.outBytes >= 0);
  if (valid.length === 0 || !(durationSec > 0)) {
    return null;
  }
  const totalMedia = valid.reduce((a, s) => a + s.mediaSec, 0);
  const totalWall = valid.reduce((a, s) => a + s.wallSec, 0);
  const totalBytes = valid.reduce((a, s) => a + s.outBytes, 0);
  const speed = totalMedia / totalWall;
  return { estimatedBytes: (totalBytes / totalMedia) * durationSec, speedXRealtime: speed, etaSec: durationSec / speed };
}

/** Mức bitrate audio nguồn giả định khi ước bitrate video của nguồn từ dung lượng tổng. */
const SOURCE_AUDIO_BPS_GUESS = REENCODE_AUDIO_BITRATE_BPS;

/** Không đặt target thì `h264_mf` TỰ CHỌN một bitrate rất thấp: đo thật 2026-10-07 trên Caribbean 070307-487.wmv
 * (720×540, nguồn 1.98 Mbps) — ~390 kbps (~0.03 bit/pixel), file 830 MB → 165 MB, hình mờ và vỡ nét nặng. Vì vậy Hạng D
 * KHÔNG BAO GIỜ nén với mặc định của bộ nén. */
export const D_REENCODE_SOURCE_FRACTION = 1;

/**
 * Bitrate video mặc định khi nén lại file Hạng D DƯỚI trần (không cần giảm dung lượng, chỉ cần đổi codec cho trình
 * duyệt phát được): giữ gần bitrate video của chính file nguồn (`D_REENCODE_SOURCE_FRACTION`), không thấp hơn mức sàn
 * ABR của `h264_mf` ở độ phân giải đầu ra, không cao hơn mức vừa trần. Thiếu số liệu nguồn thì dùng 0.1 bit/pixel.
 */
export function defaultReencodeBitrateBps(input: { sourceBytes: number; durationSec: number; width: number; height: number; fps: number; maxUploadBytes: number; maxHeight?: number }): number {
  const { sourceBytes, durationSec, maxUploadBytes } = input;
  const floor = minAbrVideoBitrateBps(input);
  const size = scaledSize(input.width, input.height, input.maxHeight);
  const pixelsPerSec = size.width * size.height * input.fps;
  const sourceVideoBps = durationSec > 0 && sourceBytes > 0 ? (sourceBytes * 8) / durationSec - SOURCE_AUDIO_BPS_GUESS : 0;
  const want = sourceVideoBps > 0 ? sourceVideoBps * D_REENCODE_SOURCE_FRACTION : pixelsPerSec > 0 ? pixelsPerSec * 0.1 : 2_000_000;
  const cap = computeTargetVideoBitrateBps(maxUploadBytes, durationSec);
  return Math.max(MIN_VIDEO_BITRATE_BPS, Math.floor(Math.min(Math.max(want, floor), cap)));
}

/** Dung lượng đầu ra (byte) mà `computeTargetVideoBitrateBps()` quy về đúng `videoBps` — nghịch đảo công thức, để thanh
 * trượt kích thước hiện đúng giá trị khởi đầu là một BITRATE (Hạng D dưới trần). */
export function sizeForVideoBitrateBps(videoBps: number, durationSec: number, audioBitrateBps: number = REENCODE_AUDIO_BITRATE_BPS): number {
  return ((videoBps + audioBitrateBps) / (1 - MUX_OVERHEAD_FRACTION) / SIZE_SAFETY_MARGIN) * (durationSec / 8);
}
