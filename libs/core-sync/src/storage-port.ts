// Cổng hẹp tới IndexedDB — worker-host/core-worker.ts nối các hàm thật của
// @tsmc/core-storage vào đây. Test trong core-sync dùng fake in-memory
// (xem *.spec.ts), không kéo fake-indexeddb vào package này — việc đó đã là
// trách nhiệm của core-storage/sync-store.spec.ts.
import type { SyncEvent, SyncState } from '@tsmc/shared-models';

export interface SyncMeta {
  deviceId: string;
  stateChannelId?: string;
  stateChannelAccessHash?: string;
  lastSeenMsgId: number;
  lastSnapshotMsgId?: number;
  lastSnapshotAt?: number;
  lastSyncAt?: number;
  lastError?: string;
}

export interface OutboxEntry {
  localId: number;
  event: SyncEvent;
  createdAt: number;
}

export interface SyncStoragePort {
  getSyncMeta(): Promise<SyncMeta>;
  putSyncMeta(patch: Partial<SyncMeta>): Promise<SyncMeta>;
  getSyncState(): Promise<SyncState>;
  putSyncState(state: SyncState): Promise<void>;
  appendOutbox(event: SyncEvent): Promise<void>;
  listOutbox(): Promise<OutboxEntry[]>;
  removeOutbox(localIds: number[]): Promise<void>;
  countOutbox(): Promise<number>;
}
