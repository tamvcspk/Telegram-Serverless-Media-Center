// CHỈ ĐỂ TEST/SO SÁNH SỐ LIỆU THẬT (SPIKE-09, docs/spikes/README.md#spike-09)
// — KHÔNG phải hành vi mặc định của tsmc-ingest, không thay đổi Quyết định
// đã Accepted của ADR-0013 (mục 1 vẫn shell-out ffmpeg/ffprobe hệ thống).
// Backend này gọi `spike09.exe` (tools/spike-09/, native FFI qua
// ffmpeg-next/ffmpeg-sys-next) làm THAY cho `ffmpeg.ts`, chọn qua
// `TSMC_INGEST_FFMPEG_BACKEND=native` (xem ffmpeg-backend.ts) — mục đích duy
// nhất là đo số liệu THẬT trên file thật của admin để quyết định hướng Tauri
// (native FFI, nhanh hơn nhưng — xem ADR-0013 § Cập nhật 2026-09-03 — một
// tham số sai làm segfault cả tiến trình) hay giữ TypeScript/Electron thuần
// (shell-out subprocess, chậm hơn nhưng không có rủi ro đó).
//
// Giới hạn đã biết, không che giấu: Hạng D (re-encode video thật) CHƯA cài ở
// spike09.exe — `reencodeToMp4` vẫn luôn dùng backend shell-out. Phụ đề ẢNH
// (PGS/DVD) spike09.exe cũng chưa hỗ trợ (chỉ rút được Text/ASS) — gặp thì
// hàm này throw rõ ràng thay vì âm thầm ghi ra file .srt rỗng.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProbeSubtitleStream } from '@tsmc/core-ingest';
import type { ExtractedSubtitle } from './ffmpeg';

const execFileAsync = promisify(execFile);

const IMAGE_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub']);

function resolveBinPath(): string {
  const bin = process.env['TSMC_INGEST_NATIVE_FFMPEG_BIN'];
  if (!bin) {
    throw new Error(
      'TSMC_INGEST_FFMPEG_BACKEND=native yêu cầu biến TSMC_INGEST_NATIVE_FFMPEG_BIN trỏ tới spike09.exe ' +
        '(build bằng: cd tools/spike-09 && cargo build --release) — xem tools/spike-09/README.md.'
    );
  }
  return bin;
}

/**
 * Giải mã vài mã thoát NTSTATUS Windows hay gặp — Node báo `code` có thể là
 * số dương lớn (unsigned 32-bit) hoặc âm tuỳ đường gọi, chuẩn hoá về unsigned
 * trước khi so khớp. Phát hiện thật (2026-09-04, chạy qua `upload` thật):
 * 0xC0000135 (DLL_NOT_FOUND) từng bị README/log cũ đoán nhầm là "có thể
 * segfault" — hai loại lỗi khác hẳn nhau, không nên gộp làm một.
 */
function describeWindowsExitCode(code: number | null): string {
  if (code === null) {
    return '';
  }
  const unsigned = code < 0 ? code + 0x100000000 : code;
  const known: Record<number, string> = {
    0xc0000005: ' (STATUS_ACCESS_VIOLATION — lỗi bộ nhớ FFI thật, đúng loại "segfault" đã ghi ở ADR-0013 § Cập nhật 2026-09-03: một tham số/buffer sai khiến avcodec crash thẳng tiến trình, không qua Result::Err)',
    0xc0000135: ' (STATUS_DLL_NOT_FOUND — KHÔNG phải segfault, chỉ là spike09.exe thiếu DLL vcpkg (avcodec-61.dll/swresample-5.dll/...) — copy các DLL cạnh spike09.exe hoặc thêm vcpkg/installed/x64-windows/bin vào PATH, xem tools/spike-09/README.md)'
  };
  return known[unsigned] ?? ` (mã Windows 0x${unsigned.toString(16)} chưa có trong bảng tra — có thể là segfault hoặc lỗi tải DLL khác)`;
}

function runNative(args: string[]): Promise<string> {
  const bin = resolveBinPath();
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args);
    let stdout = '';
    let stderrTail = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    proc.stderr.on('data', (chunk: Buffer) => {
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-4000);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      // spike09.exe co the segfault (SIGSEGV) neu gap bug FFI chua luong het
      // - dung nghia day la RUI RO chinh spike nay dang do, khong che giau
      // bang mot thong diep loi "than thien" hon. NHUNG ma loi Windows thap
      // (khong tim thay DLL, ...) la mot loai KHAC han - phat hien that lan
      // dau chay qua apps/tsmc-ingest (2026-09-03): spike09.exe thoat ma
      // 0xC0000135 (STATUS_DLL_NOT_FOUND) vi PATH cua terminal khong co DLL
      // vcpkg - khong phai segfault, chi la thieu DLL. Giai ma rieng cac ma
      // NTSTATUS thap pho bien de khong danh dong het thanh "co the segfault".
      reject(new Error(`spike09.exe thoát với mã ${code}${describeWindowsExitCode(code)}:\n${stderrTail}`));
    });
  });
}

export async function checkNativeFfmpegAvailable(): Promise<boolean> {
  try {
    const bin = resolveBinPath();
    await execFileAsync(bin, []).catch(() => {
      // spike09.exe khong co lenh "" hop le nen luon exit code != 0 (usage
      // error) - chi can tien trinh SPAWN duoc (binary + DLL load duoc) la
      // du de coi la "available", khong can exit code 0.
    });
    return true;
  } catch {
    return false;
  }
}

/** Khớp `ffmpeg.ts::remuxToMp4` — copy_audio khi reencodeAudioToAac=false. */
export async function remuxToMp4(input: string, output: string, opts: { reencodeAudioToAac: boolean }): Promise<void> {
  const args = opts.reencodeAudioToAac ? ['remux', input, output] : ['remux', input, output, '--copy-audio'];
  await runNative(args);
}

/** Hạng D — spike09.exe CHƯA cài re-encode video, không có backend native cho việc này. */
export async function reencodeToMp4(): Promise<void> {
  throw new Error('Backend native (spike09.exe) chưa cài re-encode video (Hạng D) — dùng TSMC_INGEST_FFMPEG_BACKEND mặc định (shell-out) cho file Hạng D.');
}

/** Khớp `ffmpeg.ts::extractSubtitles` — mỗi track rút riêng qua `subs <in> <out> <stream_index>`. */
export async function extractSubtitles(input: string, subtitles: ProbeSubtitleStream[], outputBaseNoExt: string): Promise<ExtractedSubtitle[]> {
  const results: ExtractedSubtitle[] = [];
  for (const sub of subtitles) {
    if (sub.index === undefined) {
      continue;
    }
    const isImageBased = IMAGE_SUBTITLE_CODECS.has(sub.codec.toLowerCase());
    if (isImageBased) {
      throw new Error(`Backend native chưa hỗ trợ phụ đề ảnh (${sub.codec}, stream ${sub.index}) — dùng backend shell-out cho file này.`);
    }
    const langTag = sub.lang ? `.${sub.lang}` : '';
    const outputPath = `${outputBaseNoExt}${langTag}.srt`;
    await runNative(['subs', input, outputPath, String(sub.index)]);
    results.push({ lang: sub.lang, path: outputPath, isImageBased: false });
  }
  return results;
}

/** Khớp `ffmpeg.ts::generateThumbnail` — cùng midpoint = floor(durationSec/2), cùng scale=320:-1. */
export async function generateThumbnail(input: string, durationSec: number, output: string): Promise<void> {
  const midpoint = Math.max(1, Math.floor(durationSec / 2));
  await runNative(['thumb', input, output, String(midpoint), '320']);
}
