import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';

/** Hiện khi admin bấm "Tra TMDB" lần đầu (chưa có key lưu sẵn) — ADR-0019
 * mục 2: đây là cách hiện thực "opt-in, mặc định tắt" mà KHÔNG cần màn
 * Settings riêng (app chưa có) — admin CHỦ ĐỘNG cung cấp key = tự bật tính
 * năng. Đóng dialog trả về key đã nhập (chuỗi rỗng bị coi như huỷ), hoặc
 * `undefined` nếu đóng bằng cách khác (Esc/bấm ra ngoài). KHÔNG tự mở —
 * luôn qua `DialogService.promptTmdbApiKey()`. */
export interface TmdbKeyDialogData {
  /** URL hướng dẫn lấy key — hiện làm link trong dialog, không hardcode
   * trong component để dễ đổi nếu TMDB thay đổi trang. */
  helpUrl: string;
}

@Component({
  selector: 'app-tmdb-key-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule],
  templateUrl: './tmdb-key-dialog.html',
  styleUrl: './tmdb-key-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TmdbKeyDialog {
  protected readonly data = inject<TmdbKeyDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<TmdbKeyDialog, string>>(MatDialogRef);

  protected readonly apiKey = signal('');

  protected onSave(): void {
    const trimmed = this.apiKey().trim();
    if (trimmed.length > 0) {
      this.dialogRef.close(trimmed);
    }
  }

  protected onCancel(): void {
    this.dialogRef.close();
  }
}
