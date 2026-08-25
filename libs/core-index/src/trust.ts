// Mô hình tin cậy — ADR-0010 §3, brainstorm sau phát hiện thật (channel-post
// senderId ambiguity, CHAT_ADMIN_REQUIRED, và rủi ro FLOOD_WAIT nếu verify
// hàng loạt theo publisher lúc quét).
//
// Nguyên tắc "eventual correctness": LÚC QUÉT chỉ gán nhãn bằng tín hiệu
// MIỄN PHÍ đã có sẵn (owner / channel-post / admin-list đã cache) — KHÔNG
// BAO GIỜ gọi RPC theo từng publisher trong một lượt quét (kênh N publisher
// × N RPC là con đường thẳng tới FLOOD_WAIT). Publisher chưa xác định được
// gắn nhãn `pending` — item vẫn được lưu (không bỏ), chỉ đúng dần khi được
// TRUY CẬP: resolvePublisherTrust() lúc đó mới tra cứu MỘT publisher cụ thể,
// cache lại theo publisherId nên các item khác từ cùng publisher ăn theo
// miễn phí. Cùng bản chất với "refresh file_reference on-demand lúc phát"
// (ADR-0006/0007 §C5) — không xác thực trước, chỉ xác thực khi thật sự dùng.
import type { IndexGateway, ResolvedIndexChannel } from './gateway-port';
import type { IndexStoragePort, TrustLabel } from './storage-port';

const ADMIN_CACHE_TTL_MS = 60 * 60 * 1000;

function isCacheFresh(fetchedAt: number | undefined): boolean {
  return fetchedAt !== undefined && Date.now() - fetchedAt < ADMIN_CACHE_TTL_MS;
}

/**
 * CHỈ dùng dữ liệu ĐÃ CÓ sẵn (không gọi mạng) — an toàn gọi cho MỌI message
 * trong một lượt quét, bất kể có bao nhiêu publisher khác nhau.
 */
export async function classifyFromCache(
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel,
  publisherId: string
): Promise<TrustLabel> {
  if (channel.isOwn) {
    return 'owner';
  }
  // GramJS Message: post kênh không bật "Sign Messages" (mặc định đa số
  // kênh) → senderId rơi về CHÍNH peer id của kênh. Chỉ admin mới đăng được
  // vào broadcast channel (Telegram chặn ở tầng protocol) nên đây là bằng
  // chứng đủ, không cần khớp user id.
  if (publisherId === channel.id) {
    return 'channel-post';
  }

  const meta = await storage.getIndexMeta(sourceId);
  if (isCacheFresh(meta.trustedAdminsFetchedAt) && meta.trustedAdmins) {
    return meta.trustedAdmins.includes(publisherId) ? 'verified-admin' : 'not-admin';
  }

  const cachedPublisher = await storage.getPublisherTrust(sourceId, publisherId);
  if (cachedPublisher && isCacheFresh(cachedPublisher.fetchedAt)) {
    return cachedPublisher.isAdmin ? 'verified-admin' : 'not-admin';
  }

  return 'pending';
}

/**
 * Gọi lúc QUÉT — cố lấy danh sách admin MỘT LẦN/kênh (rẻ, cache TTL 1h,
 * resolve MỌI publisher cùng lúc khi thành công). KHÔNG bao giờ fallback
 * sang tra cứu từng publisher ở đây — đó là việc của resolvePublisherTrust(),
 * chỉ chạy lúc truy cập.
 */
export async function ensureChannelAdminListCached(
  gateway: IndexGateway,
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel
): Promise<void> {
  if (channel.isOwn) {
    return;
  }
  const meta = await storage.getIndexMeta(sourceId);
  if (isCacheFresh(meta.trustedAdminsFetchedAt)) {
    return;
  }
  const admins = await gateway.getChannelAdmins(channel.id);
  await storage.putIndexMeta(sourceId, { trustedAdmins: admins, trustedAdminsFetchedAt: Date.now() });
}

/**
 * Lúc TRUY CẬP (on-access) — nếu classifyFromCache() vẫn `pending`, tra cứu
 * THẬT nhưng CHỈ MỘT publisher (channels.GetParticipant, không phải liệt kê
 * toàn bộ), cache lại theo publisherId. Trả `pending` nếu Telegram vẫn từ
 * chối tiết lộ dù chỉ hỏi một người — thử lại ở lần truy cập sau, không suy
 * diễn thành trusted/untrusted.
 */
export async function resolvePublisherTrust(
  gateway: IndexGateway,
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel,
  publisherId: string
): Promise<TrustLabel> {
  const fast = await classifyFromCache(storage, sourceId, channel, publisherId);
  if (fast !== 'pending') {
    return fast;
  }

  const isAdmin = await gateway.checkPublisherIsAdmin(channel.id, publisherId);
  if (isAdmin === null) {
    return 'pending';
  }
  await storage.putPublisherTrust(sourceId, publisherId, isAdmin, Date.now());
  return isAdmin ? 'verified-admin' : 'not-admin';
}
