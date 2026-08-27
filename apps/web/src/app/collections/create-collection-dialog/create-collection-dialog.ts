import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

export interface CreateCollectionDialogData {
  /** Có giá trị khi dialog dùng để đổi tên (Màn hình 3) thay vì tạo mới — input điền sẵn tên cũ, tiêu đề/nút đổi theo. */
  existingName?: string;
}

/**
 * Dialog tạo bộ sưu tập mới / đổi tên (Màn hình 3, docs/ux-design.md) — dùng
 * chung một component cho cả hai vì cùng là "nhập một tên hợp lệ rồi trả về",
 * chỉ khác tiêu đề và giá trị khởi tạo của input. Trả tên đã trim qua
 * `dialogRef.close()`, hoặc `undefined` nếu user bấm Huỷ/đóng ngoài dialog.
 */
@Component({
  selector: 'app-create-collection-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  templateUrl: './create-collection-dialog.html',
  styleUrl: './create-collection-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CreateCollectionDialog {
  private readonly dialogRef = inject(MatDialogRef<CreateCollectionDialog, string>);
  protected readonly data = inject<CreateCollectionDialogData>(MAT_DIALOG_DATA);

  protected readonly isRename = Boolean(this.data.existingName);
  protected readonly error = signal<string | null>(null);

  onSubmit(event: Event, nameInput: string): void {
    event.preventDefault();
    const name = nameInput.trim();
    if (!name) {
      this.error.set('Nhập tên bộ sưu tập trước khi xác nhận.');
      return;
    }
    this.dialogRef.close(name);
  }
}
