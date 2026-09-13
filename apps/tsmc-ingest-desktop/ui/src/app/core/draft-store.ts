import { Injectable, signal } from '@angular/core';
import type { CompatRank } from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';

export type QueueItemStatus = 'probing' | 'ready' | 'error';

/** Dòng trong BẢNG METADATA (cột phải, `workspace.ts`) — file CHƯA bắt đầu
 * upload, còn sửa được. Biến mất khỏi đây (chuyển sang `UploadQueueItem`,
 * `queue-store.ts`) ngay khi `startUpload()` đẩy nó vào hàng đợi. */
export interface QueueItem {
  path: string;
  name: string;
  status: QueueItemStatus;
  rank?: CompatRank;
  reasons?: string[];
  errorMessage?: string;
  /** Từ `ProbeResultDto.duration_sec` — dùng để ước tính thời gian re-encode
   * lúc hỏi xác nhận Hạng D (mockup A.2 mục 1). */
  durationSec?: number;
  /** `msgId: 0` placeholder — chưa có gì để gán, item chưa upload. */
  metadata: CatalogItemV1;
  /** Mặc định `true`, TRỪ khi probe xong ra Hạng D (mockup A.5 "File Hạng D:
   * mặc định bỏ chọn"). */
  selected: boolean;
}

/** Bảng metadata (Draft) — `providedIn: 'root'` (ADR-0018 mục 6): sống xuyên
 * route thay vì gắn vòng đời `WorkspaceComponent`, để `canDeactivateWorkspace`
 * (`workspace-deactivate.guard.ts`) có chỗ ĐỌC (đếm số dòng chưa upload để
 * cảnh báo) và GHI (xoá sau khi user xác nhận rời màn) mà không phụ thuộc
 * việc component còn sống hay không. Chỉ giữ state thuần — mọi logic nghiệp
 * vụ (probe, seed/kế thừa metadata, thao tác hàng loạt) vẫn ở `workspace.ts`,
 * thao tác trực tiếp lên `items` (đúng tinh thần "chỉ tách state cần sống
 * xuyên route", không tách toàn bộ component ra service). */
@Injectable({ providedIn: 'root' })
export class DraftStore {
  readonly items = signal<QueueItem[]>([]);

  /** Gọi bởi guard SAU KHI user xác nhận rời Workspace dù còn draft chưa
   * upload (ADR-0018 § "Quyết định kèm theo") — mất có chủ đích, không phải
   * bug: khác `QueueStore` (giữ nguyên, tiến trình Rust vẫn chạy ngầm). */
  clear(): void {
    this.items.set([]);
  }
}
