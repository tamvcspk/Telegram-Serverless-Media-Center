import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { Router } from '@angular/router';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import type { CompatRank } from '@tsmc/core-ingest';
import {
  assertChannelWritable,
  assignToSeries,
  buildCatalogEnvelope,
  classifyCompatRank,
  composeCaption,
  deriveCompat,
  findRepresentativeEpisode,
  flattenMetadataTree,
  inheritMetadata,
  matchSidecarSubtitles,
  mergeCatalogItems,
  parseExistingCatalogItems,
  seasonGroupKey,
  seedMetadataFromFilename,
  seriesGroupKey,
  type FlatMetadataRow
} from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { DraftStore, type QueueItem } from '../core/draft-store';
import { withFloodWaitRetry } from '../core/flood-wait-retry';
import {
  cancelUpload,
  cleanupTempDir,
  clearCurrentTask,
  describeIngestError,
  describeTmdbError,
  getCurrentTask,
  listDirEntries,
  listMediaFiles,
  onPipelineStage,
  onUploadProgress,
  prepareUpload,
  probeMedia,
  publishCatalog,
  readPinnedCatalog,
  tmdbDetails,
  tmdbHasKey,
  tmdbSaveKey,
  toIngestRpcError,
  toProbeResult,
  toTmdbError,
  uploadSubtitle,
  uploadTmdbPoster,
  uploadVideo
} from '../core/ingest-rpc';
import type { PreparedUploadDto, RemuxModeDto } from '../core/ingest-rpc.types';
import { QueueStore, type UploadQueueItem, type UploadStage } from '../core/queue-store';
import { SelectedChannelStore } from '../core/selected-channel';
import { DialogService } from '../shared/dialog/dialog.service';

type FillDownField = 'title' | 'season' | 'year';

const UPLOAD_STAGE_LABEL: Record<UploadStage, string> = {
  queued: 'Trong hàng đợi…',
  remuxing: 'Đang remux…',
  reencoding: 'Đang re-encode video (chậm)…',
  generating_thumbnail: 'Đang tạo thumbnail…',
  extracting_subtitles: 'Đang rút phụ đề…',
  uploading_video: 'Đang upload video…',
  uploading_subtitles: 'Đang upload phụ đề…',
  uploading_poster: 'Đang upload poster…',
  done: 'Xong',
  error: 'Lỗi'
};

/** Phụ đề dạng ẢNH (PGS/DVD subtitle) không convert được sang text —
 * `extract_subtitles()` (`ingest-ffmpeg`) không xử lý track loại này, nên lọc
 * bỏ TRƯỚC khi gửi qua `prepareUpload()`. Bản sao có chủ đích của
 * `apps/tsmc-ingest/src/ffmpeg.ts::IMAGE_SUBTITLE_CODECS` — hai app tách
 * runtime hoàn toàn, không có lib UI dùng chung (ADR-0017). */
const IMAGE_SUBTITLE_CODECS = new Set(['hdmv_pgs_subtitle', 'pgssub', 'dvd_subtitle', 'dvdsub']);

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.slice(normalized.lastIndexOf('/') + 1);
}

function stripExt(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

function dirnameOf(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx >= 0 ? normalized.slice(0, idx) : '.';
}

function parseOptionalInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Màn "Workspace ba vùng" (docs/ux-design.md § Phụ lục A.3) — hai danh sách
 * TÁCH BIỆT (theo yêu cầu user 2026-09-12, thay bản đầu vốn lặp lại CÙNG một
 * danh sách ở cả hai bên):
 * - **Hàng đợi (sidebar trái, `uploadQueue`)** — vai trò "Queue" kiểu
 *   FileZilla/trạng thái gửi mail Apple Mail: RỖNG cho tới khi bấm "Upload".
 *   Vẫn là vùng thả file/folder (`+ Thả file hoặc folder vào đây`).
 * - **Bảng metadata (cột phải, `queue`)** — DUY NHẤT nơi sửa Title/Season/
 *   Ep/Năm, chọn nhiều dòng/gõ 1 lần/điền xuống/đánh số tập tự động (nguyên
 *   tắc UX A.2 mục 3). Bấm "Upload" đẩy các dòng đã chọn SANG hàng đợi (xoá
 *   khỏi bảng này — "bảng chính được làm trống để đón file mới") rồi xử lý
 *   tuần tự: remux/re-encode → thumbnail → rút phụ đề → upload video → upload
 *   phụ đề → publish catalog MỘT LẦN cho cả batch. Nhận CẢ Hạng D (re-encode
 *   video thật qua `reencode.rs`), nhưng LUÔN hỏi xác nhận trước qua
 *   `DialogService` (mockup A.2 mục 1: "re-encode video luôn phải hỏi", kèm
 *   số phút ước tính) — xem `startUpload()`.
 *
 * Phụ đề upload ĐẦY ĐỦ như CLI: NHÚNG trong container (rút bằng
 * `prepareUpload()`, chỉ Hạng C có) VÀ NGOÀI cạnh file trên đĩa (quy ước
 * Plex/Jellyfin/Kodi, so khớp bằng `matchSidecarSubtitles()` sau khi
 * `listDirEntries()` đọc thư mục chứa file — độc lập hạng). CHƯA có thanh
 * chi phí (mockup "TRƯỚC KHI CHẠY: ... byte · phút remux · phút upload") —
 * để dành slice sau.
 *
 * Seed/kế thừa metadata dùng LẠI NGUYÊN VẸN `seedMetadataFromFilename()`/
 * `inheritMetadata()` (`@tsmc/core-ingest` — nguồn sự thật duy nhất, ADR-0017
 * điều kiện bắt buộc #4), cùng logic tuần tự "kế thừa từ item ngay trước
 * trong hàng đợi" mà `apps/tsmc-ingest/src/commands/upload.ts::
 * resolveMetadataForFile()` dùng — khác CLI ở chỗ CLI hỏi xác nhận
 * (`confirm()`) từng file trước khi áp dụng, còn ở đây kết quả kế thừa chỉ là
 * GIÁ TRỊ GỢI Ý SẴN trong ô bảng (mockup UX principle 3: "không còn là một
 * câu hỏi tuần tự chặn luồng") — admin tự sửa đè những dòng kế thừa sai
 * (thường là lúc chuyển sang series/trailer khác) ngay trong bảng.
 */
@Component({
  selector: 'app-workspace',
  imports: [MatButtonModule, MatCheckboxModule, MatListModule, MatMenuModule, MatProgressSpinnerModule, MatToolbarModule, MatTooltipModule, ScrollingModule],
  templateUrl: './workspace.html',
  // Hai file — `workspace-tree.scss` tách riêng để không vượt ngân sách
  // `anyComponentStyle` 6kB (Angular CLI tính RIÊNG từng stylesheet).
  styleUrls: ['./workspace.scss', './workspace-tree.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Workspace implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);
  protected readonly selectedChannelStore = inject(SelectedChannelStore);
  private readonly draftStore = inject(DraftStore);
  private readonly queueStore = inject(QueueStore);

  // Alias TRỎ THẲNG vào signal của store root-provided (ADR-0018 mục 6),
  // KHÔNG phải bản sao — `.set()`/`.update()` gọi qua các tên cũ này vẫn ghi
  // đúng vào store dùng chung, giữ nguyên toàn bộ code bên dưới không đổi.
  // Lý do tách store: một batch `startUpload()` là async/await JS thuần,
  // tiếp tục chạy NGẦM dù router huỷ component này khi điều hướng sang Chọn
  // kênh — cần signal sống ngoài vòng đời component để không "mất dấu" khi
  // remount (xem doc comment `QueueStore`).
  protected readonly queue = this.draftStore.items;
  protected readonly uploadQueue = this.queueStore.items;
  protected readonly uploading = this.queueStore.uploading;
  protected readonly currentUploadTaskId = this.queueStore.currentTaskId;
  protected readonly batchTotal = this.queueStore.batchTotal;
  protected readonly batchDone = this.queueStore.batchDone;

  protected readonly dragOver = signal(false);
  protected readonly searchText = signal('');

  protected readonly selectedCount = computed(() => this.queue().filter((item) => item.selected).length);
  protected readonly allSelected = computed(() => this.queue().length > 0 && this.queue().every((item) => item.selected));

  /** Item ĐỦ ĐIỀU KIỆN "Upload": đã chọn, probe xong — bao gồm CẢ Hạng D
   * (re-encode, hỏi xác nhận MỘT LẦN cho cả batch trong `startUpload()`). */
  protected readonly uploadableItems = computed(() => this.queue().filter((item) => item.selected && item.status === 'ready' && item.rank !== undefined));

  protected readonly publishing = signal(false);
  protected readonly publishFloodWaitSeconds = signal<number | null>(null);
  protected readonly publishError = signal<string | null>(null);
  protected readonly publishResult = signal<{ msgId: number; totalItems: number; newItems: number } | null>(null);

  /** "Đã tải 1/2 file — 50%" kiểu Apple Mail (trạng thái gửi ở góc dưới
   * sidebar) — rỗng khi chưa có batch nào chạy trong phiên này. */
  protected readonly globalProgressLabel = computed(() => {
    const total = this.batchTotal();
    if (total === 0) {
      return '';
    }
    const done = this.batchDone();
    const percent = Math.round((done / total) * 100);
    return `Đã tải ${done}/${total} file — ${percent}%`;
  });

  /** Lọc HIỂN THỊ theo tên file/Title cho bảng metadata — hàng đợi (sidebar
   * trái) KHÔNG lọc theo ô tìm kiếm này (hai danh sách độc lập từ slice
   * này). Thao tác hàng loạt (điền xuống/đánh số/xoá/chọn tất cả) vẫn đọc
   * thẳng `queue()` KHÔNG qua filter — gõ tìm kiếm chỉ để tìm/định vị dòng,
   * không thu hẹp phạm vi thao tác hàng loạt một cách bất ngờ. */
  protected readonly filteredQueue = computed(() => {
    const q = this.searchText().trim().toLowerCase();
    if (!q) {
      return this.queue();
    }
    return this.queue().filter((item) => item.name.toLowerCase().includes(q) || (item.metadata.title ?? '').toLowerCase().includes(q));
  });

  /** Nhóm (series/season) đang thu gọn — cùng cơ chế `catalog-manager.ts`. */
  protected readonly collapsedGroups = signal<ReadonlySet<string>>(new Set());

  /** Dạng cây (brainstorm 2026-09-18) — phim lẻ một dòng, phim bộ nhóm
   * `series.name` > `season`, xem doc comment `flattenMetadataTree()`
   * (`@tsmc/core-ingest`). Nhóm theo `filteredQueue()` (SAU tìm kiếm) —
   * cùng lý do đã ghi ở đó, gõ tìm tự thu gọn cây về đúng nhánh khớp. */
  protected readonly treeRows = computed(() => flattenMetadataTree(this.filteredQueue(), (item) => item.metadata, this.collapsedGroups()));

  ngOnInit(): void {
    // Vào thẳng URL /workspace mà chưa qua màn Chọn kênh (reload webview,
    // gõ URL tay lúc dev) — store rỗng, không có channel nào để hiện ở
    // header/publish sau này. Điều hướng về lại thay vì hiện header trống.
    if (this.selectedChannelStore.channel() === null) {
      void this.router.navigateByUrl('/channel');
      return;
    }

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === 'drop') {
          this.dragOver.set(false);
          void this.addPaths(event.payload.paths);
        } else if (event.payload.type === 'enter' || event.payload.type === 'over') {
          this.dragOver.set(true);
        } else {
          this.dragOver.set(false);
        }
      })
      .then((unlisten) => this.destroyRef.onDestroy(unlisten));

    void this.attachUploadListenersAndHydrate();
  }

  /** Đăng ký listener `"upload-progress"`/`"pipeline-stage"` rồi MỚI gọi
   * `getCurrentTask()` — thứ tự bắt buộc (ADR-0018 mục 5): đăng ký trước để
   * không lọt mất event phát ra đúng lúc đang chờ response của lệnh hydrate.
   * Cần thiết dù `QueueStore` đã root-provided (sống xuyên route): trong lúc
   * `WorkspaceComponent` bị router huỷ (điều hướng sang Chọn kênh), CHÍNH
   * listener này cũng bị `destroyRef.onDestroy()` gỡ theo — batch vẫn chạy
   * ngầm phía Rust/JS, nhưng event phát ra trong khoảng đó KHÔNG có ai nghe,
   * nên state cuối trong `QueueStore` có thể cũ hơn thực tế. `getCurrentTask()`
   * đọc lại ĐÚNG snapshot Rust để vá khoảng hở đó ngay khi remount. */
  private async attachUploadListenersAndHydrate(): Promise<void> {
    // `task_id` là correlation id (ADR-0018) — chỉ cập nhật ĐÚNG dòng sự
    // kiện báo, không giả định "luôn là item đang upload hiện tại" dù
    // pipeline tuần tự không có 2 upload chồng nhau lúc này. Cả hai sự kiện
    // đều nhắm vào `uploadQueue` — bảng metadata (`queue`) không còn giữ
    // trạng thái upload nào từ slice này.
    const unlistenProgress = await onUploadProgress((p) => {
      this.updateQueueItem(p.task_id, { progress: { bytesSent: p.bytes_sent, totalBytes: p.total_bytes } });
    });
    this.destroyRef.onDestroy(unlistenProgress);

    const unlistenStage = await onPipelineStage((p) => {
      this.updateQueueItem(p.task_id, { stage: p.stage });
    });
    this.destroyRef.onDestroy(unlistenStage);

    const snapshot = await getCurrentTask();
    if (snapshot) {
      this.updateQueueItem(snapshot.task_id, {
        stage: snapshot.stage as UploadStage,
        progress: snapshot.bytes_sent !== null && snapshot.total_bytes !== null ? { bytesSent: snapshot.bytes_sent, totalBytes: snapshot.total_bytes } : undefined
      });
    }
  }

  private async addPaths(paths: string[]): Promise<void> {
    let expanded: string[];
    try {
      expanded = await listMediaFiles(paths);
    } catch (err) {
      // Lỗi ở bước liệt kê (vd quyền đọc folder) hiếm và ảnh hưởng CẢ đợt
      // thả — khác lỗi probe từng file, nên báo qua một dòng "Lỗi" riêng
      // thay vì âm thầm bỏ qua.
      const message = describeIngestError(toIngestRpcError(err));
      this.queue.update((items) => [
        ...items,
        { path: paths.join(', '), name: 'Không đọc được', status: 'error', errorMessage: message, metadata: { msgId: 0 }, selected: false }
      ]);
      return;
    }

    const existingStaging = new Set(this.queue().map((item) => item.path));
    const existingQueued = new Set(this.uploadQueue().map((item) => item.path));
    const fresh = expanded.filter((path) => !existingStaging.has(path) && !existingQueued.has(path));
    if (fresh.length === 0) {
      return;
    }

    // Kế thừa TUẦN TỰ trong đúng thứ tự sẽ hiện trong bảng — item đầu tiên
    // của batch mới kế thừa từ dòng CUỐI bảng đã có (nếu có, vd thả thêm vài
    // tập sau khi đã thả cả season trước đó), không seed lại từ đầu chỉ vì
    // đây là một lượt thả mới.
    let previous = this.queue().at(-1)?.metadata;
    const newItems: QueueItem[] = fresh.map((path): QueueItem => {
      const name = basename(path);
      const metadata = previous ? inheritMetadata(0, name, previous) : seedMetadataFromFilename(0, name);
      previous = metadata;
      return { path, name, status: 'probing', metadata, selected: true };
    });

    this.queue.update((items) => [...items, ...newItems]);
    for (const item of newItems) {
      void this.probeOne(item.path);
    }
  }

  private async probeOne(path: string): Promise<void> {
    try {
      const dto = await probeMedia(path);
      const { rank, reasons } = classifyCompatRank(toProbeResult(dto));
      const patch: Partial<QueueItem> = { status: 'ready', rank, reasons, durationSec: dto.duration_sec };
      if (rank === 'D') {
        patch.selected = false;
      }
      this.updateItem(path, patch);
    } catch (err) {
      const message = describeIngestError(toIngestRpcError(err));
      this.updateItem(path, { status: 'error', errorMessage: message });
    }
  }

  private updateItem(path: string, patch: Partial<QueueItem>): void {
    this.queue.update((items) => items.map((item) => (item.path === path ? { ...item, ...patch } : item)));
  }

  private updateMetadata(path: string, fn: (metadata: CatalogItemV1) => CatalogItemV1): void {
    this.queue.update((items) => items.map((item) => (item.path === path ? { ...item, metadata: fn(item.metadata) } : item)));
  }

  private updateQueueItem(taskId: string, patch: Partial<UploadQueueItem>): void {
    this.uploadQueue.update((items) => items.map((item) => (item.taskId === taskId ? { ...item, ...patch } : item)));
  }

  protected onRemove(path: string): void {
    this.queue.update((items) => items.filter((item) => item.path !== path));
  }

  /** Bỏ MỘT dòng đã xong/lỗi khỏi hàng đợi (dọn bớt) — KHÔNG cho bỏ dòng
   * đang xử lý dở (template chỉ hiện nút này cho `stage === 'done' | 'error'`,
   * xem `workspace.html`). */
  protected dismissQueueItem(taskId: string): void {
    this.uploadQueue.update((items) => items.filter((item) => item.taskId !== taskId));
  }

  protected onSearchInput(value: string): void {
    this.searchText.set(value);
  }

  /** Nút back ở toolbar — quay lại màn Chọn kênh để chọn kênh khác. Không tự
   * xoá `SelectedChannelStore`: `Channel` không đọc lại store lúc vào màn
   * (tự quản state cục bộ, xem `channel.ts`), chọn kênh mới thành công sẽ tự
   * ghi đè; nếu người dùng bấm back rồi KHÔNG chọn gì, `ngOnInit()` ở trên
   * vẫn điều hướng đúng về `/channel` cho lần vào `/workspace` kế tiếp. */
  protected onBackToChannel(): void {
    void this.router.navigateByUrl('/channel');
  }

  /** Icon ⚙ ở topbar (đúng vị trí mockup A.3: "⚙ 👤" góc phải header) — màn
   * Cài đặt mới thêm (docs/roadmap.md § Ingest), route riêng ngoài canDeactivate
   * guard của route này (áp dụng cho MỌI điều hướng rời Workspace, xem
   * app.routes.ts). */
  protected onOpenSettings(): void {
    void this.router.navigateByUrl('/settings');
  }

  /** Icon cạnh ⚙ — màn "Trình quản lý catalog" (A.4), cùng ngoài
   * canDeactivate guard của route này. */
  protected onOpenCatalogManager(): void {
    void this.router.navigateByUrl('/catalog');
  }

  /** Icon cạnh "Trình quản lý catalog" — màn "Nhật ký" (A.4, màn cuối cùng
   * của phụ lục này), cùng ngoài canDeactivate guard của route này. */
  protected onOpenLogs(): void {
    void this.router.navigateByUrl('/logs');
  }

  protected trackByPath(_index: number, item: { path: string }): string {
    return item.path;
  }

  /** `trackBy` cho `treeRows()` — cùng cơ chế `catalog-manager.ts::trackByTreeRow()`. */
  protected trackByTreeRow(_index: number, row: FlatMetadataRow<QueueItem>): string {
    switch (row.kind) {
      case 'series-header':
        return seriesGroupKey(row.seriesName);
      case 'season-header':
        return seasonGroupKey(row.seriesName, row.season);
      case 'movie':
      case 'episode':
        return `item:${row.row.path}`;
    }
  }

  protected toggleSeriesCollapsed(seriesName: string): void {
    this.toggleCollapsedGroup(seriesGroupKey(seriesName));
  }

  protected toggleSeasonCollapsed(seriesName: string, season: number | undefined): void {
    this.toggleCollapsedGroup(seasonGroupKey(seriesName, season));
  }

  private toggleCollapsedGroup(key: string): void {
    this.collapsedGroups.update((keys) => {
      const next = new Set(keys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  protected trackByTaskId(_index: number, item: { taskId: string }): string {
    return item.taskId;
  }

  protected rankLabel(rank: CompatRank | undefined): string {
    switch (rank) {
      case 'A':
        return '🟢A';
      case 'B':
        return '🟡B';
      case 'C':
        return '🟠C';
      case 'D':
        return '🔴D';
      default:
        return '…';
    }
  }

  // --- Bảng metadata: sửa từng ô ---

  protected onTitleInput(path: string, rawValue: string): void {
    const title = rawValue.trim().length > 0 ? rawValue : undefined;
    this.updateMetadata(path, (m) => ({ ...m, title, series: m.series ? { ...m.series, name: title ?? m.series.name } : undefined }));
  }

  protected onYearInput(path: string, rawValue: string): void {
    const year = parseOptionalInt(rawValue);
    this.updateMetadata(path, (m) => ({ ...m, year }));
  }

  /** Gõ Season/Ep vào một item chưa có `series` (vd item `kind: 'movie'` do
   * filename không khớp `SxxExx`) — dựng `series` mới lấy `name` từ `title`
   * hiện có, đúng hành vi `inheritMetadata()` khi seed lần đầu, và tự đổi
   * `kind` sang `'episode'` (đã gõ Season/Ep nghĩa là đây rõ ràng là một tập
   * phim, không còn là `'movie'`). */
  protected onSeasonInput(path: string, rawValue: string): void {
    const season = parseOptionalInt(rawValue);
    this.updateMetadata(path, (m) => ({ ...m, kind: 'episode', series: { name: m.series?.name ?? m.title ?? '', season, episode: m.series?.episode } }));
  }

  protected onEpisodeInput(path: string, rawValue: string): void {
    const episode = parseOptionalInt(rawValue);
    this.updateMetadata(path, (m) => ({ ...m, kind: 'episode', series: { name: m.series?.name ?? m.title ?? '', season: m.series?.season, episode } }));
  }

  /** "Tra TMDB" (ADR-0019) — nếu chưa có API key lưu sẵn, hỏi nhập TRƯỚC
   * (opt-in tự nhiên, không cần màn Settings); tìm bằng `item.metadata.title`
   * đã seed sẵn (admin sửa lại được trong dialog); chỉ điền `title`/`year`
   * khi admin BẤM CHỌN một kết quả cụ thể — không có "tự động điền kết quả
   * đầu tiên" (đúng nguyên tắc `inheritMetadata()` đã áp dụng: gợi ý, không
   * tự chốt). `metaSource: 'manual'` vì admin tự tay xác nhận (không thêm
   * `'tmdb'` vào enum — xem ADR-0019 § "Đánh đổi chấp nhận").
   *
   * TMDB nâng cao (ADR-0019 § addendum 2026-09-17): SAU khi admin chọn kết
   * quả, gọi thêm `tmdbDetails()` lấy genres/cast/director — best-effort,
   * KHÔNG chặn việc đã điền title/year ở trên nếu lệnh này lỗi (mạng/TMDB
   * sập giữa hai lệnh gọi liên tiếp không nên xoá mất kết quả đã có). Poster
   * CHƯA tải/upload ở đây — chỉ ghi nhớ `pendingPosterPath`, upload thật dời
   * sang `processItem()` lúc bấm "Upload" (tránh message poster mồ côi nếu
   * admin chọn TMDB rồi xoá dòng khỏi bảng trước khi upload). */
  protected async onTmdbLookup(item: QueueItem): Promise<void> {
    if (!(await tmdbHasKey())) {
      const key = await this.dialogService.promptTmdbApiKey();
      if (!key) {
        return;
      }
      await tmdbSaveKey(key);
    }

    const kind = item.metadata.kind === 'episode' ? 'episode' : 'movie';
    const picked = await this.dialogService.searchTmdb(item.metadata.title ?? item.name, kind);
    if (!picked) {
      return;
    }
    this.updateMetadata(item.path, (m) => ({ ...m, title: picked.title, year: picked.year ?? m.year, metaSource: 'manual' }));
    if (picked.poster_path) {
      this.updateItem(item.path, { pendingPosterPath: picked.poster_path });
    }

    try {
      const details = await tmdbDetails(picked.id, kind);
      this.updateMetadata(item.path, (m) => ({
        ...m,
        genres: details.genres.length > 0 ? details.genres : m.genres,
        cast: details.cast.length > 0 ? details.cast : m.cast,
        director: details.director ?? m.director
      }));
    } catch (err) {
      await this.dialogService.alert({ title: 'TMDB nâng cao', message: `Không lấy được genres/cast/director: ${describeTmdbError(toTmdbError(err))}` });
    }
  }

  /** "Sửa nâng cao" (brainstorm 2026-09-18) — dialog dùng chung với
   * `catalog-manager.ts` (`AdvancedMetadataDialog`), sửa `series.name`/
   * `genres`/`cast`/`director`/poster. Item Draft luôn `posterMsgId`
   * `undefined` (chưa upload gì cả) — `posterChange: 'remove'` ở đây chỉ
   * nghĩa là "bỏ lựa chọn TMDB poster đã chọn trước đó", không xoá message
   * nào trên kênh (chưa có message nào để xoá). */
  protected async onEditAdvanced(item: QueueItem): Promise<void> {
    const kind = item.metadata.kind === 'episode' ? 'episode' : 'movie';
    const knownItems = await this.fetchKnownItems();
    const result = await this.dialogService.editAdvancedMetadata(item.metadata, kind, knownItems);
    if (!result) {
      return;
    }
    this.updateMetadata(item.path, () => result.item);
    if (result.posterChange?.type === 'replace') {
      this.updateItem(item.path, { pendingPosterPath: result.posterChange.posterPath });
    } else if (result.posterChange?.type === 'remove') {
      this.updateItem(item.path, { pendingPosterPath: undefined });
    }
  }

  /** Item ĐÃ BIẾT cho "Thêm vào series"/"Sửa nâng cao" — GHÉP catalog ĐÃ
   * PUBLISH (đọc lại pinned catalog, brainstorm 2026-09-18: "cross-reference
   * catalog đã publish") với item trong Draft đang sửa. Best-effort: đọc
   * pinned catalog lỗi (chưa chọn kênh, mất mạng) → chỉ dùng Draft, KHÔNG
   * chặn việc mở dialog vì đây là danh sách GỢI Ý, không phải điều kiện bắt
   * buộc. */
  private async fetchKnownItems(): Promise<CatalogItemV1[]> {
    const draftItems = this.queue().map((i) => i.metadata);
    try {
      const pinned = await readPinnedCatalog();
      const published = pinned ? parseExistingCatalogItems(pinned.raw) : [];
      return [...published, ...draftItems];
    } catch {
      return draftItems;
    }
  }

  /** "Thêm vào series" hàng loạt (brainstorm 2026-09-18) — chiều NGƯỢC LẠI
   * `convertSelectedToMovie()`. Gợi ý tên series mới bằng title (hoặc tên
   * file) của dòng ĐẦU TIÊN đã chọn, cùng tinh thần `fillDown()`. */
  protected async addSelectedToSeries(): Promise<void> {
    const selected = this.queue().filter((i) => i.selected);
    if (selected.length === 0) {
      return;
    }
    const knownItems = await this.fetchKnownItems();
    const suggestedName = selected[0].metadata.title ?? selected[0].name;
    const result = await this.dialogService.assignSeries(selected.length, suggestedName, knownItems);
    if (!result) {
      return;
    }
    const inheritFrom = result.inheritFromExisting ? findRepresentativeEpisode(knownItems, result.seriesName) : undefined;
    selected.forEach((item, i) => {
      this.updateMetadata(item.path, (m) => assignToSeries(m, result.seriesName, result.season, result.startEpisode + i, inheritFrom));
    });
  }

  // --- Bảng metadata: thao tác hàng loạt trên các dòng đã chọn ---

  protected toggleSelectAll(checked: boolean): void {
    this.queue.update((items) => items.map((item) => ({ ...item, selected: checked })));
  }

  protected toggleSelected(path: string, checked: boolean): void {
    this.updateItem(path, { selected: checked });
  }

  /** Lấy giá trị của DÒNG ĐẦU TIÊN (theo thứ tự hàng đợi) trong các dòng đã
   * chọn, gõ đè xuống MỌI dòng còn lại đã chọn — đúng mockup "chọn nhiều
   * dòng, gõ 1 lần, điền xuống", không đổi gì ở dòng nguồn. */
  protected fillDown(field: FillDownField): void {
    const selected = this.queue().filter((item) => item.selected);
    if (selected.length < 2) {
      return;
    }
    const source = selected[0].metadata;
    const targets = selected.slice(1);
    for (const target of targets) {
      if (field === 'title') {
        this.onTitleInput(target.path, source.title ?? '');
      } else if (field === 'year') {
        this.onYearInput(target.path, source.year !== undefined ? String(source.year) : '');
      } else {
        this.onSeasonInput(target.path, source.series?.season !== undefined ? String(source.series.season) : '');
      }
    }
  }

  /** Season của DÒNG ĐẦU TIÊN đã chọn áp cho TẤT CẢ dòng đã chọn; Episode
   * đánh số tăng dần bắt đầu từ episode của dòng đầu tiên (mặc định 1 nếu
   * chưa có) — đúng thứ tự hàng đợi, khớp mockup "Đánh số tập tự động". */
  protected autoNumberEpisodes(): void {
    const selected = this.queue().filter((item) => item.selected);
    if (selected.length === 0) {
      return;
    }
    const season = selected[0].metadata.series?.season;
    const startEpisode = selected[0].metadata.series?.episode ?? 1;
    selected.forEach((target, i) => {
      this.onSeasonInput(target.path, season !== undefined ? String(season) : '');
      this.onEpisodeInput(target.path, String(startEpisode + i));
    });
  }

  protected removeSelected(): void {
    this.queue.update((items) => items.filter((item) => !item.selected));
  }

  /** "Chuyển thành phim lẻ" hàng loạt (brainstorm 2026-09-18, vá 2026-09-18:
   * bỏ điều kiện "phải xoá Ep TRƯỚC" — bản đầu gate theo `series?.episode
   * === undefined`, nhưng đó là bug thật: hầu hết dòng cần chuyển ĐANG có
   * Ep (đúng lý do cần chuyển), nên điều kiện đó khiến nút "không hoạt
   * động, không biểu hiện gì" ở đúng trường hợp thường gặp nhất. Giờ chuyển
   * THẲNG mọi dòng đã chọn có `kind === 'episode'`, xoá `series` luôn trong
   * cùng thao tác — dữ liệu chỉ nằm ở buffer sửa cục bộ (chưa "Upload"),
   * không phải ghi Telegram ngay, nên không cần cổng an toàn kiểu xác nhận
   * trước khi cho phép bấm. */
  protected convertSelectedToMovie(): void {
    for (const item of this.queue().filter((i) => i.selected)) {
      if (item.metadata.kind === 'episode') {
        this.updateMetadata(item.path, (m) => ({ ...m, kind: 'movie', series: undefined }));
      }
    }
  }

  // --- Hàng đợi upload (sidebar trái) ---

  /** `matListItemLine` — chỉ nói ĐANG Ở ĐÂU, KHÔNG kèm số % nữa (số % giờ
   * hiện giữa avatar dạng `mat-progress-spinner`, xem `spinnerCenterText()` —
   * tránh lặp cùng một con số ở hai chỗ trong cùng một dòng). */
  protected uploadStageLabel(item: UploadQueueItem): string {
    if (item.floodWaitSeconds !== undefined) {
      return `FLOOD_WAIT ${item.floodWaitSeconds}s`;
    }
    return UPLOAD_STAGE_LABEL[item.stage];
  }

  /** % byte đã gửi — chỉ có ý nghĩa ở stage `uploading_video` (thao tác DUY
   * NHẤT có tiến trình byte thật, xem `ingest-rpc-trait::UploadProgress`). */
  protected queueItemProgressPercent(item: UploadQueueItem): number {
    if (!item.progress || item.progress.totalBytes <= 0) {
      return 0;
    }
    return Math.round((item.progress.bytesSent / item.progress.totalBytes) * 100);
  }

  /** Chỉ `uploading_video` có số byte thật để hiện `mode="determinate"` —
   * mọi stage cục bộ khác (remux/re-encode/thumbnail/rút phụ đề/upload phụ
   * đề) VÀ lúc đang chờ `FLOOD_WAIT` đều `"indeterminate"` (vòng xoay không
   * số, không giả vờ biết % khi không đo được). */
  protected queueItemProgressMode(item: UploadQueueItem): 'determinate' | 'indeterminate' {
    // Chỉ chuyển "determinate" sau khi ĐÃ có ít nhất một mẫu tiến trình thật
    // — chuyển ngay khi bước vào `uploading_video` (trước khi sự kiện
    // `"upload-progress"` đầu tiên tới) sẽ hiện `value=0`, tức một vòng
    // TRỐNG hoàn toàn (stroke-dashoffset ở % 0 = không có gì để vẽ) — phát
    // hiện thật (user report): "upload không thấy spinner" trong khoảnh khắc
    // đó, dễ hiểu nhầm là spinner hỏng. Giữ "indeterminate" (vẫn xoay, thấy
    // rõ có việc đang chạy) cho tới khi có số byte thật để hiện.
    const hasRealProgress = item.stage === 'uploading_video' && !!item.progress && item.progress.totalBytes > 0;
    return hasRealProgress && item.floodWaitSeconds === undefined ? 'determinate' : 'indeterminate';
  }

  /** Số hiện GIỮA vòng spinner (tận dụng avatar làm luôn chỗ hiện số, theo
   * yêu cầu user) — số giây còn lại nếu đang `FLOOD_WAIT` (ưu tiên hiện cái
   * này vì nó QUAN TRỌNG hơn % byte), % byte nếu đang `uploading_video`,
   * không có gì (`null`) ở các stage khác — vòng spinner vẫn xoay
   * (indeterminate) nhưng không có số nào đáng tin để hiện. */
  protected spinnerCenterText(item: UploadQueueItem): string | null {
    if (item.floodWaitSeconds !== undefined) {
      return String(item.floodWaitSeconds);
    }
    if (item.stage === 'uploading_video' && item.progress && item.progress.totalBytes > 0) {
      return String(this.queueItemProgressPercent(item));
    }
    return null;
  }

  /** Huỷ lần upload video ĐANG chạy (SPIKE-10 M5: "huỷ dừng lưu lượng ≤ 3s")
   * — RPC `upload_video()` đang chờ sẽ tự reject bằng `Cancelled`, `processItem()`
   * bắt lỗi đó bình thường (item đó đánh dấu Lỗi, batch chạy tiếp cho các item
   * còn lại — KHÔNG dừng cả batch, cùng triết lý "một file lỗi không chặn
   * batch" của bước probe). */
  protected onCancelCurrentUpload(): void {
    const taskId = this.currentUploadTaskId();
    if (taskId) {
      void cancelUpload(taskId);
    }
  }

  protected async startUpload(): Promise<void> {
    if (this.uploading()) {
      return;
    }
    const channel = this.selectedChannelStore.channel();
    const candidates = this.uploadableItems();
    if (!channel || candidates.length === 0) {
      return;
    }

    // Hạng D — re-encode video THẬT, đắt hơn hẳn remux. MỘT dialog tổng hợp
    // cho CẢ BATCH, toggle riêng từng file (mặc định checked) — thay bản
    // trước hỏi TỪNG FILE một dialog riêng (ADR-0018 § "Quyết định kèm
    // theo": giữ quyền kiểm soát hạt nhân, không ép all-or-nothing). File bị
    // bỏ tick vẫn ở lại Draft, không vào hàng đợi, batch vẫn chạy tiếp cho
    // các file còn lại.
    const gradeDCandidates = candidates.filter((c) => c.rank === 'D');
    const confirmedGradeD =
      gradeDCandidates.length > 0
        ? await this.dialogService.confirmGradeD(
            gradeDCandidates.map((c) => ({ path: c.path, name: c.name, estimateMin: Math.max(1, Math.ceil((c.durationSec ?? 0) / 60)) }))
          )
        : undefined;

    this.uploading.set(true);
    this.publishError.set(null);
    this.publishResult.set(null);
    this.batchTotal.set(candidates.length);
    this.batchDone.set(0);

    const newItems: CatalogItemV1[] = [];
    for (const staged of candidates) {
      if (staged.rank === 'D' && !confirmedGradeD?.has(staged.path)) {
        this.batchDone.update((n) => n + 1);
        continue;
      }

      // Đẩy từ bảng metadata SANG hàng đợi — bảng chính trống chỗ ngay cho
      // dòng này, đúng yêu cầu "bảng chính được làm trống để đón file mới".
      // `taskId` sinh Ở ĐÂY (UUID, ADR-0018) — item vừa vào hàng đợi mới cần
      // correlation id, bảng Draft (`queue`) không bao giờ nhận event Rust
      // nên không cần id trước thời điểm này.
      this.queue.update((items) => items.filter((i) => i.path !== staged.path));
      const taskId = crypto.randomUUID();
      const queued: UploadQueueItem = {
        taskId,
        path: staged.path,
        name: staged.name,
        rank: staged.rank as CompatRank,
        metadata: staged.metadata,
        pendingPosterPath: staged.pendingPosterPath,
        durationSec: staged.durationSec,
        stage: 'queued'
      };
      this.uploadQueue.update((items) => [...items, queued]);

      this.currentUploadTaskId.set(taskId);
      try {
        const finalMetadata = await this.processItem(queued);
        newItems.push(finalMetadata);
        this.updateQueueItem(taskId, { stage: 'done' });
      } catch (err) {
        const message = describeIngestError(toIngestRpcError(err));
        this.updateQueueItem(taskId, { stage: 'error', error: message, floodWaitSeconds: undefined });
      }
      // Xoá snapshot Rust CỦA ĐÚNG task này (ADR-0018 mục 5) — item đã thật
      // sự xong (thành công/lỗi), không còn gì để hydrate nếu remount sau
      // đây. Gọi SAU KHI cập nhật `uploadQueue` ở trên, không phải bên trong
      // `upload_video()` (Rust) vì item còn qua bước upload phụ đề sau đó.
      void clearCurrentTask(taskId);
      this.batchDone.update((n) => n + 1);
    }
    this.currentUploadTaskId.set(null);

    if (newItems.length > 0) {
      this.publishing.set(true);
      try {
        await this.publishAll(channel, newItems);
      } catch (err) {
        this.publishError.set(describeIngestError(toIngestRpcError(err)));
      }
      this.publishing.set(false);
      this.publishFloodWaitSeconds.set(null);
    }

    this.uploading.set(false);
  }

  /** Một item hàng đợi: probe lại lấy danh sách track phụ đề TEXT (lọc bỏ
   * track ẢNH), remux/re-encode+thumbnail+rút phụ đề (`prepareUpload()`, cục
   * bộ, không FLOOD_WAIT), rồi upload video + từng phụ đề (CÓ FLOOD_WAIT —
   * bọc `withFloodWaitRetry`). Trả về `CatalogItemV1` cuối cùng (msgId/
   * compat/subs thật) — ném lỗi nếu bất kỳ bước nào thất bại, để
   * `startUpload()` đánh dấu đúng item đó Lỗi mà KHÔNG dừng các item còn lại
   * trong batch. */
  private async processItem(item: UploadQueueItem): Promise<CatalogItemV1> {
    const mode: RemuxModeDto = item.rank === 'D' ? 'reencode_all' : item.rank === 'C' ? 'reencode_audio' : 'copy';

    const probeDto = await probeMedia(item.path);
    const subtitleTracks = probeDto.subtitles
      .filter((s) => !IMAGE_SUBTITLE_CODECS.has(s.codec.toLowerCase()))
      .map((s) => ({ index: s.index, lang: s.lang }));

    this.updateQueueItem(item.taskId, { stage: mode === 'reencode_all' ? 'reencoding' : 'remuxing' });
    const prepared: PreparedUploadDto = await prepareUpload(item.taskId, item.path, mode, subtitleTracks);

    try {
      this.updateQueueItem(item.taskId, { stage: 'uploading_video', progress: undefined });
      const compat = deriveCompat(
        prepared.final_probe.video ?? undefined,
        prepared.final_probe.audio.map((a) => ({ codec: a.codec, lang: a.lang ?? undefined, index: a.index }))
      );

      const uploaded = await withFloodWaitRetry(
        (s) => this.updateQueueItem(item.taskId, { floodWaitSeconds: s ?? undefined }),
        () =>
          uploadVideo({
            taskId: item.taskId,
            filePath: prepared.remuxed_path,
            fileName: `${stripExt(item.path)}.mp4`,
            width: prepared.final_probe.video?.width ?? 0,
            height: prepared.final_probe.video?.height ?? 0,
            durationSec: Math.round(prepared.final_probe.duration_sec),
            thumbnailPath: prepared.thumbnail_path,
            // Hashtag ghi MỘT LẦN lúc publish, KHÔNG đồng bộ lại sau — ADR-0014
            // § addendum 2026-09-17 (xem doc comment `composeCaption()`).
            caption: composeCaption(item.metadata)
          })
      );

      this.updateQueueItem(item.taskId, { stage: 'uploading_subtitles' });
      const subs: NonNullable<CatalogItemV1['subs']> = [];
      for (const sub of prepared.subtitles) {
        // Tên file hiện cho document Telegram — khớp quy ước
        // `apps/tsmc-ingest/src/commands/upload.ts` (`<tên gốc>.<lang>.srt`),
        // không phải tên file tạm `sub-<index>.srt` bên trong `temp_dir`.
        const subFileName = `${stripExt(item.path)}${sub.lang ? `.${sub.lang}` : ''}.srt`;
        const subUploaded = await withFloodWaitRetry(
          (s) => this.updateQueueItem(item.taskId, { floodWaitSeconds: s ?? undefined }),
          () => uploadSubtitle(sub.path, subFileName)
        );
        subs.push({ lang: sub.lang ?? 'und', msgId: subUploaded.msg_id });
      }

      // Phụ đề NGOÀI đặt cạnh file trên đĩa (quy ước Plex/Jellyfin/Kodi:
      // "<tên video>.srt"/"<tên video>.<lang>.srt"/".vtt") — ĐỘC LẬP với hạng
      // A/B/C (khác phụ đề NHÚNG rút bằng `prepareUpload()` ở trên, vốn chỉ
      // có ở Hạng C). Không cần remux/rút gì — file đã sẵn sàng upload thẳng.
      const dir = dirnameOf(item.path);
      const siblingNames = await listDirEntries(dir);
      const sidecarMatches = matchSidecarSubtitles(basename(item.path), siblingNames);
      for (const match of sidecarMatches) {
        const subUploaded = await withFloodWaitRetry(
          (s) => this.updateQueueItem(item.taskId, { floodWaitSeconds: s ?? undefined }),
          () => uploadSubtitle(`${dir}/${match.fileName}`, match.fileName)
        );
        subs.push({ lang: match.lang ?? 'und', msgId: subUploaded.msg_id });
      }

      // Poster TMDB (ADR-0019 § addendum 2026-09-17) — chỉ tải+upload THẬT ở
      // đây (không phải lúc "Tra TMDB"), tránh message poster mồ côi nếu
      // admin chọn TMDB rồi xoá dòng khỏi bảng trước khi upload (xem doc
      // comment `QueueItem.pendingPosterPath`).
      let poster: CatalogItemV1['poster'];
      if (item.pendingPosterPath) {
        this.updateQueueItem(item.taskId, { stage: 'uploading_poster' });
        const posterFileName = `${stripExt(item.path)}.poster.jpg`;
        const posterUploaded = await withFloodWaitRetry(
          (s) => this.updateQueueItem(item.taskId, { floodWaitSeconds: s ?? undefined }),
          () => uploadTmdbPoster(item.pendingPosterPath!, posterFileName)
        );
        poster = { msgId: posterUploaded.msg_id };
      }

      return { ...item.metadata, msgId: uploaded.msg_id, compat, ...(subs.length > 0 ? { subs } : {}), ...(poster ? { poster } : {}) };
    } finally {
      void cleanupTempDir(prepared.temp_dir);
    }
  }

  /** Đọc lại catalog đang ghim NGAY LÚC publish (không dùng bản đã đọc lúc
   * chọn kênh — có thể đã cũ), gộp với item mới, publish ĐÚNG MỘT LẦN cho cả
   * batch (giảm cửa sổ FLOOD_WAIT giữa 3 RPC so với publish từng item). */
  private async publishAll(channel: { id: string; title: string; is_own: boolean }, newItems: CatalogItemV1[]): Promise<void> {
    assertChannelWritable({ isOwn: channel.is_own });

    const pinned = await readPinnedCatalog();
    const existingItems = pinned ? parseExistingCatalogItems(pinned.raw) : [];
    const merged = mergeCatalogItems(existingItems, newItems);
    const envelope = buildCatalogEnvelope({ id: channel.id, title: channel.title }, merged);

    const result = await withFloodWaitRetry(
      (s) => this.publishFloodWaitSeconds.set(s),
      () => publishCatalog(JSON.stringify(envelope), pinned?.msg_id ?? null)
    );

    this.selectedChannelStore.set(channel, `${merged.length} item`);
    this.publishResult.set({ msgId: result.msg_id, totalItems: merged.length, newItems: newItems.length });
  }
}
