import { describe, expect, it, vi } from 'vitest';
import type { SyncEventInput } from '@tsmc/shared-models';
import { createOutboxController } from './outbox';
import { createFakeGateway, createFakeLeader, createFakeStorage } from './test-fakes';

const setThemeDark: SyncEventInput = { op: 'settings.set', k: 'theme', val: 'dark' };

describe('@tsmc/core-sync outbox controller', () => {
  it('mutate() trên tab leader: ghi ngay vào syncState + outbox cục bộ (optimistic)', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const gateway = createFakeGateway();
    const outbox = createOutboxController({ gateway, storage, leader, deviceId: 'dev-a', getChannelId: () => 'c1' });

    await outbox.mutate(setThemeDark);

    expect((await storage.getSyncState()).settings['theme']?.val).toBe('dark');
    expect(await storage.listOutbox()).toHaveLength(1);
    expect(leader.forwarded).toHaveLength(0);
  });

  it('mutate() trên tab KHÔNG phải leader: chỉ forward, không tự ghi', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(false);
    const gateway = createFakeGateway();
    const outbox = createOutboxController({ gateway, storage, leader, deviceId: 'dev-a', getChannelId: () => 'c1' });

    await outbox.mutate(setThemeDark);

    expect(leader.forwarded).toEqual([setThemeDark]);
    expect(await storage.listOutbox()).toHaveLength(0);
    expect((await storage.getSyncState()).settings['theme']).toBeUndefined();
  });

  it('mutation được forward từ tab khác: leader ghi hộ khi nhận qua onForwardedMutation', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const gateway = createFakeGateway();
    createOutboxController({ gateway, storage, leader, deviceId: 'dev-b', getChannelId: () => 'c1' });

    leader.triggerForwarded(setThemeDark);
    await vi.waitFor(async () => {
      expect((await storage.getSyncState()).settings['theme']?.val).toBe('dark');
    });
  });

  it('forceFlush(): gửi hết outbox, xoá khỏi outbox sau khi gateway xác nhận, cập nhật lastSyncAt', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const sendEvent = vi.fn(async () => ({ msgId: 42 }));
    const gateway = createFakeGateway({ sendEvent });
    const outbox = createOutboxController({ gateway, storage, leader, deviceId: 'dev-a', getChannelId: () => 'c1' });

    await outbox.mutate(setThemeDark);
    await outbox.mutate({ op: 'settings.set', k: 'lang', val: 'vi' });
    await outbox.forceFlush();

    expect(sendEvent).toHaveBeenCalledTimes(2);
    expect(await storage.listOutbox()).toHaveLength(0);
    expect((await storage.getSyncMeta()).lastSyncAt).toBeDefined();
  });

  it('forceFlush(): lỗi giữa chừng → giữ lại các event CHƯA gửi, xoá các event ĐÃ gửi thành công', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    let call = 0;
    const sendEvent = vi.fn(async () => {
      call += 1;
      if (call === 2) {
        throw new Error('FLOOD_WAIT');
      }
      return { msgId: call };
    });
    const gateway = createFakeGateway({ sendEvent });
    const outbox = createOutboxController({ gateway, storage, leader, deviceId: 'dev-a', getChannelId: () => 'c1' });

    await outbox.mutate({ op: 'settings.set', k: 'a', val: 1 });
    await outbox.mutate({ op: 'settings.set', k: 'b', val: 2 });
    await outbox.mutate({ op: 'settings.set', k: 'c', val: 3 });

    await expect(outbox.forceFlush()).rejects.toThrow('FLOOD_WAIT');

    const remaining = await storage.listOutbox();
    expect(remaining).toHaveLength(2);
    expect(remaining.map((entry) => (entry.event as { k: string }).k)).toEqual(['b', 'c']);
  });

  it('forceFlush(): trên tab không phải leader là no-op', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(false);
    const sendEvent = vi.fn(async () => ({ msgId: 1 }));
    const gateway = createFakeGateway({ sendEvent });
    const outbox = createOutboxController({ gateway, storage, leader, deviceId: 'dev-a', getChannelId: () => 'c1' });

    await outbox.forceFlush();
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('forceFlush(): chưa biết channelId (chưa hydrate xong) là no-op', async () => {
    const storage = createFakeStorage();
    const leader = createFakeLeader(true);
    const sendEvent = vi.fn(async () => ({ msgId: 1 }));
    const gateway = createFakeGateway({ sendEvent });
    const outbox = createOutboxController({ gateway, storage, leader, deviceId: 'dev-a', getChannelId: () => undefined });

    await outbox.mutate(setThemeDark);
    await outbox.forceFlush();
    expect(sendEvent).not.toHaveBeenCalled();
    expect(await storage.listOutbox()).toHaveLength(1);
  });
});
