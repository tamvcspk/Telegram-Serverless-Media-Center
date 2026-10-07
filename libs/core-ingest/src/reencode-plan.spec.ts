import { describe, expect, it } from 'vitest';
import { calibrateTargetBps, chooseAutoResolution, defaultReencodeBitrateBps, estimateFromSamples, estimateReencodeRangeBytes, isBelowAbrFloor, isReencodeFutile, minAbrVideoBitrateBps, rescaleEstimateBytes, resolutionChoices, resolveAbrFloor, scaledSize, sizeForVideoBitrateBps } from './reencode-plan';
import { computeTargetVideoBitrateBps, REENCODE_AUDIO_BITRATE_BPS } from './size-normalize';

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

describe('minAbrVideoBitrateBps / isBelowAbrFloor', () => {
  it('1080p24 ≈ 2.24 Mbps; hạ độ phân giải thì sàn giảm', () => {
    const full = minAbrVideoBitrateBps({ width: 1920, height: 1080, fps: 24 });
    expect(full).toBeCloseTo(1920 * 1080 * 24 * 0.045, -2);
    expect(minAbrVideoBitrateBps({ width: 1920, height: 1080, fps: 24, maxHeight: 720 })).toBeLessThan(full);
  });
  it('phim 1080p đặt 1.5 Mbps nằm dưới sàn, 3 Mbps thì không', () => {
    const base = { width: 1920, height: 1080, fps: 24 };
    expect(isBelowAbrFloor({ ...base, videoBitrateBps: 1_500_000 })).toBe(true);
    expect(isBelowAbrFloor({ ...base, videoBitrateBps: 3_000_000 })).toBe(false);
  });
  it('thiếu số liệu: không báo dưới sàn', () => {
    expect(isBelowAbrFloor({ width: 0, height: 0, fps: 0, videoBitrateBps: 1 })).toBe(false);
  });
});

describe('calibrateTargetBps', () => {
  const audio = REENCODE_AUDIO_BITRATE_BPS;
  const sampleAt = (videoBps: number) => ({ outBytes: ((videoBps + audio) * 8 * 1.02) / 8, mediaSec: 8, wallSec: 4 });
  it('mẫu cao hơn dự kiến 10% → hạ target ~10%', () => {
    const t = calibrateTargetBps({ targetVideoBitrateBps: 2_000_000, samples: [sampleAt(2_200_000)] });
    expect(t).toBeGreaterThan(1_800_000);
    expect(t).toBeLessThan(1_830_000);
  });
  it('mẫu đúng dự kiến → giữ target', () => {
    const t = calibrateTargetBps({ targetVideoBitrateBps: 2_000_000, samples: [sampleAt(2_000_000)] });
    expect(t).toBeGreaterThanOrEqual(1_999_000);
    expect(t).toBeLessThanOrEqual(2_000_000);
  });
  it('r bị kẹp [0.5, 2]', () => {
    expect(calibrateTargetBps({ targetVideoBitrateBps: 1_000_000, samples: [sampleAt(10_000_000)] })).toBe(500_000);
  });
  it('không có mẫu hợp lệ: null', () => {
    expect(calibrateTargetBps({ targetVideoBitrateBps: 1_000_000, samples: [] })).toBeNull();
  });
});

describe('calibrateTargetBps — desiredVideoBitrateBps', () => {
  const audio = REENCODE_AUDIO_BITRATE_BPS;
  const sampleAt = (videoBps: number) => ({ outBytes: ((videoBps + audio) * 8 * 1.02) / 8, mediaSec: 8, wallSec: 4 });
  it('hội tụ, không trôi: bộ nén ra 0.93× target, đo lại nhiều lần', () => {
    const rho = 0.93;
    const desired = 2_000_000;
    let target = 1_900_000;
    const history: number[] = [];
    for (let i = 0; i < 5; i++) {
      target = calibrateTargetBps({ targetVideoBitrateBps: target, samples: [sampleAt(target * rho)], desiredVideoBitrateBps: desired }) as number;
      history.push(target);
    }
    // đầu ra thực = target × rho phải ≈ desired ở mọi lần sau lần đầu
    for (const t of history.slice(1)) {
      expect(Math.abs(t * rho - desired) / desired).toBeLessThan(0.005);
    }
    expect(Math.abs(history[4] - history[1]) / history[1]).toBeLessThan(0.005);
  });
  it('overshoot +9.9% (ca thật): đầu ra sau hiệu chỉnh ≈ mức muốn', () => {
    const desired = 2_000_000;
    const t = calibrateTargetBps({ targetVideoBitrateBps: 1_900_000, samples: [sampleAt(1_900_000 * 1.099)], desiredVideoBitrateBps: desired }) as number;
    expect(Math.abs(t * 1.099 - desired) / desired).toBeLessThan(0.005);
  });
});

describe('rescaleEstimateBytes', () => {
  it('video tỉ lệ target, audio + overhead giữ nguyên', () => {
    const duration = 1000;
    const audioBytes = (REENCODE_AUDIO_BITRATE_BPS * duration) / 8;
    const before = (1_000_000 * duration / 8 + audioBytes) * 1.02;
    const after = rescaleEstimateBytes({ estimatedBytes: before, durationSec: duration, fromVideoBps: 1_000_000, toVideoBps: 500_000 });
    expect(after).toBeCloseTo((500_000 * duration / 8 + audioBytes) * 1.02, 0);
  });
  it('thiếu số liệu: giữ nguyên', () => {
    expect(rescaleEstimateBytes({ estimatedBytes: 123, durationSec: 0, fromVideoBps: 1, toVideoBps: 2 })).toBe(123);
  });
});

describe('resolveAbrFloor', () => {
  const src = { width: 1920, height: 1080, fps: 24 };
  it('đã đạt sàn: giữ nguyên độ phân giải', () => {
    expect(resolveAbrFloor({ ...src, videoBitrateBps: 5_000_000 })).toEqual({ resolution: undefined });
    expect(resolveAbrFloor({ ...src, videoBitrateBps: 5_000_000, maxHeight: 720 })).toEqual({ resolution: 720 });
  });
  it('dưới sàn ở 1080p: hạ về mức cao nhất còn đạt', () => {
    // sàn 1080p24 ≈ 2.24 Mbps; 720p24 ≈ 1.0 Mbps.
    expect(resolveAbrFloor({ ...src, videoBitrateBps: 1_200_000 })).toEqual({ resolution: 720 });
  });
  it('không mức nào đạt: null', () => {
    expect(resolveAbrFloor({ ...src, videoBitrateBps: 50_000 })).toBeNull();
  });
});

describe('isReencodeFutile', () => {
  const base = { sourceBytes: 2_000_000_000, durationSec: 1000, sourceHeight: 1080 };
  it('target ≥ bitrate video nguồn: vô nghĩa', () => {
    expect(isReencodeFutile({ ...base, targetVideoBitrateBps: 16_000_000 })).toBe(true);
  });
  it('target thấp hơn rõ rệt: có tác dụng', () => {
    expect(isReencodeFutile({ ...base, targetVideoBitrateBps: 8_000_000 })).toBe(false);
  });
  it('đã hạ độ phân giải: không cảnh báo', () => {
    expect(isReencodeFutile({ ...base, targetVideoBitrateBps: 16_000_000, maxHeight: 720 })).toBe(false);
  });
  it('thiếu số liệu: không cảnh báo', () => {
    expect(isReencodeFutile({ ...base, durationSec: 0, targetVideoBitrateBps: 16_000_000 })).toBe(false);
  });
});

describe('defaultReencodeBitrateBps (Hạng D dưới trần)', () => {
  // Caribbean 070307-487.wmv: 829_769_447 byte, 3346.191 s, 720×540, avg 30 fps — bộ nén tự chọn ~390 kbps làm hình vỡ.
  const wmv = { sourceBytes: 829_769_447, durationSec: 3346.191, width: 720, height: 540, fps: 30, maxUploadBytes: 4_000_000_000 };

  it('giữ gần bitrate video của nguồn, cao hơn nhiều mức ~390 kbps mà bộ nén tự chọn', () => {
    const bps = defaultReencodeBitrateBps(wmv);
    const sourceVideoBps = (829_769_447 * 8) / 3346.191 - REENCODE_AUDIO_BITRATE_BPS;
    expect(bps).toBe(Math.floor(sourceVideoBps));
    expect(bps).toBeGreaterThan(1_500_000);
  });

  it('không dưới mức sàn ABR ở độ phân giải đầu ra (nguồn bitrate rất thấp)', () => {
    const bps = defaultReencodeBitrateBps({ ...wmv, sourceBytes: 100_000_000 });
    expect(bps).toBeGreaterThanOrEqual(minAbrVideoBitrateBps(wmv));
  });

  it('không vượt mức vừa trần', () => {
    const bps = defaultReencodeBitrateBps({ ...wmv, sourceBytes: 3_990_000_000 });
    expect(bps).toBeLessThanOrEqual(computeTargetVideoBitrateBps(4_000_000_000, 3346.191));
  });

  it('thiếu số liệu nguồn → 0.1 bit/pixel (hoặc 2 Mbps khi cũng thiếu kích thước)', () => {
    expect(defaultReencodeBitrateBps({ ...wmv, sourceBytes: 0 })).toBe(Math.floor(720 * 540 * 30 * 0.1));
    expect(defaultReencodeBitrateBps({ sourceBytes: 0, durationSec: 0, width: 0, height: 0, fps: 0, maxUploadBytes: 4_000_000_000 })).toBe(100_000);
  });

  it('sizeForVideoBitrateBps là nghịch đảo của computeTargetVideoBitrateBps', () => {
    const size = sizeForVideoBitrateBps(1_800_000, 3346.191);
    expect(Math.abs(computeTargetVideoBitrateBps(size, 3346.191) - 1_800_000)).toBeLessThanOrEqual(1);
  });
});
