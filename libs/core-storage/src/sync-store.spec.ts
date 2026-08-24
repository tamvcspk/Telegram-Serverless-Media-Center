import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { SyncEvent } from '@tsmc/shared-models';
import {
  appendOutbox,
  countOutbox,
  getSyncMeta,
  getSyncState,
  listOutbox,
  putSyncMeta,
  putSyncState,
  removeOutbox
} from './sync-store';

const sampleEvent: SyncEvent = { v: 1, op: 'settings.set', ts: 1755950400000, dev: 'dev-a', k: 'theme', val: 'dark' };

describe('@tsmc/core-storage sync store', () => {
  it('getSyncMeta(): trả về mặc định khi chưa có bản ghi', async () => {
    const meta = await getSyncMeta();
    expect(meta).toEqual({ id: 'default', deviceId: '', lastSeenMsgId: 0 });
  });

  it('putSyncMeta(): merge từng phần thay vì ghi đè toàn bộ', async () => {
    await putSyncMeta({ deviceId: 'dev-a', lastSeenMsgId: 5 });
    await putSyncMeta({ lastSeenMsgId: 9 });

    const meta = await getSyncMeta();
    expect(meta.deviceId).toBe('dev-a');
    expect(meta.lastSeenMsgId).toBe(9);
  });

  it('getSyncState()/putSyncState(): round-trip, rỗng khi chưa ghi', async () => {
    expect(await getSyncState()).toEqual({ progress: {}, collections: {}, sources: {}, settings: {} });

    await putSyncState({
      progress: { 'src:1/msg:2': { k: 'src:1/msg:2', p: 10, ts: 1, dev: 'dev-a' } },
      collections: {},
      sources: {},
      settings: {}
    });

    const state = await getSyncState();
    expect(state.progress['src:1/msg:2']?.p).toBe(10);
  });

  it('outbox: append giữ đúng thứ tự, remove xoá đúng bản ghi', async () => {
    await appendOutbox(sampleEvent);
    await appendOutbox({ ...sampleEvent, k: 'lang' });

    const before = await listOutbox();
    expect(before).toHaveLength(2);
    expect(before[0]?.event.op).toBe('settings.set');
    expect(await countOutbox()).toBe(2);

    const firstId = before[0]?.localId;
    expect(firstId).toBeDefined();
    await removeOutbox([firstId as number]);

    const after = await listOutbox();
    expect(after).toHaveLength(1);
    expect(after[0]?.localId).not.toBe(firstId);

    await removeOutbox(after.map((row) => row.localId as number));
  });
});
