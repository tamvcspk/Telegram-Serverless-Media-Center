// Kiểu dữ liệu khớp NGUYÊN VĂN với serde output của src-tauri/src/dto.rs —
// đổi field ở đó thì đổi cả ở đây, không có codegen tự động ở khung sườn
// này. Field giữ snake_case cho ResolvedChannelDto/IngestRpcErrorDto vì
// dto.rs không có #[serde(rename_all = "camelCase")]; chỉ THAM SỐ của lệnh
// invoke() mới được Tauri tự camelCase, KHÔNG áp dụng cho response body.

/** Khớp `#[serde(tag = "kind", content = "detail")] IngestRpcErrorDto`. KHÔNG
 * collapse về string trần — `FloodWait` phải giữ nguyên số giây để UI tự
 * quyết định đếm ngược thay vì mất thông tin ở ranh giới IPC (CLAUDE.md: tôn
 * trọng FLOOD_WAIT tuyệt đối). */
export type IngestRpcErrorDto =
  | { kind: 'FloodWait'; detail: { seconds: number } }
  | { kind: 'FileTooLarge'; detail: { max_bytes: number; actual_bytes: number } }
  | { kind: 'NotAuthorized' }
  | { kind: 'Cancelled' }
  | { kind: 'Other'; detail: string };

export interface ResolvedChannelDto {
  id: string;
  title: string;
  is_own: boolean;
}

/** Khớp `SavedCredentialsDto`. Lưu ở app-data (Rust), KHÔNG phải
 * `localStorage` — xem doc comment gốc ở `dto.rs` (localStorage tách theo
 * origin webview, không ổn định giữa `cargo tauri dev`/bản release). */
export interface SavedCredentialsDto {
  api_id: number;
  api_hash: string;
  dial_code: string;
  national_number: string;
}

/** Khớp `PinnedCatalogDto`. `raw` là nội dung `catalog.v1.json` NGUYÊN VĂN
 * do kênh tự soạn — KHÔNG tin tưởng (CLAUDE.md bất biến #7), chỉ được
 * `JSON.parse` phòng thủ để đếm item hiển thị, không bao giờ `[innerHTML]`. */
export interface PinnedCatalogDto {
  msg_id: number;
  publisher_id: string;
  raw: string;
}

/** Khớp `#[serde(tag = "outcome")] LoginOutcomeDto`. */
export type LoginOutcomeDto = { outcome: 'LoggedIn' } | { outcome: 'PasswordRequired' };

/** Khớp `#[serde(rename_all = "lowercase")] ContainerDto` — ĐÚNG bốn chuỗi
 * `Container` (`@tsmc/core-ingest`) định nghĩa, không cần map lại. */
export type ContainerDto = 'mp4' | 'matroska' | 'mpegts' | 'avi' | 'other';

export interface ProbeVideoStreamDto {
  codec: string;
  width: number;
  height: number;
}

export interface ProbeAudioStreamDto {
  codec: string;
  lang: string | null;
  index: number;
}

export interface ProbeSubtitleStreamDto {
  codec: string;
  lang: string | null;
  index: number;
}

/** Khớp `ProbeResultDto` — field `duration_sec` giữ nguyên snake_case (quy
 * ước DTO của file này), khác `durationSec` của `ProbeResult`
 * (`@tsmc/core-ingest`) — map bằng `toProbeResult()` ở `ingest-rpc.ts` trước
 * khi gọi `classifyCompatRank()`, không đổi quy ước DTO chỉ vì một field. */
export interface ProbeResultDto {
  container: ContainerDto;
  duration_sec: number;
  video: ProbeVideoStreamDto | null;
  audio: ProbeAudioStreamDto[];
  subtitles: ProbeSubtitleStreamDto[];
}

/** Khớp `UploadedRefDto`. */
export interface UploadedRefDto {
  msg_id: number;
}

/** Payload sự kiện `"upload-progress"` (`app.emit()`, KHÔNG phải giá trị trả
 * về của `invoke()` — một lần `uploadVideo()` bắn NHIỀU sự kiện này). `path`
 * là correlation id — chỉ áp dụng update cho đúng item đang khớp path đó. */
export interface UploadProgressDto {
  path: string;
  bytes_sent: number;
  total_bytes: number;
}

/** Payload sự kiện `"pipeline-stage"` — mockup A.2 mục 4. `reencoding` chỉ
 * xảy ra với `mode: 'reencode_all'` (Hạng D — ĐẮT hơn hẳn `remuxing`, xem
 * `RemuxModeDto`). */
export interface PipelineStageDto {
  path: string;
  stage: 'remuxing' | 'reencoding' | 'generating_thumbnail' | 'extracting_subtitles';
}

/** Khớp `RemuxModeDto` — cách xử lý video ở `prepare_upload()`, suy từ hạng
 * đã `classifyCompatRank()`: `copy` (A/B), `reencode_audio` (C),
 * `reencode_all` (D — ĐẮT, decode+encode cả video, PHẢI hỏi xác nhận trước
 * khi dùng mode này, mockup A.2 mục 1). */
export type RemuxModeDto = 'copy' | 'reencode_audio' | 'reencode_all';

/** Track phụ đề TEXT cần rút — khớp `SubtitleTrackDto`. Angular tự lọc bỏ
 * track dạng ẢNH (PGS/DVD subtitle) trước khi gửi, xem
 * `IMAGE_SUBTITLE_CODECS` ở `workspace.ts`. */
export interface SubtitleTrackDto {
  index: number;
  lang: string | null;
}

export interface PreparedSubtitleDto {
  lang: string | null;
  path: string;
}

/** Khớp `PreparedUploadDto` — kết quả `prepare_upload()`. */
export interface PreparedUploadDto {
  temp_dir: string;
  remuxed_path: string;
  thumbnail_path: string;
  subtitles: PreparedSubtitleDto[];
  final_probe: ProbeResultDto;
}
