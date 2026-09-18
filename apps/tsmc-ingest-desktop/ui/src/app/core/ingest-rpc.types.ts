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

/** Khớp `ChannelVideoDocumentDto` — một video document tìm thấy khi quét
 * TOÀN BỘ lịch sử kênh (`scanChannelVideos()`, đối soát chiều ngược lại ở
 * Trình quản lý catalog). Chưa so với catalog — tầng gọi tự tính hiệu tập
 * hợp với `msgId` đang có trong `items()`. `file_name` có thể `null` — client
 * Telegram di động gửi "as video" nhiều khi không gắn tên file. */
export interface ChannelVideoDocumentDto {
  msg_id: number;
  file_name: string | null;
  size: number;
  mime_type: string | null;
  duration_sec: number | null;
}

/** Payload sự kiện `"upload-progress"` (`app.emit()`, KHÔNG phải giá trị trả
 * về của `invoke()` — một lần `uploadVideo()` bắn NHIỀU sự kiện này). `task_id`
 * (UUID sinh phía Angular) là correlation id (ADR-0018) — chỉ áp dụng update
 * cho đúng item đang khớp `task_id` đó. `path` chỉ còn để hiển thị/log, KHÔNG
 * dùng để so khớp (path đổi tên/đổi đuôi qua từng bước pipeline nên không ổn
 * định — nguyên nhân bug "progress bar indeterminate" đã sửa ở ADR-0018). */
export interface UploadProgressDto {
  task_id: string;
  path: string;
  bytes_sent: number;
  total_bytes: number;
}

/** Khớp `CurrentTaskDto` — snapshot task đang chạy, đọc bằng `getCurrentTask()`
 * để hydrate `QueueStore` khi `WorkspaceComponent` remount (ADR-0018 mục 5).
 * `bytes_sent`/`total_bytes` `null` ở mọi stage KHÔNG phải `uploading_video`. */
export interface CurrentTaskDto {
  task_id: string;
  path: string;
  stage: string;
  bytes_sent: number | null;
  total_bytes: number | null;
}

/** Payload sự kiện `"pipeline-stage"` — mockup A.2 mục 4. `reencoding` chỉ
 * xảy ra với `mode: 'reencode_all'` (Hạng D — ĐẮT hơn hẳn `remuxing`, xem
 * `RemuxModeDto`). `task_id` là correlation id, cùng quy ước với
 * `UploadProgressDto` (ADR-0018). */
export interface PipelineStageDto {
  task_id: string;
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

/** Khớp `PreparedUploadDto` — kết quả `prepare_upload()`. `file_size_bytes`
 * (thêm 2026-09-19, chuẩn hoá size) là dung lượng THẬT của `remuxed_path` —
 * so với `getMaxUploadBytes()` TRƯỚC khi gọi `uploadVideo()` (xem
 * `workspace.ts::processItem()`). */
export interface PreparedUploadDto {
  temp_dir: string;
  remuxed_path: string;
  thumbnail_path: string;
  subtitles: PreparedSubtitleDto[];
  final_probe: ProbeResultDto;
  file_size_bytes: number;
}

/** Khớp `TmdbKindDto` (ADR-0019) — `'episode'` → `search/tv`, `'movie'` →
 * `search/movie`. Tầng gọi (`workspace.ts`) tự quyết theo `item.metadata.kind`. */
export type TmdbKind = 'movie' | 'episode';

/** Khớp `TmdbSearchResultDto` — một kết quả tìm kiếm TMDB đã chuẩn hoá
 * (movie/tv gộp về cùng shape). `poster_url` đã ghép sẵn base URL ảnh TMDB
 * CỠ NHỎ (`w92`), gán thẳng vào `<img src>` được, `null` nếu TMDB không có
 * poster. `poster_path` là đường dẫn THÔ — truyền lại nguyên văn cho
 * `uploadTmdbPoster()` khi admin chọn kết quả này (Rust tự ghép base URL CỠ
 * LỚN, không tái dùng `poster_url` cỡ nhỏ cho poster thật lưu vào kênh). */
export interface TmdbSearchResultDto {
  id: number;
  title: string;
  year: number | null;
  poster_url: string | null;
  poster_path: string | null;
}

/** Khớp `TmdbDetailsDto` (ADR-0019 § addendum 2026-09-17, TMDB nâng cao) —
 * genres/cast/director gọi tiếp SAU khi admin đã chọn một
 * `TmdbSearchResultDto` cụ thể (cần `id` thật của lựa chọn đó). */
export interface TmdbDetailsDto {
  genres: string[];
  cast: string[];
  director: string | null;
}

/** Khớp `#[serde(tag = "kind", content = "detail")] TmdbErrorDto`. `NoApiKey`
 * để Angular tự mở dialog nhập key thay vì hiện lỗi mạng mơ hồ. `InvalidKey`
 * (HTTP 401 — key SAI) tách riêng khỏi `Network` từ 2026-09-14. */
export type TmdbErrorDto =
  | { kind: 'NoApiKey' }
  | { kind: 'InvalidKey' }
  | { kind: 'Network'; detail: string }
  | { kind: 'Other'; detail: string };
