// Giai đoạn 2 của kế hoạch chuẩn hoá dung lượng (ADR-0017 § addendum
// 2026-09-19): dự đoán + chế độ Tự động/Nâng cao của dialog tiền kiểm. Hàm
// thuần — mọi công thức nằm ở đây, Rust (`ingest-ffmpeg::reencode`) chỉ THỰC
// THI tham số nhận được (điều kiện bắt buộc #4).

import { bitsPerPixel, computeTargetVideoBitrateBps, REENCODE_AUDIO_BITRATE_BPS, SIZE_SAFETY_MARGIN } from './size-normalize';

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
  /** 2-pass ABR theo `targetVideoBitrateBps` (ADR-0023 § 4c.2). Bỏ qua nếu có `crf` hoặc không có bitrate đích. */
  twoPass?: boolean;
  crf?: CrfPlan;
  /** Preset x264; bỏ trống = `fast` (preset "Fast" của HandBrake). */
  preset?: X264Preset;
  /** Hạ độ phân giải: chiều cao tối đa (px), giữ tỉ lệ khung hình. */
  maxHeight?: number;
  audioBitrateBps?: number;
}

/** Khớp `X264_PRESETS` ở `reencode.rs` — Rust từ chối tên lạ. */
export type X264Preset = 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';

/** Khoảng RF của thanh chất lượng (HandBrake: 18–28 là vùng dùng được; thấp hơn đẹp hơn, file to hơn). */
export const RF_MIN = 18;
export const RF_MAX = 28;

/** Độ dốc dung lượng theo RF của x264 `fast`, không VBV, đo 2026-10-10 trên WMV VC-1 1080p (90 s):
 * RF 18→28 giảm 115.1→45.5 MB, tức e^(−0.0929) ≈ 0.911 mỗi bậc (gấp đôi sau ~7.5 bậc — không phải "6"
 * của quy tắc thường nhắc). MỘT nguồn, chỉ để ngoại suy hiển thị; luôn gắn nhãn "dự kiến". */
export const CRF_SIZE_DECAY_PER_RF = 0.0929;

/**
 * Ngoại suy dung lượng ở RF mới từ MỘT lần đo ở `basisRf` (cùng độ phân giải, không trần VBV). Chỉ phần
 * VIDEO co giãn theo RF; audio + overhead container giữ nguyên. Kết quả KHÔNG vượt cận trên của VBV nếu
 * có `ceilingBytes` (trần luôn giữ).
 */
export function extrapolateCrfBytes(input: { basisBytes: number; basisRf: number; rf: number; durationSec: number; audioBitrateBps?: number; ceilingBytes?: number }): number {
  const audioBytes = ((input.audioBitrateBps ?? REENCODE_AUDIO_BITRATE_BPS) * Math.max(input.durationSec, 0)) / 8;
  const videoBytes = Math.max(input.basisBytes / ESTIMATE_OVERHEAD - audioBytes, 0);
  const scaled = (videoBytes * Math.exp(CRF_SIZE_DECAY_PER_RF * (input.basisRf - input.rf)) + audioBytes) * ESTIMATE_OVERHEAD;
  return input.ceilingBytes !== undefined && input.ceilingBytes > 0 ? Math.min(scaled, input.ceilingBytes) : scaled;
}

/** Preset cho panel Nâng cao (ADR-0023 § 4c.3): Nhanh = `veryfast`, Chuẩn = `fast` (mặc định, = HandBrake
 * "Fast"), Chậm = `medium`. `speedVsFast` = tốc độ so với `fast`, từ bảng ADR (1-pass: 7.0× / 4.0× / 3.4×). */
export const X264_PRESET_CHOICES: readonly { value: X264Preset; label: string; speedVsFast: number }[] = [
  { value: 'veryfast', label: 'Nhanh', speedVsFast: 7.0 / 4.0 },
  { value: 'fast', label: 'Chuẩn', speedVsFast: 1 },
  { value: 'medium', label: 'Chậm', speedVsFast: 3.4 / 4.0 }
];

export function presetSpeedVsFast(preset: X264Preset | undefined): number {
  return X264_PRESET_CHOICES.find((p) => p.value === (preset ?? 'fast'))?.speedVsFast ?? 1;
}

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

/** Dung lượng CRF thật so với dự đoán từ mẫu 8 s thường lệch; hệ số này là điểm bắt đầu 1.3 theo độ
 * lệch của chế độ `quality` đã đo (ADR-0023 § 4c.2), cần đo lại ở 4c.4 bằng nén trọn nhiều file. */
export const CRF_PREDICTION_DEVIATION = 1.3;

/** Thời gian nén 2 lượt so với 1 lượt cùng preset — đo 2026-10-10: 1-pass 4.8×, 2-pass 2.43× thời gian
 * thực trên WMV VC-1 1080p (pass 1 ≈ 45% thời gian vì giải mã nguồn lặp lại ở cả hai pass). */
export const TWO_PASS_TIME_FACTOR = 1.8;

export type RateMode = 'crf' | 'abr';

/**
 * Chọn chế độ rate control cho một file (ADR-0023 § 4c.2). `predictedBytes` = dung lượng đo được từ
 * mẫu CRF KHÔNG trần (ở RF đã chọn, ngoại suy cả file). CRF + trần VBV chỉ đủ tốt khi VBV không phải
 * gồng — dự đoán × độ lệch vẫn dưới ngân sách. Ngược lại 2-pass nhắm thẳng ngân sách: CRF bị trần chặn
 * là 1-pass ABR trá hình (80.1 VMAF, hụt target 10% ở medium — ADR-0023 quyết định 4).
 */
export function chooseRateMode(input: { predictedBytes: number; maxUploadBytes: number }): RateMode {
  const budget = input.maxUploadBytes * SIZE_SAFETY_MARGIN;
  return input.predictedBytes * CRF_PREDICTION_DEVIATION <= budget ? 'crf' : 'abr';
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

/** Ngưỡng bits/pixel tối thiểu để chế độ Tự động còn giữ độ phân giải. Đo 2026-10-10 với x264 `fast` 2-pass
 * trên WMV VC-1 1080p (VMAF, bản ra phóng lại 1080p bằng bicubic): ở 0.023 bit/pixel 720p hơn 1080p +6.6
 * (80.8 vs 74.2), ở 0.040 +2.8, ở 0.064 hoà (90.4 vs 90.2) — điểm giao đúng quanh 0.06. Xuống thấp hơn
 * 720p không thêm mấy (576p ≈ 720p ±0.5; 480p kém hơn ở bitrate cao). MỘT nguồn; ADR-0023 addendum 4c.4. */
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

/** Overhead container — cùng giá trị `MUX_OVERHEAD_FRACTION` ở size-normalize.ts. */
const ESTIMATE_OVERHEAD = 1.02;

/** Nén lại KHÔNG giảm gì khi target không thấp hơn bitrate video của chính file
 * nguồn (xấp xỉ: bitrate tổng trừ audio nguồn ~ `REENCODE_AUDIO_BITRATE_BPS`).
 * Chỉ so với NGUỒN. Đã hạ độ phân giải thì nén lại vẫn có tác dụng nên không
 * cảnh báo. */
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
