// Ghi hashtag vào caption message lúc upload — ADR-0014 § addendum
// 2026-09-17 (brainstorm TMDB nâng cao + hashtag): quyết định GHI MỘT LẦN
// lúc publish, KHÔNG đồng bộ lại caption khi admin sửa metadata về sau (chấp
// nhận hashtag "đóng băng" tại thời điểm publish, cùng tinh thần
// `DocumentAttributeFilename` gốc vốn cũng bất biến sau upload). Lợi ích: ai
// browse trực tiếp bằng Telegram app gốc (không qua TSMC) tap hashtag vẫn
// lọc được theo season/năm/thể loại trong chính kênh đó — MIỄN PHÍ, không
// tốn RPC nào (append vào field `caption` vốn đã gửi kèm `sendFile`).
//
// Format cố ý khớp ĐÚNG pattern mà `libs/core-index/src/hashtag-parser.ts`
// (`deriveFallbackMetadata()`, tầng ĐỌC — quét kênh cộng đồng bất kỳ) đã kỳ
// vọng — khép kín vòng ghi→đọc: `#S01E02`, năm 4 số, genre tự do (khoảng
// trắng/dấu câu bị strip vì hashtag Telegram không được chứa khoảng trắng).
import type { CatalogItemV1 } from '@tsmc/shared-models';

const GENRE_HASHTAG_MAX_LENGTH = 50;

/** Chuyển một chuỗi tự do (vd "Science Fiction") thành hashtag hợp lệ (vd
 * "#ScienceFiction") — giữ chữ/số Unicode (kể cả tiếng Việt có dấu), bỏ
 * khoảng trắng/dấu câu (Telegram không chấp nhận trong hashtag). Rỗng sau
 * khi lọc → bỏ qua (không sinh hashtag rỗng `#`). */
function toHashtag(text: string): string {
  const cleaned = text
    .replace(/[^\p{L}\p{N}_]+/gu, '')
    .slice(0, GENRE_HASHTAG_MAX_LENGTH);
  return cleaned.length > 0 ? `#${cleaned}` : '';
}

/** Ghép caption cho message video/poster lúc upload — dòng đầu là title (tự
 * nhiên, không phải hashtag), dòng sau là các hashtag suy từ đúng field đã
 * có trong `item` (không suy luận thêm gì ngoài field đã tồn tại). Không có
 * field nào sinh hashtag → trả về title trơn (hoặc chuỗi rỗng nếu cả title
 * cũng chưa có — caption rỗng vẫn hợp lệ với `sendFile`). */
export function composeCaption(item: CatalogItemV1): string {
  const lines: string[] = [];
  if (item.title) {
    lines.push(item.title);
  }

  const tags: string[] = [];
  if (item.series?.season !== undefined && item.series?.episode !== undefined) {
    const season = String(item.series.season).padStart(2, '0');
    const episode = String(item.series.episode).padStart(2, '0');
    tags.push(`#S${season}E${episode}`);
  }
  if (item.year !== undefined) {
    tags.push(`#${item.year}`);
  }
  for (const genre of item.genres ?? []) {
    const tag = toHashtag(genre);
    if (tag) {
      tags.push(tag);
    }
  }
  if (tags.length > 0) {
    lines.push(tags.join(' '));
  }

  return lines.join('\n');
}
