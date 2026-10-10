// Panel "Nén lại" của dialog tiền kiểm (ADR-0017 § addendum 2026-09-19, Giai đoạn 2).
// Tự động = thuật toán chọn, chỉ xem; Thủ công kiểu HandBrake (ADR-0023 § 4c.3): MỘT thanh chất lượng (RF)
// cho người dùng thường, còn kiểu rate control / độ phân giải / preset / audio nằm trong "Nâng cao"
// (đóng/mở nhớ ở app-data). Khởi đầu từ giá trị hiện tại của chế độ Tự động.
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSliderModule } from '@angular/material/slider';
import { AUDIO_BITRATE_CHOICES_BPS, RF_MAX, RF_MIN, X264_PRESET_CHOICES } from '@tsmc/core-ingest';
import { PreflightStore } from './preflight-store';
import { mustReencode, type PreflightDialogItem } from './preflight-types';

@Component({
  selector: 'app-preflight-encode-panel',
  imports: [MatButtonModule, MatButtonToggleModule, MatProgressBarModule, MatProgressSpinnerModule, MatSliderModule],
  templateUrl: './preflight-encode-panel.html',
  styleUrl: './preflight-encode-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreflightEncodePanel {
  protected readonly store = inject(PreflightStore);
  readonly item = input.required<PreflightDialogItem>();
  protected readonly audioChoices = AUDIO_BITRATE_CHOICES_BPS;
  protected readonly presetChoices = X264_PRESET_CHOICES;
  protected readonly rfMin = RF_MIN;
  protected readonly rfMax = RF_MAX;

  /** Nhãn nổi trên núm thanh chất lượng khi kéo/rê chuột: vị trí → "RF 20 · cao". Vị trí trái = RF cao. */
  protected readonly sliderLabel = (position: number): string => {
    const rf = RF_MIN + RF_MAX - position;
    return `RF ${rf} · ${this.store.rfLabel(rf)}`;
  };

  /** Nhãn nổi của thanh dung lượng đích (byte → "1.85 GB"). */
  protected readonly gbLabel = (bytes: number): string => `${this.store.gb(bytes)} GB`;
  protected readonly mustReencode = mustReencode;

  protected onKbps(path: string, event: Event): void {
    this.store.setVideoKbps(path, Number((event.target as HTMLInputElement).value));
  }
}
