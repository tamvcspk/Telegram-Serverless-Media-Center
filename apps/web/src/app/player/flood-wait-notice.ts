import { signal } from '@angular/core';

/**
 * Cầu tín hiệu FLOOD_WAIT từ `stream-bridge.ts` (chạy ở cấp module, sống
 * xuyên suốt vòng đời trang — ADR-0004 §3) sang `player.ts` (component, tạo
 * lại mỗi lần vào Player) — Màn hình 5, docs/ux-design.md: `MatSnackBar` báo
 * FLOOD_WAIT ở cạnh trên, không đè lên control phát.
 *
 * Object MỚI mỗi lần báo (không phải chuỗi trần) — nếu chỉ set lại đúng
 * cùng nội dung message (vd hai lần flood liên tiếp cùng số giây), Angular
 * signal bỏ qua thông báo thay đổi khi so sánh bằng giá trị nguyên thuỷ
 * (`Object.is` trên string) và snackbar thứ hai sẽ không bao giờ bật lên.
 */
export interface FloodWaitNotice {
  message: string;
}

export const floodWaitNotice = signal<FloodWaitNotice | null>(null);

export function reportFloodWait(message: string): void {
  floodWaitNotice.set({ message });
}
