import { describe, expect, it } from 'vitest';
import { classifyCompatRank, deriveCompat, type ProbeResult } from './compat-rank';

function probe(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    container: 'mp4',
    durationSec: 3600,
    video: { codec: 'h264', width: 1920, height: 1080 },
    audio: [{ codec: 'aac' }],
    subtitles: [],
    ...overrides
  };
}

describe('classifyCompatRank', () => {
  it('Hạng A: MP4 + H.264 + AAC', () => {
    expect(classifyCompatRank(probe()).rank).toBe('A');
  });

  it('Hạng B: MP4 + HEVC', () => {
    const result = classifyCompatRank(probe({ video: { codec: 'hevc', width: 3840, height: 2160 } }));
    expect(result.rank).toBe('B');
  });

  it('Hạng B: MP4 + audio Opus', () => {
    const result = classifyCompatRank(probe({ audio: [{ codec: 'opus' }] }));
    expect(result.rank).toBe('B');
  });

  it('Hạng B: MP4 + audio E-AC-3', () => {
    const result = classifyCompatRank(probe({ audio: [{ codec: 'eac3' }] }));
    expect(result.rank).toBe('B');
  });

  it('Hạng C: MKV + H.264 + audio DTS → remux', () => {
    const result = classifyCompatRank(probe({ container: 'matroska', audio: [{ codec: 'dts' }] }));
    expect(result.rank).toBe('C');
  });

  it('Hạng C: MPEG-TS + H.264', () => {
    const result = classifyCompatRank(probe({ container: 'mpegts' }));
    expect(result.rank).toBe('C');
  });

  it('Hạng C: MKV + phụ đề PGS ghi lý do rút subs riêng', () => {
    const result = classifyCompatRank(probe({ container: 'matroska', subtitles: [{ codec: 'hdmv_pgs_subtitle' }] }));
    expect(result.rank).toBe('C');
    expect(result.reasons.some((r) => r.includes('PGS'))).toBe(true);
  });

  it('Hạng D: container AVI bất kể codec bên trong (H.264)', () => {
    const result = classifyCompatRank(probe({ container: 'avi' }));
    expect(result.rank).toBe('D');
  });

  it('Hạng D: video codec VC-1 trong MKV — không remux được, phải re-encode', () => {
    const result = classifyCompatRank(probe({ container: 'matroska', video: { codec: 'vc1', width: 1280, height: 720 } }));
    expect(result.rank).toBe('D');
  });

  it('Hạng D: không có video stream', () => {
    const result = classifyCompatRank(probe({ video: undefined }));
    expect(result.rank).toBe('D');
  });

  it('Hạng D: container lạ/không nhận diện được', () => {
    const result = classifyCompatRank(probe({ container: 'other' }));
    expect(result.rank).toBe('D');
  });
});

describe('deriveCompat', () => {
  it('full: H.264 + AAC', () => {
    expect(deriveCompat({ codec: 'h264', width: 1920, height: 1080 }, [{ codec: 'aac' }])).toBe('full');
  });

  it('partial: HEVC + AAC (sau remux copy video HEVC)', () => {
    expect(deriveCompat({ codec: 'hevc', width: 3840, height: 2160 }, [{ codec: 'aac' }])).toBe('partial');
  });

  it('partial: H.264 + audio không phải AAC', () => {
    expect(deriveCompat({ codec: 'h264', width: 1920, height: 1080 }, [{ codec: 'mp3' }])).toBe('partial');
  });

  it('unplayable: không có video', () => {
    expect(deriveCompat(undefined, [{ codec: 'aac' }])).toBe('unplayable');
  });

  it('unplayable: video codec trình duyệt không giải được', () => {
    expect(deriveCompat({ codec: 'vc1', width: 1280, height: 720 }, [{ codec: 'aac' }])).toBe('unplayable');
  });

  it('không bao giờ ngầm định "full" khi audio rỗng (catalog-spec.md: thiếu compat không được giả định full)', () => {
    expect(deriveCompat({ codec: 'h264', width: 1920, height: 1080 }, [])).toBe('partial');
  });
});
