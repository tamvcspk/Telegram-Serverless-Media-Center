import { describe, expect, it } from 'vitest';
import { bitsPerPixel, chooseDefaultStrategy, computeTargetVideoBitrateBps, MIN_VIDEO_BITRATE_BPS, planSizeCap, REENCODE_AUDIO_BITRATE_BPS, SIZE_SAFETY_MARGIN, TWO_PASS_SAFETY_MARGIN } from './size-normalize';

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

describe('planSizeCap', () => {
  it('file nguồn nhỏ hơn trần: không vượt, không có bitrate mục tiêu', () => {
    expect(planSizeCap({ sourceBytes: 1_500_000_000, durationSec: 5400, maxUploadBytes: 2_000_000_000 })).toEqual({ exceedsCap: false });
  });

  it('đúng bằng trần: chưa vượt', () => {
    expect(planSizeCap({ sourceBytes: 2_000_000_000, durationSec: 5400, maxUploadBytes: 2_000_000_000 }).exceedsCap).toBe(false);
  });

  it('file nguồn lớn hơn trần: vượt, kèm đúng bitrate mục tiêu của computeTargetVideoBitrateBps', () => {
    const plan = planSizeCap({ sourceBytes: 4_300_000_000, durationSec: 7200, maxUploadBytes: 4_000_000_000 });
    expect(plan.exceedsCap).toBe(true);
    expect(plan.targetVideoBitrateBps).toBe(computeTargetVideoBitrateBps(4_000_000_000, 7200));
  });

  it('dung lượng nguồn không hợp lệ (0, âm, NaN): không chặn nhầm', () => {
    for (const sourceBytes of [0, -1, Number.NaN]) {
      expect(planSizeCap({ sourceBytes, durationSec: 5400, maxUploadBytes: 2_000_000_000 }).exceedsCap).toBe(false);
    }
  });
});

describe('chooseDefaultStrategy', () => {
  const cap = 4_000_000_000;
  it('chưa vượt trần: null', () => {
    expect(chooseDefaultStrategy({ sourceBytes: cap, maxUploadBytes: cap, mustReencode: false })).toBeNull();
  });
  it('Hạng D vượt trần: luôn nén lại, dù cần giảm nhiều', () => {
    expect(chooseDefaultStrategy({ sourceBytes: 10_000_000_000, maxUploadBytes: cap, mustReencode: true })).toBe('reencode');
  });
  it('A/B/C cần giảm ≤ 15%: nén lại', () => {
    // 4.2 GB → r = 3.68/4.2 → giảm ~12.4%
    expect(chooseDefaultStrategy({ sourceBytes: 4_200_000_000, maxUploadBytes: cap, mustReencode: false })).toBe('reencode');
  });
  it('A/B/C cần giảm > 15%: chia phần', () => {
    // 4.5 GB → giảm ~18.2%
    expect(chooseDefaultStrategy({ sourceBytes: 4_500_000_000, maxUploadBytes: cap, mustReencode: false })).toBe('split');
  });
});

describe('bitsPerPixel', () => {
  it('1080p24 ở 4 Mbps ≈ 0.08', () => {
    expect(bitsPerPixel({ bitrateBps: 4_000_000, width: 1920, height: 1080, fps: 24 })).toBeCloseTo(0.0804, 3);
  });
  it('tham số không hợp lệ: null', () => {
    expect(bitsPerPixel({ bitrateBps: 0, width: 1920, height: 1080, fps: 24 })).toBeNull();
    expect(bitsPerPixel({ bitrateBps: 1e6, width: 0, height: 1080, fps: 24 })).toBeNull();
    expect(bitsPerPixel({ bitrateBps: 1e6, width: 1920, height: 1080, fps: Number.NaN })).toBeNull();
  });
});

describe('TWO_PASS_SAFETY_MARGIN', () => {
  it('cao hơn margin 1-pass nhưng vẫn dưới 1: 2-pass bám đích ±2% nên 0.97 × 1.02 < 1', () => {
    expect(TWO_PASS_SAFETY_MARGIN).toBeGreaterThan(SIZE_SAFETY_MARGIN);
    expect(TWO_PASS_SAFETY_MARGIN * 1.02).toBeLessThan(1);
  });

  it('margin cao hơn cho nhiều bitrate hơn ở cùng trần', () => {
    const base = computeTargetVideoBitrateBps(2_000_000_000, 10_800);
    const twoPass = computeTargetVideoBitrateBps(2_000_000_000, 10_800, REENCODE_AUDIO_BITRATE_BPS, TWO_PASS_SAFETY_MARGIN);
    expect(twoPass).toBeGreaterThan(base);
  });
});
