import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { Router } from '@angular/router';
import {
  checkWritePermission,
  createChannel,
  describeIngestError,
  listOwnChannels,
  readPinnedCatalog,
  resolveChannel,
  selectChannel,
  toIngestRpcError
} from '../core/ingest-rpc';
import type { PinnedCatalogDto, ResolvedChannelDto } from '../core/ingest-rpc.types';
import { SelectedChannelStore } from '../core/selected-channel';

type ChannelStatus = 'form' | 'result';

// Chặn ID thô ngay tại ô lọc (CLAUDE.md bất biến #10 — access_hash khác nhau
// theo từng tài khoản, chia sẻ id thô là vô nghĩa). Bản sao có chủ đích của
// `looksLikeRawId()` ở apps/web/src/app/sources/add-source-sheet/
// add-source-sheet.ts — hai app tách runtime hoàn toàn (ADR-0017), không có
// lib dùng chung nào ở tầng UI để import.
function looksLikeRawId(ref: string): boolean {
  const stripped = ref
    .trim()
    .replace(/^https?:\/\/t\.me\//i, '')
    .replace(/^t\.me\//i, '')
    .replace(/^@/, '');
  return /^-?\d+$/.test(stripped);
}

// Đếm số item hiển thị — PHÒNG THỦ, không phải schema validation đầy đủ
// (đó là việc của Màn "Trình quản lý catalog" sau này, docs/ux-design.md §
// Phụ lục A.4). `raw` là nội dung do kênh tự soạn, không tin tưởng — parse
// lỗi hoặc sai khung (`spec` khác) thì coi như "không đọc được", không throw.
function tryDescribeCatalog(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && (parsed as { spec?: unknown }).spec === 'tsmc-catalog/1') {
      const items = (parsed as { items?: unknown }).items;
      return Array.isArray(items) ? `${items.length} item` : 'khung hợp lệ, không đọc được số item';
    }
    return 'nội dung ghim không đúng định dạng catalog.v1';
  } catch {
    return 'nội dung ghim không đọc được (không phải JSON hợp lệ)';
  }
}

/**
 * Màn "Chọn kênh" (docs/ux-design.md § Phụ lục A.4, hàng "Chọn kênh") — UI
 * kiểu Telegram (2026-09-11, theo yêu cầu user): một ô lọc TRÊN CÙNG danh
 * sách kênh của admin (`mat-action-list`), gõ vào đó vừa lọc danh sách tại
 * chỗ (substring không phân biệt hoa/thường trên `title`) VỪA debounce thử
 * `resolveChannel()` — gõ đúng @username/link của một kênh khác (không nằm
 * trong danh sách kênh của mình) thì kết quả resolve hiện thêm một dòng
 * riêng trong CÙNG danh sách. Nút "+" (icon button, SVG inline — bất biến
 * #8, không nhúng font ligature) nằm cạnh ô lọc mở panel "Tạo kênh mới".
 *
 * Ba nguồn ra kết quả đều đổ vào một điểm chung `finishSelecting()`
 * (check_write_permission → read_pinned_catalog, đúng thứ tự bắt buộc phía
 * Rust — state.rs::selected_channel chỉ có channel của lần chọn gần nhất):
 * 1. Bấm một dòng trong danh sách kênh của mình → `selectChannel()` — KHÔNG
 *    gọi lại `resolveChannel()`, peer cache phía Rust đã có entry từ lúc
 *    `list_own_channels()` liệt kê.
 * 2. Bấm dòng kết quả tìm kiếm (`searchResult`) → dùng THẲNG object đã
 *    resolve được lúc debounce, không gọi RPC lần hai — `resolve_channel()`
 *    ở lần debounce đó đã tự ghi `state.selected_channel` phía Rust rồi.
 * 3. "Tạo kênh mới" (`onCreateChannel`) — `createChannel(title)`, phía Rust
 *    tự chọn luôn làm kênh đang làm việc.
 *
 * `is_own === false` (chỉ xảy ra ở nhánh 2, kết quả tìm kiếm — nhánh 1/3
 * theo cấu trúc luôn `is_own === true`) chặn NGAY, không gọi tiếp
 * check_write_permission/read_pinned_catalog — CLAUDE.md bất biến #5 (không
 * bao giờ ghi vào kênh người khác).
 *
 * **Kênh (broadcast) LẪN supergroup đều liệt kê/tìm được** (2026-09-11, theo
 * yêu cầu user) — `list_own_channels()`/`resolve_channel()` phía Rust chấp
 * nhận cả hai (`ingest-grammers/src/rpc.rs::channel_like_creator()`). Group
 * NHỎ chưa nâng cấp supergroup KHÔNG hiện ra — dùng một họ RPC Telegram khác
 * hẳn (`messages.*`/`InputPeer::Chat`) mà `read_pinned_catalog()`/
 * `upload_video()`/... hiện có không hỗ trợ, cho lọt vào sẽ vỡ muộn ở bước
 * publish thay vì báo ngay lúc chọn.
 */
@Component({
  selector: 'app-channel',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatListModule],
  templateUrl: './channel.html',
  styleUrl: './channel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Channel {
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly selectedChannelStore = inject(SelectedChannelStore);

  protected readonly status = signal<ChannelStatus>('form');
  protected readonly submitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // Danh sách kênh của admin — tải NGAY lúc vào màn (khác bản trước, tải
  // lười theo nút bấm riêng): đây giờ là danh sách chính hiện mặc định,
  // đúng cảm giác Telegram (mở lên đã thấy chat list, không phải màn trống
  // chờ bấm).
  protected readonly loadingChannels = signal(false);
  protected readonly ownChannels = signal<readonly ResolvedChannelDto[] | null>(null);
  protected readonly channelsError = signal<string | null>(null);

  // Ô lọc trên cùng — vừa lọc `ownChannels` tại chỗ, vừa debounce thử
  // resolve một kênh khác nếu gõ giống @username/link.
  protected readonly filterText = signal('');
  protected readonly filterRawIdError = signal<string | null>(null);
  protected readonly searching = signal(false);
  protected readonly searchResult = signal<ResolvedChannelDto | null>(null);
  private filterTimer: ReturnType<typeof setTimeout> | null = null;
  private filterToken = 0;

  protected readonly filteredChannels = computed(() => {
    const all = this.ownChannels();
    if (all === null) {
      return null;
    }
    const needle = this.filterText().trim().toLowerCase();
    if (!needle) {
      return all;
    }
    return all.filter((c) => c.title.toLowerCase().includes(needle));
  });

  // Kết quả tìm kiếm chỉ đáng hiện riêng nếu KHÔNG trùng một dòng đã có sẵn
  // trong danh sách đã lọc — tránh hiện trùng lặp cùng một kênh hai lần.
  protected readonly showSearchResult = computed(() => {
    const result = this.searchResult();
    if (result === null) {
      return null;
    }
    const filtered = this.filteredChannels();
    if (filtered?.some((c) => c.id === result.id)) {
      return null;
    }
    return result;
  });

  // "Tạo kênh mới" — panel ẩn/hiện bằng nút "+" cạnh ô lọc.
  protected readonly createPanelOpen = signal(false);
  protected readonly creatingChannel = signal(false);
  protected readonly createError = signal<string | null>(null);

  protected readonly resolvedChannel = signal<ResolvedChannelDto | null>(null);
  protected readonly writable = signal(false);
  protected readonly pinnedCatalog = signal<PinnedCatalogDto | null>(null);
  protected readonly catalogSummary = computed(() => {
    const pinned = this.pinnedCatalog();
    return pinned === null ? 'chưa có catalog nào được ghim' : tryDescribeCatalog(pinned.raw);
  });

  constructor() {
    this.destroyRef.onDestroy(() => this.clearFilterTimer());
    void this.loadOwnChannels();
  }

  private async loadOwnChannels(): Promise<void> {
    this.loadingChannels.set(true);
    this.channelsError.set(null);
    try {
      this.ownChannels.set(await listOwnChannels());
    } catch (err) {
      this.channelsError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.loadingChannels.set(false);
    }
  }

  protected onFilterInput(value: string): void {
    this.filterText.set(value);
    this.scheduleSearch(value);
  }

  /** Debounce 500ms (cùng nhịp `scheduleAutoCheck()` ở login.ts) — gõ xong
   * mới thử `resolveChannel()`, không gọi RPC trên từng ký tự gõ. ID thô bị
   * chặn ngay, không debounce, không gọi RPC nào (bất biến #10). */
  private scheduleSearch(rawValue: string): void {
    this.clearFilterTimer();
    this.searchResult.set(null);
    this.filterRawIdError.set(null);

    const trimmed = rawValue.trim();
    if (trimmed.length < 2) {
      return;
    }
    if (looksLikeRawId(trimmed)) {
      this.filterRawIdError.set('Không dùng ID thô — access_hash khác nhau theo từng tài khoản.');
      return;
    }

    const token = ++this.filterToken;
    this.filterTimer = setTimeout(() => void this.runSearch(trimmed, token), 500);
  }

  private async runSearch(ref: string, token: number): Promise<void> {
    this.searching.set(true);
    try {
      const resolved = await resolveChannel(ref);
      if (token !== this.filterToken) {
        return; // Gõ tiếp trong lúc chờ — kết quả này đã lỗi thời.
      }
      this.searchResult.set(resolved);
    } catch {
      // Không phải username/link hợp lệ, hoặc chưa gõ xong — im lặng, đây
      // là tìm kiếm ngầm khi đang gõ, không phải submit tường minh.
    } finally {
      if (token === this.filterToken) {
        this.searching.set(false);
      }
    }
  }

  private clearFilterTimer(): void {
    if (this.filterTimer !== null) {
      clearTimeout(this.filterTimer);
      this.filterTimer = null;
    }
  }

  protected async onPickChannel(channel: ResolvedChannelDto, fromSearch: boolean): Promise<void> {
    this.errorMessage.set(null);
    this.submitting.set(true);
    try {
      if (!fromSearch) {
        // Từ danh sách kênh của mình — chưa có gì ghi vào state.selected_channel
        // phía Rust cho ĐÚNG kênh này (list_own_channels() chỉ nạp peer cache,
        // không tự chọn), phải select_channel() trước.
        await selectChannel(channel);
      }
      // fromSearch=true: resolveChannel() ở scheduleSearch() đã tự ghi
      // state.selected_channel rồi — gọi finishSelecting() thẳng, không RPC
      // thêm.
      await this.finishSelecting(channel);
    } catch (err) {
      this.errorMessage.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.submitting.set(false);
    }
  }

  protected onToggleCreatePanel(): void {
    this.createPanelOpen.set(!this.createPanelOpen());
    this.createError.set(null);
  }

  protected async onCreateChannel(event: Event, titleInput: HTMLInputElement): Promise<void> {
    event.preventDefault();
    const title = titleInput.value.trim();
    this.createError.set(null);
    if (!title) {
      return;
    }

    this.creatingChannel.set(true);
    try {
      const resolved = await createChannel(title);
      this.createPanelOpen.set(false);
      // Thêm ngay vào danh sách tại chỗ — component không tự reload
      // list_own_channels() khi quay lại từ "result", không làm thế thì kênh
      // vừa tạo "biến mất" khỏi danh sách cho tới khi rời hẳn màn rồi vào lại.
      this.ownChannels.set([...(this.ownChannels() ?? []), resolved]);
      await this.finishSelecting(resolved);
    } catch (err) {
      this.createError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.creatingChannel.set(false);
    }
  }

  /** Điểm hội tụ của cả ba cách chọn kênh — check_write_permission() +
   * read_pinned_catalog() ĐÚNG THỨ TỰ backend yêu cầu (channel đã chọn ở
   * `state.rs::selected_channel` phía Rust từ trước khi hàm này được gọi). */
  private async finishSelecting(resolved: ResolvedChannelDto): Promise<void> {
    this.resolvedChannel.set(resolved);

    if (!resolved.is_own) {
      this.writable.set(false);
      this.pinnedCatalog.set(null);
      this.status.set('result');
      return;
    }

    this.writable.set(await checkWritePermission());
    this.pinnedCatalog.set(await readPinnedCatalog());
    this.status.set('result');

    if (this.writable()) {
      this.selectedChannelStore.set(resolved, this.catalogSummary());
    }
  }

  protected onGoToWorkspace(): void {
    void this.router.navigateByUrl('/workspace');
  }

  protected onChooseAnother(): void {
    this.status.set('form');
    this.resolvedChannel.set(null);
    this.pinnedCatalog.set(null);
    this.errorMessage.set(null);
  }
}
