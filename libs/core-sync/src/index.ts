// Event log, replay, snapshot compaction — ADR-0009. Chạy trong Core
// Worker. Không import @tsmc/core-mtproto (xem gateway-port.ts) — nhận
// gateway/storage thật qua tham số, worker-host/core-worker.ts nối dây.
export const LIB_NAME = '@tsmc/core-sync' as const;

export { createSyncEngine } from './sync-engine';
export type { SyncEngine, SyncEngineOptions, SyncStatus } from './sync-engine';

export type { SyncGateway, FetchedEvent, PublishedMessage } from './gateway-port';
export type { SyncStoragePort, SyncMeta, OutboxEntry } from './storage-port';

export {
  createLeaderController,
  type LeaderController,
  type LockManagerLike,
  type BroadcastChannelLike
} from './leader';

export { applyEvent, applySnapshot, mergeStates, replay } from './reducer';
export { resolveStateChannel, resolveChannelFromLink, hydrate, hydrateWithMerge } from './hydrate';
export type { ChannelResolution, ResolvedChannel, HydrationResult } from './hydrate';
export { decideCompaction, maybeCompact } from './compaction';
export type { CompactionDecision } from './compaction';
export { ensureDeviceId } from './device-id';
