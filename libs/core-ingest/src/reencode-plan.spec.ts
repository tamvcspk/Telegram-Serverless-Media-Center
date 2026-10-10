import { describe, expect, it } from 'vitest';
import { chooseAutoResolution, chooseRateMode, CRF_PREDICTION_DEVIATION, crfCeilingBytes, defaultRf, estimateFromSamples, extrapolateCrfBytes, isReencodeFutile, planCrf, presetSpeedVsFast, resolutionChoices, scaledSize } from './reencode-plan';
import { computeTargetVideoBitrateBps } from './size-normalize';

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

describe('defaultRf (bảng preset "Fast" của HandBrake)', () => {
  it('RF theo chiều cao đầu ra: ≥1080 → 22, ≥720 → 21, thấp hơn → 20', () => {
    expect(defaultRf(2160)).toBe(22);
    expect(defaultRf(1080)).toBe(22);
    expect(defaultRf(1079)).toBe(21);
    expect(defaultRf(720)).toBe(21);
    expect(defaultRf(576)).toBe(20);
    expect(defaultRf(480)).toBe(20);
  });
});

describe('planCrf', () => {
  const GB = 1024 ** 3;
  const base = { width: 1920, height: 1080, maxUploadBytes: 2 * GB, durationSec: 3 * 3600 };

  it('maxrate = ngân sách bitrate vừa trần, bufsize = 2× maxrate', () => {
    const plan = planCrf(base);
    expect(plan.rf).toBe(22);
    expect(plan.maxrateBps).toBe(computeTargetVideoBitrateBps(base.maxUploadBytes, base.durationSec));
    expect(plan.bufsizeBits).toBe(plan.maxrateBps * 2);
  });

  it('RF theo độ phân giải ĐẦU RA, không phải của nguồn', () => {
    expect(planCrf({ ...base, maxHeight: 720 }).rf).toBe(21);
    expect(planCrf({ ...base, maxHeight: 480 }).rf).toBe(20);
  });

  it('rf truyền vào ghi đè mặc định', () => {
    expect(planCrf({ ...base, rf: 18 }).rf).toBe(18);
  });

  it('không biết thời lượng → không đặt trần VBV (không ép về sàn 100 kbps)', () => {
    const plan = planCrf({ ...base, durationSec: 0 });
    expect(plan.maxrateBps).toBe(0);
    expect(plan.bufsizeBits).toBe(0);
  });
});

describe('crfCeilingBytes', () => {
  it('cận trên của dung lượng ở chế độ CRF nằm dưới trần upload khi maxrate là ngân sách vừa trần', () => {
    const GB = 1024 ** 3;
    const durationSec = 5400;
    const { maxrateBps } = planCrf({ width: 1920, height: 1080, maxUploadBytes: 2 * GB, durationSec });
    expect(crfCeilingBytes({ maxrateBps, durationSec })).toBeLessThan(2 * GB);
  });
});

describe('chooseRateMode', () => {
  const GB = 1024 ** 3;
  const max = 2 * GB;

  it('dự đoán × độ lệch còn dưới ngân sách → CRF', () => {
    expect(chooseRateMode({ predictedBytes: 1.0 * GB, maxUploadBytes: max })).toBe('crf');
  });

  it('dự đoán thấp hơn ngân sách nhưng × độ lệch vượt → 2-pass (VBV sẽ phải gồng)', () => {
    const budget = max * 0.92;
    const predicted = (budget / CRF_PREDICTION_DEVIATION) * 1.05;
    expect(predicted).toBeLessThan(budget);
    expect(chooseRateMode({ predictedBytes: predicted, maxUploadBytes: max })).toBe('abr');
  });

  it('dự đoán đã vượt trần → 2-pass', () => {
    expect(chooseRateMode({ predictedBytes: 3 * GB, maxUploadBytes: max })).toBe('abr');
  });

  it('đúng ngưỡng → CRF', () => {
    const predicted = (max * 0.92) / CRF_PREDICTION_DEVIATION;
    expect(chooseRateMode({ predictedBytes: predicted, maxUploadBytes: max })).toBe('crf');
  });
});

describe('extrapolateCrfBytes', () => {
  const base = { basisBytes: 100_000_000, basisRf: 22, durationSec: 600 };

  it('cùng RF → giữ nguyên', () => {
    expect(extrapolateCrfBytes({ ...base, rf: 22 })).toBeCloseTo(base.basisBytes, 0);
  });

  it('RF cao hơn → nhỏ hơn, RF thấp hơn → lớn hơn, đơn điệu', () => {
    const a = extrapolateCrfBytes({ ...base, rf: 20 });
    const b = extrapolateCrfBytes({ ...base, rf: 24 });
    expect(a).toBeGreaterThan(base.basisBytes);
    expect(b).toBeLessThan(base.basisBytes);
  });

  it('khớp số đo thật: RF 18→28 trên mẫu đo giảm ~2.5 lần', () => {
    const at28 = extrapolateCrfBytes({ basisBytes: 115_063_644, basisRf: 18, rf: 28, durationSec: 90 });
    expect(at28 / 115_063_644).toBeGreaterThan(0.38);
    expect(at28 / 115_063_644).toBeLessThan(0.42);
  });

  it('audio giữ nguyên: dù RF thay đổi, không xuống dưới phần audio + overhead', () => {
    const tiny = extrapolateCrfBytes({ ...base, rf: 28, basisRf: 18, basisBytes: 1_000_000 });
    expect(tiny).toBeGreaterThan(((160_000 * 600) / 8) * 1.02 - 1);
  });

  it('không vượt cận trên VBV', () => {
    expect(extrapolateCrfBytes({ ...base, rf: 18, ceilingBytes: 90_000_000 })).toBe(90_000_000);
  });
});

describe('presetSpeedVsFast', () => {
  it('fast là mốc 1; veryfast nhanh hơn, medium chậm hơn; bỏ trống = fast', () => {
    expect(presetSpeedVsFast('fast')).toBe(1);
    expect(presetSpeedVsFast(undefined)).toBe(1);
    expect(presetSpeedVsFast('veryfast')).toBeGreaterThan(1);
    expect(presetSpeedVsFast('medium')).toBeLessThan(1);
  });
});
