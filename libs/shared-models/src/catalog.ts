// Catalog Spec v1 — ADR-0010, docs/catalog-spec.md. Dữ liệu do người lạ soạn
// (kênh cộng đồng bất kỳ) — mọi field phải qua schema Valibot trước khi được
// tin, và item sai kiểu bị LOẠI BỎ riêng từng item chứ không làm hỏng cả
// catalog (catalog-spec.md §"Client đọc catalog phải làm gì" điểm 1).
//
// `trustedPublishers` trong JSON chỉ được lưu lại để THAM KHẢO — KHÔNG dùng
// làm biên an ninh: đây là trường tự khai báo bởi chính catalog, một kênh
// cộng đồng bất kỳ có thể tự liệt id của mình vào đó. Biên an ninh thật là
// kiểm tra publisher qua channels.getParticipants (admin thật của kênh) —
// xem libs/core-index/src/trust.ts.
import * as v from 'valibot';

const CATALOG_SPEC_V1 = 'tsmc-catalog/1' as const;

const MAX_STRING_LENGTH = 200;
const MAX_ARRAY_LENGTH = 100;

// Ranh giới mã điểm (code point) cần strip — viết bằng số hex thay vì literal
// ký tự để tránh nhét thẳng ký tự vô hình/đảo chiều vào mã nguồn (không ai
// review được một ký tự vô hình nằm trong file .ts).
const CONTROL_CHAR_MAX = 0x1f; // C0 control chars, code point 0..31
const BIDI_EMBED_MIN = 0x202a; // LRE/RLE/PDF/LRO/RLO
const BIDI_EMBED_MAX = 0x202e;
const BIDI_ISOLATE_MIN = 0x2066; // LRI/RLI/FSI/PDI
const BIDI_ISOLATE_MAX = 0x2069;

function isUnsafeCodePoint(code: number): boolean {
  if (code <= CONTROL_CHAR_MAX) {
    return true;
  }
  if (code >= BIDI_EMBED_MIN && code <= BIDI_EMBED_MAX) {
    return true;
  }
  return code >= BIDI_ISOLATE_MIN && code <= BIDI_ISOLATE_MAX;
}

/**
 * Strip ký tự điều khiển C0 và ký tự đảo chiều Unicode bidi (mẹo giả mạo tên
 * file kinh điển — catalog-spec.md §"Client đọc catalog phải làm gì" điểm 3),
 * rồi cắt về `maxLen`.
 */
export function sanitizeUntrustedString(input: string, maxLen: number = MAX_STRING_LENGTH): string {
  let result = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (!isUnsafeCodePoint(code)) {
      result += ch;
    }
  }
  return result.slice(0, maxLen).trim();
}

const untrustedString = (maxLen: number = MAX_STRING_LENGTH) =>
  v.pipe(
    v.string(),
    v.transform((s: string) => sanitizeUntrustedString(s, maxLen))
  );

const untrustedStringArray = (maxLen: number = MAX_STRING_LENGTH) =>
  v.pipe(v.array(untrustedString(maxLen)), v.maxLength(MAX_ARRAY_LENGTH));

const seriesSchema = v.object({
  name: untrustedString(),
  season: v.optional(v.number()),
  episode: v.optional(v.number())
});

const videoSchema = v.object({
  w: v.optional(v.number()),
  h: v.optional(v.number()),
  codec: v.optional(untrustedString(50))
});

const audioTrackSchema = v.object({
  lang: untrustedString(20)
});

const subtitleSchema = v.object({
  lang: untrustedString(20),
  msgId: v.number()
});

const posterSchema = v.object({
  msgId: v.number()
});

const compatSchema = v.picklist(['full', 'partial', 'unplayable']);
const metaSourceSchema = v.picklist(['manual', 'filename', 'bot']);
const kindSchema = v.picklist(['movie', 'episode']);

// Item schema — chỉ msgId bắt buộc (catalog-spec.md §"Ba nguyên tắc thiết kế").
export const catalogItemV1Schema = v.object({
  msgId: v.number(),
  title: v.optional(untrustedString()),
  originalTitle: v.optional(untrustedString()),
  year: v.optional(v.number()),
  genres: v.optional(untrustedStringArray(50)),
  // ADR-0010 § Cập nhật 2026-08-29 (mục A) — nguyên văn tên Forum Topic
  // (vd "Phim lẻ", "Phim bộ"), do admin kênh đặt để TỰ TỔ CHỨC kênh, khác
  // bản chất với `genres` (mô tả NỘI DUNG phim) nên KHÔNG gộp chung. Không
  // suy luận `kind`/`series` từ giá trị này — xem "Đánh đổi chấp nhận" ở ADR.
  topic: v.optional(untrustedString()),
  kind: v.optional(kindSchema),
  series: v.optional(seriesSchema),
  runtime: v.optional(v.number()),
  size: v.optional(v.number()),
  video: v.optional(videoSchema),
  audio: v.optional(v.pipe(v.array(audioTrackSchema), v.maxLength(MAX_ARRAY_LENGTH))),
  subs: v.optional(v.pipe(v.array(subtitleSchema), v.maxLength(MAX_ARRAY_LENGTH))),
  poster: v.optional(posterSchema),
  cast: v.optional(untrustedStringArray(100)),
  director: v.optional(untrustedString()),
  compat: v.optional(compatSchema),
  metaSource: v.optional(metaSourceSchema)
});

export type CatalogItemV1 = v.InferOutput<typeof catalogItemV1Schema>;

const catalogChannelRefSchema = v.object({
  id: v.optional(v.union([v.string(), v.number()])),
  title: v.optional(untrustedString())
});

// Envelope — KHÔNG validate `items` ở đây (mỗi item được parse/lọc riêng
// bằng parseCatalogItem, xem dưới).
export const catalogEnvelopeV1Schema = v.object({
  spec: v.literal(CATALOG_SPEC_V1),
  channel: v.optional(catalogChannelRefSchema),
  generatedAt: v.string(),
  trustedPublishers: v.optional(v.array(v.union([v.string(), v.number()])))
});

export type CatalogEnvelopeV1 = v.InferOutput<typeof catalogEnvelopeV1Schema>;

/**
 * Parse phần khung catalog (không phải `items`). `spec` khác `tsmc-catalog/1`
 * (major version lạ) → null, không cố đoán — catalog-spec.md §Phiên bản.
 */
export function parseCatalogEnvelope(raw: unknown): CatalogEnvelopeV1 | null {
  const result = v.safeParse(catalogEnvelopeV1Schema, raw);
  return result.success ? result.output : null;
}

/**
 * Parse một item catalog. Sai kiểu → null (item đó bị loại, không làm hỏng
 * cả catalog — gọi hàm này riêng cho từng phần tử của mảng `items`).
 */
export function parseCatalogItem(raw: unknown): CatalogItemV1 | null {
  const result = v.safeParse(catalogItemV1Schema, raw);
  return result.success ? result.output : null;
}
