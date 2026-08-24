// Cổng hẹp mà core-sync cần từ core-mtproto — KHÔNG import @tsmc/core-mtproto
// trực tiếp (xem CLAUDE.md bất biến #3: chỉ core-mtproto được import
// `telegram`). worker-host/core-worker.ts nối một implementation thật
// (createTelegramGateway() đã mở rộng cho ADR-0009/0014) vào interface này;
// test trong core-sync chỉ cần một fake khớp shape, không cần mock 'telegram'.
import type { SnapshotV1, StateChannelCandidate, SyncEvent } from '@tsmc/shared-models';

export interface FetchedEvent {
  msgId: number;
  event: SyncEvent;
}

export interface PublishedMessage {
  msgId: number;
}

export interface SyncGateway {
  /** Dò các kênh do chính mình tạo có `about` khớp `tsmc-state/1` — ADR-0014. */
  listOwnStateChannelCandidates(): Promise<StateChannelCandidate[]>;
  /** Xác thực một kênh state đã cache cục bộ vẫn còn truy cập được. */
  getChannelById(id: string): Promise<{ id: string; accessHash: string } | null>;
  createStateChannel(): Promise<{ id: string; accessHash: string }>;
  sendEvent(channelId: string, event: SyncEvent): Promise<PublishedMessage>;
  fetchEventsSince(channelId: string, sinceMsgId: number): Promise<FetchedEvent[]>;
  fetchPinnedSnapshot(channelId: string): Promise<SnapshotV1 | null>;
  publishSnapshot(channelId: string, snapshot: SnapshotV1, compactedMsgIds: number[]): Promise<PublishedMessage>;
  /** Best-effort — xem ADR-0009 "kẹp ts vào thời gian server Telegram". */
  serverNow(): number;
}
