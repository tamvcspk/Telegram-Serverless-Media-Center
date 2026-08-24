import { describe, expect, it, vi } from 'vitest';
import type { StateChannelResolutionCallbacks } from '@tsmc/shared-models';
import { createSyncEngine } from './sync-engine';
import { createFakeGateway, createFakeLeader, createFakeStorage, makeCandidate } from './test-fakes';

const neverAsk: StateChannelResolutionCallbacks = {
  chooseCandidate: async () => {
    throw new Error('không nên hỏi user ở kịch bản này');
  }
};

describe('@tsmc/core-sync createSyncEngine — tab là leader ngay từ đầu', () => {
  it('init(): hydrate thật, trả state đã hydrate, getStatus() phản ánh đúng kênh', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const gateway = createFakeGateway({ listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'c1' })] });
    const engine = createSyncEngine(gateway, storage, { leader });

    const state = await engine.init(neverAsk);
    expect(state).toEqual({ progress: {}, collections: {}, sources: {}, settings: {} });

    const status = await engine.getStatus();
    expect(status.isLeader).toBe(true);
    expect(status.stateChannelId).toBe('c1');
    expect(status.pendingOutboxCount).toBe(0);

    engine.stop();
  });

  it('mutate() sau init(): ghi optimistic ngay, forceFlush() đẩy lên gateway', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const sendEvent = vi.fn(async () => ({ msgId: 1 }));
    const gateway = createFakeGateway({ listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'c1' })], sendEvent });
    const engine = createSyncEngine(gateway, storage, { leader });

    await engine.init(neverAsk);
    await engine.mutate({ op: 'settings.set', k: 'theme', val: 'dark' });

    expect((await storage.getSyncState()).settings['theme']?.val).toBe('dark');
    expect((await engine.getStatus()).pendingOutboxCount).toBe(1);

    await engine.forceFlush();
    expect(sendEvent).toHaveBeenCalledTimes(1);
    expect((await engine.getStatus()).pendingOutboxCount).toBe(0);

    engine.stop();
  });

  it('init() lỗi hydrate → lỗi propagate ra caller VÀ được ghi vào syncMeta.lastError', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => {
        throw new Error('NETWORK_DOWN');
      }
    });
    const engine = createSyncEngine(gateway, storage, { leader });

    await expect(engine.init(neverAsk)).rejects.toThrow('NETWORK_DOWN');
    expect((await storage.getSyncMeta()).lastError).toContain('NETWORK_DOWN');

    engine.stop();
  });
});

describe('@tsmc/core-sync createSyncEngine — tab CHƯA phải leader lúc init()', () => {
  it('init() không treo vô thời hạn: trả state cục bộ hiện có, không tự hydrate', async () => {
    const storage = createFakeStorage();
    await storage.putSyncState({
      progress: {},
      collections: {},
      sources: {},
      settings: { theme: { val: 'from-other-tab', ts: 1, dev: 'x' } }
    });
    const leader = createFakeLeader(false);
    const gateway = createFakeGateway();
    const engine = createSyncEngine(gateway, storage, { leader, leaderDecisionTimeoutMs: 20 });

    const state = await engine.init(neverAsk);
    expect(state.settings['theme']?.val).toBe('from-other-tab');

    const status = await engine.getStatus();
    expect(status.isLeader).toBe(false);

    engine.stop();
  }, 2000);

  it('mutate() trên tab không-leader: forward, không ghi cục bộ', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(false);
    const gateway = createFakeGateway();
    const engine = createSyncEngine(gateway, storage, { leader, leaderDecisionTimeoutMs: 20 });

    await engine.init(neverAsk);
    await engine.mutate({ op: 'settings.set', k: 'theme', val: 'dark' });

    expect(leader.forwarded).toEqual([{ op: 'settings.set', k: 'theme', val: 'dark' }]);
    expect((await storage.getSyncState()).settings['theme']).toBeUndefined();

    engine.stop();
  }, 2000);

  it('được thăng làm leader MUỘN (sau init() đã trả về): tự hydrate ở nền', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(false);
    const gateway = createFakeGateway({ listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'late-channel' })] });
    const engine = createSyncEngine(gateway, storage, { leader, leaderDecisionTimeoutMs: 20 });

    await engine.init(neverAsk);
    expect((await storage.getSyncMeta()).stateChannelId).toBeUndefined();

    leader.setLeader(true);
    await vi.waitFor(async () => {
      expect((await storage.getSyncMeta()).stateChannelId).toBe('late-channel');
    });

    engine.stop();
  }, 2000);
});
