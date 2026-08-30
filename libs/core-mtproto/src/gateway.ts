// PHẢI đứng trước import 'telegram': patch globalThis.window trước khi
// platform.js của GramJS tính isBrowser (xem browser-shim.ts).
import './browser-shim';
import { Api, TelegramClient, sessions } from 'telegram';
import type {
  LoginCallbacks,
  SnapshotV1,
  StateChannelCandidate,
  SyncEvent,
  TelegramCredentials,
  TelegramUserSummary
} from '@tsmc/shared-models';
import { deleteSessionRecord, getSessionRecord, putSessionRecord, type SessionRecord } from '@tsmc/core-storage';
import { createSyncGatewayMethods, type MinimalChannel } from './gateway-sync';
import {
  createIndexGatewayMethods,
  type ChannelDiagnosticMessage,
  type IndexHistoryMessage,
  type MemberChannelSummary,
  type PinnedCatalogDocument,
  type ResolvedIndexChannel
} from './gateway-index';
import { createDownloadGatewayMethods, type PlaybackDocumentRef } from './gateway-download';
import { createIngestGatewayMethods, type SubtitleUploadInput, type UploadedVideoRef, type VideoUploadInput } from './gateway-ingest';
import { decryptSessionString, encryptSessionString, generateSessionKey } from './session-crypto';

/**
 * Nơi `login()`/`restoreSession()`/`logout()` đọc/ghi session mã hoá.
 * Mặc định dùng `@tsmc/core-storage` (Dexie/IndexedDB, chỉ chạy trong trình
 * duyệt) — đúng nhu cầu duy nhất trước đây (worker-host). Tham số hoá ra
 * thành interface để `tsmc-ingest` (CLI, tiến trình Node — không có
 * IndexedDB) truyền vào một adapter khác (file cục bộ mã hoá) mà không phải
 * đụng logic login/signInUser bên dưới. Đây là RÀO CẢN DUY NHẤT từng ngăn
 * CLI tái dùng `createTelegramGateway()` nguyên vẹn.
 */
export interface SessionStoragePort {
  get(): Promise<SessionRecord | undefined>;
  put(record: SessionRecord): Promise<void>;
  delete(): Promise<void>;
}

const dexieSessionStorage: SessionStoragePort = {
  get: getSessionRecord,
  put: putSessionRecord,
  delete: deleteSessionRecord
};

const { StringSession } = sessions;

// 60s mặc định của GramJS: FLOOD_WAIT dưới ngưỡng này được tự động chờ
// (đúng tinh thần "tôn trọng FLOOD_WAIT" — CLAUDE.md); trên ngưỡng thì
// FloodWaitError nổi lên onError() để hiển thị cho user, không tự dồn dập.
const FLOOD_SLEEP_THRESHOLD_SECONDS = 60;

export interface TelegramGateway {
  login(credentials: TelegramCredentials, phoneNumber: string, callbacks: LoginCallbacks): Promise<TelegramUserSummary>;
  restoreSession(): Promise<TelegramUserSummary | null>;
  logout(): Promise<void>;

  // Phần dưới đây khớp shape @tsmc/core-sync SyncGateway (gateway-port.ts)
  // — cố ý KHÔNG import type đó ở đây (core-mtproto không phụ thuộc
  // core-sync, xem CLAUDE.md bất biến #3 + plan slice Sync). Khớp cấu trúc
  // được xác nhận tại nơi nối dây thật, worker-host/core-worker.ts.
  listOwnStateChannelCandidates(): Promise<StateChannelCandidate[]>;
  getChannelById(id: string): Promise<MinimalChannel | null>;
  createStateChannel(): Promise<MinimalChannel>;
  sendEvent(channelId: string, event: SyncEvent): Promise<{ msgId: number }>;
  fetchEventsSince(channelId: string, sinceMsgId: number): Promise<Array<{ msgId: number; event: SyncEvent }>>;
  fetchPinnedSnapshot(channelId: string): Promise<SnapshotV1 | null>;
  publishSnapshot(channelId: string, snapshot: SnapshotV1, compactedMsgIds: number[]): Promise<{ msgId: number }>;
  serverNow(): number;

  // Phần dưới đây khớp shape @tsmc/core-index IndexGateway (gateway-port.ts)
  // — cùng lý do KHÔNG import type đó ở đây như nhóm SyncGateway phía trên.
  listMemberChannels(): Promise<MemberChannelSummary[]>;
  resolveIndexChannel(ref: string): Promise<ResolvedIndexChannel | null>;
  getPinnedCatalogDocument(channelId: string): Promise<PinnedCatalogDocument | null>;
  fetchHistorySince(channelId: string, minId: number, limit: number, direction?: 'asc' | 'desc'): Promise<IndexHistoryMessage[]>;
  getChannelAdmins(channelId: string): Promise<string[] | null>;
  /** Forum Topic của kênh (`channels.GetForumTopics`, SPIKE-07) — xem comment ở gateway-index.ts. */
  listForumTopics(channelId: string): Promise<{ id: string; title: string }[] | null>;
  /** Tra cứu MỘT publisher — dùng lúc truy cập (on-access), không dùng hàng loạt lúc quét. Xem comment ở gateway-index.ts. */
  checkPublisherIsAdmin(channelId: string, publisherId: string): Promise<boolean | null>;
  /** Chẩn đoán — không lọc gì cả, xem comment ChannelDiagnosticMessage (gateway-index.ts). Chỉ debug UI gọi. */
  diagnoseChannel(ref: string, limit: number): Promise<ChannelDiagnosticMessage[]>;
  /** Ingest Editor (Màn hình 6) — xem comment đầy đủ ở gateway-index.ts. */
  publishCatalogDocument(channelId: string, json: string, previousMsgId?: number): Promise<{ msgId: number }>;

  // Phần dưới đây khớp shape @tsmc/core-ingest IngestGateway (gateway-port.ts)
  // — cùng lý do KHÔNG import type đó ở đây như các nhóm phía trên. Duy nhất
  // dùng bởi CLI `tsmc-ingest` (ADR-0013 mục 1) — chưa có consumer trình
  // duyệt nào cần method này.
  /** Upload một file video cục bộ thành document mới trong kênh media. Xem comment đầy đủ ở gateway-ingest.ts. */
  uploadVideoDocument(channelId: string, input: VideoUploadInput): Promise<UploadedVideoRef>;
  /** Upload một file phụ đề text (`.srt`) cục bộ thành document rời. Xem comment đầy đủ ở gateway-ingest.ts. */
  uploadSubtitleDocument(channelId: string, input: SubtitleUploadInput): Promise<UploadedVideoRef>;

  // Phần dưới đây khớp shape @tsmc/core-download DownloadGateway
  // (gateway-port.ts) — cùng lý do KHÔNG import type đó ở đây như hai nhóm
  // Sync/Index phía trên.
  getPlaybackDocument(channelId: string, msgId: number): Promise<PlaybackDocumentRef | null>;
  fetchFileChunk(ref: PlaybackDocumentRef, offset: number, limit: number): Promise<ArrayBuffer>;
}

function toUserSummary(user: Api.TypeUser): TelegramUserSummary {
  if (!(user instanceof Api.User)) {
    throw new Error('Không lấy được thông tin tài khoản người dùng (user rỗng hoặc đã bị xoá).');
  }
  return {
    id: user.id.toString(),
    firstName: user.firstName,
    lastName: user.lastName,
    username: user.username,
    phone: user.phone
  };
}

/**
 * TelegramGateway — ADR-0003. Nơi duy nhất trong repo được phép import
 * package `telegram`; không type nào của GramJS/`Api.*` rò ra ngoài package
 * này, mọi tầng khác chỉ thấy DTO từ `@tsmc/shared-models`.
 */
export function createTelegramGateway(deps?: { sessionStorage?: SessionStoragePort; sessionKeyExtractable?: boolean }): TelegramGateway {
  const sessionStorage = deps?.sessionStorage ?? dexieSessionStorage;
  // Dexie (web/worker-host) giữ nguyên object CryptoKey qua structured clone
  // của IndexedDB — extractable:false vẫn đọc lại dùng được, không cần export
  // bytes. Một SessionStoragePort khác (vd file cục bộ của CLI) không có cơ
  // chế tương đương — PHẢI export/import bytes để ghi ra đĩa, nên cần key
  // extractable. Caller (CLI) tự khai báo qua `sessionKeyExtractable: true`
  // khi truyền `sessionStorage` tuỳ biến (xem session-crypto.ts).
  const sessionKeyExtractable = deps?.sessionKeyExtractable ?? false;
  let client: TelegramClient | undefined;

  async function persistSession(credentials: TelegramCredentials, sessionString: string): Promise<void> {
    const cryptoKey = await generateSessionKey(sessionKeyExtractable);
    const { iv, ciphertext } = await encryptSessionString(cryptoKey, sessionString);
    await sessionStorage.put({ id: 'default', apiId: credentials.apiId, apiHash: credentials.apiHash, iv, ciphertext, cryptoKey });
  }

  function requireClient(): TelegramClient {
    if (!client) {
      throw new Error('TelegramGateway: chưa đăng nhập (gọi login()/restoreSession() trước).');
    }
    return client;
  }

  const syncMethods = createSyncGatewayMethods(requireClient);
  const indexMethods = createIndexGatewayMethods(requireClient);
  const downloadMethods = createDownloadGatewayMethods(requireClient);
  const ingestMethods = createIngestGatewayMethods(requireClient);

  return {
    ...syncMethods,
    ...indexMethods,
    ...downloadMethods,
    ...ingestMethods,
    async login(credentials, phoneNumber, callbacks) {
      const stringSession = new StringSession('');
      client = new TelegramClient(stringSession, credentials.apiId, credentials.apiHash, {
        floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_SECONDS
      });
      await client.connect();

      const user = await client.signInUser(credentials, {
        phoneNumber,
        phoneCode: callbacks.phoneCode,
        password: callbacks.password,
        onError: callbacks.onError
      });

      await persistSession(credentials, stringSession.save());
      return toUserSummary(user);
    },

    async restoreSession() {
      const record = await sessionStorage.get();
      if (!record) {
        return null;
      }

      const sessionString = await decryptSessionString(record.cryptoKey, record.iv, record.ciphertext);
      client = new TelegramClient(new StringSession(sessionString), record.apiId, record.apiHash, {
        floodSleepThreshold: FLOOD_SLEEP_THRESHOLD_SECONDS
      });
      await client.connect();

      const authorized = await client.checkAuthorization();
      if (!authorized) {
        // File_reference/access có thể lệch nhưng đây là AUTH_KEY chết hẳn —
        // không phải trường hợp "refresh on-demand" của ADR-0006/C5.
        await sessionStorage.delete();
        return null;
      }

      return toUserSummary(await client.getMe());
    },

    async logout() {
      // Vô hiệu hoá session phía server TRƯỚC khi xoá local — xoá local
      // trước sẽ để lại một session sống trong danh sách thiết bị của user
      // mà app không còn cách nào thu hồi (ADR-0011).
      if (client) {
        await client.invoke(new Api.auth.LogOut());
      }
      await sessionStorage.delete();
    }
  };
}
