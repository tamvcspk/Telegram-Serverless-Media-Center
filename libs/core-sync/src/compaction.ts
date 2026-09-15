// Nén snapshot — ADR-0009 "Compaction". Chỉ tab leader gọi (sync-engine.ts
// gate qua leader trước khi gọi maybeCompact).
import type { SnapshotV1, SyncState } from '@tsmc/shared-models';
import type { SyncGateway } from './gateway-port';
import type { SyncStoragePort } from './storage-port';

// Lưới an toàn cứng — KHÔNG cấu hình được (roadmap.md § Sync & dữ liệu:
// "Ngưỡng >200 event vẫn giữ làm lưới an toàn cứng — không đổi, không cấu
// hình được, đảm bảo dùng nặng vẫn nén dù chưa tới hạn ngày").
const COMPACTION_EVENT_THRESHOLD = 200;
// Mặc định ADR-0009 ("Compaction": "snapshot cũ hơn 7 ngày") — GIỮ NGUYÊN
// giá trị mặc định này. `maybeCompact()` (dưới) cho phép user CHỈNH ngưỡng
// này qua Settings (key đồng bộ `compactionMaxSnapshotAgeDays`, cùng cơ chế
// `maxConcurrency` đã có) — đây là thêm KHẢ NĂNG cấu hình, không đổi giá trị
// mặc định, nên không cần addendum riêng cho phần này theo quy tắc ở
// docs/adr/README.md (chỉ đổi MẶC ĐỊNH mới cần) — xem ADR-0009 addendum
// 2026-09-15 để biết chi tiết đầy đủ.
export const DEFAULT_COMPACTION_MAX_SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_COMPACTION_MAX_SNAPSHOT_AGE_DAYS = 1;
const MAX_COMPACTION_MAX_SNAPSHOT_AGE_DAYS = 90;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface CompactionDecision {
  shouldCompact: boolean;
  reason?: 'event-count' | 'snapshot-age';
}

/** Quyết định thuần tuý, test được không cần gateway/storage. `maxSnapshotAgeMs`
 * mặc định `DEFAULT_COMPACTION_MAX_SNAPSHOT_AGE_MS` (7 ngày, ADR-0009) — truyền
 * riêng khi đã đọc được ngưỡng user tự cấu hình (xem `maybeCompact()`). */
export function decideCompaction(
  eventCountSinceSnapshot: number,
  snapshotAgeMs: number | undefined,
  maxSnapshotAgeMs: number = DEFAULT_COMPACTION_MAX_SNAPSHOT_AGE_MS
): CompactionDecision {
  if (eventCountSinceSnapshot > COMPACTION_EVENT_THRESHOLD) {
    return { shouldCompact: true, reason: 'event-count' };
  }
  if (snapshotAgeMs !== undefined && snapshotAgeMs > maxSnapshotAgeMs) {
    return { shouldCompact: true, reason: 'snapshot-age' };
  }
  return { shouldCompact: false };
}

/** Đọc ngưỡng nén (tính bằng ngày) user tự cấu hình ở Settings (đồng bộ qua
 * `settings.set`, key `compactionMaxSnapshotAgeDays` — cùng cơ chế
 * `maxConcurrency`, KHÔNG export hằng key này để dùng chung: quy ước đã có
 * của repo là lặp lại literal string ở đầu đọc/đầu ghi, xem cách
 * `apps/web/src/app/settings/settings.ts` dùng `'maxConcurrency'`). Chưa
 * cấu hình, hoặc giá trị hỏng (NaN/âm/không phải số — dữ liệu này tự thiết
 * bị khác ghi, không tin tuyệt đối) → mặc định. Có cấu hình → kẹp về
 * [1, 90] ngày, phòng một thiết bị lỡ ghi giá trị vô lý làm nén chạy liên
 * tục (quá thấp) hoặc không bao giờ chạy theo tuổi (quá cao). */
function readConfiguredMaxSnapshotAgeMs(state: SyncState): number {
  const raw = state.settings['compactionMaxSnapshotAgeDays']?.val;
  // <= 0 KHÔNG được coi là "cấu hình cực đoan cần kẹp" — đó không phải một
  // khoảng thời gian hợp lệ theo bất kỳ nghĩa nào (khác trường hợp "200
  // ngày", nơi kẹp về 90 vẫn giữ đúng Ý ĐỊNH "để lâu hơn mặc định"). Coi như
  // dữ liệu hỏng, rơi về mặc định thay vì âm thầm biến thành "1 ngày" — một
  // hành vi không ai yêu cầu.
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_COMPACTION_MAX_SNAPSHOT_AGE_MS;
  }
  const clampedDays = Math.min(MAX_COMPACTION_MAX_SNAPSHOT_AGE_DAYS, Math.max(MIN_COMPACTION_MAX_SNAPSHOT_AGE_DAYS, raw));
  return clampedDays * MS_PER_DAY;
}

/**
 * Đọc event kể từ snapshot hiện tại, quyết định có nén không, và nếu có thì
 * đăng snapshot mới (ghim trước) rồi xoá event đã nén — thứ tự này khớp
 * ADR-0009 "ghim trước, xoá sau" (nằm trong hợp đồng
 * gateway.publishSnapshot: pin rồi mới delete). Trả về true nếu đã nén.
 */
export async function maybeCompact(gateway: SyncGateway, storage: SyncStoragePort, channelId: string): Promise<boolean> {
  const meta = await storage.getSyncMeta();
  const baseMsgId = meta.lastSnapshotMsgId ?? 0;
  // Đọc TRƯỚC quyết định (không chỉ lúc build snapshot bên dưới) — cần
  // `state.settings` để biết ngưỡng ngày user tự cấu hình (nếu có).
  const state = await storage.getSyncState();

  const events = await gateway.fetchEventsSince(channelId, baseMsgId);
  const snapshotAgeMs = meta.lastSnapshotAt !== undefined ? Date.now() - meta.lastSnapshotAt : undefined;
  const decision = decideCompaction(events.length, snapshotAgeMs, readConfiguredMaxSnapshotAgeMs(state));

  if (!decision.shouldCompact || events.length === 0) {
    return false;
  }

  const highestMsgId = Math.max(baseMsgId, ...events.map((e) => e.msgId));
  const snapshot: SnapshotV1 = { v: 1, state, baseMsgId: highestMsgId };

  const published = await gateway.publishSnapshot(
    channelId,
    snapshot,
    events.map((e) => e.msgId)
  );

  await storage.putSyncMeta({
    lastSnapshotMsgId: published.msgId,
    lastSnapshotAt: Date.now(),
    lastSeenMsgId: published.msgId
  });
  return true;
}
