import { describe, expect, it } from 'vitest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { deriveFallbackMetadata } from '@tsmc/core-index';
import { composeCaption } from './caption-hashtags';

/** Tách hashtag ra khỏi một dòng caption bằng khoảng trắng — mô phỏng đúng
 * cách Telegram tách `MessageEntityHashtag` khỏi text thật (mỗi `#word` là
 * MỘT entity riêng), dùng cho test round-trip ghi→đọc bên dưới. Không phải
 * code sản phẩm — hashtag thật lúc ĐỌC lấy qua `message.entities`
 * (`gateway-index.ts`), không phải regex lại caption thô. */
function extractHashtags(caption: string): string[] {
  return caption.split(/\s+/).filter((word) => word.startsWith('#'));
}

describe('composeCaption', () => {
  it('không có field nào ngoài title → caption chỉ có title, không hashtag', () => {
    const item: CatalogItemV1 = { msgId: 1, title: 'Inception' };
    expect(composeCaption(item)).toBe('Inception');
  });

  it('item rỗng hoàn toàn → caption rỗng', () => {
    expect(composeCaption({ msgId: 1 })).toBe('');
  });

  it('season/episode → hashtag #SxxExx đúng 2 chữ số kể cả season/ep 1 chữ số', () => {
    const item: CatalogItemV1 = { msgId: 1, title: 'Breaking Bad', series: { name: 'Breaking Bad', season: 1, episode: 2 } };
    expect(composeCaption(item)).toBe('Breaking Bad\n#S01E02');
  });

  it('year → hashtag #YYYY', () => {
    const item: CatalogItemV1 = { msgId: 1, title: 'Dune: Part Two', year: 2024 };
    expect(composeCaption(item)).toBe('Dune: Part Two\n#2024');
  });

  it('genres nhiều từ → strip khoảng trắng, không sinh hashtag rỗng', () => {
    const item: CatalogItemV1 = { msgId: 1, title: 'Dune: Part Two', genres: ['Science Fiction', 'Adventure', '   '] };
    expect(composeCaption(item)).toBe('Dune: Part Two\n#ScienceFiction #Adventure');
  });

  it('kết hợp season/episode + year + genres, đúng thứ tự', () => {
    const item: CatalogItemV1 = {
      msgId: 1,
      title: 'Some Show',
      series: { name: 'Some Show', season: 3, episode: 9 },
      year: 2023,
      genres: ['Anime']
    };
    expect(composeCaption(item)).toBe('Some Show\n#S03E09 #2023 #Anime');
  });

  it('round-trip: hashtag sinh ra từ composeCaption() được deriveFallbackMetadata() đọc lại đúng season/episode/year/genres', () => {
    const original: CatalogItemV1 = {
      msgId: 1,
      title: 'Some Show',
      series: { name: 'Some Show', season: 3, episode: 9 },
      year: 2023,
      genres: ['scifi']
    };
    const caption = composeCaption(original);
    const hashtags = extractHashtags(caption);

    const reread = deriveFallbackMetadata(1, 'Some.Show.mkv', hashtags);
    expect(reread.series).toEqual({ name: 'Some Show', season: 3, episode: 9 });
    expect(reread.year).toBe(2023);
    expect(reread.genres).toEqual(['scifi']);
  });
});
