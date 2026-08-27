import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { SyncStatus } from '../sync/sync-status';
import { ChannelIndex } from '../index/channel-index';

/**
 * Tab "Nguồn" (Màn hình 4, docs/ux-design.md) — UI thật (MatBottomSheet thêm
 * nguồn, MatProgressBar theo card) CHƯA xây. Tạm thời host lại hai công cụ
 * debug đã có (`ChannelIndex` — thêm/quét nguồn, `SyncStatus` — trạng thái
 * đồng bộ) vì cả hai đều thuộc phạm vi "quản lý nguồn dữ liệu" gần nhất với
 * tab này trong 3 tab hiện có — xoá khối này khi Màn hình 4 thật được build.
 *
 * Nút Đăng xuất cũng tạm đặt ở đây (route duy nhất còn lại có nút bấm được
 * sau khi login.ts không còn render nhánh 'authenticated'). Đây KHÔNG phải
 * luồng Đăng xuất đầy đủ ở Màn hình 7 (docs/ux-design.md) — thiếu bước kiểm
 * tra/flush outbox trước khi xoá phiên và bước xác nhận 2 lần qua
 * `MatBottomSheet`; chỉ đủ để không mất hẳn khả năng đăng xuất trong lúc
 * Màn hình 7 chưa được build.
 */
@Component({
  selector: 'app-sources',
  imports: [MatButtonModule, SyncStatus, ChannelIndex],
  templateUrl: './sources.html',
  styleUrl: './sources.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Sources {
  private readonly client = createCoreWorkerClient();
  private readonly router = inject(Router);

  protected readonly loggingOut = signal(false);
  protected readonly logoutError = signal<string | null>(null);

  async onLogout(): Promise<void> {
    this.loggingOut.set(true);
    this.logoutError.set(null);
    try {
      await this.client.logout();
      await this.router.navigateByUrl('/login');
    } catch (err) {
      // Khác bug cũ (không try/catch, promise reject không ai bắt — xem
      // ADR-0016/ux-design.md addendum) — chỉ điều hướng đi KHI logout()
      // thật sự thành công, không âm thầm coi như xong.
      this.logoutError.set(err instanceof Error ? err.message : 'Đăng xuất thất bại.');
    } finally {
      this.loggingOut.set(false);
    }
  }
}
