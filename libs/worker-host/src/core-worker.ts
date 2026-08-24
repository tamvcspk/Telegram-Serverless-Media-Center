import * as Comlink from 'comlink';
import { createTelegramGateway } from '@tsmc/core-mtproto';
import { createSyncEngine, type SyncGateway, type SyncStoragePort } from '@tsmc/core-sync';
import {
  appendOutbox,
  countOutbox,
  getSyncMeta,
  getSyncState,
  listOutbox,
  putSyncMeta,
  putSyncState,
  removeOutbox
} from '@tsmc/core-storage';
import type { StateChannelResolutionCallbacks } from '@tsmc/shared-models';

// Bootstrap thật của Core Worker — ADR-0004. Chỉ Core Worker được mở kết nối
// MTProto (CLAUDE.md bất biến #2). File này KHÔNG được bundle qua cơ chế
// split-chunk mặc định của Angular CLI (new URL(..., import.meta.url)) —
// GramJS cần polyfill fs/net/tls không có trong esbuild builder của Angular.
// Build riêng bằng build.mjs, tái dùng cấu hình đã kiểm chứng ở SPIKE-03.
const gateway = createTelegramGateway();

// SyncMetaRecord/OutboxRecord (core-storage, có `id`/`localId` optional theo
// yêu cầu Dexie) đều là superset cấu trúc của SyncMeta/OutboxEntry
// (core-sync, thuần dữ liệu — xem storage-port.ts): thừa field `id`/kiểu
// `localId` chặt hơn (optional → required sau khi đã ghi) vẫn khớp kiểu
// gán bình thường, không cần bóc tách trừ listOutbox (localId luôn có giá
// trị SAU khi đọc lại từ Dexie, nhưng type khai báo optional).
const storagePort: SyncStoragePort = {
  getSyncMeta,
  putSyncMeta,
  getSyncState,
  putSyncState,
  appendOutbox,
  async listOutbox() {
    const rows = await listOutbox();
    return rows.map((row) => ({ localId: row.localId as number, event: row.event, createdAt: row.createdAt }));
  },
  removeOutbox,
  countOutbox
};

// TelegramGateway (core-mtproto) khai báo trực tiếp các method khớp shape
// SyncGateway (core-sync) mà KHÔNG import type đó — xem comment trong
// gateway.ts. `gateway` khớp cấu trúc, ép kiểu tường minh ở đúng một chỗ
// nối dây này.
const syncEngine = createSyncEngine(gateway as unknown as SyncGateway, storagePort);

const api = {
  login: gateway.login.bind(gateway),
  restoreSession: gateway.restoreSession.bind(gateway),
  async logout() {
    // Dừng outbox/compaction timer TRƯỚC khi đăng xuất — logout() không
    // reset GramJS client (xem gateway.ts), nên nếu không dừng, timer nền
    // của phiên cũ có thể vẫn bắn ngay trước khi UI kịp gọi lại initSync()
    // cho tài khoản kế tiếp trong cùng tab.
    syncEngine.stop();
    await gateway.logout();
  },

  // Sync & Hydration (F1.2/F1.3) — UI gọi initSync() sau khi status()
  // chuyển 'authenticated' (không tự chạy ngầm bên trong login/
  // restoreSession, giữ hai mối quan tâm tách bạch).
  initSync: (callbacks: StateChannelResolutionCallbacks) => syncEngine.init(callbacks),
  forceFlush: () => syncEngine.forceFlush(),

  setProgress: (key: string, position: number) => syncEngine.mutate({ op: 'progress.set', k: key, p: position }),
  clearProgress: (key: string) => syncEngine.mutate({ op: 'progress.clear', k: key }),
  createCollection: (id: string, name: string) => syncEngine.mutate({ op: 'collection.create', id, name }),
  renameCollection: (id: string, name: string) => syncEngine.mutate({ op: 'collection.rename', id, name }),
  deleteCollection: (id: string) => syncEngine.mutate({ op: 'collection.delete', id }),
  addToCollection: (id: string, item: string) => syncEngine.mutate({ op: 'collection.add', id, item }),
  removeFromCollection: (id: string, item: string) => syncEngine.mutate({ op: 'collection.remove', id, item }),
  addSource: (id: string, ref: string) => syncEngine.mutate({ op: 'source.add', id, ref }),
  removeSource: (id: string) => syncEngine.mutate({ op: 'source.remove', id }),
  configureSource: (id: string, patch: Record<string, unknown>) => syncEngine.mutate({ op: 'source.configure', id, patch }),
  setSetting: (key: string, val: unknown) => syncEngine.mutate({ op: 'settings.set', k: key, val })
};

export type CoreWorkerApi = typeof api;

Comlink.expose(api);
