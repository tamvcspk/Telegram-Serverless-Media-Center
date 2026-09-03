// Điểm chọn backend DUY NHẤT cho remux/thumbnail/subtitle — CHỈ để đo số
// liệu thật cho SPIKE-09 (docs/spikes/README.md#spike-09), quyết định hướng
// Tauri (native FFI) hay giữ TypeScript/Electron thuần (shell-out) cho một
// core lib Rust tương lai. KHÔNG đổi hành vi mặc định của ADR-0013 mục 1.
//
// Mặc định (không set biến môi trường): shell-out `ffmpeg`/`ffprobe` hệ
// thống — đúng Quyết định gốc, đã Accepted, đã verify thật (ADR-0013 § Cập
// nhật 2026-08-30). Set TSMC_INGEST_FFMPEG_BACKEND=native để chuyển sang gọi
// spike09.exe (tools/spike-09/) — xem apps/tsmc-ingest/README.md.
import * as nativeBackend from './ffmpeg-native';
import * as shellBackend from './ffmpeg';

export type { ExtractedSubtitle } from './ffmpeg';

const useNative = process.env['TSMC_INGEST_FFMPEG_BACKEND'] === 'native';

if (useNative) {
  console.error('[ffmpeg-backend] TSMC_INGEST_FFMPEG_BACKEND=native — dùng spike09.exe thay shell-out ffmpeg (CHỈ để đo số liệu SPIKE-09, không phải hành vi production).');
}

export const checkFfmpegAvailable = useNative ? nativeBackend.checkNativeFfmpegAvailable : shellBackend.checkFfmpegAvailable;
export const remuxToMp4 = useNative ? nativeBackend.remuxToMp4 : shellBackend.remuxToMp4;
export const extractSubtitles = useNative ? nativeBackend.extractSubtitles : shellBackend.extractSubtitles;
export const generateThumbnail = useNative ? nativeBackend.generateThumbnail : shellBackend.generateThumbnail;
// Hạng D (re-encode video) — spike09.exe chưa cài, luôn dùng shell-out dù backend=native.
export const reencodeToMp4 = shellBackend.reencodeToMp4;
