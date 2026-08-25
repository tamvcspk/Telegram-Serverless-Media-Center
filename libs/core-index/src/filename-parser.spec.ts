import { describe, expect, it } from 'vitest';
import { parseFilenameFallback } from './filename-parser';

describe('parseFilenameFallback', () => {
  it('nhận diện season/episode → kind episode', () => {
    const item = parseFilenameFallback(1, 'Breaking.Bad.S01E02.1080p-RARBG.mkv');
    expect(item.kind).toBe('episode');
    expect(item.series).toEqual({ name: 'Breaking Bad', season: 1, episode: 2 });
    expect(item.title).toBe('Breaking Bad');
    expect(item.metaSource).toBe('filename');
  });

  it('nhận diện năm trong ngoặc → year', () => {
    const item = parseFilenameFallback(2, 'Dune.Part.Two.(2024).2160p.mkv');
    expect(item.year).toBe(2024);
    expect(item.kind).toBe('movie');
    expect(item.title).toBe('Dune Part Two');
  });

  it('không có season/episode → kind movie, không gắn series', () => {
    const item = parseFilenameFallback(3, 'Inception.2010.1080p.mp4');
    expect(item.kind).toBe('movie');
    expect(item.series).toBeUndefined();
  });

  it('strip nhóm release ở cuối tên file', () => {
    const item = parseFilenameFallback(4, 'Movie.Name.2024.1080p-GROUPNAME.mkv');
    expect(item.title).not.toContain('GROUPNAME');
  });

  it('luôn gắn msgId và metaSource filename', () => {
    const item = parseFilenameFallback(99, 'random_file_no_pattern.mp4');
    expect(item.msgId).toBe(99);
    expect(item.metaSource).toBe('filename');
  });

  it('tên file không có gì nhận diện được vẫn không throw, title dùng tên gốc nếu remainder rỗng', () => {
    expect(() => parseFilenameFallback(1, '.mkv')).not.toThrow();
  });
});
