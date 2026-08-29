import { describe, expect, it } from 'vitest';
import { deriveFallbackMetadata } from './hashtag-parser';

describe('deriveFallbackMetadata', () => {
  it('không có hashtag → hành vi y hệt parseFilenameFallback()', () => {
    const item = deriveFallbackMetadata(1, 'Breaking.Bad.S01E02.1080p-RARBG.mkv');
    expect(item.kind).toBe('episode');
    expect(item.series).toEqual({ name: 'Breaking Bad', season: 1, episode: 2 });
  });

  it('hashtag season/episode thắng filename (mục B.2) khi cả hai đều khớp, title vẫn từ filename (mục B.3)', () => {
    const item = deriveFallbackMetadata(1, 'Breaking.Bad.S01E02.1080p-RARBG.mkv', ['#S03E09']);
    expect(item.kind).toBe('episode');
    expect(item.series).toEqual({ name: 'Breaking Bad', season: 3, episode: 9 });
    expect(item.title).toBe('Breaking Bad');
  });

  it('filename KHÔNG có season/episode, hashtag CÓ → dùng hashtag, series.name rơi về title (không có filename series.name)', () => {
    const item = deriveFallbackMetadata(1, 'Some.Show.mkv', ['#S02E05']);
    expect(item.kind).toBe('episode');
    expect(item.series).toEqual({ name: 'Some Show', season: 2, episode: 5 });
  });

  it('hashtag năm — chỉ dùng khi filename KHÔNG có year', () => {
    const withoutYear = deriveFallbackMetadata(1, 'Some.Movie.mkv', ['#2019']);
    expect(withoutYear.year).toBe(2019);

    const withYear = deriveFallbackMetadata(2, 'Dune.Part.Two.(2024).mkv', ['#2019']);
    expect(withYear.year).toBe(2024);
  });

  it('hashtag độ phân giải được nhận diện (loại khỏi genres) nhưng không lưu vào field nào', () => {
    const item = deriveFallbackMetadata(1, 'Some.Movie.mkv', ['#1080p', '#2160p', '#4k']);
    expect(item.genres).toBeUndefined();
  });

  it('hashtag không khớp season/episode/year/resolution nào → gộp vào genres (mục B.4)', () => {
    const item = deriveFallbackMetadata(1, 'Some.Movie.mkv', ['#scifi', '#adventure']);
    expect(item.genres).toEqual(['scifi', 'adventure']);
  });

  it('hashtag hỗn hợp: season/episode + năm + thẻ lạ, mỗi loại đi đúng chỗ', () => {
    const item = deriveFallbackMetadata(1, 'Some.Show.mkv', ['#S01E01', '#2023', '#anime']);
    expect(item.series).toEqual({ name: 'Some Show', season: 1, episode: 1 });
    expect(item.year).toBe(2023);
    expect(item.genres).toEqual(['anime']);
  });

  it('sanitize hashtag lạ (strip ky tu dieu khien) truoc khi gop vao genres', () => {
    const withControlChar = '#haihuoc';
    const item = deriveFallbackMetadata(1, 'Some.Movie.mkv', [withControlChar]);
    expect(item.genres).toEqual(['haihuoc']);
  });

  it('mảng hashtags rỗng → hành vi y hệt không có hashtag', () => {
    const item = deriveFallbackMetadata(1, 'Inception.2010.1080p.mp4', []);
    expect(item.kind).toBe('movie');
    expect(item.genres).toBeUndefined();
  });
});
