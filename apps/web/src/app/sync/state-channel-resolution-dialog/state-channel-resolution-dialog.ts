import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatTabsModule } from '@angular/material/tabs';
import type { StateChannelCandidate, StateChannelChoice } from '@tsmc/shared-models';

export interface StateChannelResolutionDialogData {
  candidates: StateChannelCandidate[];
}

/**
 * Dò được nhiều hơn một kênh state — ADR-0014 "không tự đoán, hiện màn cho
 * user chọn". Đây cũng là chỗ DUY NHẤT có ô "dán link thủ công" — thay vì
 * dựng riêng một trang Cài đặt (chưa tồn tại) chỉ cho một lối thoát hiếm
 * khi dùng, gộp luôn vào đúng thời điểm nó thật sự cần.
 */
@Component({
  selector: 'app-state-channel-resolution-dialog',
  imports: [DatePipe, MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatRadioModule, MatTabsModule],
  templateUrl: './state-channel-resolution-dialog.html',
  styleUrl: './state-channel-resolution-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StateChannelResolutionDialog {
  private readonly dialogRef = inject(MatDialogRef<StateChannelResolutionDialog, StateChannelChoice>);
  readonly data = inject<StateChannelResolutionDialogData>(MAT_DIALOG_DATA);

  readonly selectedChannelId = signal<string | null>(this.data.candidates[0]?.id ?? null);
  readonly linkError = signal<string | null>(null);

  onUseSelected(): void {
    const channelId = this.selectedChannelId();
    if (!channelId) {
      return;
    }
    this.dialogRef.close({ kind: 'use', channelId });
  }

  onMergeAll(): void {
    this.dialogRef.close({ kind: 'merge', channelIds: this.data.candidates.map((c) => c.id) });
  }

  onSubmitLink(event: Event, linkInput: string): void {
    event.preventDefault();
    const link = linkInput.trim();
    if (!link) {
      this.linkError.set('Dán link kênh state (dạng t.me/c/…) trước khi xác nhận.');
      return;
    }
    this.dialogRef.close({ kind: 'link', link });
  }
}
