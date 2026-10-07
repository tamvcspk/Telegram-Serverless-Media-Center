// Dialog TIỀN KIỂM dung lượng (Giai đoạn 0 → 4, ADR-0017 § addendum 2026-09-19 "kế hoạch", ADR-0022) —
// MỘT dialog duy nhất để giải quyết mọi file đã chọn upload (thay dialog Hạng D + dialog vượt trần
// nối tiếp trước đây), hỏi TRƯỚC khi file nào bắt đầu xử lý:
//
// - Trái: danh sách file (trạng thái từng file). Phải: thiết lập của file đang chọn — chọn phương
//   pháp (Nén lại / Chia phần / Bỏ qua, hoặc Upload nguyên với file không cần quyết định) rồi hiệu
//   chỉnh ngay trong một lượt: công tắc Tự động (thuật toán chọn) / Thủ công (tự đặt).
// - Mỗi file giữ thiết lập RIÊNG (`PreflightStore`); đổi phương pháp không làm mất thiết lập của
//   phương pháp kia. "Áp dụng cho tất cả" chỉ là lối tắt đặt hàng loạt.
// - 90% khung nhìn, kéo giãn bằng tay cầm góc phải-dưới: dialog nằm giữa màn hình nên kéo giãn
//   ĐỐI XỨNG (2× độ dời) để tay cầm luôn dính con trỏ.
//
// Đóng bằng cách khác (Esc/ra ngoài/"Huỷ upload") → `null`: `startUpload()` dừng hẳn, mọi file còn
// nguyên trong bảng metadata. KHÔNG tự mở — luôn qua `DialogService.confirmPreflight()`.
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { firstValueFrom } from 'rxjs';
import { ConfirmDialog, type ConfirmDialogData } from '../confirm-dialog';
import { PreflightEncodePanel } from './preflight-encode-panel';
import { PreflightSplitPanel } from './preflight-split-panel';
import { PreflightStore, type ItemStrategy } from './preflight-store';
import { mustReencode, needsDecision, type PreflightDialogData, type PreflightDialogItem, type PreflightDialogResult } from './preflight-types';

const MIN_WIDTH_PX = 880;
const MIN_HEIGHT_PX = 520;
/** Giữ lại một dải mép để luôn thấy/kéo được tay cầm. */
const MAX_VIEWPORT_FRACTION = 0.98;

@Component({
  selector: 'app-preflight-dialog',
  imports: [MatButtonModule, MatButtonToggleModule, MatDialogModule, MatMenuModule, PreflightEncodePanel, PreflightSplitPanel],
  providers: [PreflightStore],
  templateUrl: './preflight-dialog.html',
  styleUrl: './preflight-dialog.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PreflightDialog {
  protected readonly store = inject(PreflightStore);
  protected readonly data = inject<PreflightDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<PreflightDialog, PreflightDialogResult>>(MatDialogRef);
  private readonly dialog = inject(MatDialog);

  protected readonly needsDecision = needsDecision;
  protected readonly mustReencode = mustReencode;

  /** Nhãn phương pháp + chế độ hiện ở dòng file bên trái. */
  protected rowLabel(item: PreflightDialogItem): string {
    const s = this.store.state(item.path);
    switch (s.strategy) {
      case 'upload':
        return 'Upload nguyên';
      case 'skip':
        return 'Bỏ qua';
      case 'reencode':
        return `Nén lại · ${s.mode === 'auto' ? 'tự động' : 'thủ công'}`;
      case 'split': {
        const parts = s.split.status === 'ready' ? s.split.cuts.length + 1 : this.store.splitPartCount(item);
        return `Chia ${s.split.status === 'ready' ? '' : '~'}${parts} phần · ${s.mode === 'auto' ? 'tự động' : 'thủ công'}`;
      }
    }
  }

  protected rowStatus(item: PreflightDialogItem): 'ok' | 'blocked' | 'skip' {
    if (this.store.state(item.path).strategy === 'skip') {
      return 'skip';
    }
    return this.store.blockers().some((b) => b.path === item.path) ? 'blocked' : 'ok';
  }

  protected blockerReasons(item: PreflightDialogItem): string {
    return this.store
      .blockers()
      .filter((b) => b.path === item.path)
      .map((b) => b.reason)
      .join('; ');
  }

  protected setStrategy(path: string, strategy: ItemStrategy): void {
    this.store.setStrategy(path, strategy);
  }

  protected async autoAll(): Promise<void> {
    if (this.store.anyManual()) {
      const ref = this.dialog.open<ConfirmDialog, ConfirmDialogData, boolean>(ConfirmDialog, {
        data: { title: 'Đặt lại tự động cho tất cả?', message: 'Mọi thiết lập tay (điểm cắt, bitrate, độ phân giải, audio) của các file đang ở chế độ Thủ công sẽ bị thay bằng kết quả của thuật toán.', confirmText: 'Đặt lại', cancelText: 'Giữ nguyên', tone: 'warn', mode: 'confirm' },
        width: '26rem'
      });
      if ((await firstValueFrom(ref.afterClosed())) !== true) {
        return;
      }
    }
    this.store.setAllAuto();
  }

  protected onConfirm(): void {
    this.dialogRef.close({ choices: this.store.choices() });
  }

  protected onResizePointerDown(event: PointerEvent): void {
    const grip = event.currentTarget as HTMLElement;
    const pane = grip.closest('.cdk-overlay-pane') as HTMLElement | null;
    if (!pane) {
      return;
    }
    event.preventDefault();
    grip.setPointerCapture(event.pointerId);
    const start = { x: event.clientX, y: event.clientY, w: pane.offsetWidth, h: pane.offsetHeight };
    const onMove = (e: PointerEvent): void => {
      const w = Math.min(window.innerWidth * MAX_VIEWPORT_FRACTION, Math.max(MIN_WIDTH_PX, start.w + 2 * (e.clientX - start.x)));
      const h = Math.min(window.innerHeight * MAX_VIEWPORT_FRACTION, Math.max(MIN_HEIGHT_PX, start.h + 2 * (e.clientY - start.y)));
      this.dialogRef.updateSize(`${Math.round(w)}px`, `${Math.round(h)}px`);
    };
    const onUp = (e: PointerEvent): void => {
      grip.releasePointerCapture(e.pointerId);
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  }
}
