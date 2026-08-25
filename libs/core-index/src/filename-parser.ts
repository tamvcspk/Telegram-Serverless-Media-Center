// Fallback parse metadata từ tên file khi kênh không có catalog — ADR-0010
// mục 4. Parser regex đơn giản (season/episode, năm, độ phân giải, nhóm
// release) — KHÔNG xử lý hashtag (ADR-0010 có nhắc "tên file và hashtag",
// nhưng hashtag đòi hỏi đọc lại text của message gốc thay vì chỉ filename;
// để dành nếu sau này cần, MVP slice này chỉ cần chứng minh 3-tier hoạt
// động, không cần độ chính xác metadata tối đa).
import { sanitizeUntrustedString, type CatalogItemV1 } from '@tsmc/shared-models';

const SEASON_EPISODE_RE = /S(\d{1,2})E(\d{1,2})/i;
const YEAR_RE = /\((19|20)\d{2}\)/;
const RESOLUTION_RE = /\b(720p|1080p|2160p|4k)\b/i;
const EXTENSION_RE = /\.[A-Za-z0-9]+$/;
const RELEASE_GROUP_RE = /-[A-Za-z0-9]+$/;

function stripAll(base: string, matches: Array<RegExpMatchArray | null>): string {
  let result = base;
  for (const m of matches) {
    if (m) {
      result = result.replace(m[0], ' ');
    }
  }
  return result;
}

/** Parse một item từ tên file — luôn thành công, không bao giờ throw (biên dữ liệu không tin cậy). */
export function parseFilenameFallback(msgId: number, fileName: string): CatalogItemV1 {
  const withoutExt = fileName.replace(EXTENSION_RE, '');
  const groupMatch = withoutExt.match(RELEASE_GROUP_RE);
  const seasonMatch = withoutExt.match(SEASON_EPISODE_RE);
  const yearMatch = withoutExt.match(YEAR_RE);
  const resolutionMatch = withoutExt.match(RESOLUTION_RE);

  const remainder = stripAll(withoutExt, [groupMatch, seasonMatch, yearMatch, resolutionMatch]);
  const title = sanitizeUntrustedString(
    remainder
      .replace(/[._]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );

  const resolvedTitle = title.length > 0 ? title : fileName;
  const item: CatalogItemV1 = {
    msgId,
    title: resolvedTitle,
    kind: seasonMatch ? 'episode' : 'movie',
    metaSource: 'filename'
  };
  if (seasonMatch) {
    item.series = { name: resolvedTitle, season: Number(seasonMatch[1]), episode: Number(seasonMatch[2]) };
  }
  if (yearMatch) {
    item.year = Number(yearMatch[0].replace(/[()]/g, ''));
  }
  return item;
}
