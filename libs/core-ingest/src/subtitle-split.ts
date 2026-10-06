// Chia phụ đề theo phần — ADR-0022 §1: `subs` mỗi phần đã rebase về 0 tại đầu
// phần; cue vắt ngang điểm cắt được nhân đôi và cắt ngắn ở cả hai phía (Player
// không phải tính offset). Hàm thuần trên chuỗi; I/O đọc/ghi file do tầng gọi lo.

interface Cue {
  startSec: number;
  endSec: number;
  text: string;
}

// "00:01:02,345" (SRT) hoặc "00:01:02.345" / "01:02.345" (VTT).
const TIMESTAMP = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})`;
const TIMING_LINE = new RegExp(String.raw`^\s*${TIMESTAMP}\s*-->\s*${TIMESTAMP}`);

function toSec(h: string | undefined, m: string, s: string, ms: string): number {
  return Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000;
}

/** Parse SRT hoặc WebVTT (bỏ header/NOTE/số thứ tự/cue settings); dòng hỏng bị bỏ qua. */
export function parseSubtitleCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const blocks = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const timingIdx = lines.findIndex((l) => TIMING_LINE.test(l));
    if (timingIdx < 0) {
      continue;
    }
    const m = TIMING_LINE.exec(lines[timingIdx])!;
    const startSec = toSec(m[1], m[2], m[3], m[4]);
    const endSec = toSec(m[5], m[6], m[7], m[8]);
    const body = lines.slice(timingIdx + 1).join('\n').trim();
    if (endSec > startSec && body.length > 0) {
      cues.push({ startSec, endSec, text: body });
    }
  }
  return cues;
}

function formatTimestamp(totalSec: number): string {
  const totalMs = Math.round(totalSec * 1000);
  const ms = totalMs % 1000;
  const s = Math.floor(totalMs / 1000) % 60;
  const m = Math.floor(totalMs / 60000) % 60;
  const h = Math.floor(totalMs / 3600000);
  const pad = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms, 3)}`;
}

/**
 * Rebase phụ đề (SRT hoặc VTT) cho cửa sổ `[startSec, endSec)` của một phần:
 * giữ cue giao với cửa sổ, cắt ngắn về biên, dịch về 0 tại `startSec`, đánh số
 * lại. Luôn trả SRT. Không còn cue nào → chuỗi rỗng (tầng gọi bỏ qua phụ đề
 * của phần đó, không upload file rỗng).
 */
export function rebaseSubtitle(text: string, startSec: number, endSec: number): string {
  const out: string[] = [];
  let n = 0;
  for (const cue of parseSubtitleCues(text)) {
    const s = Math.max(cue.startSec, startSec);
    const e = Math.min(cue.endSec, endSec);
    if (e - s < 0.001) {
      continue;
    }
    n += 1;
    out.push(`${n}\n${formatTimestamp(s - startSec)} --> ${formatTimestamp(e - startSec)}\n${cue.text}`);
  }
  return out.length > 0 ? `${out.join('\n\n')}\n` : '';
}
