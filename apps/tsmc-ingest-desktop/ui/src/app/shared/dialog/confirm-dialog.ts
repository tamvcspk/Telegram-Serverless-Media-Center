import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

/** `mode: 'alert'` chỉ có nút xác nhận (không có Huỷ) — dùng để BÁO, không
 * hỏi. `mode: 'confirm'` có cả hai — người dùng phải chọn. `DialogService`
 * (cùng thư mục) là nơi DUY NHẤT tạo giá trị này, component không tự suy
 * đoán `mode` từ field nào khác. */
export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  /** `'warn'` tô đỏ nút xác nhận (mockup A.2 mục 1: cảnh báo Hạng D) — mặc
   * định `'default'` (màu primary). */
  tone?: 'default' | 'warn';
  mode: 'alert' | 'confirm';
}

/**
 * Dialog xác nhận/báo dùng CHUNG cho cả app — thay `window.confirm()`/
 * `window.alert()` (dialog gốc trình duyệt, không theo theme, không kiểm
 * soát được layout/nút màu warn) bằng Angular Material thật. KHÔNG tự mở —
 * luôn qua `DialogService.confirm()`/`alert()` (cùng thư mục), component chỉ
 * là view thuần đọc `MAT_DIALOG_DATA`.
 */
@Component({
  selector: 'app-confirm-dialog',
  imports: [MatButtonModule, MatDialogModule],
  templateUrl: './confirm-dialog.html',
  styleUrl: './confirm-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ConfirmDialog {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);

  protected onCancel(): void {
    this.dialogRef.close(false);
  }

  protected onConfirm(): void {
    this.dialogRef.close(true);
  }
}
