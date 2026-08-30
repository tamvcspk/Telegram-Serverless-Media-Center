// I/O wrapper quanh matchSidecarSubtitles() (@tsmc/core-ingest, logic thuần
// so khớp tên file) — đọc thư mục chứa video, tìm phụ đề NGOÀI đặt cạnh theo
// quy ước Plex/Jellyfin/Kodi ("<tên video>.srt" hoặc "<tên video>.<lang>.srt"/
// ".vtt"). Khác extractSubtitles() (ffmpeg.ts) vốn rút phụ đề NHÚNG trong
// container qua ffmpeg — đây không gọi ffmpeg, chỉ đọc thư mục.
import { readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { matchSidecarSubtitles } from '@tsmc/core-ingest';

export interface SidecarSubtitle {
  lang?: string;
  path: string;
}

export async function findSidecarSubtitles(videoPath: string): Promise<SidecarSubtitle[]> {
  const dir = dirname(videoPath);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return matchSidecarSubtitles(basename(videoPath), entries).map((m) => ({ lang: m.lang, path: join(dir, m.fileName) }));
}
