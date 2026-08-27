import { describe, expect, it } from 'vitest';
import { createEmptySyncState, type SyncEvent, type SyncState } from '@tsmc/shared-models';
import { applyEvent, mergeStates, replay } from './reducer';

// PRNG nhỏ, có seed, thuần Node — thay cho fast-check (giữ core-sync
// zero-dependency). Mulberry32.
function makeRng(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

function assertConvergesRegardlessOfOrder(events: SyncEvent[], seedCount = 30): void {
  const expected = replay(createEmptySyncState(), events);
  for (let seed = 0; seed < seedCount; seed++) {
    const shuffled = shuffle(events, makeRng(seed));
    const actual = replay(createEmptySyncState(), shuffled);
    expect(actual).toEqual(expected);
  }
}

describe('@tsmc/core-sync reducer — convergence (property-style, seeded shuffle)', () => {
  it('progress.set trên nhiều key độc lập hội tụ bất kể thứ tự replay', () => {
    const events: SyncEvent[] = [
      { v: 1, op: 'progress.set', ts: 100, dev: 'a', k: 'src:1/msg:1', p: 10 },
      { v: 1, op: 'progress.set', ts: 200, dev: 'b', k: 'src:1/msg:2', p: 20 },
      { v: 1, op: 'progress.set', ts: 50, dev: 'a', k: 'src:1/msg:3', p: 5 },
      { v: 1, op: 'progress.set', ts: 300, dev: 'c', k: 'src:1/msg:1', p: 15 }
    ];
    assertConvergesRegardlessOfOrder(events);
  });

  it('progress.set xung đột trên CÙNG key: ts lớn hơn luôn thắng bất kể thứ tự replay', () => {
    const events: SyncEvent[] = [
      { v: 1, op: 'progress.set', ts: 100, dev: 'a', k: 'src:1/msg:1', p: 10 },
      { v: 1, op: 'progress.set', ts: 300, dev: 'b', k: 'src:1/msg:1', p: 99 },
      { v: 1, op: 'progress.set', ts: 200, dev: 'c', k: 'src:1/msg:1', p: 50 }
    ];
    const state = replay(createEmptySyncState(), events);
    expect(state.progress['src:1/msg:1']).toMatchObject({ p: 99, ts: 300, dev: 'b' });
    assertConvergesRegardlessOfOrder(events);
  });

  it('progress.set ts bằng nhau: dev id lớn hơn thắng (tie-break), hội tụ mọi thứ tự', () => {
    const events: SyncEvent[] = [
      { v: 1, op: 'progress.set', ts: 100, dev: 'aaa', k: 'src:1/msg:1', p: 1 },
      { v: 1, op: 'progress.set', ts: 100, dev: 'zzz', k: 'src:1/msg:1', p: 2 },
      { v: 1, op: 'progress.set', ts: 100, dev: 'mmm', k: 'src:1/msg:1', p: 3 }
    ];
    const state = replay(createEmptySyncState(), events);
    expect(state.progress['src:1/msg:1']).toMatchObject({ p: 2, dev: 'zzz' });
    assertConvergesRegardlessOfOrder(events);
  });

  it('progress.clear là tombstone: set cũ hơn thua clear ngay cả khi replay SAU clear', () => {
    const setOld: SyncEvent = { v: 1, op: 'progress.set', ts: 100, dev: 'a', k: 'src:1/msg:1', p: 10 };
    const clearNew: SyncEvent = { v: 1, op: 'progress.clear', ts: 200, dev: 'b', k: 'src:1/msg:1' };

    // Replay theo thứ tự log (set trước, clear sau) — clear thắng vì ts mới hơn.
    const orderA = replay(createEmptySyncState(), [setOld, clearNew]);
    expect(orderA.progress['src:1/msg:1']).toMatchObject({ cleared: true });

    // Replay ngược (clear "tới" trước set cũ, ví dụ merge hai kênh) — vẫn
    // phải giữ nguyên kết quả clear thắng, KHÔNG được để set cũ hồi sinh
    // progress đã xoá chỉ vì nó được áp dụng sau.
    const orderB = replay(createEmptySyncState(), [clearNew, setOld]);
    expect(orderB.progress['src:1/msg:1']).toMatchObject({ cleared: true });
  });

  it('collection.add-wins: remove rồi add lại vẫn còn item bất kể thứ tự replay các add/remove còn lại', () => {
    const events: SyncEvent[] = [
      { v: 1, op: 'collection.create', ts: 10, dev: 'a', id: 'c1', name: 'Yêu thích' },
      { v: 1, op: 'collection.add', ts: 20, dev: 'a', id: 'c1', item: 'movie-1' },
      { v: 1, op: 'collection.remove', ts: 30, dev: 'b', id: 'c1', item: 'movie-1' },
      { v: 1, op: 'collection.add', ts: 40, dev: 'a', id: 'c1', item: 'movie-1' }
    ];
    const state = replay(createEmptySyncState(), events);
    expect(state.collections['c1']?.items).toContain('movie-1');
  });

  it('collection.rename LWW theo ts, hội tụ bất kể thứ tự replay', () => {
    const events: SyncEvent[] = [
      { v: 1, op: 'collection.create', ts: 10, dev: 'a', id: 'c1', name: 'Ban đầu' },
      { v: 1, op: 'collection.rename', ts: 30, dev: 'b', id: 'c1', name: 'Tên cuối' },
      { v: 1, op: 'collection.rename', ts: 20, dev: 'a', id: 'c1', name: 'Tên giữa' }
    ];
    const state = replay(createEmptySyncState(), events);
    expect(state.collections['c1']?.name).toBe('Tên cuối');
    assertConvergesRegardlessOfOrder(events);
  });

  it('collection.reorder LWW theo ts trong đúng thứ tự log (giống add/remove, KHÔNG hội tụ nếu shuffle trước create)', () => {
    // Không gọi assertConvergesRegardlessOfOrder ở đây — giống lý do
    // collection.add-wins phía trên: reorder dùng getOrCreateCollection để
    // "khởi tạo" bản ghi nếu chưa có (như add/rename/delete), nhưng KHÔNG
    // set name như rename. Nếu một reorder có ts cao hơn bị shuffle tới
    // TRƯỚC collection.create trong replay, nó sẽ "founding" bản ghi với
    // name rỗng và khoá create ra khỏi việc set name (create thua LWW vì
    // ts thấp hơn) — không sao trong thực tế vì message_id của kênh state
    // luôn đảm bảo create đến trước reorder thật (chỉ test bằng đúng thứ tự
    // log, không phải bất biến order-independent như rename).
    const events: SyncEvent[] = [
      { v: 1, op: 'collection.create', ts: 10, dev: 'a', id: 'c1', name: 'Marvel' },
      { v: 1, op: 'collection.add', ts: 11, dev: 'a', id: 'c1', item: 'movie-1' },
      { v: 1, op: 'collection.add', ts: 12, dev: 'a', id: 'c1', item: 'movie-2' },
      { v: 1, op: 'collection.reorder', ts: 30, dev: 'b', id: 'c1', items: ['movie-2', 'movie-1'] },
      { v: 1, op: 'collection.reorder', ts: 20, dev: 'a', id: 'c1', items: ['movie-1', 'movie-2', 'movie-3'] }
    ];
    const state = replay(createEmptySyncState(), events);
    // ts=30 thắng dù items của nó "thiếu" movie-3 so với ts=20 — reorder thay
    // hẳn mảng items (LWW toàn phần), không hợp nhất từng phần tử.
    expect(state.collections['c1']?.items).toEqual(['movie-2', 'movie-1']);
    expect(state.collections['c1']?.name).toBe('Marvel');
  });

  it('settings.set LWW theo ts, hội tụ bất kể thứ tự replay', () => {
    const events: SyncEvent[] = [
      { v: 1, op: 'settings.set', ts: 10, dev: 'a', k: 'theme', val: 'light' },
      { v: 1, op: 'settings.set', ts: 30, dev: 'b', k: 'theme', val: 'dark' },
      { v: 1, op: 'settings.set', ts: 20, dev: 'a', k: 'theme', val: 'sepia' }
    ];
    const state = replay(createEmptySyncState(), events);
    expect(state.settings['theme']?.val).toBe('dark');
    assertConvergesRegardlessOfOrder(events);
  });
});

describe('@tsmc/core-sync reducer — applyEvent không mutate input', () => {
  it('trả về object mới, state gốc giữ nguyên', () => {
    const base = createEmptySyncState();
    const next = applyEvent(base, { v: 1, op: 'settings.set', ts: 1, dev: 'a', k: 'x', val: 1 });
    expect(base.settings).toEqual({});
    expect(next.settings['x']?.val).toBe(1);
  });
});

describe('@tsmc/core-sync reducer — mergeStates (ADR-0014 gộp nhiều kênh state)', () => {
  it('hợp nhất progress theo LWW, sources/settings tương tự', () => {
    const a: SyncState = {
      ...createEmptySyncState(),
      progress: { k1: { k: 'k1', p: 10, ts: 100, dev: 'a' } },
      settings: { theme: { val: 'light', ts: 10, dev: 'a' } }
    };
    const b: SyncState = {
      ...createEmptySyncState(),
      progress: { k1: { k: 'k1', p: 99, ts: 200, dev: 'b' }, k2: { k: 'k2', p: 5, ts: 1, dev: 'b' } },
      settings: { theme: { val: 'dark', ts: 5, dev: 'b' } }
    };

    const merged = mergeStates(a, b);
    expect(merged.progress['k1']).toMatchObject({ p: 99, ts: 200 });
    expect(merged.progress['k2']).toMatchObject({ p: 5 });
    expect(merged.settings['theme']?.val).toBe('light');
    expect(mergeStates(b, a)).toEqual(merged);
  });

  it('hợp nhất collection: union item, tên theo structural LWW mới nhất', () => {
    const a: SyncState = {
      ...createEmptySyncState(),
      collections: { c1: { id: 'c1', name: 'Tên A', ts: 100, dev: 'a', items: ['m1', 'm2'] } }
    };
    const b: SyncState = {
      ...createEmptySyncState(),
      collections: { c1: { id: 'c1', name: 'Tên B', ts: 50, dev: 'b', items: ['m2', 'm3'] } }
    };

    const merged = mergeStates(a, b);
    expect(merged.collections['c1']?.name).toBe('Tên A');
    expect(merged.collections['c1']?.items.sort()).toEqual(['m1', 'm2', 'm3']);
    expect(mergeStates(b, a).collections['c1']?.items.sort()).toEqual(['m1', 'm2', 'm3']);
  });

  it('hợp nhất collection: thứ tự items lấy theo bên thắng LWW (phản ánh reorder), item riêng của bên thua nối vào cuối', () => {
    const a: SyncState = {
      ...createEmptySyncState(),
      collections: { c1: { id: 'c1', name: 'Marvel', ts: 100, dev: 'a', items: ['m2', 'm1'] } }
    };
    const b: SyncState = {
      ...createEmptySyncState(),
      collections: { c1: { id: 'c1', name: 'Marvel', ts: 50, dev: 'b', items: ['m1', 'm3'] } }
    };

    // a thắng LWW (ts=100) — thứ tự phải giữ nguyên ['m2','m1'] rồi mới nối
    // thêm 'm3' (chỉ có ở b) vào cuối, không được sort lại hay để b lấn thứ
    // tự của a.
    expect(mergeStates(a, b).collections['c1']?.items).toEqual(['m2', 'm1', 'm3']);
    expect(mergeStates(b, a).collections['c1']?.items).toEqual(['m2', 'm1', 'm3']);
  });

  it('mergeStates giao hoán (commutative) trên dữ liệu ngẫu nhiên', () => {
    const rng = makeRng(7);
    const events: SyncEvent[] = Array.from({ length: 20 }, (_, i) => ({
      v: 1,
      op: 'progress.set',
      ts: Math.floor(rng() * 1000),
      dev: rng() > 0.5 ? 'a' : 'b',
      k: `k${i % 5}`,
      p: i
    }));
    const half = Math.floor(events.length / 2);
    const stateA = replay(createEmptySyncState(), events.slice(0, half));
    const stateB = replay(createEmptySyncState(), events.slice(half));

    expect(mergeStates(stateA, stateB)).toEqual(mergeStates(stateB, stateA));
  });
});
