import { invoke } from '@tauri-apps/api/core';
import type {
  IngestRpcErrorDto,
  LoginOutcomeDto,
  PinnedCatalogDto,
  ResolvedChannelDto,
  SavedCredentialsDto
} from './ingest-rpc.types';

/**
 * Cổng DUY NHẤT gọi `invoke()` của Tauri trong app này — mọi component chỉ
 * gọi qua các hàm dưới, không tự gọi `invoke()` rời rạc. Khớp tinh thần
 * "TelegramGateway" của apps/web (CLAUDE.md bất biến #3), dù ở đây không có
 * eslint-plugin-boundaries ép vì chỉ có một file gọi `@tauri-apps/api`.
 * Mười hai command khớp `src-tauri/src/commands.rs` — PHẢI gọi đúng thứ tự
 * đã ghi ở đó: checkSession() → requestLoginCode() → submitOtp() →
 * (submitPassword() nếu `PasswordRequired`) → MỘT trong ba cách chọn kênh
 * (resolveChannel() / selectChannel() sau listOwnChannels() / createChannel())
 * → checkWritePermission()/readPinnedCatalog() (hai cái sau luôn đọc lại
 * channel của lần chọn gần nhất phía Rust, không cần truyền lại qua IPC).
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
