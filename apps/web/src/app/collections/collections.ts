import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * Placeholder tab "BST" (Màn hình 3, docs/ux-design.md) — chưa xây, chỉ giữ
 * chỗ trong bottom nav để route/skeleton có đủ 3 tab. Xem CLAUDE.md: chỉ
 * Auth/Sync/Index/Browse/Playback đã chạy thật, Collections chưa có UI.
 */
@Component({
  selector: 'app-collections',
  template: `<p class="placeholder">📚 Bộ sưu tập — chưa xây (xem Màn hình 3, docs/ux-design.md).</p>`,
  styles: `
    .placeholder {
      padding: 2rem 1rem;
      text-align: center;
      opacity: 0.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Collections {}
