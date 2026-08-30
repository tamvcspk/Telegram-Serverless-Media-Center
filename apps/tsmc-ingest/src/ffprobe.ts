// Wrapper mỏng quanh binary `ffprobe` hệ thống — gọi thẳng qua child_process,
// KHÔNG thêm thư viện wrapper (fluent-ffmpeg...) cho một CLI chỉ cần đúng
// một lệnh -show_format/-show_streams (đúng tinh thần giữ dependency tối
// thiểu của repo). ADR-0013 mục 1: compat phải quyết bằng ffprobe CỤC BỘ
// trên máy admin — không có fallback nào khác nếu thiếu binary này (xem
// checkFfmpegToolingAvailable()).
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Container, ProbeResult } from '@tsmc/core-ingest';

const execFileAsync = promisify(execFile);

interface FfprobeStream {
  index?: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  tags?: { language?: string };
}

interface FfprobeOutput {
  format?: { format_name?: string; duration?: string };
  streams?: FfprobeStream[];
}

function normalizeContainer(formatName: string | undefined): Container {
  const name = (formatName ?? '').toLowerCase();
  if (name.includes('mp4') || name.includes('mov') || name.includes('m4a') || name.includes('3gp') || name.includes('3g2') || name.includes('mj2')) {
    return 'mp4';
  }
  if (name.includes('matroska') || name.includes('webm')) {
    return 'matroska';
  }
  if (name.includes('mpegts')) {
    return 'mpegts';
  }
  if (name.includes('avi')) {
    return 'avi';
  }
  return 'other';
}

/**
 * `ffprobe -version` — preflight trước khi chạy bất kỳ pipeline nào. ADR-0013
 * không có nhánh "im lặng bỏ qua chuẩn hoá" khi thiếu tooling — CLI phải từ
 * chối rõ ràng (xem cli.ts).
 */
export async function checkFfprobeAvailable(): Promise<boolean> {
  try {
    await execFileAsync('ffprobe', ['-version']);
    return true;
  } catch {
    return false;
  }
}

export async function probeFile(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', filePath]);
  const parsed = JSON.parse(stdout) as FfprobeOutput;
  const streams = parsed.streams ?? [];

  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStreams = streams.filter((s) => s.codec_type === 'audio');
  const subtitleStreams = streams.filter((s) => s.codec_type === 'subtitle');

  return {
    container: normalizeContainer(parsed.format?.format_name),
    durationSec: Number(parsed.format?.duration ?? 0),
    video:
      videoStream && videoStream.width && videoStream.height
        ? { codec: videoStream.codec_name ?? '', width: videoStream.width, height: videoStream.height }
        : undefined,
    audio: audioStreams.map((s) => ({ codec: s.codec_name ?? '', lang: s.tags?.language, index: s.index })),
    subtitles: subtitleStreams.map((s) => ({ codec: s.codec_name ?? '', lang: s.tags?.language, index: s.index }))
  };
}
