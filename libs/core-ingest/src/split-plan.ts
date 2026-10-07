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

  const parts = splitPartsFromCuts(cuts, totalBytes, durationSec);
  return parts.every((p) => p.approxBytes <= limitBytes) ? { ok: true, cuts, parts } : null;
}

/** Các phần tạo ra từ danh sách điểm cắt (đã sắp tăng dần). */
export function splitPartsFromCuts(cuts: SplitCandidate[], totalBytes: number, durationSec: number): SplitPart[] {
  const bounds = [{ timeSec: 0, byteOffset: 0 }, ...cuts, { timeSec: durationSec, byteOffset: totalBytes }];
  return Array.from({ length: bounds.length - 1 }, (_, i) => ({ startSec: bounds[i].timeSec, endSec: bounds[i + 1].timeSec, approxBytes: bounds[i + 1].byteOffset - bounds[i].byteOffset }));
}

/** Một phần có vừa trần × margin không (dùng chung dialog editor và kiểm tra sau remux). */
export function partFits(part: SplitPart, maxUploadBytes: number): boolean {
  return part.approxBytes <= maxUploadBytes * SPLIT_SAFETY_MARGIN;
}

/** Số đo thô Rust trả về quanh một ứng viên (`analyze_cut_signals`). */
export interface SplitSignal {
  timeSec: number;
  /** Độ lệch luma 0..1 giữa frame trước và frame tại keyframe; null = không đo được. */
  sceneDiff: number | null;
  /** RMS audio quanh keyframe (dBFS); null = không đo được/không có audio. */
  audioRmsDb: number | null;
}

/** Độ lệch luma từ mức này trở lên coi là chuyển cảnh "chắc chắn" (sceneScore = 1).
 * Đo trên fixture: cảnh liền ≈ 0.005–0.01, chuyển cảnh cứng ≈ 0.22. Ngưỡng THAM
 * KHẢO — chưa hiệu chỉnh trên phim thật. */
export const SCENE_DIFF_FULL = 0.2;

/** RMS (dBFS) dưới mức này coi là im lặng. Thoại thường nghỉ ở −50…−60 dB, tiếng
 * nền/nhạc nền thường > −35. THAM KHẢO, chưa hiệu chỉnh. */
export const SILENCE_RMS_DB = -45;

/** Gắn `sceneScore`/`silent` cho các keyframe có số đo (khớp theo thời điểm). */
export function applySignals(keyframes: SplitCandidate[], signals: SplitSignal[]): SplitCandidate[] {
  const byTime = new Map(signals.map((s) => [s.timeSec, s]));
  return keyframes.map((k) => {
    const s = byTime.get(k.timeSec);
    if (!s) {
      return k;
    }
    return {
      ...k,
      ...(s.sceneDiff === null ? {} : { sceneScore: Math.max(0, Math.min(1, s.sceneDiff / SCENE_DIFF_FULL)) }),
      ...(s.audioRmsDb === null ? {} : { silent: s.audioRmsDb < SILENCE_RMS_DB })
    };
  });
}

/**
 * Thời điểm các keyframe cần ĐO tín hiệu: với mỗi điểm cắt lý tưởng (chia đều tối
 * thiểu), tối đa `perCut` keyframe gần nhất nằm trong cửa sổ mà bonus tín hiệu có
 * thể tác động (±2 × `SIGNAL_BONUS_FRACTION` × trần byte) — chỉ phân tích quanh vị
 * trí cắt, không quét cả phim.
 */
export function signalCandidateTimes(input: { keyframes: SplitCandidate[]; totalBytes: number; maxUploadBytes: number; perCut?: number }): number[] {
  const { keyframes, totalBytes, maxUploadBytes, perCut = 20 } = input;
  const count = Math.max(2, Math.ceil(totalBytes / (maxUploadBytes * SPLIT_SAFETY_MARGIN)));
  const window = 2 * SIGNAL_BONUS_FRACTION * maxUploadBytes;
  const times = new Set<number>();
  for (let k = 1; k < count; k++) {
    const ideal = (totalBytes * k) / count;
    keyframes
      .filter((c) => Math.abs(c.byteOffset - ideal) <= window)
      .sort((a, b) => Math.abs(a.byteOffset - ideal) - Math.abs(b.byteOffset - ideal))
      .slice(0, perCut)
      .forEach((c) => times.add(c.timeSec));
  }
  return [...times].sort((a, b) => a - b);
}

/**
 * Các keyframe có thể thay cho điểm cắt `index` mà KHÔNG làm phần nào vượt trần
 * (hai phần liền kề điểm cắt đó vẫn ≤ trần × margin, giữ nguyên các điểm cắt khác).
 * Sắp theo thời gian; gồm cả điểm cắt hiện tại nếu hợp lệ.
 */
export function alternativeCuts(input: { keyframes: SplitCandidate[]; cuts: SplitCandidate[]; index: number; totalBytes: number; maxUploadBytes: number }): SplitCandidate[] {
  const { keyframes, cuts, index, totalBytes, maxUploadBytes } = input;
  const limit = maxUploadBytes * SPLIT_SAFETY_MARGIN;
  const prev = index > 0 ? cuts[index - 1] : { timeSec: 0, byteOffset: 0 };
  const next = index < cuts.length - 1 ? cuts[index + 1] : { timeSec: Number.POSITIVE_INFINITY, byteOffset: totalBytes };
  return keyframes
    .filter((c) => c.timeSec > prev.timeSec && c.timeSec < next.timeSec && c.byteOffset - prev.byteOffset <= limit && next.byteOffset - c.byteOffset <= limit)
    .sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Ánh xạ điểm cắt do user chọn (thời điểm, từ lần quét nguồn) sang keyframe của lần
 * quét SAU remux (cùng thời điểm khi stream-copy; dung sai `toleranceSec`) rồi kiểm
 * dung lượng thật. Trả `null` nếu có điểm cắt không còn keyframe tương ứng hoặc phần
 * nào vượt trần — tầng gọi rơi về `planSplit()` tự động.
 */
export function planFromCutTimes(input: { keyframes: SplitCandidate[]; cutTimesSec: number[]; totalBytes: number; durationSec: number; maxUploadBytes: number; toleranceSec?: number }): SplitPlan | null {
  const { keyframes, cutTimesSec, totalBytes, durationSec, maxUploadBytes, toleranceSec = 0.05 } = input;
  const cuts: SplitCandidate[] = [];
  for (const t of [...cutTimesSec].sort((a, b) => a - b)) {
    const nearest = keyframes.reduce<SplitCandidate | null>((best, c) => (best === null || Math.abs(c.timeSec - t) < Math.abs(best.timeSec - t) ? c : best), null);
    if (!nearest || Math.abs(nearest.timeSec - t) > toleranceSec || (cuts.length > 0 && nearest.timeSec <= cuts[cuts.length - 1].timeSec)) {
      return null;
    }
    cuts.push(nearest);
  }
  if (cuts.length === 0) {
    return null;
  }
  const parts = splitPartsFromCuts(cuts, totalBytes, durationSec);
  return parts.every((p) => partFits(p, maxUploadBytes)) ? { ok: true, cuts, parts } : null;
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

/** Keyframe gần `timeSec` nhất (null nếu không có keyframe nào). */
export function nearestKeyframe(keyframes: SplitCandidate[], timeSec: number): SplitCandidate | null {
  return keyframes.reduce<SplitCandidate | null>((best, c) => (best === null || Math.abs(c.timeSec - timeSec) < Math.abs(best.timeSec - timeSec) ? c : best), null);
}

/**
 * Thêm một điểm cắt tại `candidate` (một keyframe). Từ chối (null) nếu trùng điểm cắt đã có,
 * ở đúng đầu phim, hoặc sẽ vượt `MAX_SPLIT_PARTS`. Tách một phần thành hai nên luôn làm các
 * phần nhỏ đi — không bao giờ tạo phần vượt trần.
 */
export function addCut(cuts: SplitCandidate[], candidate: SplitCandidate): SplitCandidate[] | null {
  if (candidate.timeSec <= 0 || candidate.byteOffset <= 0 || cuts.some((c) => c.timeSec === candidate.timeSec) || cuts.length + 2 > MAX_SPLIT_PARTS) {
    return null;
  }
  return [...cuts, candidate].sort((a, b) => a.timeSec - b.timeSec);
}

/** Bỏ điểm cắt `index` gộp hai phần kề thành một — chỉ được nếu phần gộp vẫn vừa trần × margin và còn ít nhất một điểm cắt. */
export function canRemoveCut(input: { cuts: SplitCandidate[]; index: number; totalBytes: number; durationSec: number; maxUploadBytes: number }): boolean {
  const { cuts, index, totalBytes, durationSec, maxUploadBytes } = input;
  if (cuts.length < 2 || index < 0 || index >= cuts.length) {
    return false;
  }
  const merged = splitPartsFromCuts(
    cuts.filter((_, i) => i !== index),
    totalBytes,
    durationSec
  );
  return merged.every((p) => partFits(p, maxUploadBytes));
}

export function removeCut(cuts: SplitCandidate[], index: number): SplitCandidate[] {
  return cuts.filter((_, i) => i !== index);
}

export type CutMoveCheck = { ok: true } | { ok: false; reason: 'same' | 'order' | 'too-big' };

/**
 * Có dời được điểm cắt `index` sang `candidate` (một keyframe) không: `same` = đã đúng vị trí đó; `order` = sẽ
 * trùng/vượt qua điểm cắt kế bên (hoặc đầu/cuối phim); `too-big` = có phần vượt trần × margin.
 */
export function checkCutMove(input: { cuts: SplitCandidate[]; index: number; candidate: SplitCandidate; totalBytes: number; durationSec: number; maxUploadBytes: number }): CutMoveCheck {
  const { cuts, index, candidate, totalBytes, durationSec, maxUploadBytes } = input;
  if (candidate.timeSec === cuts[index]?.timeSec) {
    return { ok: false, reason: 'same' };
  }
  const prev = index > 0 ? cuts[index - 1].timeSec : 0;
  const next = index < cuts.length - 1 ? cuts[index + 1].timeSec : Number.POSITIVE_INFINITY;
  if (candidate.timeSec <= prev || candidate.timeSec >= next || candidate.byteOffset <= 0) {
    return { ok: false, reason: 'order' };
  }
  const moved = cuts.map((c, i) => (i === index ? candidate : c));
  return splitPartsFromCuts(moved, totalBytes, durationSec).every((p) => partFits(p, maxUploadBytes)) ? { ok: true } : { ok: false, reason: 'too-big' };
}
