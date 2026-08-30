import { describe, expect, it } from 'vitest';
import { matchSidecarSubtitles } from './sidecar-subtitles';

describe('@tsmc/core-ingest matchSidecarSubtitles', () => {
  it('nhận "<tên video>.srt" không có lang', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['Movie.srt']);
    expect(result).toEqual([{ lang: undefined, fileName: 'Movie.srt' }]);
  });

  it('nhận "<tên video>.<lang>.srt" và tách đúng lang', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['Movie.vi.srt', 'Movie.en.srt']);
    expect(result).toContainEqual({ lang: 'vi', fileName: 'Movie.vi.srt' });
    expect(result).toContainEqual({ lang: 'en', fileName: 'Movie.en.srt' });
  });

  it('nhận .vtt cùng quy ước như .srt', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['Movie.en.vtt']);
    expect(result).toEqual([{ lang: 'en', fileName: 'Movie.en.vtt' }]);
  });

  it('KHÔNG khớp lại chính file video', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['Movie.mkv', 'Movie.srt']);
    expect(result).toEqual([{ lang: undefined, fileName: 'Movie.srt' }]);
  });

  it('KHÔNG khớp file không cùng basename', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['OtherMovie.srt', 'Movie.Extended.srt']);
    expect(result).toEqual([]);
  });

  it('KHÔNG khớp đuôi không hỗ trợ (.ass cần convert, ngoài phạm vi v1)', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['Movie.ass', 'Movie.vi.ssa']);
    expect(result).toEqual([]);
  });

  it('không phân biệt hoa/thường ở đuôi file', () => {
    const result = matchSidecarSubtitles('Movie.mkv', ['Movie.SRT', 'Movie.VI.SRT']);
    expect(result).toContainEqual({ lang: undefined, fileName: 'Movie.SRT' });
    expect(result).toContainEqual({ lang: 'vi', fileName: 'Movie.VI.SRT' });
  });

  it('mảng rỗng khi không có file nào cạnh video', () => {
    expect(matchSidecarSubtitles('Movie.mkv', [])).toEqual([]);
  });
});
