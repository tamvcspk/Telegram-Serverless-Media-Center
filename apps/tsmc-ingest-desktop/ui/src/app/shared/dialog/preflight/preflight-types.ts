// Kiểu dữ liệu ra/vào dialog tiền kiểm (ADR-0017 § addendum 2026-09-19 "kế hoạch", ADR-0022).
// Tách khỏi component để workspace/dialog.service import mà không kéo cả UI theo.
import type { CompatRank, ReencodePlan } from '@tsmc/core-ingest';

export interface PreflightDialogItem {
  path: string;
  name: string;
  /** Dung lượng file NGUỒN (cũng là dự đoán đầu ra của Hạng A/B/C). */
  sourceBytes: number;
  durationSec: number;
  /** Số liệu video nguồn — 0 nếu probe không đọc được (chỉ báo chất lượng/tự chọn độ phân giải tắt, không chặn gì). */
  width: number;
  height: number;
  fps: number;
  rank: CompatRank;
  /** Dự đoán vượt trần upload nếu upload nguyên. */
  overCap: boolean;
}

export interface PreflightDialogData {
  /** MỌI file đã chọn upload — file không cần quyết định gì vẫn có mặt (`upload nguyên`). */
  items: PreflightDialogItem[];
  maxUploadBytes: number;
}

/** Hạng D: video bắt buộc re-encode, không có đường stream-copy để chia. */
export function mustReencode(item: PreflightDialogItem): boolean {
  return item.rank === 'D';
}

/** Cần user quyết định: vượt trần, hoặc Hạng D (re-encode chậm — luôn phải xác nhận). */
export function needsDecision(item: PreflightDialogItem): boolean {
  return item.overCap || mustReencode(item);
}

/** Quyết định cho MỘT file được chạy. File bị "Bỏ qua" không có mặt trong `choices` (ở lại bảng metadata).
 * - `upload`: upload nguyên, không xử lý thêm.
 * - `reencode`: nén lại với tham số `plan` (`plan` rỗng = Hạng D, để bộ nén tự chọn).
 * - `split`: chia phần; `cutTimesSec` = điểm cắt (giây, thời điểm keyframe) user đã chốt, bỏ trống = tự động lúc upload. */
export type PreflightChoice =
  | { path: string; strategy: 'upload' }
  | { path: string; strategy: 'reencode'; plan: ReencodePlan }
  | { path: string; strategy: 'split'; cutTimesSec?: number[] };

export interface PreflightDialogResult {
  choices: PreflightChoice[];
}
