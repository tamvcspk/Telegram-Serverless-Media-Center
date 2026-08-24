import { describe, expect, it } from 'vitest';
import type { StateChannelChoice, StateChannelResolutionCallbacks } from '@tsmc/shared-models';
import { hydrate, hydrateWithMerge, resolveStateChannel } from './hydrate';
import { createFakeGateway, createFakeStorage, makeCandidate, makeFetchedEvent, makeSnapshot } from './test-fakes';

function callbacksReturning(choice: StateChannelChoice): StateChannelResolutionCallbacks {
  return { chooseCandidate: async () => choice };
}

const neverAsk: StateChannelResolutionCallbacks = {
  chooseCandidate: async () => {
    throw new Error('không nên hỏi user ở kịch bản này');
  }
};

describe('@tsmc/core-sync resolveStateChannel (ADR-0014)', () => {
  it('có cache hợp lệ → dùng cache, không dò dialog', async () => {
    const storage = createFakeStorage();
    await storage.putSyncMeta({ stateChannelId: 'c1', stateChannelAccessHash: 'hash1' });
    const gateway = createFakeGateway({ getChannelById: async (id) => (id === 'c1' ? { id: 'c1', accessHash: 'hash1' } : null) });

    const result = await resolveStateChannel(gateway, storage, neverAsk);
    expect(result).toEqual({ kind: 'single', channelId: 'c1', accessHash: 'hash1' });
  });

  it('cache cũ không còn hợp lệ → xoá cache, dò lại từ dialog', async () => {
    const storage = createFakeStorage();
    await storage.putSyncMeta({ stateChannelId: 'stale', stateChannelAccessHash: 'x' });
    const gateway = createFakeGateway({
      getChannelById: async () => null,
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'fresh', accessHash: 'y' })]
    });

    const result = await resolveStateChannel(gateway, storage, neverAsk);
    expect(result).toEqual({ kind: 'single', channelId: 'fresh', accessHash: 'y' });
  });

  it('không có cache, 0 ứng viên → tạo kênh mới', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({ createStateChannel: async () => ({ id: 'created', accessHash: 'h' }) });

    const result = await resolveStateChannel(gateway, storage, neverAsk);
    expect(result).toEqual({ kind: 'single', channelId: 'created', accessHash: 'h' });
  });

  it('đúng 1 ứng viên → dùng thẳng, không hỏi user', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({ listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'only' })] });

    const result = await resolveStateChannel(gateway, storage, neverAsk);
    expect(result).toEqual({ kind: 'single', channelId: 'only', accessHash: 'hash' });
  });

  it('nhiều ứng viên → hỏi user, dùng lựa chọn "use"', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })]
    });

    const result = await resolveStateChannel(gateway, storage, callbacksReturning({ kind: 'use', channelId: 'b' }));
    expect(result).toEqual({ kind: 'single', channelId: 'b', accessHash: 'hash' });
  });

  it('nhiều ứng viên → lựa chọn "link" → phân giải qua t.me/c/<id>', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })],
      getChannelById: async (id) => (id === '999' ? { id: '999', accessHash: 'linked-hash' } : null)
    });

    const result = await resolveStateChannel(gateway, storage, callbacksReturning({ kind: 'link', link: 'https://t.me/c/999/42' }));
    expect(result).toEqual({ kind: 'single', channelId: '999', accessHash: 'linked-hash' });
  });

  it('nhiều ứng viên → lựa chọn "merge" → trả về kind: merge, không tự hydrate ở đây', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })]
    });

    const result = await resolveStateChannel(gateway, storage, callbacksReturning({ kind: 'merge', channelIds: ['a', 'b'] }));
    expect(result).toEqual({ kind: 'merge', targetChannelId: 'a', allChannelIds: ['a', 'b'] });
  });

  it('lựa chọn "use" với channelId không nằm trong danh sách → ném lỗi rõ ràng', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({ listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })] });

    await expect(resolveStateChannel(gateway, storage, callbacksReturning({ kind: 'use', channelId: 'zzz' }))).rejects.toThrow();
  });
});

describe('@tsmc/core-sync hydrate() (ADR-0009 Hydration)', () => {
  it('không có snapshot ghim: replay toàn bộ event từ đầu', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'c1' })],
      fetchPinnedSnapshot: async () => null,
      fetchEventsSince: async () => [
        makeFetchedEvent({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'theme', val: 'dark' }, 10),
        makeFetchedEvent({ v: 1, op: 'settings.set', ts: 2, dev: 'a', k: 'lang', val: 'vi' }, 11)
      ]
    });

    const result = await hydrate(gateway, storage, neverAsk);
    expect(result.state.settings['theme']?.val).toBe('dark');
    expect(result.lastSeenMsgId).toBe(11);
    expect((await storage.getSyncMeta()).stateChannelId).toBe('c1');
    expect((await storage.getSyncMeta()).lastSeenMsgId).toBe(11);
  });

  it('có snapshot ghim: bắt đầu từ state của snapshot, chỉ replay event SAU baseMsgId', async () => {
    const storage = createFakeStorage();
    const snapshot = makeSnapshot({
      state: { progress: {}, collections: {}, sources: {}, settings: { theme: { val: 'light', ts: 1, dev: 'a' } } },
      baseMsgId: 100
    });
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'c1' })],
      fetchPinnedSnapshot: async () => snapshot,
      fetchEventsSince: async (_id, since) => {
        expect(since).toBe(100);
        return [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 2, dev: 'a', k: 'theme', val: 'dark' }, 101)];
      }
    });

    const result = await hydrate(gateway, storage, neverAsk);
    expect(result.state.settings['theme']?.val).toBe('dark');
    expect(result.lastSeenMsgId).toBe(101);
  });

  it('không có event mới sau snapshot: lastSeenMsgId = baseMsgId của snapshot', async () => {
    const storage = createFakeStorage();
    const snapshot = makeSnapshot({ baseMsgId: 55 });
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'c1' })],
      fetchPinnedSnapshot: async () => snapshot,
      fetchEventsSince: async () => []
    });

    const result = await hydrate(gateway, storage, neverAsk);
    expect(result.lastSeenMsgId).toBe(55);
  });

  it('gateway trả event không theo thứ tự msgId: hydrate() tự sort trước khi replay', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'c1' })],
      // Cố tình trả về SAI thứ tự (msgId 20 trước 10) — ts khác nhau nên
      // kết quả LWW chỉ đúng nếu hydrate() tự sort lại theo msgId trước khi
      // gọi replay(), không tin thứ tự gateway trả về.
      fetchEventsSince: async () => [
        makeFetchedEvent({ v: 1, op: 'settings.set', ts: 200, dev: 'a', k: 'theme', val: 'newer-ts-smaller-msgId' }, 10),
        makeFetchedEvent({ v: 1, op: 'settings.set', ts: 100, dev: 'a', k: 'theme', val: 'older-ts-larger-msgId' }, 20)
      ]
    });

    const result = await hydrate(gateway, storage, neverAsk);
    // ts=200 (msgId 10) mới hơn ts=100 (msgId 20) → thắng theo LWW dù msgId
    // nhỏ hơn — nhưng lastSeenMsgId vẫn phải theo msgId LỚN NHẤT (20), vì đó
    // là con trỏ đọc thật của kênh, không liên quan gì tới LWW nội dung.
    expect(result.state.settings['theme']?.val).toBe('newer-ts-smaller-msgId');
    expect(result.lastSeenMsgId).toBe(20);
  });

  it('user chọn "merge" ở bước dò kênh: hydrate() tự dispatch sang hydrateWithMerge, không hydrate đơn kênh', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({
      listOwnStateChannelCandidates: async () => [makeCandidate({ id: 'a' }), makeCandidate({ id: 'b' })],
      getChannelById: async (id) => ({ id, accessHash: `hash-${id}` }),
      fetchPinnedSnapshot: async () => null,
      fetchEventsSince: async (id) => [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 1, dev: 'x', k: id, val: id }, 1)],
      publishSnapshot: async () => ({ msgId: 777 })
    });

    const result = await hydrate(gateway, storage, callbacksReturning({ kind: 'merge', channelIds: ['a', 'b'] }));
    expect(result.channel.channelId).toBe('a');
    expect(result.state.settings['a']?.val).toBe('a');
    expect(result.state.settings['b']?.val).toBe('b');
    expect(result.lastSeenMsgId).toBe(777);
  });
});

describe('@tsmc/core-sync hydrateWithMerge (ADR-0014 gộp)', () => {
  it('hoà 2 kênh, ghi snapshot đã gộp lên kênh đích, nén event đã đọc của kênh đích', async () => {
    const storage = createFakeStorage();
    const publishSnapshot = async (
      _id: string,
      _snapshot: unknown,
      compactedMsgIds: number[]
    ): Promise<{ msgId: number }> => {
      expect(compactedMsgIds).toEqual([5]);
      return { msgId: 999 };
    };
    const gateway = createFakeGateway({
      getChannelById: async (id) => ({ id, accessHash: `hash-${id}` }),
      fetchPinnedSnapshot: async (id) => (id === 'target' ? null : makeSnapshot({ baseMsgId: 0 })),
      fetchEventsSince: async (id) => {
        if (id === 'target') {
          return [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'theme', val: 'from-target' }, 5)];
        }
        return [makeFetchedEvent({ v: 1, op: 'settings.set', ts: 2, dev: 'b', k: 'lang', val: 'vi' }, 3)];
      },
      publishSnapshot
    });

    const result = await hydrateWithMerge(gateway, storage, 'target', ['target', 'other']);
    expect(result.state.settings['theme']?.val).toBe('from-target');
    expect(result.state.settings['lang']?.val).toBe('vi');
    expect(result.lastSeenMsgId).toBe(999);
    expect((await storage.getSyncMeta()).stateChannelId).toBe('target');
  });

  it('kênh đích không tồn tại → ném lỗi rõ ràng', async () => {
    const storage = createFakeStorage();
    const gateway = createFakeGateway({ getChannelById: async () => null });
    await expect(hydrateWithMerge(gateway, storage, 'missing', ['missing'])).rejects.toThrow();
  });
});
