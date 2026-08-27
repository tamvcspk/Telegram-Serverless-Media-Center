import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { CdkDrag, CdkDragDrop, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { getMediaItem, getSyncState, liveQuery, type MediaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { createEmptySyncState, type Collection } from '@tsmc/shared-models';
import { firstValueFrom, from, switchMap } from 'rxjs';
import { CreateCollectionDialog } from './create-collection-dialog/create-collection-dialog';

/** "src:<sourceId>/msg:<msgId>" — cùng quy ước khoá đã dùng cho ProgressEntry.k (ADR-0009, xem player.ts progressKey). */
function parseItemKey(key: string): { sourceId: string; msgId: number } | null {
  const match = /^src:(.+)\/msg:(\d+)$/.exec(key);
  if (!match) {
    return null;
  }
  return { sourceId: match[1] as string, msgId: Number(match[2]) };
}

/**
 * Tab "BST" (Màn hình 3, docs/ux-design.md) — CRUD bộ sưu tập đầy đủ (tạo/
 * đổi tên/xoá BST, thêm/gỡ/sắp xếp lại phim) qua RPC `create/rename/delete/
 * add/removeFromCollection` + `reorderCollection` (op mới, thêm cùng slice
 * này — xem libs/shared-models/src/sync-events.ts). KHÔNG phân biệt trạng
 * thái chết link "mất quyền truy cập" vs "nguồn đã xoá tệp tin" như mockup
 * yêu cầu — cần bắt lỗi MTProto ở core-worker (CHANNEL_INVALID vs file
 * không tồn tại), việc tầng MTProto ngoài phạm vi slice UI này, xem CLAUDE.md.
 * Xoá cả bộ sưu tập dùng `confirm()` gốc trình duyệt thay vì dialog Material
 * riêng — hành động hiếm, không đáng một component chỉ để xác nhận.
 */
@Component({
  selector: 'app-collections',
  imports: [MatButtonModule, CdkDropList, CdkDrag],
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

  private readonly allItemKeys = computed(() => {
    const keys = new Set<string>();
    for (const collection of this.collections()) {
      for (const item of collection.items) {
        keys.add(item);
      }
    }
    return [...keys];
  });

  // Một Map dùng chung cho MỌI bộ sưu tập (thay vì resolve riêng từng cái) —
  // tránh N liveQuery độc lập chạy song song khi có nhiều BST cùng hiển thị.
  protected readonly resolvedItems = toSignal(
    toObservable(this.allItemKeys).pipe(switchMap((keys) => from(liveQuery(() => this.resolveKeys(keys))))),
    { initialValue: new Map<string, MediaRecord | undefined>() }
  );

  private async resolveKeys(keys: string[]): Promise<Map<string, MediaRecord | undefined>> {
    const entries = await Promise.all(
      keys.map(async (key): Promise<[string, MediaRecord | undefined]> => {
        const parsed = parseItemKey(key);
        return [key, parsed ? await getMediaItem(parsed.sourceId, parsed.msgId) : undefined];
      })
    );
    return new Map(entries);
  }

  itemLabel(key: string): string {
    const map = this.resolvedItems();
    if (!map.has(key)) {
      return '…';
    }
    const record = map.get(key);
    if (!record) {
      return '(không còn trong catalog cục bộ)';
    }
    const title = record.title ?? '(chưa có tên)';
    return record.year ? `${title} · ${record.year}` : title;
  }

  trackByCollection(_index: number, collection: Collection): string {
    return collection.id;
  }

  trackByItem(_index: number, item: string): string {
    return item;
  }

  async onCreate(): Promise<void> {
    const ref = this.dialog.open(CreateCollectionDialog, { data: {} });
    const name = await firstValueFrom(ref.afterClosed());
    if (!name) {
      return;
    }
    await this.client.createCollection(crypto.randomUUID(), name);
  }

  async onRename(collection: Collection): Promise<void> {
    const ref = this.dialog.open(CreateCollectionDialog, { data: { existingName: collection.name } });
    const name = await firstValueFrom(ref.afterClosed());
    if (!name) {
      return;
    }
    await this.client.renameCollection(collection.id, name);
  }

  async onDeleteCollection(collection: Collection): Promise<void> {
    if (!confirm(`Xoá bộ sưu tập "${collection.name}"? Không thể hoàn tác.`)) {
      return;
    }
    await this.client.deleteCollection(collection.id);
  }

  async onRemoveItem(collection: Collection, item: string): Promise<void> {
    await this.client.removeFromCollection(collection.id, item);
  }

  async onDrop(collection: Collection, event: CdkDragDrop<string[]>): Promise<void> {
    if (event.previousIndex === event.currentIndex) {
      return;
    }
    const items = [...collection.items];
    moveItemInArray(items, event.previousIndex, event.currentIndex);
    await this.client.reorderCollection(collection.id, items);
  }
}
