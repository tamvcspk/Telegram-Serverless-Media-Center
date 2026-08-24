// Fakes dùng chung cho *.spec.ts trong package này — KHÔNG phải file test
// (không khớp include pattern */src/**/*.spec.ts của libs/vitest.config.ts).
import { createEmptySyncState, type SnapshotV1, type StateChannelCandidate, type SyncEvent, type SyncEventInput } from '@tsmc/shared-models';
import type { FetchedEvent, PublishedMessage, SyncGateway } from './gateway-port';
import type { LeaderController } from './leader';
import type { OutboxEntry, SyncMeta, SyncStoragePort } from './storage-port';

export function createFakeLeader(
  isLeaderInitially: boolean
): LeaderController & { forwarded: SyncEventInput[]; triggerForwarded(input: SyncEventInput): void; setLeader(v: boolean): void } {
  let leader = isLeaderInitially;
  let handler: ((input: SyncEventInput) => void) | undefined;
  let leaderChangeHandler: ((isLeader: boolean) => void) | undefined;
  const forwarded: SyncEventInput[] = [];
  return {
    isLeader: () => leader,
    onLeaderChange(h) {
      leaderChangeHandler = h;
      if (leader) {
        h(true);
      }
    },
    onForwardedMutation(h) {
      handler = h;
    },
    forwardMutation(input) {
      forwarded.push(input);
    },
    stop() {},
    forwarded,
    triggerForwarded(input) {
      handler?.(input);
    },
    setLeader(v) {
      leader = v;
      if (v) {
        leaderChangeHandler?.(true);
      }
    }
  };
}

export function createFakeGateway(overrides: Partial<SyncGateway> = {}): SyncGateway {
  let nextMsgId = 1;
  return {
    listOwnStateChannelCandidates: async () => [],
    getChannelById: async () => null,
    createStateChannel: async () => ({ id: 'new-channel', accessHash: 'hash' }),
    sendEvent: async () => ({ msgId: nextMsgId++ }),
    fetchEventsSince: async () => [],
    fetchPinnedSnapshot: async () => null,
    publishSnapshot: async () => ({ msgId: nextMsgId++ }),
    serverNow: () => Date.now(),
    ...overrides
  };
}

export function createFakeStorage(): SyncStoragePort {
  let meta: SyncMeta = { deviceId: '', lastSeenMsgId: 0 };
  let state = createEmptySyncState();
  let outbox: OutboxEntry[] = [];
  let nextLocalId = 1;

  return {
    async getSyncMeta() {
      return meta;
    },
    async putSyncMeta(patch) {
      meta = { ...meta, ...patch };
      return meta;
    },
    async getSyncState() {
      return state;
    },
    async putSyncState(next) {
      state = next;
    },
    async appendOutbox(event: SyncEvent) {
      outbox.push({ localId: nextLocalId++, event, createdAt: Date.now() });
    },
    async listOutbox() {
      return [...outbox];
    },
    async removeOutbox(localIds: number[]) {
      const toRemove = new Set(localIds);
      outbox = outbox.filter((entry) => !toRemove.has(entry.localId));
    },
    async countOutbox() {
      return outbox.length;
    }
  };
}

export function makeCandidate(overrides: Partial<StateChannelCandidate> = {}): StateChannelCandidate {
  return { id: 'c1', accessHash: 'hash', title: 'TSMC State', eventCount: 0, updatedAt: Date.now(), ...overrides };
}

export function makeFetchedEvent(event: SyncEvent, msgId: number): FetchedEvent {
  return { msgId, event };
}

export function makeSnapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return { v: 1, state: createEmptySyncState(), baseMsgId: 0, ...overrides };
}

export function noopPublished(msgId = 1): PublishedMessage {
  return { msgId };
}
