// Chia file thành nhiều phần — Giai đoạn 4 (ADR-0017 § addendum 2026-09-19
// quyết định #4-5, ADR-0022). Hàm thuần: chọn điểm cắt từ danh sách keyframe
// Rust trả về (`ingest-ffmpeg::scan_keyframes`); Rust chỉ liệt kê ứng viên và
// thực thi cắt (điều kiện bắt buộc #4 — luật nghiệp vụ nằm ở đây).
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { composeCaption } from './caption-hashtags';

/** Một keyframe có thể làm điểm cắt. `sceneScore`/`silent` là tín hiệu TUỲ CHỌN
 * (ADR-0017 addendum #5: ưu tiên chuyển cảnh + im lặng quanh vị trí lý tưởng) —
 * Rust chưa điền, chọn điểm cắt hiện chỉ dựa vào vị trí byte. */
export interface SplitCandidate {
  timeSec: number;
  /** Byte tích luỹ của mọi packet đứng trước keyframe (xấp xỉ dung lượng phần đứng trước). */
  byteOffset: number;
  /** 0..1, cao = giống chuyển cảnh. */
  sceneScore?: number;
  /** Có đoạn im lặng quanh điểm này (cắt âm thanh giữa câu lộ hơn cắt hình). */
  silent?: boolean;
}

/** Nhắm dưới trần một chút — kích thước phần chính xác đến byte nên chỉ cần
 * chừa chỗ cho moov mỗi phần + sai lệch xấp xỉ (ADR-0017 addendum #5: ~1-3%,
 * không phải 8% như nén lại). 3% của trần 4 GB ≈ 120 MB, dư cho moov vài MB. */
export const SPLIT_SAFETY_MARGIN = 0.97;

/** Khớp `MAX_PARTS` của schema catalog (ADR-0022 §2). */
export const MAX_SPLIT_PARTS = 50;

/** Tín hiệu chuyển cảnh/im lặng chỉ để PHÁ HOÀ giữa các keyframe gần như ngang
 * nhau về dung lượng — mỗi tín hiệu bù tối đa chừng này tỉ lệ `maxPartBytes`
 * lệch khỏi mốc chia đều, không bao giờ lấn át ràng buộc dung lượng. */
const SIGNAL_BONUS_FRACTION = 0.02;

export interface SplitPart {
  startSec: number;
  endSec: number;
  /** Dung lượng xấp xỉ (byte) — dung lượng thật đo lại sau khi cắt. */
  approxBytes: number;
}

export type SplitPlan =
  | { ok: true; cuts: SplitCandidate[]; parts: SplitPart[] }
  | { ok: false; reason: 'no-keyframes' | 'too-many-parts' | 'cannot-fit' };

function signalBonus(c: SplitCandidate, maxPartBytes: number): number {
  const scene = Math.max(0, Math.min(1, c.sceneScore ?? 0));
  return (scene + (c.silent ? 1 : 0)) * SIGNAL_BONUS_FRACTION * maxPartBytes;
}

/** Thử chia đúng `count` phần; null nếu không có cách đặt điểm cắt nào thoả ràng buộc. */
function tryPlan(keyframes: SplitCandidate[], totalBytes: number, durationSec: number, count: number, limitBytes: number, maxPartBytes: number): SplitPlan | null {
  const cuts: SplitCandidate[] = [];
  let prevOffset = 0;
  for (let k = 1; k < count; k++) {
    const ideal = (totalBytes * k) / count;
    // Phần đứng trước điểm cắt phải ≤ limit; phần còn lại phía sau cũng phải còn
    // đủ chỗ trong (count - k) phần còn lại.
    const minOffset = Math.max(prevOffset + 1, totalBytes - (count - k) * limitBytes);
    const maxOffset = prevOffset + limitBytes;
    let best: SplitCandidate | null = null;
    let bestCost = Infinity;
    for (const c of keyframes) {
      if (c.byteOffset < minOffset || c.byteOffset > maxOffset || c.timeSec <= (cuts.at(-1)?.timeSec ?? 0)) {
        continue;
      }
      const cost = Math.abs(c.byteOffset - ideal) - signalBonus(c, maxPartBytes);
      if (cost < bestCost) {
        best = c;
        bestCost = cost;
      }
    }
    if (!best) {
      return null;
    }
    cuts.push(best);
    prevOffset = best.byteOffset;
  }

  const bounds = [{ timeSec: 0, byteOffset: 0 }, ...cuts, { timeSec: durationSec, byteOffset: totalBytes }];
  const parts: SplitPart[] = [];
  for (let i = 0; i < count; i++) {
    parts.push({ startSec: bounds[i].timeSec, endSec: bounds[i + 1].timeSec, approxBytes: bounds[i + 1].byteOffset - bounds[i].byteOffset });
  }
  return parts.every((p) => p.approxBytes <= limitBytes) ? { ok: true, cuts, parts } : null;
}

/**
 * Chia ĐỀU (4.3 GB → 2 × 2.15 GB, không phải 3.9 + 0.4): bắt đầu từ số phần tối
 * thiểu `ceil(tổng / (trần × margin))`, đặt mỗi điểm cắt tại keyframe gần mốc chia
 * đều nhất (kèm bù nhẹ cho chuyển cảnh/im lặng); không thoả ràng buộc thì tăng
 * thêm một phần, tối đa `MAX_SPLIT_PARTS`.
 */
export function planSplit(input: { keyframes: SplitCandidate[]; totalBytes: number; durationSec: number; maxUploadBytes: number }): SplitPlan {
  const { totalBytes, durationSec, maxUploadBytes } = input;
  // Keyframe ở đúng 0 không phải điểm cắt hợp lệ; sắp theo thời gian cho chắc.
  const keyframes = input.keyframes.filter((c) => c.timeSec > 0 && c.byteOffset > 0).sort((a, b) => a.timeSec - b.timeSec);
  const limitBytes = maxUploadBytes * SPLIT_SAFETY_MARGIN;
  const minCount = Math.max(2, Math.ceil(totalBytes / limitBytes));
  if (keyframes.length === 0) {
    return { ok: false, reason: 'no-keyframes' };
  }
  if (minCount > MAX_SPLIT_PARTS) {
    return { ok: false, reason: 'too-many-parts' };
  }
  for (let count = minCount; count <= Math.min(MAX_SPLIT_PARTS, keyframes.length + 1); count++) {
    const plan = tryPlan(keyframes, totalBytes, durationSec, count, limitBytes, maxUploadBytes);
    if (plan) {
      return plan;
    }
  }
  return { ok: false, reason: 'cannot-fit' };
}

/** Tên file phần: `X.partIofN.mp4` — quy ước ADR-0022 §3/§4 (quét mồ côi và T2/T3 nhận diện phần qua đây). */
export function partFileName(baseName: string, index: number, count: number): string {
  return `${baseName}.part${index}of${count}.mp4`;
}

const PART_NAME_PATTERN = /^(.*)\.part(\d+)of(\d+)\.[A-Za-z0-9]+$/;

/** Nhận diện tên file phần; null nếu không theo quy ước (index 1..count). */
export function parsePartFileName(fileName: string): { baseName: string; index: number; count: number } | null {
  const m = PART_NAME_PATTERN.exec(fileName);
  if (!m) {
    return null;
  }
  const index = Number(m[2]);
  const count = Number(m[3]);
  return index >= 1 && count >= 2 && index <= count ? { baseName: m[1], index, count } : null;
}

/** Caption một phần: "Tiêu đề — Phần i/N" + cùng dòng hashtag với phần 1 (ADR-0022 §3). */
export function composePartCaption(item: CatalogItemV1, index: number, count: number): string {
  const suffix = `Phần ${index}/${count}`;
  return composeCaption({ ...item, title: item.title ? `${item.title} — ${suffix}` : suffix });
}
