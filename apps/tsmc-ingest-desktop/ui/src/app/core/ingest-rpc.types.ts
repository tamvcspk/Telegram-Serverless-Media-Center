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
