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
