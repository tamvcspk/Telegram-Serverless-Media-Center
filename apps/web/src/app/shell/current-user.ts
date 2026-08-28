import { signal } from '@angular/core';
import type { TelegramUserSummary } from '@tsmc/shared-models';

/**
 * Bản sao NHẸ của user hiện tại — set bởi `authGuard` (nơi DUY NHẤT gọi
 * `restoreSession()` xuyên điều hướng, xem auth.guard.ts) ngay sau khi
 * restore thành công. Settings (Màn hình 7, khối "Tài khoản kết nối") đọc
 * signal này thay vì tự gọi lại `restoreSession()` — gọi lại sẽ tạo THÊM một
 * `TelegramClient` mới trong gateway (gateway.ts không tái dùng client cũ,
 * xem restoreSession()), tốn một round-trip `checkAuthorization`/`getMe()`
 * không cần thiết chỉ để hiển thị lại đúng thông tin guard vừa có.
 */
export const currentUser = signal<TelegramUserSummary | null>(null);
