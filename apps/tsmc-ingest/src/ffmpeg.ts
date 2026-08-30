// Wrapper mỏng quanh binary `ffmpeg` hệ thống — cùng lý do không thêm thư
// viện wrapper như ffprobe.ts. ADR-0013 mục 1: CLI LUÔN bật `+faststart`
// (ngay cả Hạng A) — đây là dependency CỨNG cho toàn bộ lệnh `upload`, không
// có fallback (ffmpeg.wasm là giải pháp RIÊNG của "Chế độ Admin trong web
// app", mục 3 ADR-0013, khác hẳn CLI này).
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProbeSubtitleStream } from '@tsmc/core-ingest';

const execFileAsync = promisify(execFile);

export async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    return true;
  } catch {
    return false;
  }
}

function runFfmpeg(args: string[], onProgress?: (line: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', ['-y', ...args]);
    let stderrTail = '';
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderrTail = (stderrTail + text).slice(-4000);
      if (onProgress) {
        for (const line of text.split('\n')) {
          if (line.includes('time=')) {
            onProgress(line.trim());
          }
        }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg thoát với mã ${code}:\n${stderrTail}`));
      }
    });
  });
}

/**
 * Remux copy-video, luôn `+faststart` (ADR-0013 mục 1). `reencodeAudioToAac`
 * chỉ bật cho Hạng C (audio DTS/TrueHD/khác không phát được trực tiếp) —
 * Hạng A/B giữ nguyên audio, chỉ đổi container/vị trí moov.
 */
export async function remuxToMp4(input: string, output: string, opts: { reencodeAudioToAac: boolean }, onProgress?: (line: string) => void): Promise<void> {
  const audioArgs = opts.reencodeAudioToAac ? ['-c:a', 'aac'] : ['-c:a', 'copy'];
  await runFfmpeg(['-i', input, '-c:v', 'copy', ...audioArgs, '-movflags', '+faststart', output], onProgress);
}

/**
 * Hạng D — re-encode video thật (đắt, ADR-0013 bắt admin xác nhận TRƯỚC khi
 * gọi hàm này, xem commands/upload.ts). `libx264` là codec chắc chắn phát
 * được trên mọi trình duyệt hỗ trợ (Hạng A sau khi xong).
 */
export async function reencodeToMp4(input: string, output: string, onProgress?: (line: string) => void): Promise<void> {
  await runFfmpeg(['-i', input, '-c:v', 'libx264', '-preset', 'medium', '-c:a', 'aac', '-movflags', '+faststart', output], onProgress);
}

export interface ExtractedSubtitle {
  lang?: string;
  path: string;
  /** Phụ đề dạng ảnh (PGS) không convert được sang text — rút nguyên bản (`.sup`), không phải `.srt`. */
  isImageBased: boolean;
}

const IMAGE_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub']);

/** Rút phụ đề ra file rời — ADR-0013 mục 1 "rút phụ đề". Phụ đề text convert sang `.srt`; phụ đề ảnh giữ nguyên bitstream. */
export async function extractSubtitles(input: string, subtitles: ProbeSubtitleStream[], outputBaseNoExt: string): Promise<ExtractedSubtitle[]> {
  const results: ExtractedSubtitle[] = [];
  for (const sub of subtitles) {
    if (sub.index === undefined) {
      continue;
    }
    const isImageBased = IMAGE_SUBTITLE_CODECS.has(sub.codec.toLowerCase());
    const langTag = sub.lang ? `.${sub.lang}` : '';
    const outputPath = isImageBased ? `${outputBaseNoExt}${langTag}.sup` : `${outputBaseNoExt}${langTag}.srt`;
    const codecArgs = isImageBased ? ['-c:s', 'copy'] : ['-c:s', 'srt'];
    await runFfmpeg(['-i', input, '-map', `0:${sub.index}`, ...codecArgs, outputPath]);
    results.push({ lang: sub.lang, path: outputPath, isImageBased });
  }
  return results;
}

/** Thumbnail JPEG lấy giữa file — ADR-0013 mục 1 "sinh thumbnail". */
export async function generateThumbnail(input: string, durationSec: number, output: string): Promise<void> {
  const midpoint = Math.max(1, Math.floor(durationSec / 2));
  await runFfmpeg(['-ss', String(midpoint), '-i', input, '-frames:v', '1', '-vf', 'scale=320:-1', output]);
}
