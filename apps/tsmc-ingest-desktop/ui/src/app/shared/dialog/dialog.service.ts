import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmDialogData } from './confirm-dialog';

export type AlertOptions = Omit<ConfirmDialogData, 'mode' | 'cancelText'>;
export type ConfirmOptions = Omit<ConfirmDialogData, 'mode'>;

/**
 * Cổng DUY NHẤT mở `ConfirmDialog` — component đó không tự mở, mọi nơi cần
 * hỏi/báo trong app gọi qua service này thay vì `window.confirm()`/
 * `window.alert()` (dialog gốc trình duyệt, không theo theme Material, và
 * KHÔNG kiểm soát được nút màu warn — cần cho cảnh báo Hạng D re-encode,
 * mockup A.2 mục 1).
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  private readonly dialog = inject(MatDialog);

  /** Chỉ có nút xác nhận — dùng để BÁO, không hỏi (vd lỗi nghiêm trọng cần
   * người dùng đọc rồi tự bấm qua, không có lựa chọn "huỷ" nào hợp lý). */
  async alert(options: AlertOptions): Promise<void> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: { ...options, mode: 'alert' },
      width: '26rem'
    });
    await firstValueFrom(ref.afterClosed());
  }

  /** Có cả hai nút — trả `true` nếu người dùng bấm xác nhận, `false` nếu
   * Huỷ HOẶC đóng dialog bằng cách khác (bấm ra ngoài, phím Esc) — mọi
   * đường đóng không phải "xác nhận" đều coi là từ chối, không có trạng thái
   * thứ ba nào để caller phải xử lý. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
      data: { ...options, mode: 'confirm' },
      width: '26rem'
    });
    const result = await firstValueFrom(ref.afterClosed());
    return result === true;
  }
}
