import { describe, expect, it } from 'vitest';
import { composePartCaption, MAX_SPLIT_PARTS, parsePartFileName, partFileName, planSplit, SPLIT_SAFETY_MARGIN, type SplitCandidate } from './split-plan';

/** Phim giả `totalBytes` byte, `durationSec` giây, keyframe mỗi `gopSec` giây, bitrate phẳng. */
function flatMovie(totalBytes: number, durationSec: number, gopSec: number): { keyframes: SplitCandidate[]; totalBytes: number; durationSec: number } {
  const keyframes: SplitCandidate[] = [];
  for (let t = gopSec; t < durationSec; t += gopSec) {
    keyframes.push({ timeSec: t, byteOffset: Math.round((totalBytes * t) / durationSec) });
  }
  return { keyframes, totalBytes, durationSec };
}

describe('planSplit', () => {
  const GB = 1_000_000_000;

  it('4.3 GB, trần 4 GB → 2 phần ĐỀU (~2.15 GB), không phải 3.9 + 0.4', () => {
    const plan = planSplit({ ...flatMovie(4.3 * GB, 7200, 5), maxUploadBytes: 4 * GB });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.parts).toHaveLength(2);
    for (const p of plan.parts) {
      expect(p.approxBytes).toBeGreaterThan(2.0 * GB);
      expect(p.approxBytes).toBeLessThan(2.3 * GB);
    }
  });

  it('mọi phần ≤ trần × margin, kể cả khi cần nhiều phần', () => {
    const maxUploadBytes = 2 * GB;
    const plan = planSplit({ ...flatMovie(9 * GB, 10_000, 4), maxUploadBytes });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    expect(plan.parts).toHaveLength(5);
    for (const p of plan.parts) {
      expect(p.approxBytes).toBeLessThanOrEqual(maxUploadBytes * SPLIT_SAFETY_MARGIN);
    }
    expect(plan.parts.reduce((s, p) => s + p.approxBytes, 0)).toBe(9 * GB);
    expect(plan.parts[0].startSec).toBe(0);
    expect(plan.parts.at(-1)?.endSec).toBe(10_000);
  });

  it('điểm cắt tăng dần và nằm giữa các phần liền kề', () => {
    const plan = planSplit({ ...flatMovie(7 * GB, 6000, 3), maxUploadBytes: 2 * GB });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const times = plan.cuts.map((c) => c.timeSec);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    plan.parts.forEach((p, i) => {
      if (i > 0) {
        expect(p.startSec).toBe(plan.parts[i - 1].endSec);
      }
    });
  });

  it('keyframe thưa (GOP 600 s) vẫn thoả ràng buộc bằng cách tăng số phần', () => {
    const plan = planSplit({ ...flatMovie(4.3 * GB, 7200, 600), maxUploadBytes: 4 * GB });
    expect(plan.ok).toBe(true);
  });

  it('ưu tiên keyframe có chuyển cảnh/im lặng khi chúng gần ngang nhau về dung lượng', () => {
    const base = flatMovie(4.3 * GB, 7200, 5);
    const idealIdx = base.keyframes.findIndex((c) => c.byteOffset >= base.totalBytes / 2);
    const neighbour = base.keyframes[idealIdx + 1];
    const keyframes = base.keyframes.map((c) => (c === neighbour ? { ...c, sceneScore: 1, silent: true } : c));
    const plan = planSplit({ keyframes, totalBytes: base.totalBytes, durationSec: base.durationSec, maxUploadBytes: 4 * GB });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.cuts[0].timeSec).toBe(neighbour.timeSec);
    }
  });

  it('tín hiệu không lấn át ràng buộc dung lượng: ứng viên im lặng nhưng quá xa mốc bị bỏ', () => {
    const base = flatMovie(4.3 * GB, 7200, 5);
    const far = { timeSec: 100, byteOffset: Math.round((4.3 * GB * 100) / 7200), sceneScore: 1, silent: true };
    const plan = planSplit({ keyframes: [...base.keyframes, far], totalBytes: base.totalBytes, durationSec: base.durationSec, maxUploadBytes: 4 * GB });
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.cuts[0].timeSec).not.toBe(100);
    }
  });

  it('không có keyframe → no-keyframes', () => {
    expect(planSplit({ keyframes: [], totalBytes: 5 * GB, durationSec: 100, maxUploadBytes: 4 * GB })).toEqual({ ok: false, reason: 'no-keyframes' });
  });

  it('cần quá nhiều phần → too-many-parts', () => {
    const plan = planSplit({ ...flatMovie(300 * GB, 100_000, 5), maxUploadBytes: 4 * GB });
    expect(plan).toEqual({ ok: false, reason: 'too-many-parts' });
    expect(MAX_SPLIT_PARTS).toBe(50);
  });

  it('keyframe duy nhất nằm lệch quá xa → cannot-fit', () => {
    const plan = planSplit({ keyframes: [{ timeSec: 10, byteOffset: 100 }], totalBytes: 8 * GB, durationSec: 7200, maxUploadBytes: 4 * GB });
    expect(plan).toEqual({ ok: false, reason: 'cannot-fit' });
  });
});

describe('tên và caption phần', () => {
  it('partFileName / parsePartFileName là nghịch đảo của nhau', () => {
    const name = partFileName('Dune Part Two', 2, 3);
    expect(name).toBe('Dune Part Two.part2of3.mp4');
    expect(parsePartFileName(name)).toEqual({ baseName: 'Dune Part Two', index: 2, count: 3 });
  });

  it('parsePartFileName từ chối tên không theo quy ước hoặc chỉ số vô lý', () => {
    expect(parsePartFileName('Dune.mp4')).toBeNull();
    expect(parsePartFileName('Dune.part0of3.mp4')).toBeNull();
    expect(parsePartFileName('Dune.part4of3.mp4')).toBeNull();
    expect(parsePartFileName('Dune.part1of1.mp4')).toBeNull();
  });

  it('composePartCaption thêm "— Phần i/N" vào dòng tiêu đề và giữ hashtag', () => {
    const caption = composePartCaption({ msgId: 0, title: 'Dune', year: 2024 }, 1, 2);
    expect(caption).toBe('Dune — Phần 1/2\n#2024');
  });

  it('composePartCaption không có tiêu đề → chỉ "Phần i/N"', () => {
    expect(composePartCaption({ msgId: 0 }, 2, 3)).toBe('Phần 2/3');
  });
});
