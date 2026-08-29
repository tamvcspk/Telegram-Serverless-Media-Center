// Cổng hẹp mà core-index cần từ core-mtproto — KHÔNG import @tsmc/core-mtproto
// trực tiếp (CLAUDE.md bất biến #3: chỉ core-mtproto được import `telegram`).
// worker-host/core-worker.ts nối một implementation thật (createTelegramGateway()
// đã mở rộng cho ADR-0010) vào interface này; test trong core-index chỉ cần
// một fake khớp shape, không cần mock 'telegram'.
//
// Các type kết quả nằm ngay tại đây (không đưa lên @tsmc/shared-models) —
// đây là type riêng của port, chỉ dùng nội bộ giữa core-index và
// core-mtproto, cùng quy ước với @tsmc/core-sync/gateway-port.ts.

export interface ResolvedIndexChannel {
  id: string;
  accessHash: string;
  title: string;
  /** ADR-0010 §3: kênh private của user (do chính mình tạo) tin toàn bộ. */
  isOwn: boolean;
  /**
   * `channels.CreateChannel`/kết quả resolve kênh trả thẳng field `forum`
   * (SPIKE-07) — dùng để index-engine.ts bỏ qua hẳn `listForumTopics()` cho
   * kênh không phải Forum (đa số kênh media là broadcast, không có Forum).
   */
  isForum: boolean;
}

export interface MemberChannelSummary extends ResolvedIndexChannel {
  /** true = channel/broadcast, false = supergroup — chỉ để hiển thị. */
  isBroadcast: boolean;
}

export interface PinnedCatalogDocument {
  msgId: number;
  publisherId: string;
  raw: string;
}

export interface IndexHistoryMessage {
  msgId: number;
  publisherId: string;
  date: number;
  fileName?: string;
  /** Text/caption của message — nguồn title dự phòng khi video gửi "as video" không có fileName. */
  caption?: string;
  mimeType?: string;
  size?: number;
  video?: { w: number; h: number; durationSec: number };
  /**
   * Forum Topic message này thuộc về — suy ra bằng `replyToTopId ??
   * replyToMsgId` khi `forumTopic === true` (SPIKE-07, ADR-0010 § Cập nhật
   * 2026-08-29 mục A). `undefined` = không thuộc topic nào (kênh không phải
   * Forum, hoặc message gửi ngoài mọi topic).
   */
  topicId?: string;
  /**
   * Hashtag tách từ `message.entities` (MessageEntityHashtag, cắt theo
   * offset/length) — KHÔNG regex lại caption thô (ADR-0010 § Cập nhật
   * 2026-08-29 mục B). `undefined` khi message không có hashtag nào.
   */
  hashtags?: string[];
}

export interface IndexGateway {
  /** Toàn bộ channel/supergroup tài khoản đang đăng nhập đã là thành viên — nguồn cho UI "chọn từ danh sách". */
  listMemberChannels(): Promise<MemberChannelSummary[]>;
  /** `ref` = username/invite link do user nhập (CLAUDE.md bất biến #10), hoặc id kênh đã biết. */
  resolveIndexChannel(ref: string): Promise<ResolvedIndexChannel | null>;
  /** T1 — catalog ghim trên kênh, catalog-spec.md §"Đặt ở đâu". */
  getPinnedCatalogDocument(channelId: string): Promise<PinnedCatalogDocument | null>;
  /**
   * T2/T3 — quét lịch sử tin nhắn có document. `direction: 'asc'` (mặc định)
   * quét tăng dần từ `minId` (T2 delta); `'desc'` lấy `limit` message MỚI
   * NHẤT, bỏ qua `minId` (T3 full-scan bounded — ưu tiên nội dung mới).
   */
  fetchHistorySince(channelId: string, minId: number, limit: number, direction?: 'asc' | 'desc'): Promise<IndexHistoryMessage[]>;
  /**
   * Danh sách user id admin của kênh — biên an ninh thật cho mô hình tin cậy
   * (ADR-0010 §3). Trả `null` khi Telegram từ chối tiết lộ (CHAT_ADMIN_REQUIRED
   * — nhóm/kênh ẩn participant list với thành viên thường); core-index/trust.ts
   * quyết định null nghĩa là gì.
   */
  getChannelAdmins(channelId: string): Promise<string[] | null>;
  /**
   * Liệt kê Forum Topic của kênh (`channels.GetForumTopics`, SPIKE-07) — 1
   * RPC/kênh/lượt quét, cache TTL giống `getChannelAdmins` (xem
   * forum-topics.ts). Trả `null` khi kênh không phải Forum — cùng convention
   * null-safety với `getChannelAdmins()` (null = "không áp dụng", không phải
   * "rỗng"). KHÔNG BAO GIỜ gọi theo từng message (ADR-0010 § Cập nhật
   * 2026-08-29 mục A).
   */
  listForumTopics(channelId: string): Promise<{ id: string; title: string }[] | null>;
  /**
   * Tra cứu ĐÚNG MỘT publisher — dùng lúc TRUY CẬP (on-access), không bao
   * giờ gọi hàng loạt lúc quét (N publisher × N RPC = rủi ro FLOOD_WAIT,
   * ADR-0006). Trả `null` khi vẫn không xác định được (kể cả tra cứu một
   * người); `false` khi chắc chắn không phải admin (kể cả không còn là
   * thành viên — USER_NOT_PARTICIPANT).
   */
  checkPublisherIsAdmin(channelId: string, publisherId: string): Promise<boolean | null>;
  /**
   * Ghi/ghim `catalog.json` mới lên kênh media — Ingest Editor (Màn hình 6,
   * ADR-0013 §3 "Chế độ Admin trong web app"). Gọi tầng trên (publish-
   * catalog.ts) đã tự chặn khi `!channel.isOwn` (ADR-0014 §4 "Kho Cá Nhân"),
   * hàm này KHÔNG tự kiểm tra lại quyền — chỉ lo phần upload/ghim/dọn.
   * Ghim message MỚI TRƯỚC, xoá `previousMsgId` (catalog cũ, nếu có) SAU —
   * cùng thứ tự "không để trạng thái trung gian thiếu dữ liệu" của
   * `publishSnapshot()` (core-sync, ADR-0009).
   */
  publishCatalogDocument(channelId: string, json: string, previousMsgId?: number): Promise<{ msgId: number }>;
}
