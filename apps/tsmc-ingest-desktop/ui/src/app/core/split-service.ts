// Điều phối "quét keyframe → đo tín hiệu quanh vị trí cắt → chọn điểm cắt" cho
// tính năng Chia phần (ADR-0022). Dùng chung bởi `workspace.ts` (đường tự động lúc
// upload) và dialog tiền kiểm (editor điểm cắt). Luật nghiệp vụ nằm ở
// `@tsmc/core-ingest` (`planSplit()`, `applySignals()`...); file này chỉ nối RPC với
// các hàm thuần đó.
import { applySignals, planSplit, signalCandidateTimes, type SplitCandidate, type SplitPlan } from '@tsmc/core-ingest';
import { analyzeCutSignals, scanSplitCandidates, toIngestRpcError } from './ingest-rpc';
import type { SplitScanDto } from './ingest-rpc.types';
import { formatBytesShort } from './format';

export interface SplitAnalysis {
  scan: SplitScanDto;
  /** Keyframe ứng viên, đã gắn tín hiệu (`sceneScore`/`silent`) ở nơi đo được. */
  keyframes: SplitCandidate[];
  /** Kế hoạch tự động trên `keyframes`. */
  plan: SplitPlan;
}

/** Quét keyframe của `path` (file nguồn hoặc đã remux). */
export async function scanKeyframes(taskId: string, path: string): Promise<{ scan: SplitScanDto; keyframes: SplitCandidate[] }> {
  const scan = await scanSplitCandidates(taskId, path);
  return { scan, keyframes: scan.keyframes.map((k) => ({ timeSec: k.time_sec, byteOffset: k.byte_offset })) };
}

/**
 * Đo tín hiệu (chuyển cảnh/im lặng) quanh mốc chia đều rồi lập kế hoạch tự động. Đo là
 * TUỲ CHỌN: lỗi đo (không phải huỷ) chỉ làm mất bonus, không làm hỏng việc chia — điểm cắt
 * khi đó chỉ dựa vào vị trí byte. Huỷ (`Cancelled`) vẫn nổi lên cho tầng gọi. Tách khỏi
 * `scanKeyframes()` để editor mở được NGAY sau khi quét, phân tích để sau.
 */
export async function analyzeAndPlan(
  taskId: string,
  path: string,
  input: { keyframes: SplitCandidate[]; totalBytes: number; durationSec: number },
  maxUploadBytes: number
): Promise<{ keyframes: SplitCandidate[]; plan: SplitPlan }> {
  let keyframes = input.keyframes;
  const times = signalCandidateTimes({ keyframes, totalBytes: input.totalBytes, maxUploadBytes });
  if (times.length > 0) {
    try {
      const signals = await analyzeCutSignals(taskId, path, times);
      keyframes = applySignals(
        keyframes,
        signals.map((s) => ({ timeSec: s.time_sec, sceneDiff: s.scene_diff, audioRmsDb: s.audio_rms_db }))
      );
    } catch (err) {
      if (toIngestRpcError(err).kind === 'Cancelled') {
        throw err;
      }
    }
  }
  return { keyframes, plan: planSplit({ keyframes, totalBytes: input.totalBytes, durationSec: input.durationSec, maxUploadBytes }) };
}

/** Quét → đo tín hiệu → lập kế hoạch (đường tự động lúc upload, không có UI). */
export async function scanAndPlan(taskId: string, path: string, maxUploadBytes: number): Promise<SplitAnalysis> {
  const { scan, keyframes: raw } = await scanKeyframes(taskId, path);
  const { keyframes, plan } = await analyzeAndPlan(taskId, path, { keyframes: raw, totalBytes: scan.total_packet_bytes, durationSec: scan.duration_sec }, maxUploadBytes);
  return { scan, keyframes, plan };
}

export function describeSplitFailure(reason: 'no-keyframes' | 'too-many-parts' | 'cannot-fit', fileBytes: number, maxBytes: number): string {
  const size = `${formatBytesShort(fileBytes)} (trần ${formatBytesShort(maxBytes)})`;
  switch (reason) {
    case 'no-keyframes':
      return `Không tìm thấy keyframe nào để cắt file ${size}. Thử "Nén lại" cho file này.`;
    case 'too-many-parts':
      return `File ${size} cần quá nhiều phần để chia (tối đa 50). Thử "Nén lại" cho file này.`;
    case 'cannot-fit':
      return `Keyframe của file ${size} quá thưa để chia đều dưới trần. Thử "Nén lại" cho file này.`;
  }
}

/** `h:mm:ss` cho thời điểm trong editor điểm cắt. */
export function formatHms(totalSec: number): string {
  const t = Math.max(0, Math.round(totalSec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}
