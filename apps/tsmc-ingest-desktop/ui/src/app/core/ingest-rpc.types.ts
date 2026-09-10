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

/** Khớp `#[serde(tag = "outcome")] LoginOutcomeDto`. */
export type LoginOutcomeDto = { outcome: 'LoggedIn' } | { outcome: 'PasswordRequired' };
