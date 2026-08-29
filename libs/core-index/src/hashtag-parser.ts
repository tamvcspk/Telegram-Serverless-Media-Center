// Suy luận metadata bổ sung từ hashtag — ADR-0010 § Cập nhật 2026-08-29 (mục
// B). Tách riêng khỏi filename-parser.ts (KHÔNG sửa parseFilenameFallback())
// vì đây là NGUỒN tín hiệu khác (message.entities, không phải tên file) với
// thứ tự ưu tiên riêng khi hợp nhất:
//   1. catalog.json thật (T1) luôn thắng tuyệt đối — không liên quan hàm này.
//   2. Season/episode: hashtag thử TRƯỚC, không khớp mới rơi về filename.
//   3. Title: luôn ưu tiên filename — hashtag hiếm khi chứa tên phim đầy đủ.
//   4. Hashtag không khớp pattern nào → gộp vào `genres` thay vì bỏ qua.
import { sanitizeUntrustedString, type CatalogItemV1 } from '@tsmc/shared-models';
import { parseFilenameFallback } from './filename-parser';

const HASHTAG_SEASON_EPISODE_RE = /^#?S(\d{1,2})E(\d{1,2})$/i;
const HASHTAG_YEAR_RE = /^#?((?:19|20)\d{2})$/;
const HASHTAG_RESOLUTION_RE = /^#?(720p|1080p|2160p|4k)$/i;
// Khớp untrustedStringArray(50) của `genres` trong catalog.ts — hashtag lạ
// gộp vào cùng mảng đó nên phải cùng giới hạn độ dài.
const GENRE_MAX_LENGTH = 50;

interface ParsedHashtags {
  seasonEpisode?: { season: number; episode: number };
  year?: number;
  genres: string[];
}

function parseHashtags(hashtags: string[]): ParsedHashtags {
  let seasonEpisode: ParsedHashtags['seasonEpisode'];
  let year: number | undefined;
  const genres: string[] = [];

  for (const raw of hashtags) {
    if (!seasonEpisode) {
      const seasonMatch = raw.match(HASHTAG_SEASON_EPISODE_RE);
      if (seasonMatch) {
        seasonEpisode = { season: Number(seasonMatch[1]), episode: Number(seasonMatch[2]) };
        continue;
      }
    }
    if (year === undefined) {
      const yearMatch = raw.match(HASHTAG_YEAR_RE);
      if (yearMatch) {
        year = Number(yearMatch[1]);
        continue;
      }
    }
    if (HASHTAG_RESOLUTION_RE.test(raw)) {
      continue;
    }
    const tag = sanitizeUntrustedString(raw.replace(/^#/, ''), GENRE_MAX_LENGTH);
    if (tag.length > 0) {
      genres.push(tag);
    }
  }

  return { seasonEpisode, year, genres };
}

/**
 * Kết hợp fallback tên file (nguồn `title`, luôn thắng) với hashtag (nguồn
 * `season`/`episode` ưu tiên trước, thẻ lạ gộp vào `genres`). Luôn thành
 * công, không throw (biên dữ liệu không tin cậy, cùng bất biến với
 * `parseFilenameFallback()`).
 */
export function deriveFallbackMetadata(msgId: number, titleSource: string, hashtags?: string[]): CatalogItemV1 {
  const base = parseFilenameFallback(msgId, titleSource);
  if (!hashtags || hashtags.length === 0) {
    return base;
  }

  const { seasonEpisode, year, genres } = parseHashtags(hashtags);

  if (seasonEpisode) {
    base.kind = 'episode';
    base.series = { name: base.series?.name ?? base.title ?? titleSource, season: seasonEpisode.season, episode: seasonEpisode.episode };
  }
  if (year !== undefined && base.year === undefined) {
    base.year = year;
  }
  if (genres.length > 0) {
    base.genres = [...(base.genres ?? []), ...genres];
  }
  return base;
}
