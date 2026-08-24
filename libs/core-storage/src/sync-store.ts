import type { SyncEvent, SyncState } from '@tsmc/shared-models';
import { createEmptySyncState } from '@tsmc/shared-models';
import { getDb, type OutboxRecord, type SyncMetaRecord } from './session-store';

const DEFAULT_SYNC_META: SyncMetaRecord = {
  id: 'default',
  deviceId: '',
  lastSeenMsgId: 0
};

export async function getSyncMeta(): Promise<SyncMetaRecord> {
  const record = await getDb().syncMeta.get('default');
  return record ?? DEFAULT_SYNC_META;
}

export async function putSyncMeta(patch: Partial<Omit<SyncMetaRecord, 'id'>>): Promise<SyncMetaRecord> {
  const current = await getSyncMeta();
  const next: SyncMetaRecord = { ...current, ...patch, id: 'default' };
  await getDb().syncMeta.put(next);
  return next;
}

export async function getSyncState(): Promise<SyncState> {
  const record = await getDb().syncState.get('default');
  return record?.state ?? createEmptySyncState();
}

export async function putSyncState(state: SyncState): Promise<void> {
  await getDb().syncState.put({ id: 'default', state });
}

export async function appendOutbox(event: SyncEvent): Promise<void> {
  await getDb().outbox.add({ event, createdAt: Date.now() });
}

export async function listOutbox(): Promise<OutboxRecord[]> {
  return getDb().outbox.orderBy('localId').toArray();
}

export async function removeOutbox(localIds: number[]): Promise<void> {
  await getDb().outbox.bulkDelete(localIds);
}

export async function countOutbox(): Promise<number> {
  return getDb().outbox.count();
}
