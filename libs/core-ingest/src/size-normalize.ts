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
const SIZE_SAFETY_MARGIN = 0.92;

/** Sàn cứng — dưới mức này hình gần như vô dụng; nếu vẫn vượt trần thì để bước
 * kiểm tra dung lượng sau re-encode báo lỗi rõ ràng thay vì hạ thêm. */
export const MIN_VIDEO_BITRATE_BPS = 100_000;

/**
 * `target_video_bitrate = (maxBytes * margin * 8 / duration) * (1 - overhead) - audio_bitrate`,
 * kẹp dưới bởi `MIN_VIDEO_BITRATE_BPS`. `durationSec <= 0` (probe không đọc
 * được) trả về sàn — không chia cho 0.
 */
export function computeTargetVideoBitrateBps(maxUploadBytes: number, durationSec: number): number {
  if (!(durationSec > 0)) {
    return MIN_VIDEO_BITRATE_BPS;
  }
  const totalBudgetBps = (maxUploadBytes * SIZE_SAFETY_MARGIN * 8) / durationSec;
  const videoBudgetBps = totalBudgetBps * (1 - MUX_OVERHEAD_FRACTION) - REENCODE_AUDIO_BITRATE_BPS;
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
