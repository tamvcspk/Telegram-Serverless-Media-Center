// Chuẩn hoá dung lượng vượt trần upload — Option C (docs/roadmap.md § Ingest,
// ADR-0017 § addendum 2026-09-19). Hàm thuần: tính bitrate video mục tiêu (bps)
// để một lần re-encode ra file nằm dưới trần byte cho phép. Rust
// (`ingest-ffmpeg::reencode_to_mp4`) chỉ THỰC THI số này, không tự quyết công
// thức (ADR-0017 điều kiện bắt buộc #4).

/** Bitrate audio AAC của nhánh re-encode. PHẢI khớp `audio_enc_ctx.
 * set_bit_rate(160_000)` ở `apps/tsmc-ingest-desktop/ingest-ffmpeg/src/
 * reencode.rs` — không có cách chia sẻ hằng số qua ranh giới Rust/TS, chỉ giữ
 * đồng bộ bằng comment chéo này. */
export const REENCODE_AUDIO_BITRATE_BPS = 160_000;

/** Ước tính overhead container MP4 (moov/stbl/...) — trừ 2% ngân sách bit, không đo chính xác. */
const MUX_OVERHEAD_FRACTION = 0.02;

/** Nhắm DƯỚI trần thật thay vì đúng khít — SPIKE-11 cho thấy rate control của
 * `h264_mf` có thể overshoot target ở nội dung phức tạp. */
export const SIZE_SAFETY_MARGIN = 0.92;

/** Margin SAU khi target đã hiệu chỉnh theo mẫu thử (`calibrateTargetBps`): ABR
 * bám target ±3% sau hiệu chỉnh (ADR-0017 § addendum 2026-10-04) nên 0.955 ×
 * 1.03 ≈ 0.984 vẫn dưới trần. Chỉ dùng cho target đã hiệu chỉnh — chưa hiệu
 * chỉnh thì overshoot tới +10% (0.92 × 1.099 ≈ 1.011) nên PHẢI giữ 0.92. */
export const CALIBRATED_SAFETY_MARGIN = 0.955;

/** Sàn cứng — dưới mức này hình gần như vô dụng; nếu vẫn vượt trần thì để bước
 * kiểm tra dung lượng sau re-encode báo lỗi rõ ràng thay vì hạ thêm. */
export const MIN_VIDEO_BITRATE_BPS = 100_000;

/**
 * `target_video_bitrate = (maxBytes * margin * 8 / duration) * (1 - overhead) - audio_bitrate`,
 * kẹp dưới bởi `MIN_VIDEO_BITRATE_BPS`. `durationSec <= 0` (probe không đọc
 * được) trả về sàn — không chia cho 0.
 */
export function computeTargetVideoBitrateBps(maxUploadBytes: number, durationSec: number, audioBitrateBps: number = REENCODE_AUDIO_BITRATE_BPS, safetyMargin: number = SIZE_SAFETY_MARGIN): number {
  if (!(durationSec > 0)) {
    return MIN_VIDEO_BITRATE_BPS;
  }
  const totalBudgetBps = (maxUploadBytes * safetyMargin * 8) / durationSec;
  const videoBudgetBps = totalBudgetBps * (1 - MUX_OVERHEAD_FRACTION) - audioBitrateBps;
  return Math.max(Math.floor(videoBudgetBps), MIN_VIDEO_BITRATE_BPS);
}

export interface SizeCapPlan {
  /** Dự đoán file đầu ra có vượt trần upload không (xem `planSizeCap()`). */
  exceedsCap: boolean;
  /** Bitrate video mục tiêu (bps) cho MỘT lần re-encode duy nhất — chỉ có khi
   * `exceedsCap`. */
  targetVideoBitrateBps?: number;
}

/**
 * TIỀN KIỂM dung lượng, chạy TRƯỚC khi bấm Upload (Giai đoạn 0, ADR-0017 §
 * addendum 2026-09-19 "kế hoạch") — thay cách cũ chỉ biết dung lượng SAU
 * remux rồi hỏi giữa batch (batch chạy lúc user vắng mặt sẽ đứng chờ).
 *
 * Dự đoán: đầu ra ≈ dung lượng file NGUỒN. Đúng gần sát với Hạng A/B/C (video
 * stream-copy, audio copy hoặc AAC 160 kbps — chỉ lệch vài % do bỏ track phụ),
 * chỉ là cận trên thô với Hạng D (re-encode, dung lượng đầu ra chưa đoán được
 * — `h264_mf` có mức sàn theo nội dung, SPIKE-11). Cố ý KHÔNG thêm hệ số hiệu
 * chỉnh: Giai đoạn 2 sẽ thay bằng ước tính chính xác (encode thử vài đoạn
 * ngắn); dự đoán lệch thì lưới an toàn sau remux (`workspace.ts::processItem()`)
 * vẫn bắt được.
 *
 * `sourceBytes <= 0` (không đọc được) → coi như không vượt, không chặn nhầm.
 */
export function planSizeCap(input: { sourceBytes: number; durationSec: number; maxUploadBytes: number }): SizeCapPlan {
  const { sourceBytes, durationSec, maxUploadBytes } = input;
  if (!(sourceBytes > maxUploadBytes)) {
    return { exceedsCap: false };
  }
  return { exceedsCap: true, targetVideoBitrateBps: computeTargetVideoBitrateBps(maxUploadBytes, durationSec) };
}

/** Cần giảm tới mức này (so với dung lượng nguồn) thì nén lại vẫn gần như không
 * mất chất lượng → mặc định "Nén lại"; vượt mức này mặc định "Chia phần".
 * ĐIỂM BẮT ĐẦU, chưa có dữ liệu thật (ADR-0017 § addendum 2026-09-19 quyết định
 * #1) — chỉnh sau khi có số liệu, có thể thay bằng chỉ báo bits/pixel. */
export const REENCODE_DEFAULT_MAX_REDUCTION = 0.15;

export type SizeCapStrategy = 'reencode' | 'split';

/**
 * Chiến lược MẶC ĐỊNH của bước tiền kiểm (user vẫn đổi được ở dialog).
 * Hạng D luôn nén lại (không có stream-copy để chia). Hạng A/B/C: `r = trần ×
 * 0.92 / dung lượng nguồn`; cần giảm ≤ 15% → nén lại, ngược lại → chia phần.
 * Chưa vượt trần → `null` (không cần hỏi gì).
 */
export function chooseDefaultStrategy(input: {
  sourceBytes: number;
  maxUploadBytes: number;
  /** `true` với Hạng D (video phải re-encode sẵn). */
  mustReencode: boolean;
}): SizeCapStrategy | null {
  const { sourceBytes, maxUploadBytes, mustReencode } = input;
  if (!(sourceBytes > maxUploadBytes)) {
    return null;
  }
  if (mustReencode) {
    return 'reencode';
  }
  const reduction = 1 - (maxUploadBytes * SIZE_SAFETY_MARGIN) / sourceBytes;
  return reduction <= REENCODE_DEFAULT_MAX_REDUCTION ? 'reencode' : 'split';
}

/**
 * Chỉ báo chất lượng: bits trên pixel trên frame (`bps / (w × h × fps)`). Tham
 * số đầu vào hợp lệ mới tính, ngược lại `null`. Thang đọc: dưới ~0.05 dễ lộ
 * block ở cảnh chuyển động, ~0.1 là H.264 xem ổn — NGƯỠNG THAM KHẢO chưa hiệu
 * chỉnh trên `h264_mf`, dùng để hiển thị, không để chặn.
 */
export function bitsPerPixel(input: { bitrateBps: number; width: number; height: number; fps: number }): number | null {
  const { bitrateBps, width, height, fps } = input;
  const pixelsPerSec = width * height * fps;
  if (!(bitrateBps > 0) || !(pixelsPerSec > 0)) {
    return null;
  }
  return bitrateBps / pixelsPerSec;
}
