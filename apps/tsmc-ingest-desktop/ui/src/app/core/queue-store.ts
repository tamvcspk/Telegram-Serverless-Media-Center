import { Injectable, signal } from '@angular/core';
import type { CompatRank } from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';

/** Stage của MỘT item trong hàng đợi upload — bốn cái đầu do sự kiện
 * `"pipeline-stage"` (Rust, cục bộ) báo, hai cái sau do chính `processItem()`
 * (`workspace.ts`) set khi gọi RPC MTProto thật. `reencoding` chỉ xảy ra với
 * Hạng D (`mode: 'reencode_all'`). `queued` là trạng thái tức thời ngay lúc
 * vừa đẩy từ bảng metadata sang, trước khi `processItem()` kịp set stage
 * đầu tiên. */
export type UploadStage =
  | 'queued'
  | 'remuxing'
  | 'reencoding'
  | 'generating_thumbnail'
  | 'extracting_subtitles'
  | 'uploading_video'
  | 'uploading_subtitles'
  | 'uploading_poster'
  | 'done'
  | 'error';

/** Dòng trong HÀNG ĐỢI UPLOAD (sidebar trái) — file ĐÃ bấm "Upload", không
 * còn sửa metadata được nữa. `taskId` (UUID, ADR-0018) là correlation id
 * THẬT cho mọi event `"upload-progress"`/`"pipeline-stage"` của dòng này —
 * `path` không dùng để so khớp (đổi tên/đổi đuôi qua từng bước pipeline). */
export interface UploadQueueItem {
  taskId: string;
  path: string;
  name: string;
  rank: CompatRank;
  metadata: CatalogItemV1;
  /** Kế thừa từ `QueueItem.pendingPosterPath` lúc đẩy vào hàng đợi — xem doc
   * comment ở đó (ADR-0019 § addendum 2026-09-17). */
  pendingPosterPath?: string;
  durationSec?: number;
  stage: UploadStage;
  progress?: { bytesSent: number; totalBytes: number };
  error?: string;
  /** Đếm ngược `FLOOD_WAIT` (giây còn lại) — ĐỘC LẬP với `stage` (mockup A.5). */
  floodWaitSeconds?: number;
}

/** Hàng đợi upload — `providedIn: 'root'` (ADR-0018 mục 6). Lý do KHÔNG chỉ
 * là "chỗ ghi hydrate": một batch `startUpload()` (`workspace.ts`) là
 * async/await JS THUẦN — router huỷ `WorkspaceComponent` khi điều hướng
 * sang Chọn kênh KHÔNG tự huỷ theo Promise chain đang chạy dở của nó, batch
 * vẫn tiếp tục ghi vào `items`/`uploading`/... ở NGẦM. Nếu các signal này
 * còn gắn ở component (như trước ADR-0018), instance MỚI lúc remount sẽ
 * dựng lại từ rỗng dù batch cũ vẫn đang chạy thật — root-provided giữ đúng
 * MỘT nguồn sự thật cho cả bản Workspace cũ (đang chạy ngầm) lẫn bản mới
 * (vừa remount, chỉ cần ĐỌC LẠI đúng state hiện có, không cần tự chạy lại
 * gì). `uploading`/`currentTaskId`/`batchTotal`/`batchDone` gộp vào đây
 * cùng lý do — tách riêng ra sẽ mất đồng bộ với `items`. */
@Injectable({ providedIn: 'root' })
export class QueueStore {
  readonly items = signal<UploadQueueItem[]>([]);
  readonly uploading = signal(false);
  readonly currentTaskId = signal<string | null>(null);
  readonly batchTotal = signal(0);
  readonly batchDone = signal(0);
}
