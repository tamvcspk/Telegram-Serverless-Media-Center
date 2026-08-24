import { describe, expect, it, vi } from 'vitest';
import type { SyncEventInput } from '@tsmc/shared-models';
import { createLeaderController, type BroadcastChannelLike, type LockManagerLike } from './leader';

/**
 * Fake LockManager mô phỏng đúng API thật (ifAvailable:true trước, request
 * thường ở nền nếu không rảnh) — xem comment leader.ts về lý do hai pha.
 */
function makeFakeLocks(): {
  locks: LockManagerLike;
  grantIfAvailable: (granted: boolean) => void;
  grantQueued: () => void;
} {
  let ifAvailableCb: ((lock: unknown) => Promise<void>) | undefined;
  let resolveIfAvailable: (() => void) | undefined;
  let queuedCb: (() => Promise<void>) | undefined;
  let resolveQueued: (() => void) | undefined;

  const request = (
    _name: string,
    optionsOrCallback: { ifAvailable: true } | (() => Promise<void>),
    maybeCallback?: (lock: unknown) => Promise<void>
  ): Promise<void> => {
    if (typeof optionsOrCallback === 'function') {
      queuedCb = optionsOrCallback;
      return new Promise((resolve) => {
        resolveQueued = resolve;
      });
    }
    ifAvailableCb = maybeCallback;
    return new Promise((resolve) => {
      resolveIfAvailable = resolve;
    });
  };

  return {
    locks: { request } as unknown as LockManagerLike,
    grantIfAvailable(granted) {
      void ifAvailableCb?.(granted ? {} : null).then(() => resolveIfAvailable?.());
    },
    grantQueued() {
      void queuedCb?.().then(() => resolveQueued?.());
    }
  };
}

function neverGrantedLocks(): LockManagerLike {
  return { request: () => new Promise<void>(() => {}) } as unknown as LockManagerLike;
}

function makeFakeChannelPair(): { a: BroadcastChannelLike; b: BroadcastChannelLike } {
  const listenersA: Array<(ev: { data: { input: SyncEventInput } }) => void> = [];
  const listenersB: Array<(ev: { data: { input: SyncEventInput } }) => void> = [];
  const a: BroadcastChannelLike = {
    postMessage: (data) => listenersB.forEach((l) => l({ data })),
    addEventListener: (_type, listener) => listenersA.push(listener),
    close: vi.fn()
  };
  const b: BroadcastChannelLike = {
    postMessage: (data) => listenersA.forEach((l) => l({ data })),
    addEventListener: (_type, listener) => listenersB.push(listener),
    close: vi.fn()
  };
  return { a, b };
}

const sampleInput: SyncEventInput = { op: 'settings.set', k: 'theme', val: 'dark' };

async function flushMicrotasks(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) {
    await Promise.resolve();
  }
}

describe('@tsmc/core-sync leader controller', () => {
  it('không có Web Locks (không inject) → coi là leader ngay (tab duy nhất)', () => {
    const controller = createLeaderController({ locks: false, createBroadcastChannel: () => undefined as never });
    expect(controller.isLeader()).toBe(true);
  });

  it('onLeaderChange đăng ký SAU khi đã là leader → bắn true ngay lập tức', () => {
    const controller = createLeaderController({ locks: false, createBroadcastChannel: () => undefined as never });
    const changes: boolean[] = [];
    controller.onLeaderChange((v) => changes.push(v));
    expect(changes).toEqual([true]);
  });

  it('ifAvailable cấp ngay (không tranh chấp) → thành leader ngay, onLeaderChange bắn true', async () => {
    const { locks, grantIfAvailable } = makeFakeLocks();
    const controller = createLeaderController({ locks, createBroadcastChannel: () => undefined as never });
    expect(controller.isLeader()).toBe(false);

    const changes: boolean[] = [];
    controller.onLeaderChange((v) => changes.push(v));

    grantIfAvailable(true);
    await flushMicrotasks();
    expect(controller.isLeader()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('ifAvailable KHÔNG rảnh → chưa leader; tab kia đóng (queue được cấp) → thành leader muộn', async () => {
    const { locks, grantIfAvailable, grantQueued } = makeFakeLocks();
    const controller = createLeaderController({ locks, createBroadcastChannel: () => undefined as never });

    const changes: boolean[] = [];
    controller.onLeaderChange((v) => changes.push(v));

    grantIfAvailable(false);
    await flushMicrotasks();
    expect(controller.isLeader()).toBe(false);
    expect(changes).toEqual([]);

    grantQueued();
    await flushMicrotasks();
    expect(controller.isLeader()).toBe(true);
    expect(changes).toEqual([true]);
  });

  it('tab không-leader forwardMutation(): tab leader nhận được qua BroadcastChannel', async () => {
    const { a: channelForLeader, b: channelForFollower } = makeFakeChannelPair();
    const { locks, grantIfAvailable } = makeFakeLocks();

    const leaderController = createLeaderController({ locks, createBroadcastChannel: () => channelForLeader });
    const followerController = createLeaderController({ locks: neverGrantedLocks(), createBroadcastChannel: () => channelForFollower });

    grantIfAvailable(true);
    await flushMicrotasks();
    expect(leaderController.isLeader()).toBe(true);
    expect(followerController.isLeader()).toBe(false);

    const received: SyncEventInput[] = [];
    leaderController.onForwardedMutation((input) => received.push(input));

    followerController.forwardMutation(sampleInput);
    expect(received).toEqual([sampleInput]);
  });

  it('stop(): giải phóng lock và đóng channel không throw', () => {
    const controller = createLeaderController({ locks: neverGrantedLocks(), createBroadcastChannel: () => undefined as never });
    expect(() => controller.stop()).not.toThrow();
  });
});
