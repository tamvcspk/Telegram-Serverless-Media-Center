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

export function isDebugEnabled(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('debug') === '1';
}
