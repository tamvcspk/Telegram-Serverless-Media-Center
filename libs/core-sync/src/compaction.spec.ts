import { describe, expect, it } from 'vitest';
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
});
