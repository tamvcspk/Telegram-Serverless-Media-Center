import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { ProbeResult } from '@tsmc/core-ingest';
import type {
  IngestRpcErrorDto,
  LoginOutcomeDto,
  PinnedCatalogDto,
  PipelineStageDto,
  PreparedUploadDto,
  ProbeResultDto,
  RemuxModeDto,
  ResolvedChannelDto,
  SavedCredentialsDto,
  SubtitleTrackDto,
  UploadedRefDto,
  UploadProgressDto
} from './ingest-rpc.types';

/**
 * Cổng DUY NHẤT gọi `invoke()` của Tauri trong app này — mọi component chỉ
 * gọi qua các hàm dưới, không tự gọi `invoke()` rời rạc. Khớp tinh thần
 * "TelegramGateway" của apps/web (CLAUDE.md bất biến #3), dù ở đây không có
 * eslint-plugin-boundaries ép vì chỉ có một file gọi `@tauri-apps/api`.
 * Mười hai command đăng nhập/chọn kênh khớp `src-tauri/src/commands.rs` —
 * PHẢI gọi đúng thứ tự đã ghi ở đó: checkSession() → requestLoginCode() →
 * submitOtp() → (submitPassword() nếu `PasswordRequired`) → MỘT trong ba
 * cách chọn kênh (resolveChannel() / selectChannel() sau listOwnChannels() /
 * createChannel()) → checkWritePermission()/readPinnedCatalog() (hai cái sau
 * luôn đọc lại channel của lần chọn gần nhất phía Rust, không cần truyền lại
 * qua IPC). Thêm hai command `list_media_files`/`probe_media`
 * (`src-tauri/src/probe.rs`) cho màn workspace ba vùng (A.3) — KHÔNG phụ
 * thuộc thứ tự trên, chạy được cả trước khi đăng nhập (probe không đụng
 * MTProto). Thêm `prepare_upload`/`cleanup_temp_dir` (`pipeline.rs`, cũng
 * không đụng MTProto) + `upload_video`/`upload_subtitle`/`publish_catalog`/
 * `cancel_upload` (`upload.rs`, CẦN đã chọn kênh — đọc lại
 * `state.selected_channel` phía Rust) cho luồng "Bắt đầu upload".
 */

export function checkSession(apiId: number): Promise<boolean> {
  return invoke<boolean>('check_session', { apiId });
}

export function requestLoginCode(apiHash: string, phone: string): Promise<void> {
  return invoke<void>('request_login_code', { apiHash, phone });
}

export function submitOtp(code: string): Promise<LoginOutcomeDto> {
  return invoke<LoginOutcomeDto>('submit_otp', { code });
}

export function submitPassword(password: string): Promise<void> {
  return invoke<void>('submit_password', { password });
}

export function loadSavedCredentials(): Promise<SavedCredentialsDto | null> {
  return invoke<SavedCredentialsDto | null>('load_saved_credentials');
}

export function saveCredentials(apiId: number, apiHash: string, dialCode: string, nationalNumber: string): Promise<void> {
  return invoke<void>('save_credentials', { apiId, apiHash, dialCode, nationalNumber });
}

export function resolveChannel(channelRef: string): Promise<ResolvedChannelDto> {
  return invoke<ResolvedChannelDto>('resolve_channel', { channelRef });
}

export function listOwnChannels(): Promise<ResolvedChannelDto[]> {
  return invoke<ResolvedChannelDto[]>('list_own_channels');
}

export function createChannel(title: string): Promise<ResolvedChannelDto> {
  return invoke<ResolvedChannelDto>('create_channel', { title });
}

export function selectChannel(channel: ResolvedChannelDto): Promise<void> {
  return invoke<void>('select_channel', { id: channel.id, title: channel.title, isOwn: channel.is_own });
}

export function checkWritePermission(): Promise<boolean> {
  return invoke<boolean>('check_write_permission');
}

export function readPinnedCatalog(): Promise<PinnedCatalogDto | null> {
  return invoke<PinnedCatalogDto | null>('read_pinned_catalog');
}

/** Mở rộng danh sách đường dẫn vừa kéo thả (file HOẶC folder trộn lẫn) thành
 * danh sách file video — folder được quét đệ quy phía Rust (`probe.rs`,
 * `ingest-ffmpeg` không tham gia bước này, chỉ liệt kê bằng phần mở rộng). */
export function listMediaFiles(paths: string[]): Promise<string[]> {
  return invoke<string[]>('list_media_files', { paths });
}

/** Liệt kê TÊN FILE (không phải đường dẫn đầy đủ) trong một thư mục — dùng để
 * tìm phụ đề NGOÀI đặt cạnh video qua `matchSidecarSubtitles()`
 * (`@tsmc/core-ingest`, logic thuần so khớp tên file). Trả mảng rỗng nếu thư
 * mục không đọc được (best-effort, không throw). */
export function listDirEntries(dirPath: string): Promise<string[]> {
  return invoke<string[]>('list_dir_entries', { dirPath });
}

/** Probe MỘT file bằng `ingest-ffmpeg` (native, không cần cài ffmpeg lên máy
 * — mockup A.5). Gọi riêng cho từng file trong hàng đợi, KHÔNG gộp mảng — một
 * file lỗi (probe fail) không được chặn kết quả của những file lành (mockup
 * A.5, bảng đường hỏng "Pipeline FFmpeg crash"). */
export function probeMedia(path: string): Promise<ProbeResultDto> {
  return invoke<ProbeResultDto>('probe_media', { path });
}

/** `ProbeResultDto` (IPC, snake_case) → `ProbeResult` (`@tsmc/core-ingest`,
 * camelCase `durationSec`) — chuyển đổi DUY NHẤT để gọi `classifyCompatRank()`
 * bằng đúng nguồn sự thật TypeScript (ADR-0017 điều kiện bắt buộc #4), không
 * viết lại luật phân hạng ở tầng UI. */
export function toProbeResult(dto: ProbeResultDto): ProbeResult {
  return {
    container: dto.container,
    durationSec: dto.duration_sec,
    video: dto.video ?? undefined,
    audio: dto.audio.map((a) => ({ codec: a.codec, lang: a.lang ?? undefined, index: a.index })),
    subtitles: dto.subtitles.map((s) => ({ codec: s.codec, lang: s.lang ?? undefined, index: s.index }))
  };
}

/** "Chuẩn bị upload" — remux/re-encode + thumbnail + rút phụ đề CỤC BỘ
 * (không đụng MTProto), gộp thành MỘT lệnh phía Rust
 * (`pipeline.rs::prepare_upload()`) để không phải tự quản thư mục tạm ở tầng
 * UI. `mode`/`subtitleTracks` do GỌI Ở ĐÂY quyết định (dựa trên
 * `classifyCompatRank()` đã chạy ở bước probe trước đó) — lệnh Rust chỉ thực
 * thi, không tự quyết (ADR-0017 điều kiện bắt buộc #4). `mode:
 * 'reencode_all'` (Hạng D) PHẢI đã hỏi xác nhận xong TRƯỚC khi gọi hàm này
 * (mockup A.2 mục 1 — "re-encode video luôn phải hỏi", `startUpload()` ở
 * `workspace.ts` lo việc này). */
export function prepareUpload(inputPath: string, mode: RemuxModeDto, subtitleTracks: SubtitleTrackDto[]): Promise<PreparedUploadDto> {
  return invoke<PreparedUploadDto>('prepare_upload', { inputPath, mode, subtitleTracks });
}

/** Dọn thư mục tạm của `prepareUpload()` sau khi upload xong (thành công hay
 * lỗi) — best-effort phía Rust, không throw. */
export function cleanupTempDir(dirPath: string): Promise<void> {
  return invoke<void>('cleanup_temp_dir', { dirPath });
}

/** Upload video kèm thumbnail — thao tác DUY NHẤT bắn sự kiện `"upload-
 * progress"` trong lúc chạy (dùng `onUploadProgress()` bên dưới để lắng
 * nghe), và DUY NHẤT huỷ được giữa chừng (`cancelUpload()`). */
export function uploadVideo(input: {
  filePath: string;
  fileName: string;
  width: number;
  height: number;
  durationSec: number;
  thumbnailPath?: string;
  caption?: string;
}): Promise<UploadedRefDto> {
  return invoke<UploadedRefDto>('upload_video', input);
}

export function uploadSubtitle(filePath: string, fileName: string): Promise<UploadedRefDto> {
  return invoke<UploadedRefDto>('upload_subtitle', { filePath, fileName });
}

/** Gọi ĐÚNG MỘT LẦN cho cả batch, sau khi mọi item đã upload xong — giảm cửa
 * sổ `FLOOD_WAIT` giữa 3 RPC (`sendFile → pinMessage → deleteMessages`) so
 * với publish từng item một. `json` là `catalog.v1.json` ĐÃ build bằng
 * `buildCatalogEnvelope()` (`@tsmc/core-ingest`), `previousMsgId` là
 * `msg_id` của catalog đang ghim (nếu có) để xoá SAU khi ghim bản mới. */
export function publishCatalog(json: string, previousMsgId: number | null): Promise<UploadedRefDto> {
  return invoke<UploadedRefDto>('publish_catalog', { json, previousMsgId });
}

/** Huỷ lần `uploadVideo()` ĐANG chạy, nếu có — no-op an toàn nếu không có gì
 * đang upload. */
export function cancelUpload(): Promise<void> {
  return invoke<void>('cancel_upload');
}

/** Lắng nghe sự kiện `"upload-progress"` (`app.emit()` phía Rust, KHÔNG phải
 * giá trị trả về của `invoke()` — một lần `uploadVideo()` bắn NHIỀU sự kiện
 * này). Trả về hàm huỷ đăng ký — gọi trong `DestroyRef.onDestroy()`. */
export function onUploadProgress(handler: (payload: UploadProgressDto) => void): Promise<UnlistenFn> {
  return listen<UploadProgressDto>('upload-progress', (event) => handler(event.payload));
}

/** Lắng nghe sự kiện `"pipeline-stage"` (mockup A.2 mục 4 — "Tiến trình phải
 * nói đang ở stage nào"). */
export function onPipelineStage(handler: (payload: PipelineStageDto) => void): Promise<UnlistenFn> {
  return listen<PipelineStageDto>('pipeline-stage', (event) => handler(event.payload));
}

/** `invoke()` reject bằng đúng giá trị `IngestRpcErrorDto` đã serialize khi
 * command trả `Err` — nhưng lỗi tầng IPC/Tauri thật (command không tồn tại,
 * lỗi transport) reject bằng string/Error trần, không có field `kind`. Hàm
 * này chặn cả hai đường về cùng một kiểu để UI không phải tự đoán shape. */
export function toIngestRpcError(err: unknown): IngestRpcErrorDto {
  if (typeof err === 'object' && err !== null && 'kind' in err) {
    return err as IngestRpcErrorDto;
  }
  return { kind: 'Other', detail: err instanceof Error ? err.message : String(err) };
}

/** Thông báo tiếng Việt hiện cho user — FloodWait giữ số giây nguyên văn
 * (nguyên tắc UX A.2 mục 4: FLOOD_WAIT phải hiện thành thông tin cụ thể,
 * không phải một dòng lỗi lướt qua). */
export function describeIngestError(err: IngestRpcErrorDto): string {
  switch (err.kind) {
    case 'FloodWait':
      return `Telegram yêu cầu chờ ${err.detail.seconds}s trước khi thử lại (FLOOD_WAIT) — không có cách né hợp lệ, đây là giới hạn thật của tài khoản.`;
    case 'FileTooLarge':
      return 'File vượt quá kích thước cho phép.';
    case 'NotAuthorized':
      return 'Chưa đăng nhập — thực hiện lại luồng đăng nhập từ đầu.';
    case 'Cancelled':
      return 'Đã huỷ thao tác.';
    case 'Other':
      return err.detail;
  }
}
