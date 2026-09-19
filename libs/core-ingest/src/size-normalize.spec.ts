import { describe, expect, it } from 'vitest';
import { computeTargetVideoBitrateBps, MIN_VIDEO_BITRATE_BPS, REENCODE_AUDIO_BITRATE_BPS } from './size-normalize';

describe('computeTargetVideoBitrateBps', () => {
  it('tính đúng cho trường hợp thường: trần 2 GB, phim 2 giờ', () => {
    const bps = computeTargetVideoBitrateBps(2_000_000_000, 7200);
    // 2e9 * 0.92 * 8 / 7200 = 2_044_444 bps tổng; * 0.98 - 160_000 = ~1_843_555
    expect(bps).toBe(Math.floor(((2_000_000_000 * 0.92 * 8) / 7200) * 0.98 - REENCODE_AUDIO_BITRATE_BPS));
    expect(bps).toBeGreaterThan(1_800_000);
    expect(bps).toBeLessThan(1_900_000);
  });

  it('file tổng đầu ra ước tính (video + audio) nằm dưới trần', () => {
    const maxBytes = 4_000_000_000;
    const duration = 5400;
    const videoBps = computeTargetVideoBitrateBps(maxBytes, duration);
    const estimatedBytes = ((videoBps + REENCODE_AUDIO_BITRATE_BPS) * duration) / 8;
    expect(estimatedBytes).toBeLessThan(maxBytes);
  });

  it('kẹp ở sàn khi thời lượng quá dài khiến ngân sách âm/quá thấp', () => {
    expect(computeTargetVideoBitrateBps(1_000_000, 100_000)).toBe(MIN_VIDEO_BITRATE_BPS);
  });

  it('durationSec = 0, âm hoặc NaN trả về sàn, không chia cho 0', () => {
    expect(computeTargetVideoBitrateBps(2_000_000_000, 0)).toBe(MIN_VIDEO_BITRATE_BPS);
    expect(computeTargetVideoBitrateBps(2_000_000_000, -5)).toBe(MIN_VIDEO_BITRATE_BPS);
    expect(computeTargetVideoBitrateBps(2_000_000_000, Number.NaN)).toBe(MIN_VIDEO_BITRATE_BPS);
  });
});
