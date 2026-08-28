import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createEmptySyncState } from '@tsmc/shared-models';
import { appendOutbox, getSyncState, putSyncState } from './sync-store';
import { deleteSessionRecord, getSessionRecord, putSessionRecord, wipeAllData, type SessionRecord } from './session-store';

async function makeRecord(): Promise<SessionRecord> {
  const cryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  return {
    id: 'default',
    apiId: 12345,
    apiHash: 'test-hash',
    iv: crypto.getRandomValues(new Uint8Array(12)),
    ciphertext: new TextEncoder().encode('encrypted-session-bytes').buffer,
    cryptoKey
  };
}

describe('@tsmc/core-storage session store', () => {
  it('round-trips a session record through Dexie (put → get → delete)', async () => {
    const record = await makeRecord();
    await putSessionRecord(record);

    const loaded = await getSessionRecord();
    expect(loaded?.apiId).toBe(record.apiId);
    expect(loaded?.apiHash).toBe(record.apiHash);
    expect(new Uint8Array(loaded?.ciphertext ?? new ArrayBuffer(0))).toEqual(new Uint8Array(record.ciphertext));
    expect(loaded?.cryptoKey).toBeDefined();

    await deleteSessionRecord();
    expect(await getSessionRecord()).toBeUndefined();
  });

  it('overwrites the previous record on put (single-row store)', async () => {
    await putSessionRecord(await makeRecord());
    const second = await makeRecord();
    second.apiId = 999;
    await putSessionRecord(second);

    const loaded = await getSessionRecord();
    expect(loaded?.apiId).toBe(999);

    await deleteSessionRecord();
  });

  it('wipeAllData(): dọn sạch mọi bảng — luồng Đăng xuất (Màn hình 7)', async () => {
    await putSessionRecord(await makeRecord());
    await putSyncState({ ...createEmptySyncState(), settings: { theme: { val: 'dark', ts: 1, dev: 'a' } } });
    await appendOutbox({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'theme', val: 'dark' });

    await wipeAllData();

    expect(await getSessionRecord()).toBeUndefined();
    expect(await getSyncState()).toEqual(createEmptySyncState());
  });
});
