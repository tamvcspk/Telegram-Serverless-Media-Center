// Giai đoạn 2 của kế hoạch chuẩn hoá dung lượng (ADR-0017 § addendum
// 2026-09-19): dự đoán + chế độ Tự động/Nâng cao của dialog tiền kiểm. Hàm
// thuần — mọi công thức nằm ở đây, Rust (`ingest-ffmpeg::reencode`) chỉ THỰC
// THI tham số nhận được (điều kiện bắt buộc #4).

import { bitsPerPixel, REENCODE_AUDIO_BITRATE_BPS } from './size-normalize';

/** Tham số một lần re-encode do bước tiền kiểm quyết — khớp `ReencodeOptions`
 * (Rust) trừ `window`. Field bỏ trống = giữ mặc định của Hạng D thường. */
export interface ReencodePlan {
  targetVideoBitrateBps?: number;
  /** Hạ độ phân giải: chiều cao tối đa (px), giữ tỉ lệ khung hình. */
  maxHeight?: number;
  audioBitrateBps?: number;
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
