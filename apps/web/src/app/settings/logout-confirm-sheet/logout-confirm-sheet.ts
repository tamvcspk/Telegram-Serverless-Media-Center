import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { createCoreWorkerClient } from '@tsmc/worker-host';

export interface LogoutConfirmSheetData {
  pendingOutboxCount: number;
}

type Phase = 'confirm' | 'processing' | 'error';

/**
 * MatBottomSheet xác nhận Đăng xuất (Màn hình 7, "Logout Journey" —
 * docs/ux-design.md) — KHÔNG đăng xuất ngay khi bấm nút ở Settings, luôn qua
 * xác nhận lần 2 ở đây vì rào cản đăng nhập lại (API_ID/API_HASH/OTP) rất
 * lớn. Nút thoát (`color="warn"`) đặt TRƯỚC nút Huỷ trong DOM — Huỷ là hành
 * động nổi bật/mặc định hơn về thị giác (giảm chạm nhầm, xem ux-design.md).
 *
 * `client.logout()` (worker-host/core-worker.ts) tự làm ĐỦ bốn bước đúng thứ
 * tự (flush outbox → dừng timer → auth.LogOut → xoá IndexedDB) và ném lỗi
 * NGAY nếu bước nào thất bại mà chưa đụng bước sau — component này chỉ cần
 * bắt lỗi chung, không cần tự phân biệt lỗi đến từ bước nào.
 */
@Component({
  selector: 'app-logout-confirm-sheet',
  imports: [MatButtonModule, MatProgressBarModule],
  templateUrl: './logout-confirm-sheet.html',
  styleUrl: './logout-confirm-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LogoutConfirmSheet {
  private readonly sheetRef = inject(MatBottomSheetRef<LogoutConfirmSheet, 'success'>);
  private readonly client = createCoreWorkerClient();
  protected readonly data = inject<LogoutConfirmSheetData>(MAT_BOTTOM_SHEET_DATA);

  protected readonly phase = signal<Phase>('confirm');
  protected readonly errorMessage = signal<string | null>(null);

  async onConfirm(): Promise<void> {
    this.phase.set('processing');
    this.errorMessage.set(null);
    try {
      await this.client.logout();
      this.sheetRef.dismiss('success');
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : String(err));
      this.phase.set('error');
    }
  }

  onCancel(): void {
    this.sheetRef.dismiss();
  }
}
