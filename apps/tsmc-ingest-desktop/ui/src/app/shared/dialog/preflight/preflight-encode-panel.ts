// Panel "Nén lại" của dialog tiền kiểm (ADR-0017 § addendum 2026-09-19, Giai đoạn 2).
// Tự động = Option D (thuật toán chọn, chỉ xem); Thủ công = MỌI tham số `ReencodeOptions` đều
// chỉnh được (bitrate video — trực tiếp hoặc qua kích thước đầu ra —, độ phân giải, bitrate audio),
// khởi đầu từ giá trị hiện tại của chế độ Tự động (kể cả target đã hiệu chỉnh sau "Ước tính chính xác").
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { AUDIO_BITRATE_CHOICES_BPS } from '@tsmc/core-ingest';
import { PreflightStore } from './preflight-store';
import { mustReencode, type PreflightDialogItem } from './preflight-types';

@Component({
  selector: 'app-preflight-encode-panel',
  imports: [MatButtonModule, MatButtonToggleModule, MatProgressSpinnerModule, MatSliderModule],
  templateUrl: './preflight-encode-panel.html',
  styleUrl: './preflight-encode-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreflightEncodePanel {
  protected readonly store = inject(PreflightStore);
  readonly item = input.required<PreflightDialogItem>();
  protected readonly audioChoices = AUDIO_BITRATE_CHOICES_BPS;
  protected readonly mustReencode = mustReencode;

  protected onKbps(path: string, event: Event): void {
    this.store.setVideoKbps(path, Number((event.target as HTMLInputElement).value));
  }
}
