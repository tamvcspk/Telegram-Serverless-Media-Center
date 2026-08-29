import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { getSyncState, liveQuery } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { createEmptySyncState, type Collection } from '@tsmc/shared-models';
import { firstValueFrom, from } from 'rxjs';
import { PosterTile } from '../shared/poster-tile/poster-tile';
import { CreateCollectionDialog } from './create-collection-dialog/create-collection-dialog';

/**
 * Tab "BST" (Màn hình 3, docs/ux-design.md) — nay CHỈ còn danh sách bộ sưu
 * tập dạng lưới tile (tên + số lượng), tap vào tile điều hướng sang
 * `home/collections/:id` (`CollectionDetail`, route con lồng thêm ở
 * app.routes.ts) thay vì hiện hết mọi item của mọi BST trên cùng một trang.
 * Toàn bộ logic resolve/kéo-thả/gỡ item đã dời sang `collection-detail.ts`.
 * Xoá cả bộ sưu tập dùng `confirm()` gốc trình duyệt thay vì dialog Material
 * riêng — hành động hiếm, không đáng một component chỉ để xác nhận.
 */
@Component({
  selector: 'app-collections',
  imports: [MatButtonModule, MatMenuModule, PosterTile, RouterLink],
  templateUrl: './collections.html',
  styleUrl: './collections.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Collections {
  private readonly client = createCoreWorkerClient();
  private readonly dialog = inject(MatDialog);

  private readonly syncState = toSignal(from(liveQuery(() => getSyncState())), { initialValue: createEmptySyncState() });

  protected readonly collections = computed(() =>
    Object.values(this.syncState().collections)
      .filter((c) => !c.deleted)
      .sort((a, b) => a.name.localeCompare(b.name, 'vi'))
  );

  // Dùng CHUNG một <mat-menu> cho mọi tile (thay vì một menu/tile) — cùng lý
  // do đã áp dụng ở browse.ts trước đây: số tile hiển thị cùng lúc nhỏ nên
  // chi phí không đáng kể, nhưng dùng chung đơn giản hơn.
  protected readonly menuTargetCollection = signal<Collection | null>(null);

  trackByCollection(_index: number, collection: Collection): string {
    return collection.id;
  }

  onOpenTileMenu(collection: Collection): void {
    this.menuTargetCollection.set(collection);
  }

  async onCreate(): Promise<void> {
    const ref = this.dialog.open(CreateCollectionDialog, { data: {} });
    const name = await firstValueFrom(ref.afterClosed());
    if (!name) {
      return;
    }
    await this.client.createCollection(crypto.randomUUID(), name);
  }

  async onRename(): Promise<void> {
    const collection = this.menuTargetCollection();
    if (!collection) {
      return;
    }
    const ref = this.dialog.open(CreateCollectionDialog, { data: { existingName: collection.name } });
    const name = await firstValueFrom(ref.afterClosed());
    if (!name) {
      return;
    }
    await this.client.renameCollection(collection.id, name);
  }

  async onDeleteCollection(): Promise<void> {
    const collection = this.menuTargetCollection();
    if (!collection) {
      return;
    }
    if (!confirm(`Xoá bộ sưu tập "${collection.name}"? Không thể hoàn tác.`)) {
      return;
    }
    await this.client.deleteCollection(collection.id);
  }
}
