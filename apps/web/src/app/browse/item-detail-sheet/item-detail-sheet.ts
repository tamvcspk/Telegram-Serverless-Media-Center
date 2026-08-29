import { ChangeDetectionStrategy, Component, Signal, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { MAT_BOTTOM_SHEET_DATA, MatBottomSheetRef } from '@angular/material/bottom-sheet';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { getMediaItem, liveQuery, type MediaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { Collection, SourceRef } from '@tsmc/shared-models';
import { from } from 'rxjs';
import { PosterTile } from '../../shared/poster-tile/poster-tile';

export interface ItemDetailSheetData {
  row: MediaRecord;
  /** null nếu nguồn đã bị gỡ giữa lúc lưới còn hiển thị item cũ — bỏ qua resolveItemTrust, vẫn cho Phát/Sửa metadata/BST bình thường. */
  source: SourceRef | null;
  /** Truyền thẳng Signal (không phải giá trị đã đọc) — sheet đọc reactive từ cùng liveQuery của Browse, không mở thêm liveQuery trùng. */
  collections: Signal<Collection[]>;
}

// "src:<sourceId>/msg:<msgId>" — cùng quy ước khoá đã dùng ở ProgressEntry.k
// (ADR-0009, player.ts progressKey) và collections.ts parseItemKey().
function itemKeyOf(row: MediaRecord): string {
  return `src:${row.sourceId}/msg:${row.msgId}`;
}

/**
 * Bottom sheet chi tiết phim (Màn hình 2) — thay thao tác rời rạc từng nút
 * trên card lưới (đã hết chỗ ở kích thước card mới, xem browse.ts
 * `onCardOpen`). Đọc lại item qua `liveQuery` thay vì tin snapshot lúc mở
 * sheet, để trust badge phản ánh đúng NGAY SAU khi `resolveItemTrust()`
 * (gọi lúc sheet mở, fire-and-forget) ghi lại kết quả. Checklist "Thêm vào
 * bộ sưu tập" hiện luôn trong sheet — hành động toggle đơn giản, không đáng
 * tách thêm một bước điều hướng riêng (đã chốt với user).
 */
@Component({
  selector: 'app-item-detail-sheet',
  imports: [PosterTile, MatButtonModule, MatCheckboxModule],
  templateUrl: './item-detail-sheet.html',
  styleUrl: './item-detail-sheet.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ItemDetailSheet {
  private readonly sheetRef = inject(MatBottomSheetRef<ItemDetailSheet, void>);
  private readonly sheetData = inject<ItemDetailSheetData>(MAT_BOTTOM_SHEET_DATA);
  private readonly router = inject(Router);
  private readonly client = createCoreWorkerClient();

  protected readonly row = toSignal(from(liveQuery(() => getMediaItem(this.sheetData.row.sourceId, this.sheetData.row.msgId))), {
    initialValue: this.sheetData.row as MediaRecord | undefined
  });

  protected readonly collections = this.sheetData.collections;

  constructor() {
    const source = this.sheetData.source;
    if (source) {
      void this.client.resolveItemTrust(this.sheetData.row.sourceId, source.ref, this.sheetData.row.msgId);
    }
  }

  isInCollection(collection: Collection): boolean {
    const current = this.row();
    return current !== undefined && collection.items.includes(itemKeyOf(current));
  }

  async onToggleCollection(collection: Collection): Promise<void> {
    const current = this.row();
    if (!current) {
      return;
    }
    const key = itemKeyOf(current);
    if (collection.items.includes(key)) {
      await this.client.removeFromCollection(collection.id, key);
    } else {
      await this.client.addToCollection(collection.id, key);
    }
  }

  onPlay(): void {
    const current = this.row();
    if (!current) {
      return;
    }
    this.sheetRef.dismiss();
    void this.router.navigate(['/player', current.sourceId, current.msgId]);
  }

  onEditMetadata(): void {
    const current = this.row();
    if (!current) {
      return;
    }
    this.sheetRef.dismiss();
    void this.router.navigate(['/metadata', current.sourceId, current.msgId]);
  }
}
