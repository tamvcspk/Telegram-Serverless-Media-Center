import { describe, expect, it } from 'vitest';
import { chooseAutoResolution, estimateFromSamples, estimateReencodeRangeBytes, resolutionChoices, scaledSize } from './reencode-plan';
import { REENCODE_AUDIO_BITRATE_BPS } from './size-normalize';

describe('scaledSize / resolutionChoices', () => {
  it('hạ 1920x1080 về 720 giữ tỉ lệ, chẵn', () => {
    expect(scaledSize(1920, 1080, 720)).toEqual({ width: 1280, height: 720 });
  });
  it('không phóng to; kích thước lẻ làm tròn xuống chẵn', () => {
    expect(scaledSize(1279, 719, 1080)).toEqual({ width: 1278, height: 718 });
    expect(scaledSize(1280, 720, undefined)).toEqual({ width: 1280, height: 720 });
  });
  it('chỉ đề xuất mức thấp hơn nguồn', () => {
    expect(resolutionChoices(1080)).toEqual([720, 576, 480, 360]);
    expect(resolutionChoices(360)).toEqual([]);
  });
});

describe('chooseAutoResolution', () => {
  it('bitrate dư dả: giữ nguyên độ phân giải', () => {
    expect(chooseAutoResolution({ width: 1920, height: 1080, fps: 24, videoBitrateBps: 6_000_000 })).toBeUndefined();
  });
  it('bitrate thấp: hạ xuống mức cao nhất còn đạt ngưỡng', () => {
    // 1.5 Mbps: 1080p24 ≈ 0.030 (trượt); 720p24 ≈ 0.068 (đạt)
    expect(chooseAutoResolution({ width: 1920, height: 1080, fps: 24, videoBitrateBps: 1_500_000 })).toBe(720);
  });
  it('quá thấp cho mọi mức: lấy mức thấp nhất', () => {
    expect(chooseAutoResolution({ width: 1920, height: 1080, fps: 24, videoBitrateBps: 100_000 })).toBe(360);
  });
  it('thiếu số liệu nguồn: giữ nguyên', () => {
    expect(chooseAutoResolution({ width: 0, height: 0, fps: 0, videoBitrateBps: 100_000 })).toBeUndefined();
  });
});

describe('estimateReencodeRangeBytes', () => {
  it('khoảng bao quanh ước tính theo bitrate mục tiêu', () => {
    const r = estimateReencodeRangeBytes({ targetVideoBitrateBps: 2_000_000, durationSec: 3600 });
    const nominal = ((2_000_000 + REENCODE_AUDIO_BITRATE_BPS) * 3600) / 8;
    expect(r.minBytes).toBeLessThan(nominal);
    expect(r.maxBytes).toBeGreaterThan(nominal);
  });
});

describe('estimateFromSamples', () => {
  it('ngoại suy byte/giây và tốc độ theo tổng', () => {
    const e = estimateFromSamples(
      [
        { outBytes: 8_000_000, mediaSec: 8, wallSec: 4 },
        { outBytes: 16_000_000, mediaSec: 8, wallSec: 4 }
      ],
      3600
    );
    expect(e?.estimatedBytes).toBeCloseTo(1_500_000 * 3600, 0);
    expect(e?.speedXRealtime).toBeCloseTo(2, 5);
    expect(e?.etaSec).toBeCloseTo(1800, 5);
  });
  it('không có mẫu hợp lệ: null', () => {
    expect(estimateFromSamples([], 3600)).toBeNull();
    expect(estimateFromSamples([{ outBytes: 1, mediaSec: 0, wallSec: 1 }], 3600)).toBeNull();
  });
});
