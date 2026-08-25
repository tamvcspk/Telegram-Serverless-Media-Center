// Kiểu dữ liệu miền + schema Valibot dùng chung — ADR-0011.
// Package này không được phụ thuộc bất cứ thứ gì khác trong repo (ADR-0012 §2).
export const LIB_NAME = '@tsmc/shared-models' as const;

// DTO qua biên Comlink cho luồng đăng nhập (F1.1) — KHÔNG dùng type nào của
// GramJS/`Api.*`, đúng bất biến ADR-0003 "không type GramJS nào rò ra ngoài
// core-mtproto". credentials do chính user tạo tại my.telegram.org (ADR-0001).
export interface TelegramCredentials {
  apiId: number;
  apiHash: string;
}

export interface TelegramUserSummary {
  id: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phone?: string;
}

export interface LoginCallbacks {
  /** isCodeViaApp: true nếu Telegram gửi mã qua app thay vì SMS. */
  phoneCode(isCodeViaApp?: boolean): Promise<string>;
  /** hint: gợi ý mật khẩu 2FA do Telegram trả về, có thể rỗng. */
  password(hint?: string): Promise<string>;
  /** Trả về true để dừng hẳn luồng đăng nhập, false để cho thử lại. */
  onError(err: Error): Promise<boolean>;
}

// DTO cho slice Sync & Hydration (F1.2/F1.3) — ADR-0009, ADR-0014.
export type { SyncEvent, SyncEventInput, SyncEventBase } from './sync-events';
export { isSyncEvent } from './sync-events';
export type { SyncState, ProgressEntry, Collection, SourceRef, SettingValue, SnapshotV1 } from './sync-state';
export { createEmptySyncState } from './sync-state';
export type { StateChannelCandidate, StateChannelChoice, StateChannelResolutionCallbacks } from './sync-channel';

// DTO cho slice Index (F2) — ADR-0010, docs/catalog-spec.md.
export type { CatalogItemV1, CatalogEnvelopeV1 } from './catalog';
export { catalogItemV1Schema, catalogEnvelopeV1Schema, parseCatalogEnvelope, parseCatalogItem, sanitizeUntrustedString } from './catalog';
