import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface OrphanReviewDialogItem {
  msgId: number;
  fileName: string;
  /** Đã format sẵn (vd "342.1 MB") — dialog không tự tính, cùng quy ước với
   * `GradeDDialogItem.estimateMin` (đã format ở tầng gọi). */
  sizeLabel: string;
  /** `null` nếu document không có duration (hiếm, nhưng có thể xảy ra). */
  durationLabel: string | null;
}

export interface OrphanReviewDialogData {
  items: OrphanReviewDialogItem[];
}

/** Hiện danh sách file mồ côi tìm thấy khi quét TOÀN BỘ lịch sử kênh (đối
 * soát chiều ngược lại, `catalog-manager.ts::onScanOrphans()`) — toggle
 * riêng từng dòng, mặc định TẤT CẢ được chọn (cùng khuôn `GradeDDialog`:
 * đây là "thêm vào catalog", không phải cảnh báo cần cân nhắc từng file như
 * Hạng D, nên mặc định chọn hết là hợp lý hơn mặc định bỏ hết). Trả về tập
 * `msgId` còn được chọn lúc bấm "Thêm vào catalog"; đóng bằng nút "Đóng"
 * hoặc Esc/bấm ra ngoài → mảng RỖNG (không thêm gì — cùng nguyên tắc "đóng
 * không phải xác nhận = từ chối" của `DialogService`). KHÔNG tự mở — luôn
 * qua `DialogService.reviewOrphans()`. */
@Component({
  selector: 'app-orphan-review-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule],
  templateUrl: './orphan-review-dialog.html',
  styleUrl: './orphan-review-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class OrphanReviewDialog {
  protected readonly data = inject<OrphanReviewDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<OrphanReviewDialog, number[]>>(MatDialogRef);

  protected readonly checked = signal<ReadonlySet<number>>(new Set(this.data.items.map((i) => i.msgId)));

  protected isChecked(msgId: number): boolean {
    return this.checked().has(msgId);
  }

  protected toggle(msgId: number, value: boolean): void {
    this.checked.update((current) => {
      const next = new Set(current);
      if (value) {
        next.add(msgId);
      } else {
        next.delete(msgId);
      }
      return next;
    });
  }

  protected onClose(): void {
    this.dialogRef.close([]);
  }

  protected onConfirm(): void {
    this.dialogRef.close([...this.checked()]);
  }
}
