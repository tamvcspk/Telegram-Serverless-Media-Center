// Category theo Forum Topic — ADR-0010 § Cập nhật 2026-08-29 (mục A),
// SPIKE-07. Cùng khuôn cache TTL với trust.ts (ensureChannelAdminListCached):
// MỘT cuộc gọi/kênh/lượt quét, KHÔNG BAO GIỜ theo từng message.
import { sanitizeUntrustedString } from '@tsmc/shared-models';
import type { IndexGateway, ResolvedIndexChannel } from './gateway-port';
import type { IndexStoragePort } from './storage-port';

const FORUM_TOPICS_CACHE_TTL_MS = 60 * 60 * 1000;

function isCacheFresh(fetchedAt: number | undefined): boolean {
  return fetchedAt !== undefined && Date.now() - fetchedAt < FORUM_TOPICS_CACHE_TTL_MS;
}

/**
 * Gọi lúc QUÉT — bỏ qua hẳn cho kênh không phải Forum (đa số kênh media là
 * broadcast, không có Forum) để không tốn RPC vô ích. Sanitize title ngay
 * lúc cache (giống `genres`) — `lookupTopicTitle()` đọc ra dùng thẳng, không
 * sanitize lại mỗi item.
 */
export async function ensureForumTopicsCached(
  gateway: IndexGateway,
  storage: IndexStoragePort,
  sourceId: string,
  channel: ResolvedIndexChannel
): Promise<void> {
  if (!channel.isForum) {
    return;
  }
  const meta = await storage.getIndexMeta(sourceId);
  if (isCacheFresh(meta.forumTopicsFetchedAt)) {
    return;
  }
  const topics = await gateway.listForumTopics(channel.id);
  const map = topics ? Object.fromEntries(topics.map((t) => [t.id, sanitizeUntrustedString(t.title)])) : null;
  await storage.putIndexMeta(sourceId, { forumTopics: map, forumTopicsFetchedAt: Date.now() });
}

/**
 * CHỈ đọc cache đã có (không gọi mạng) — an toàn gọi cho MỌI message trong
 * một lượt quét, đúng nguyên tắc "tín hiệu MIỄN PHÍ" của trust.ts.
 */
export async function lookupTopicTitle(storage: IndexStoragePort, sourceId: string, topicId: string | undefined): Promise<string | undefined> {
  if (!topicId) {
    return undefined;
  }
  const meta = await storage.getIndexMeta(sourceId);
  return meta.forumTopics?.[topicId];
}
