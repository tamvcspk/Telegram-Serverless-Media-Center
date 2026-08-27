import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { createCoreWorkerClient } from '@tsmc/worker-host';

export type AddSourceResult = { kind: 'ref'; ref: string } | { kind: 'channel'; id: string; title: string };

// Chấp nhận @username / t.me/username / https://t.me/username, từ chối ID
// thô (username sau khi bóc tiền tố chỉ toàn chữ số) — ADR-0014 §1:
// access_hash khác nhau theo từng tài khoản nên chia sẻ id thô là vô nghĩa.
// Không áp dụng cho lựa chọn từ picker (onPickChannel) — link t.me/c/<id> ở
// đó tự sinh từ listMemberChannels() CỦA CHÍNH tài khoản này, khác với việc
// bắt user tự gõ/dán id thô do người khác đưa.
function looksLikeRawId(ref: string): boolean {
  const stripped = ref
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@/, '')
    .replace(/^c\//, '');
  return /^-?\d+$/.test(stripped);
}

/**
 * MatBottomSheet thêm nguồn (Màn hình 4, docs/ux-design.md) — thay popup
 * giữa màn hình theo nguyên tắc mobile-first. Chỉ thu thập lựa chọn rồi trả
 * về qua `bottomSheetRef.dismiss()`; `Sources` (component cha) mới thật sự
 * gọi `addSource()`/`configureSource()` — cùng quy ước với
 * `CreateCollectionDialog` (collections/), giữ RPC ghi tập trung một chỗ.
 */
@Component({
  selector: 'app-add-source-sheet',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './add-source-sheet.html',
  styleUrl: './add-source-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AddSourceSheet {
  private readonly sheetRef = inject(MatBottomSheetRef<AddSourceSheet, AddSourceResult>);
  private readonly client = createCoreWorkerClient();

  protected readonly refError = signal<string | null>(null);

  protected readonly showPicker = signal(false);
  protected readonly loadingChannels = signal(false);
  protected readonly channels = signal<readonly { id: string; title: string; isBroadcast: boolean }[]>([]);
  protected readonly pickerError = signal<string | null>(null);

  onSubmitRef(event: Event, refInput: HTMLInputElement): void {
    event.preventDefault();
    const ref = refInput.value.trim();
    if (!ref) {
      return;
    }
    if (looksLikeRawId(ref)) {
      this.refError.set(
        'Không dùng ID thô — access_hash khác nhau theo từng tài khoản. Dán username (@tên) hoặc link t.me/tên, hoặc chọn từ danh sách bên dưới.'
      );
      return;
    }
    this.refError.set(null);
    this.sheetRef.dismiss({ kind: 'ref', ref });
  }

  async onTogglePicker(): Promise<void> {
    const next = !this.showPicker();
    this.showPicker.set(next);
    if (!next || this.channels().length > 0) {
      return;
    }
    this.loadingChannels.set(true);
    this.pickerError.set(null);
    try {
      this.channels.set(await this.client.listMemberChannels());
    } catch (err) {
      this.pickerError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingChannels.set(false);
    }
  }

  onPickChannel(channel: { id: string; title: string }): void {
    this.sheetRef.dismiss({ kind: 'channel', id: channel.id, title: channel.title });
  }

  onCancel(): void {
    this.sheetRef.dismiss();
  }
}
