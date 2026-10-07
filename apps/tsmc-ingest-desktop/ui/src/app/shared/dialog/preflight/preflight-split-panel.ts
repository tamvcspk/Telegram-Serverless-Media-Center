// Panel "Chia phần" của dialog tiền kiểm (ADR-0022) — bố cục như một player: khung hình ở trên,
// thanh thời gian ở dưới. MỘT khung hình duy nhất, luôn là khung hình tại playhead; điểm cắt "đang
// chọn" chính là điểm cắt trùng playhead (tay cầm sáng lên). Tự động = tay cầm bị khoá (vẫn lướt xem
// được); Thủ công = kéo tay cầm, thêm/bớt điểm cắt (số phần không bị buộc theo dự đoán). Điểm cắt chỉ
// dừng ở keyframe và trong giới hạn mọi phần còn vừa trần (`alternativeCuts()`).
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import type { SplitCandidate } from '@tsmc/core-ingest';
import { formatHms } from '../../../core/split-service';
import { PreflightStore } from './preflight-store';
import type { PreflightDialogItem } from './preflight-types';

@Component({
  selector: 'app-preflight-split-panel',
  imports: [MatButtonModule, MatProgressSpinnerModule],
  templateUrl: './preflight-split-panel.html',
  styleUrl: './preflight-split-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreflightSplitPanel {
  protected readonly store = inject(PreflightStore);
  readonly item = input.required<PreflightDialogItem>();

  protected hms(sec: number): string {
    return formatHms(sec);
  }

  protected partColor(index: number): string {
    return `hsl(${(index * 67 + 200) % 360} 55% 42%)`;
  }

  /** Keyframe đang ở playhead (mang tín hiệu chuyển cảnh/im lặng nếu đã đo). */
  protected playheadKeyframe(): SplitCandidate | undefined {
    const sp = this.store.state(this.item().path).split;
    return sp.keyframes.find((k) => k.timeSec === sp.playheadSec);
  }

  /** Vị trí/độ rộng trên thanh theo % tổng thời lượng. */
  protected pct(sec: number): number {
    const total = this.store.state(this.item().path).split.durationSec;
    return total > 0 ? (sec / total) * 100 : 0;
  }

  /** Vùng điểm cắt đang chọn kéo tới được (từ keyframe sớm nhất tới muộn nhất còn giữ mọi phần ≤ trần). */
  protected selectedRange(): { left: number; width: number } | null {
    const path = this.item().path;
    const index = this.store.selectedCut(path);
    if (index < 0) {
      return null;
    }
    const alts = this.store.splitAlternatives(path, index);
    if (alts.length < 2) {
      return null;
    }
    const left = this.pct(alts[0].timeSec);
    return { left, width: this.pct(alts[alts.length - 1].timeSec) - left };
  }

  private isManual(): boolean {
    return this.store.state(this.item().path).mode === 'manual';
  }

  /** Giờ (giây) tại vị trí con trỏ trên thanh `bar`. */
  private timeAt(bar: HTMLElement, clientX: number): number {
    const rect = bar.getBoundingClientRect();
    const total = this.store.state(this.item().path).split.durationSec;
    return rect.width > 0 ? Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * total : 0;
  }

  // ── lướt trên thanh (đặt playhead), cả hai chế độ ──
  protected onBarPointerDown(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.store.setPlayhead(this.item().path, this.timeAt(event.currentTarget as HTMLElement, event.clientX));
  }

  protected onBarPointerMove(event: PointerEvent): void {
    const bar = event.currentTarget as HTMLElement;
    if (bar.hasPointerCapture(event.pointerId)) {
      this.store.setPlayhead(this.item().path, this.timeAt(bar, event.clientX));
    }
  }

  protected onBarPointerUp(event: PointerEvent): void {
    const bar = event.currentTarget as HTMLElement;
    if (bar.hasPointerCapture(event.pointerId)) {
      bar.releasePointerCapture(event.pointerId);
    }
  }

  // ── tay cầm điểm cắt: CHỌN (và đưa seeker tới đó), không kéo ──
  protected onHandlePointerDown(event: PointerEvent, index: number): void {
    event.stopPropagation(); // không để thanh coi là "đặt seeker tại con trỏ"
    this.store.selectCut(this.item().path, index);
  }

  protected onHandleKeydown(event: KeyboardEvent, index: number): void {
    const path = this.item().path;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.store.selectCut(path, index);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && this.isManual()) {
      event.preventDefault();
      this.store.selectCut(path, index);
      this.store.removeSelectedCut(path);
    }
  }

  /** Khoảng giờ mà điểm cắt đang chọn dời tới được (giữ mọi phần ≤ trần) — nói rõ vì sao có chỗ không dời được. */
  protected moveRangeText(): string | null {
    const path = this.item().path;
    const index = this.store.selectedCut(path);
    if (index < 0) {
      return null;
    }
    const alts = this.store.splitAlternatives(path, index);
    if (alts.length < 2) {
      return `Điểm cắt ${index + 1} không dời được (hai phần kề đã gần đầy trần) — muốn cắt chỗ khác thì thêm một điểm cắt.`;
    }
    return `Điểm cắt ${index + 1} dời được trong khoảng ${this.hms(alts[0].timeSec)} – ${this.hms(alts[alts.length - 1].timeSec)} (vùng sáng trên thanh), vì mọi phần phải ≤ trần.`;
  }

  /** Lý do nút "Di chuyển điểm cắt" đang khoá (null nếu bấm được hoặc không có điểm cắt đang chọn). */
  protected moveBlockedReason(): string | null {
    const check = this.store.cutMoveCheck(this.item().path);
    if (check === null || check.ok) {
      return null;
    }
    switch (check.reason) {
      case 'same':
        return 'Seeker đang ở đúng điểm cắt này.';
      case 'order':
        return 'Không dời qua/trùng điểm cắt kế bên được — đưa seeker vào giữa hai điểm cắt liền kề.';
      case 'too-big':
        return 'Vị trí này làm một phần vượt trần — đưa seeker vào vùng sáng phía trên thanh.';
    }
  }
}
