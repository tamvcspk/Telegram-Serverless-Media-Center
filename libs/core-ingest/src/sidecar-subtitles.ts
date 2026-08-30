// Phụ đề NGOÀI (sidecar) đặt cạnh file video trên đĩa, theo đúng quy ước phổ
// biến của Plex/Jellyfin/Kodi: "<tên video>.srt" hoặc "<tên video>.<lang>.srt"
// (cũng nhận ".vtt"). Khác extractSubtitles() (apps/tsmc-ingest/src/ffmpeg.ts)
// vốn rút phụ đề NHÚNG trong container qua ffmpeg — đây là logic THUẦN so
// khớp tên file, không đọc đĩa (apps/tsmc-ingest tự `readdir()` rồi truyền
// danh sách tên file vào đây, cùng ranh giới I/O-ngoài/logic-thuần với phần
// còn lại của package này). Chỉ nhận .srt/.vtt (text thuần, dùng được ngay)
// — .ass/.ssa cần convert mới dùng được, ngoài phạm vi v1 (cùng lý do .sup/
// PGS không tự upload ở extractSubtitles()).
export interface SidecarSubtitleMatch {
  lang?: string;
  fileName: string;
}

const SIDECAR_EXTS = new Set(['srt', 'vtt']);

/** `videoFileName` chỉ cần basename (vd "Movie.mkv"), không cần đường dẫn đầy đủ. */
export function matchSidecarSubtitles(videoFileName: string, siblingFileNames: string[]): SidecarSubtitleMatch[] {
  const dotIndex = videoFileName.lastIndexOf('.');
  const videoBase = dotIndex > 0 ? videoFileName.slice(0, dotIndex) : videoFileName;
  const escapedBase = videoBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Nhóm lang tuỳ chọn ("vi"/"en"...) rồi tới đuôi file — cả hai đều dạng
  // ".xxx" liền nhau nên regex engine tự phân biệt đúng qua backtracking
  // (nhóm lang chỉ nhận 2-3 chữ cái, nhóm đuôi ăn phần còn lại).
  const pattern = new RegExp(`^${escapedBase}(?:\\.([a-zA-Z]{2,3}))?\\.([a-zA-Z0-9]+)$`, 'i');

  const results: SidecarSubtitleMatch[] = [];
  for (const fileName of siblingFileNames) {
    if (fileName === videoFileName) {
      continue;
    }
    const match = pattern.exec(fileName);
    if (!match) {
      continue;
    }
    const ext = match[2].toLowerCase();
    if (!SIDECAR_EXTS.has(ext)) {
      continue;
    }
    results.push({ lang: match[1]?.toLowerCase(), fileName });
  }
  return results;
}
