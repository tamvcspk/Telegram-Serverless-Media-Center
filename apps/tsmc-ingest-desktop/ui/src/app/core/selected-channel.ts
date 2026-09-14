import { Injectable, signal } from '@angular/core';
import type { ResolvedChannelDto } from './ingest-rpc.types';

/** Kênh đang làm việc, dùng chung giữa màn "Chọn kênh" (nơi set) và màn
 * "Workspace ba vùng" (nơi đọc, hiện ở header mockup A.3: "Kênh:
 * @tsmc_mediacenter ▾ catalog: 5 item · ghim OK") — CHỈ giữ những gì UI cần
 * hiện lại, không phải bản sao đầy đủ state; `state.rs::selected_channel`
 * phía Rust mới là nguồn sự thật cho RPC (channel.ts đã gọi `select_channel`/
 * `resolve_channel`/`create_channel` để ghi state đó TRƯỚC khi set ở đây).
 * `providedIn: 'root'` — đúng một instance cho cả app, KHÔNG phải SignalStore
 * vì đây chỉ là một object duy nhất truyền qua route, không phải danh sách
 * cần truy vấn/lọc (ui-conventions §"SignalStore vs signal() trần" của
 * apps/web, áp dụng tinh thần tương tự ở đây dù app Angular tách biệt). */
@Injectable({ providedIn: 'root' })
export class SelectedChannelStore {
  readonly channel = signal<ResolvedChannelDto | null>(null);
  readonly catalogSummary = signal<string>('chưa có catalog nào được ghim');

  set(channel: ResolvedChannelDto, catalogSummary: string): void {
    this.channel.set(channel);
    this.catalogSummary.set(catalogSummary);
  }

  /** Dùng lúc đăng xuất (màn Cài đặt) — kênh đang chọn phía Rust
   * (`state.rs::selected_channel`) đã bị xoá cùng lúc `ConnState` về
   * `Disconnected` (`commands.rs::sign_out()`), store phía UI phải theo kịp
   * để không hiện lại tên kênh cũ nếu vào lại `/workspace` trước khi đăng
   * nhập lại. */
  clear(): void {
    this.channel.set(null);
    this.catalogSummary.set('chưa có catalog nào được ghim');
  }
}
