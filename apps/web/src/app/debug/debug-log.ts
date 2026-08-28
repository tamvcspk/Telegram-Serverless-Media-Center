// Log debug dùng chung (F4) — signal thay vì DOM overlay rời: ghi thẳng vào
// trang play (player.html bind trực tiếp `debugLogLines()`), tránh phụ thuộc
// việc tự chèn phần tử vào `document.body` có thể bị `<video>` fullscreen
// gốc của iOS Safari che mất hoàn toàn (phát hiện thật — xem player.ts
// `playsinline`). Không thêm dependency, không CDN thứ ba (CLAUDE.md bất
// biến #8).
import { signal } from '@angular/core';

const MAX_LINES = 150;

export const debugLogLines = signal<string[]>([]);

export function debugLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  debugLogLines.update((lines) => {
    const next = [...lines, `[${ts}] ${line}`];
    return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
  });
}

const DEBUG_STORAGE_KEY = 'tsmc-debug-enabled';

/**
 * `?debug=1` HOẶC cờ đã lưu (Cài đặt, Màn hình 7 — MatSlideToggle "Bật Log
 * Worker"). Cờ lưu trong `localStorage` (KHÔNG qua kênh state Telegram) —
 * đây là tuỳ chọn debug cục bộ của thiết bị này, không phải domain data cần
 * đồng bộ (ADR-0009 chỉ đồng bộ mutation người dùng thật sự quan tâm xuyên
 * thiết bị). `initDebugCapture()` chỉ đọc cờ này MỘT LẦN lúc bootstrap
 * (main.ts) — bật/tắt từ Cài đặt có hiệu lực sau khi tải lại trang.
 */
export function isDebugEnabled(): boolean {
  if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1') {
    return true;
  }
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(DEBUG_STORAGE_KEY, enabled ? '1' : '0');
  } catch {
    // Safari chế độ riêng tư/quota đầy có thể ném lỗi — tắt log debug không
    // phải tính năng cốt lõi, im lặng bỏ qua thay vì làm hỏng toàn màn Cài đặt.
  }
}
