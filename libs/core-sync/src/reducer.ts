// Replay + merge engine — ADR-0009 "Quy tắc hợp nhất". Thuần tuý (không I/O),
// đây là module được test bằng property-style convergence test
// (reducer.spec.ts). KHÔNG import @tsmc/core-mtproto hay bất cứ thứ gì có
// side-effect — xem CLAUDE.md quy ước "Chunk truyền... ArrayBuffer
// transferable" không áp dụng ở đây, nhưng tinh thần "logic lõi test được
// bằng Node thuần" thì có (ADR-0012 §2).
import {
  createEmptySyncState,
  type Collection,
  type SnapshotV1,
  type SourceRef,
  type SyncEvent,
  type SyncState
} from '@tsmc/shared-models';

/**
 * So sánh (ts, dev) — LWW theo ts, phá hoà bằng dev id để mọi thiết bị ra
 * cùng kết quả bất kể replay theo thứ tự nào (ADR-0009).
 * Trả về true nếu (ts,dev) của bên "candidate" mới hơn (hoặc thắng hoà) bên
 * "current".
 */
function isNewer(candidateTs: number, candidateDev: string, currentTs: number, currentDev: string): boolean {
  if (candidateTs !== currentTs) {
    return candidateTs > currentTs;
  }
  return candidateDev > currentDev;
}

function cloneState(state: SyncState): SyncState {
  return {
    progress: { ...state.progress },
    collections: { ...state.collections },
    sources: { ...state.sources },
    settings: { ...state.settings }
  };
}

function getOrCreateCollection(state: SyncState, id: string, ts: number, dev: string): Collection {
  return state.collections[id] ?? { id, name: '', ts, dev, items: [], deleted: false };
}

function getOrCreateSource(state: SyncState, id: string, ts: number, dev: string): SourceRef {
  return state.sources[id] ?? { id, ref: '', ts, dev };
}

/**
 * Áp một sự kiện lên state hiện tại, trả về state MỚI (không mutate input).
 * Order-independent cho các trường hợp xung đột (LWW/add-wins) — gọi
 * applyEvent hai lần với thứ tự event hoán đổi phải ra cùng kết quả cuối,
 * đây chính là bất biến mà reducer.spec.ts kiểm chứng.
 */
export function applyEvent(state: SyncState, event: SyncEvent): SyncState {
  const next = cloneState(state);

  switch (event.op) {
    case 'progress.set': {
      const existing = next.progress[event.k];
      if (!existing || isNewer(event.ts, event.dev, existing.ts, existing.dev)) {
        next.progress[event.k] = { k: event.k, p: event.p, ts: event.ts, dev: event.dev };
      }
      return next;
    }
    case 'progress.clear': {
      const existing = next.progress[event.k];
      if (!existing || isNewer(event.ts, event.dev, existing.ts, existing.dev)) {
        next.progress[event.k] = { k: event.k, ts: event.ts, dev: event.dev, cleared: true };
      }
      return next;
    }
    case 'collection.create': {
      const existing = next.collections[event.id];
      if (!existing || isNewer(event.ts, event.dev, existing.ts, existing.dev)) {
        next.collections[event.id] = {
          id: event.id,
          name: event.name,
          ts: event.ts,
          dev: event.dev,
          items: existing?.items ?? [],
          deleted: false
        };
      }
      return next;
    }
    case 'collection.rename': {
      const existing = getOrCreateCollection(next, event.id, event.ts, event.dev);
      if (isNewer(event.ts, event.dev, existing.ts, existing.dev) || !next.collections[event.id]) {
        next.collections[event.id] = { ...existing, name: event.name, ts: event.ts, dev: event.dev };
      }
      return next;
    }
    case 'collection.delete': {
      const existing = getOrCreateCollection(next, event.id, event.ts, event.dev);
      if (isNewer(event.ts, event.dev, existing.ts, existing.dev) || !next.collections[event.id]) {
        next.collections[event.id] = { ...existing, ts: event.ts, dev: event.dev, deleted: true };
      }
      return next;
    }
    case 'collection.add': {
      // add-wins: log là total order (message_id) trong một kênh — trong
      // đúng đường replay đơn kênh, "chèn muộn hơn trong log thắng" chính là
      // add-wins ("xoá nhầm còn sửa được": add sau luôn đưa item trở lại).
      const existing = getOrCreateCollection(next, event.id, event.ts, event.dev);
      const items = existing.items.includes(event.item) ? existing.items : [...existing.items, event.item];
      next.collections[event.id] = { ...existing, items };
      return next;
    }
    case 'collection.remove': {
      const existing = next.collections[event.id];
      if (!existing) {
        return next;
      }
      next.collections[event.id] = { ...existing, items: existing.items.filter((item) => item !== event.item) };
      return next;
    }
    case 'collection.reorder': {
      const existing = getOrCreateCollection(next, event.id, event.ts, event.dev);
      if (isNewer(event.ts, event.dev, existing.ts, existing.dev) || !next.collections[event.id]) {
        next.collections[event.id] = { ...existing, items: event.items, ts: event.ts, dev: event.dev };
      }
      return next;
    }
    case 'source.add': {
      const existing = next.sources[event.id];
      if (!existing || isNewer(event.ts, event.dev, existing.ts, existing.dev)) {
        next.sources[event.id] = { id: event.id, ref: event.ref, ts: event.ts, dev: event.dev };
      }
      return next;
    }
    case 'source.remove': {
      const existing = getOrCreateSource(next, event.id, event.ts, event.dev);
      if (isNewer(event.ts, event.dev, existing.ts, existing.dev) || !next.sources[event.id]) {
        next.sources[event.id] = { ...existing, ts: event.ts, dev: event.dev, removed: true };
      }
      return next;
    }
    case 'source.configure': {
      const existing = getOrCreateSource(next, event.id, event.ts, event.dev);
      if (isNewer(event.ts, event.dev, existing.ts, existing.dev) || !next.sources[event.id]) {
        next.sources[event.id] = { ...existing, patch: { ...existing.patch, ...event.patch }, ts: event.ts, dev: event.dev };
      }
      return next;
    }
    case 'settings.set': {
      const existing = next.settings[event.k];
      if (!existing || isNewer(event.ts, event.dev, existing.ts, existing.dev)) {
        next.settings[event.k] = { val: event.val, ts: event.ts, dev: event.dev };
      }
      return next;
    }
  }
}

/** Replay một danh sách sự kiện (thứ tự bất kỳ nếu không xung đột, thứ tự
 * log nếu xung đột — applyEvent tự hoà giải) lên state ban đầu. */
export function replay(baseState: SyncState, events: readonly SyncEvent[]): SyncState {
  return events.reduce(applyEvent, baseState);
}

export function applySnapshot(snapshot: SnapshotV1 | undefined): SyncState {
  return snapshot ? cloneState(snapshot.state) : createEmptySyncState();
}

function mergeRecordsLww<T extends { ts: number; dev: string }>(a: Record<string, T>, b: Record<string, T>): Record<string, T> {
  const merged: Record<string, T> = { ...a };
  for (const key of Object.keys(b)) {
    const fromB = b[key] as T;
    const fromA = merged[key];
    if (!fromA || isNewer(fromB.ts, fromB.dev, fromA.ts, fromA.dev)) {
      merged[key] = fromB;
    }
  }
  return merged;
}

/**
 * Hoà hai state đã phân kỳ — dùng khi dò thấy nhiều hơn một kênh state
 * (ADR-0014 mục "gộp"). KHÔNG có nhật ký sự kiện chung giữa hai state (mỗi
 * kênh có message_id riêng), nên không thể replay lại — thay vào đó so
 * sánh field-wise, dùng lại đúng luật LWW của applyEvent. Với thành viên
 * collection: hợp nhất bảo thủ (union) vì không có ts theo từng item để so
 * — thà giữ dư một mục còn hơn làm mất bộ sưu tập user đã thêm. Thứ tự lấy
 * theo bên thắng LWW (structural, phản ánh collection.reorder gần nhất nếu
 * có) rồi mới nối thêm item riêng của bên thua vào cuối.
 */
export function mergeStates(a: SyncState, b: SyncState): SyncState {
  const progress = mergeRecordsLww(a.progress, b.progress);
  const sources = mergeRecordsLww(a.sources, b.sources);
  const settings = mergeRecordsLww(a.settings, b.settings);

  const collectionIds = new Set([...Object.keys(a.collections), ...Object.keys(b.collections)]);
  const collections: Record<string, Collection> = {};
  for (const id of collectionIds) {
    const fromA = a.collections[id];
    const fromB = b.collections[id];
    if (fromA && !fromB) {
      collections[id] = fromA;
    } else if (fromB && !fromA) {
      collections[id] = fromB;
    } else if (fromA && fromB) {
      const structural = isNewer(fromB.ts, fromB.dev, fromA.ts, fromA.dev) ? fromB : fromA;
      const other = structural === fromA ? fromB : fromA;
      const items = [...structural.items, ...other.items.filter((item) => !structural.items.includes(item))];
      collections[id] = { ...structural, items };
    }
  }

  return { progress, collections, sources, settings };
}
