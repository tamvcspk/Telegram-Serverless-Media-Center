import { describe, expect, it } from 'vitest';
import { inheritMetadata, seedMetadataFromFilename } from './metadata-inherit';

describe('seedMetadataFromFilename', () => {
  it('suy season/episode/title từ tên file — item đầu tiên của series', () => {
    const item = seedMetadataFromFilename(100, 'Dune.S01E01.1080p.mkv');
    expect(item.series).toEqual({ name: 'Dune', season: 1, episode: 1 });
    expect(item.kind).toBe('episode');
  });
});

describe('inheritMetadata', () => {
  it('kế thừa title/genres/cast/director từ item trước, chỉ đổi msgId + season/episode theo tên file mới', () => {
    const previous = {
      msgId: 100,
      title: 'Dune',
      genres: ['sci-fi'],
      cast: ['Timothée Chalamet'],
      director: 'Denis Villeneuve',
      year: 2024,
      kind: 'episode' as const,
      series: { name: 'Dune', season: 1, episode: 1 },
      metaSource: 'manual' as const
    };

    const next = inheritMetadata(101, 'Dune.S01E02.1080p.mkv', previous);

    expect(next.msgId).toBe(101);
    expect(next.series).toEqual({ name: 'Dune', season: 1, episode: 2 });
    expect(next.title).toBe('Dune');
    expect(next.genres).toEqual(['sci-fi']);
    expect(next.cast).toEqual(['Timothée Chalamet']);
    expect(next.director).toBe('Denis Villeneuve');
    expect(next.year).toBe(2024);
    expect(next.metaSource).toBe('manual');
  });

  it('tên file mới không khớp season/episode nào → giữ nguyên series của item trước, không tự đoán tăng', () => {
    const previous = {
      msgId: 100,
      title: 'Dune',
      kind: 'episode' as const,
      series: { name: 'Dune', season: 1, episode: 1 }
    };

    const next = inheritMetadata(101, 'random-extra-file.mkv', previous);

    expect(next.series).toEqual({ name: 'Dune', season: 1, episode: 1 });
  });

  it('previous không phải episode (movie) — kind giữ nguyên nếu file mới cũng không khớp season/episode', () => {
    const previous = { msgId: 100, title: 'Dune', kind: 'movie' as const };
    const next = inheritMetadata(101, 'Dune.Part.Two.2024.mkv', previous);
    expect(next.kind).toBe('movie');
  });

  it('BUG THẬT 2026-08-30: tên file mới CHỈ có SxxExx trần trụi (không mang tên phim) → series.name PHẢI kế thừa từ item trước, KHÔNG lấy nguyên filename làm tên phim', () => {
    const previous = {
      msgId: 6,
      title: 'The bigbang Theory',
      kind: 'episode' as const,
      series: { name: 'The bigbang Theory', season: 1, episode: 1 },
      compat: 'full' as const,
      metaSource: 'manual' as const
    };

    const next = inheritMetadata(9, 'S01E02.mp4', previous);

    // Season/episode PHẢI lấy từ file mới (mỗi tập một số khác nhau).
    expect(next.series).toEqual({ name: 'The bigbang Theory', season: 1, episode: 2 });
    // Không phải như bug thật đã thấy trong catalog.json: { name: "S01E02.mp4", ... }.
    expect(next.series?.name).not.toBe('S01E02.mp4');
  });

  it('previous chưa có series (item đầu tiên seed từ filename trần trụi, chưa từng đúng "episode") — kế thừa qua title, không rơi về filename', () => {
    const previous = { msgId: 6, title: 'Some Show', kind: 'movie' as const };
    const next = inheritMetadata(9, 'S01E02.mp4', previous);
    expect(next.series).toEqual({ name: 'Some Show', season: 1, episode: 2 });
  });
});
