import { describe, expect, it } from 'vitest';
import { createEmptySyncState } from '@tsmc/shared-models';
import { decideCompaction, maybeCompact } from './compaction';
import { createFakeGateway, createFakeStorage, makeFetchedEvent } from './test-fakes';

describe('@tsmc/core-sync decideCompaction (thuần tuý)', () => {
  it('vượt 200 event → nén, lý do event-count', () => {
    expect(decideCompaction(201, undefined)).toEqual({ shouldCompact: true, reason: 'event-count' });
  });

  it('đúng 200 event → CHƯA nén (ADR-0009: "vượt 200", không phải "đủ 200")', () => {
    expect(decideCompaction(200, 0)).toEqual({ shouldCompact: false });
  });

  it('snapshot quá 7 ngày → nén, lý do snapshot-age', () => {
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    expect(decideCompaction(1, eightDaysMs)).toEqual({ shouldCompact: true, reason: 'snapshot-age' });
  });

  it('ít event, snapshot còn mới, chưa có snapshot nào (age=undefined) → không nén', () => {
    expect(decideCompaction(5, undefined)).toEqual({ shouldCompact: false });
  });

  it('tham số maxSnapshotAgeMs tuỳ chọn ghi đè mặc định 7 ngày (Settings, ADR-0009 addendum 2026-09-15)', () => {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const twoDaysMs = 2 * oneDayMs;
    // Mặc định 7 ngày: 2 ngày tuổi CHƯA đủ nén.
    expect(decideCompaction(1, twoDaysMs)).toEqual({ shouldCompact: false });
    // Ngưỡng tuỳ chỉnh 1 ngày: cùng 2 ngày tuổi giờ ĐÃ đủ nén.
    expect(decideCompaction(1, twoDaysMs, oneDayMs)).toEqual({ shouldCompact: true, reason: 'snapshot-age' });
  });
});

describe('@tsmc/core-sync maybeCompact', () => {
  it('không có event mới → không nén dù snapshot đã quá cũ', async () => {
    const storage = createFakeStorage();
    await storage.putSyncMeta({ lastSnapshotMsgId: 10, lastSnapshotAt: Date.now() - 30 * 24 * 60 * 60 * 1000 });
    const gateway = createFakeGateway({ fetchEventsSince: async () => [] });

    const compacted = await maybeCompact(gateway, storage, 'c1');
    expect(compacted).toBe(false);
  });

  it('vượt ngưỡng event: ghim snapshot mới, xoá đúng các msgId đã nén, cập nhật con trỏ', async () => {
    const storage = createFakeStorage();
    const events = Array.from({ length: 201 }, (_, i) =>
      makeFetchedEvent({ v: 1, op: 'settings.set', ts: i, dev: 'a', k: `k${i}`, val: i }, i + 1)
    );
    let compactedIds: number[] = [];
    const gateway = createFakeGateway({
      fetchEventsSince: async () => events,
      publishSnapshot: async (_id, _snapshot, ids) => {
        compactedIds = ids;
        return { msgId: 999 };
      }
    });

    const compacted = await maybeCompact(gateway, storage, 'c1');
    expect(compacted).toBe(true);
    expect(compactedIds).toHaveLength(201);
    expect(compactedIds).toContain(201);

    const meta = await storage.getSyncMeta();
    expect(meta.lastSnapshotMsgId).toBe(999);
    expect(meta.lastSeenMsgId).toBe(999);
    expect(meta.lastSnapshotAt).toBeDefined();
  });

  it('dưới ngưỡng, snapshot còn mới → không gọi publishSnapshot', async () => {
    const storage = createFakeStorage();
    let called = false;
    const gateway = createFakeGateway({
      fetchEventsSince: async () => [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 }, 1)],
      publishSnapshot: async () => {
        called = true;
        return { msgId: 1 };
      }
    });

    const compacted = await maybeCompact(gateway, storage, 'c1');
    expect(compacted).toBe(false);
    expect(called).toBe(false);
  });

  it('ngưỡng ngày tự cấu hình ở Settings (settings.compactionMaxSnapshotAgeDays) có hiệu lực — nén SỚM hơn mặc định 7 ngày', async () => {
    const storage = createFakeStorage();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    await storage.putSyncMeta({ lastSnapshotMsgId: 10, lastSnapshotAt: Date.now() - twoDaysMs });
    await storage.putSyncState({ ...createEmptySyncState(), settings: { compactionMaxSnapshotAgeDays: { val: 1, ts: 1, dev: 'a' } } });
    const gateway = createFakeGateway({
      fetchEventsSince: async () => [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 }, 11)],
      publishSnapshot: async () => ({ msgId: 999 })
    });

    // Mặc định 7 ngày sẽ KHÔNG nén ở tuổi 2 ngày (xem test decideCompaction
    // tương ứng) — ngưỡng cấu hình 1 ngày phải khiến maybeCompact() nén.
    const compacted = await maybeCompact(gateway, storage, 'c1');
    expect(compacted).toBe(true);
  });

  it('giá trị ngưỡng hỏng (âm/NaN/không phải số) ở Settings → rơi về mặc định 7 ngày, không crash, không nén sớm', async () => {
    const storage = createFakeStorage();
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    await storage.putSyncMeta({ lastSnapshotMsgId: 10, lastSnapshotAt: Date.now() - twoDaysMs });
    await storage.putSyncState({ ...createEmptySyncState(), settings: { compactionMaxSnapshotAgeDays: { val: -5, ts: 1, dev: 'a' } } });
    const gateway = createFakeGateway({
      fetchEventsSince: async () => [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 }, 11)]
    });

    const compacted = await maybeCompact(gateway, storage, 'c1');
    expect(compacted).toBe(false);
  });
});
