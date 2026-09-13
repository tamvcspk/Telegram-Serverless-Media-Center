import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface GradeDDialogItem {
  path: string;
  name: string;
  /** Số phút ước tính re-encode, làm tròn LÊN từ duration thật (mockup A.2
   * mục 1: "cảnh báo Hạng D bằng số phút cụ thể"). */
  estimateMin: number;
}

export interface GradeDDialogData {
  items: GradeDDialogItem[];
}

/** Xác nhận re-encode Hạng D CHO CẢ BATCH trong MỘT dialog, có toggle riêng
 * từng file (mặc định checked) — thay bản trước hỏi từng file MỘT dialog
 * riêng (ADR-0018 § "Quyết định kèm theo"). Bỏ tick một file nghĩa là
 * "không upload lúc này" — file đó ở lại Draft (`DraftStore`), KHÔNG bị xoá
 * khỏi bảng, `startUpload()` (`workspace.ts`) tự lọc theo tập `path` được
 * trả về từ `DialogService.confirmGradeD()`. KHÔNG tự mở — luôn qua
 * `DialogService`, cùng quy ước với `ConfirmDialog`. */
@Component({
  selector: 'app-grade-d-dialog',
  imports: [MatButtonModule, MatCheckboxModule, MatDialogModule],
  templateUrl: './grade-d-dialog.html',
  styleUrl: './grade-d-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GradeDDialog {
  protected readonly data = inject<GradeDDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<GradeDDialog, string[]>>(MatDialogRef);

  /** `path` → checked. Mặc định TẤT CẢ checked (khớp hành vi cũ: mỗi file D
   * mặc định được hỏi "tiếp tục?" chứ không mặc định bỏ qua). */
  protected readonly checked = signal<ReadonlySet<string>>(new Set(this.data.items.map((i) => i.path)));

  protected isChecked(path: string): boolean {
    return this.checked().has(path);
  }

  protected toggle(path: string, value: boolean): void {
    this.checked.update((current) => {
      const next = new Set(current);
      if (value) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }

  protected onConfirm(): void {
    this.dialogRef.close([...this.checked()]);
  }
}
