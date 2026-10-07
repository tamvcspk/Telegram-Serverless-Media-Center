import { describe, expect, it } from 'vitest';
import {
  addCut,
  alternativeCuts,
  applySignals,
  canRemoveCut,
  checkCutMove,
  composePartCaption,
  MAX_SPLIT_PARTS,
  nearestKeyframe,
  parsePartFileName,
  partFileName,
  planFromCutTimes,
  planSplit,
  removeCut,
  signalCandidateTimes,
  SPLIT_SAFETY_MARGIN,
  splitPartsFromCuts,
  type SplitCandidate
} from './split-plan';

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

describe('tín hiệu chuyển cảnh/im lặng và editor', () => {
  const GB = 1_000_000_000;

  it('applySignals quy số đo thành sceneScore (0..1) và silent theo ngưỡng', () => {
    const kfs: SplitCandidate[] = [
      { timeSec: 10, byteOffset: 1 },
      { timeSec: 20, byteOffset: 2 },
      { timeSec: 30, byteOffset: 3 }
    ];
    const out = applySignals(kfs, [
      { timeSec: 10, sceneDiff: 0.005, audioRmsDb: -21 },
      { timeSec: 20, sceneDiff: 0.4, audioRmsDb: -60 },
      { timeSec: 99, sceneDiff: 1, audioRmsDb: -90 }
    ]);
    expect(out[0].sceneScore).toBeCloseTo(0.025, 6);
    expect(out[0].silent).toBe(false);
    expect(out[1]).toEqual({ timeSec: 20, byteOffset: 2, sceneScore: 1, silent: true });
    expect(out[2]).toEqual(kfs[2]);
  });

  it('applySignals bỏ qua số đo null', () => {
    const out = applySignals([{ timeSec: 10, byteOffset: 1 }], [{ timeSec: 10, sceneDiff: null, audioRmsDb: null }]);
    expect(out[0]).toEqual({ timeSec: 10, byteOffset: 1 });
  });

  it('signalCandidateTimes chỉ lấy keyframe quanh mốc chia đều, không quét cả phim', () => {
    const movie = flatMovie(4.3 * GB, 7200, 5);
    const times = signalCandidateTimes({ keyframes: movie.keyframes, totalBytes: movie.totalBytes, maxUploadBytes: 4 * GB, perCut: 10 });
    expect(times).toHaveLength(10);
    expect(Math.min(...times)).toBeGreaterThan(3500);
    expect(Math.max(...times)).toBeLessThan(3700);
  });

  it('alternativeCuts chỉ trả keyframe giữ mọi phần ≤ trần × margin', () => {
    const movie = flatMovie(7 * GB, 6000, 5);
    const plan = planSplit({ ...movie, maxUploadBytes: 2 * GB });
    expect(plan.ok).toBe(true);
    if (!plan.ok) {
      return;
    }
    const alts = alternativeCuts({ keyframes: movie.keyframes, cuts: plan.cuts, index: 1, totalBytes: movie.totalBytes, maxUploadBytes: 2 * GB });
    expect(alts.length).toBeGreaterThan(1);
    for (const alt of alts) {
      const cuts = plan.cuts.map((c, i) => (i === 1 ? alt : c));
      for (const p of splitPartsFromCuts(cuts, movie.totalBytes, movie.durationSec)) {
        expect(p.approxBytes).toBeLessThanOrEqual(2 * GB * SPLIT_SAFETY_MARGIN);
      }
    }
    expect(alts.map((a) => a.timeSec)).toContain(plan.cuts[1].timeSec);
  });

  it('planFromCutTimes ánh xạ sang keyframe gần nhất (dung sai) và kiểm dung lượng', () => {
    const movie = flatMovie(4.3 * GB, 7200, 5);
    const ok = planFromCutTimes({ ...movie, cutTimesSec: [3600.01], maxUploadBytes: 4 * GB });
    expect(ok?.ok).toBe(true);
    expect(ok?.cuts[0].timeSec).toBe(3600);
  });

  it('planFromCutTimes null khi không còn keyframe tương ứng, phần vượt trần hoặc không có điểm cắt', () => {
    const movie = flatMovie(4.3 * GB, 7200, 5);
    expect(planFromCutTimes({ ...movie, cutTimesSec: [3602.5], maxUploadBytes: 4 * GB })).toBeNull();
    expect(planFromCutTimes({ ...movie, cutTimesSec: [100], maxUploadBytes: 4 * GB })).toBeNull();
    expect(planFromCutTimes({ ...movie, cutTimesSec: [], maxUploadBytes: 4 * GB })).toBeNull();
  });
});

describe('thêm/bớt điểm cắt', () => {
  const GB = 1_000_000_000;
  const movie = flatMovie(7 * GB, 6000, 5);
  const planned = planSplit({ ...movie, maxUploadBytes: 2 * GB });
  const cuts = planned.ok ? planned.cuts : [];

  it('addCut chèn đúng thứ tự và từ chối trùng / đầu phim / vượt số phần', () => {
    const extra = movie.keyframes.find((k) => !cuts.some((c) => c.timeSec === k.timeSec) && k.timeSec > cuts[0].timeSec && k.timeSec < cuts[1].timeSec) as SplitCandidate;
    const added = addCut(cuts, extra);
    expect(added?.map((c) => c.timeSec)).toEqual([cuts[0].timeSec, extra.timeSec, ...cuts.slice(1).map((c) => c.timeSec)]);
    expect(addCut(cuts, cuts[0])).toBeNull();
    expect(addCut(cuts, { timeSec: 0, byteOffset: 0 })).toBeNull();
    const many = Array.from({ length: 49 }, (_, i) => ({ timeSec: i + 1, byteOffset: (i + 1) * 10 }));
    expect(addCut(many, { timeSec: 100, byteOffset: 5000 })).toBeNull();
  });

  it('thêm điểm cắt không bao giờ làm phần nào vượt trần', () => {
    const extra = movie.keyframes[Math.floor(movie.keyframes.length / 3)];
    const added = addCut(cuts, extra);
    if (added) {
      for (const p of splitPartsFromCuts(added, movie.totalBytes, movie.durationSec)) {
        expect(p.approxBytes).toBeLessThanOrEqual(2 * GB * SPLIT_SAFETY_MARGIN);
      }
    }
  });

  it('canRemoveCut chỉ cho gộp khi phần gộp vẫn vừa trần; không bỏ điểm cắt cuối cùng', () => {
    expect(canRemoveCut({ cuts, index: 0, totalBytes: movie.totalBytes, durationSec: movie.durationSec, maxUploadBytes: 2 * GB })).toBe(false);
    const two = planSplit({ ...flatMovie(4.3 * GB, 7200, 5), maxUploadBytes: 4 * GB });
    expect(two.ok).toBe(true);
    if (two.ok) {
      const more = addCut(two.cuts, nearestKeyframe(flatMovie(4.3 * GB, 7200, 5).keyframes, 1000) as SplitCandidate) as SplitCandidate[];
      expect(more).toHaveLength(2);
      expect(canRemoveCut({ cuts: more, index: 0, totalBytes: 4.3 * GB, durationSec: 7200, maxUploadBytes: 4 * GB })).toBe(true);
      expect(canRemoveCut({ cuts: two.cuts, index: 0, totalBytes: 4.3 * GB, durationSec: 7200, maxUploadBytes: 4 * GB })).toBe(false);
    }
  });

  it('removeCut bỏ đúng phần tử và nearestKeyframe chọn keyframe gần nhất', () => {
    expect(removeCut(cuts, 1)).toHaveLength(cuts.length - 1);
    expect(nearestKeyframe(movie.keyframes, 12.4)?.timeSec).toBe(10);
    expect(nearestKeyframe([], 5)).toBeNull();
  });
});

describe('checkCutMove', () => {
  const GB = 1_000_000_000;
  const movie = flatMovie(7 * GB, 6000, 5);
  const planned = planSplit({ ...movie, maxUploadBytes: 2 * GB });
  const cuts = planned.ok ? planned.cuts : [];
  const args = { cuts, totalBytes: movie.totalBytes, durationSec: movie.durationSec, maxUploadBytes: 2 * GB };
  const kf = (t: number): SplitCandidate => movie.keyframes.find((k) => k.timeSec === t) as SplitCandidate;

  it('same khi đã đúng vị trí', () => {
    expect(checkCutMove({ ...args, index: 1, candidate: cuts[1] })).toEqual({ ok: false, reason: 'same' });
  });

  it('ok khi dời một chút và mọi phần vẫn vừa trần', () => {
    expect(checkCutMove({ ...args, index: 1, candidate: kf(cuts[1].timeSec + 5) })).toEqual({ ok: true });
  });

  it('order khi trùng/vượt điểm cắt kế bên', () => {
    expect(checkCutMove({ ...args, index: 1, candidate: kf(cuts[2].timeSec) })).toEqual({ ok: false, reason: 'order' });
    expect(checkCutMove({ ...args, index: 1, candidate: kf(cuts[0].timeSec - 5) })).toEqual({ ok: false, reason: 'order' });
  });

  it('too-big khi dời làm một phần vượt trần', () => {
    // dời điểm cắt đầu lên rất sớm → phần 2 phình to
    expect(checkCutMove({ ...args, index: 0, candidate: kf(50) })).toEqual({ ok: false, reason: 'too-big' });
  });
});
