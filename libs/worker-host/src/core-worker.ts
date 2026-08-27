import * as Comlink from 'comlink';
import { createTelegramGateway } from '@tsmc/core-mtproto';
import { createSyncEngine, type SyncGateway, type SyncStoragePort } from '@tsmc/core-sync';
import { createIndexEngine, type IndexGateway, type IndexStoragePort } from '@tsmc/core-index';
import { createSearchEngine, type SearchEngine } from '@tsmc/core-search';
import { createDownloadEngine, type DownloadGateway } from '@tsmc/core-download';
import {
  appendOutbox,
  countMediaBySource,
  countOutbox,
  deleteMediaBySource,
  deleteMediaItem,
  getIndexMeta,
  getMediaItem,
  getPublisherTrust,
  getSearchIndexBlob,
  getSyncMeta,
  getSyncState,
  listAllMedia,
  listMediaBySource,
  listOutbox,
  putIndexMeta,
  putPublisherTrust,
  putSearchIndexBlob,
  putSyncMeta,
  putSyncState,
  removeOutbox,
  replaceMediaItems,
  updateMediaItemTrust,
  upsertMediaItems,
  type MediaRecord
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

// IndexStoragePort (core-index) khớp cấu trúc CHÍNH XÁC với các hàm
// media-store.ts của core-storage (cùng field name/optionality — xem
// session-store.ts IndexMetaRecord) nên re-export thẳng, không cần adapter
// như storagePort.listOutbox ở trên.
const indexStorage: IndexStoragePort = {
  getIndexMeta,
  putIndexMeta,
  replaceMediaItems,
  upsertMediaItems,
  deleteMediaBySource,
  countMediaItems: countMediaBySource,
  getMediaItem,
  updateMediaItemTrust,
  deleteMediaItem,
  getPublisherTrust,
  putPublisherTrust
};

// TelegramGateway (core-mtproto) khai báo trực tiếp các method khớp shape
// IndexGateway (core-index) mà KHÔNG import type đó — cùng quy ước với
// SyncGateway phía trên.
const indexEngine = createIndexEngine(gateway as unknown as IndexGateway, indexStorage);

// Playback (F4) — vertical slice tối thiểu, ADR-0005/0006. `TelegramGateway`
// (core-mtproto) khai báo trực tiếp các method khớp shape DownloadGateway
// (core-download) mà KHÔNG import type đó — cùng quy ước với SyncGateway/
// IndexGateway phía trên.
const downloadEngine = createDownloadEngine(gateway as unknown as DownloadGateway);

// sourceId (id nội bộ trong SyncState.sources) → channelId Telegram thật —
// KHÔNG có trong SyncState/MediaRecord (chỉ có `ref` — username/invite link,
// xem sync-state.ts), phải resolve qua gateway.resolveIndexChannel() như
// scanSource() đã làm. Cache tại đây để KHÔNG resolve lại (round-trip mạng)
// cho mỗi sub-chunk trong lúc một phim đang phát — chỉ resolve một lần cho
// mỗi nguồn trong vòng đời Core Worker này.
const channelIdBySource = new Map<string, string>();
async function resolveChannelIdForSource(sourceId: string): Promise<string> {
  const cached = channelIdBySource.get(sourceId);
  if (cached) {
    return cached;
  }
  const state = await getSyncState();
  const source = state.sources[sourceId];
  if (!source || source.removed) {
    throw new Error(`Nguồn "${sourceId}" không tồn tại hoặc đã bị xoá.`);
  }
  const channel = await gateway.resolveIndexChannel(source.ref);
  if (!channel) {
    throw new Error(`Không resolve được kênh Telegram cho nguồn "${sourceId}" (ref "${source.ref}").`);
  }
  channelIdBySource.set(sourceId, channel.id);
  return channel.id;
}

// Tìm kiếm (F3, ADR-0008) — nạp lười lúc RPC đầu tiên cần tới (searchMedia
// hoặc sau scanSource() đầu tiên), không nạp lúc module load vì đọc
// IndexedDB là async còn phần trên của file này chạy đồng bộ. Nạp từ bản
// serialize đã lưu (nhanh); nếu chưa có (lần đầu dùng F3 trên một tài khoản
// đã quét từ trước) thì backfill từ toàn bộ media đã có trong Dexie.
let searchEnginePromise: Promise<SearchEngine> | null = null;
function getSearchEngine(): Promise<SearchEngine> {
  searchEnginePromise ??= (async () => {
    const serialized = await getSearchIndexBlob();
    if (serialized) {
      return createSearchEngine(serialized);
    }
    const engine = createSearchEngine();
    const bySource = new Map<string, MediaRecord[]>();
    for (const item of await listAllMedia()) {
      const list = bySource.get(item.sourceId) ?? [];
      list.push(item);
      bySource.set(item.sourceId, list);
    }
    for (const [sourceId, items] of bySource) {
      engine.reindexSource(sourceId, items.map(toSearchDocument));
    }
    return engine;
  })();
  return searchEnginePromise;
}

function toSearchDocument(item: MediaRecord) {
  return {
    sourceId: item.sourceId,
    msgId: item.msgId,
    title: item.title,
    originalTitle: item.originalTitle,
    cast: item.cast,
    director: item.director,
    genres: item.genres
  };
}

// Debounce ghi bản serialize xuống IndexedDB (ADR-0008 §Vòng đời điểm 2) —
// mỗi lần scan/resolve trust có thể gọi liên tiếp, không cần ghi disk mỗi
// lần, chỉ cần ghi bản MỚI NHẤT sau khi im lặng một lúc.
let saveTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSearchIndexSave(engine: SearchEngine): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void putSearchIndexBlob(engine.serialize());
  }, 2000);
}

async function scanSourceAndReindex(sourceId: string, ref: string, opts?: { tier: 'full' }) {
  const result = await indexEngine.scanSource(sourceId, ref, opts);
  const engine = await getSearchEngine();
  const items = await listMediaBySource(sourceId);
  engine.reindexSource(sourceId, items.map(toSearchDocument));
  scheduleSearchIndexSave(engine);
  return result;
}

async function resolveItemTrustAndReindex(sourceId: string, ref: string, msgId: number) {
  const result = await indexEngine.resolveItemTrust(sourceId, ref, msgId);
  // Item bị xoá thật (không phải admin) → gỡ khỏi index tìm kiếm, tránh kết
  // quả tìm kiếm trỏ tới item không còn tồn tại trong Dexie (xem trust.ts).
  const stillThere = await getMediaItem(sourceId, msgId);
  if (!stillThere) {
    const engine = await getSearchEngine();
    engine.discardItem(sourceId, msgId);
    scheduleSearchIndexSave(engine);
  }
  return result;
}

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
  reorderCollection: (id: string, items: string[]) => syncEngine.mutate({ op: 'collection.reorder', id, items }),
  addSource: (id: string, ref: string) => syncEngine.mutate({ op: 'source.add', id, ref }),
  removeSource: (id: string) => syncEngine.mutate({ op: 'source.remove', id }),
  configureSource: (id: string, patch: Record<string, unknown>) => syncEngine.mutate({ op: 'source.configure', id, patch }),
  setSetting: (key: string, val: unknown) => syncEngine.mutate({ op: 'settings.set', k: key, val }),

  // Index (F2) — UI gọi trực tiếp với sourceId/ref lấy từ SyncState.sources
  // (liveQuery, đường đọc — không qua RPC). `ref` là username/invite link
  // user nhập lúc addSource() (CLAUDE.md bất biến #10), hoặc link t.me/c/<id>
  // do UI tự sinh khi user chọn thẳng từ listMemberChannels().
  // Bọc thêm reindex vào search engine (F3) sau khi quét/resolve xong — xem
  // scanSourceAndReindex/resolveItemTrustAndReindex phía trên. Logic quét/
  // trust thật vẫn nằm nguyên trong indexEngine (core-index), không đụng.
  scanSource: (sourceId: string, ref: string, opts?: { tier: 'full' }) => scanSourceAndReindex(sourceId, ref, opts),
  // Trust "eventual correctness" — resolve trust của MỘT item lúc UI thật
  // sự hiển thị/mở nó (on-access), không phải lúc quét. Xem index-engine.ts
  // resolveItemTrust() + trust.ts. UI gọi cái này, KHÔNG gọi lại scanSource()
  // để "verify" — scanSource() không bao giờ tra cứu theo từng publisher.
  resolveItemTrust: (sourceId: string, ref: string, msgId: number) => resolveItemTrustAndReindex(sourceId, ref, msgId),
  // Tìm kiếm (F3, ADR-0008) — chỉ gọi khi ô tìm kiếm CÓ nội dung; duyệt
  // không gõ gì đọc thẳng IndexedDB qua liveQuery (đường đọc), không qua RPC.
  searchMedia: async (query: string, opts?: { sourceId?: string; limit?: number }) => (await getSearchEngine()).search(query, opts),
  // Passthrough gateway thẳng (không qua indexEngine — chỉ đọc, không đụng
  // storage), cùng kiểu với login/restoreSession ở trên. Cho UI liệt kê để
  // user CHỌN kênh thay vì tự gõ ref (nguồn lỗi resolve thật đã gặp).
  listMemberChannels: gateway.listMemberChannels.bind(gateway),
  // Chẩn đoán — không lọc gì cả, xem ChannelDiagnosticMessage (gateway-index.ts).
  // Debug UI dùng để trả lời "kênh này thật ra có gì" trước khi chỉnh filter.
  diagnoseChannel: gateway.diagnoseChannel.bind(gateway),

  // Playback (F4) — gọi từ stream-bridge.ts (apps/web), KHÔNG gọi trực tiếp
  // từ component UI nào (SW là nơi khởi phát request qua MessageChannel, xem
  // ADR-0004 §3). `Comlink.transfer()` bọc ArrayBuffer trả về — CLAUDE.md bắt
  // buộc ArrayBuffer transferable (zero-copy); Comlink KHÔNG tự transfer giá
  // trị trả về nếu không bọc tường minh (structured clone sẽ COPY thay vì
  // transfer nếu thiếu bước này).
  async fetchChunk(sourceId: string, msgId: number, offset: number, limit: number, correlationId: string): Promise<ArrayBuffer> {
    const channelId = await resolveChannelIdForSource(sourceId);
    const buffer = await downloadEngine.fetchWindow(channelId, msgId, offset, limit, correlationId);
    return Comlink.transfer(buffer, [buffer]);
  },
  cancelChunk(correlationId: string): void {
    downloadEngine.cancel(correlationId);
  },
  // `size`/`mimeType` THẬT từ Telegram — SW gọi trước khi trả 200/206 (xem
  // sw/sw.ts). Phát hiện thật: catalog cục bộ (MediaRecord) không lưu
  // mimeType gốc, hardcode 'video/mp4' làm trình duyệt từ chối phát
  // (MEDIA_ERR_SRC_NOT_SUPPORTED) với file không phải mp4.
  async getStreamInfo(sourceId: string, msgId: number): Promise<{ size: number; mimeType: string }> {
    const channelId = await resolveChannelIdForSource(sourceId);
    return downloadEngine.getInfo(channelId, msgId);
  }
};

export type CoreWorkerApi = typeof api;

Comlink.expose(api);
