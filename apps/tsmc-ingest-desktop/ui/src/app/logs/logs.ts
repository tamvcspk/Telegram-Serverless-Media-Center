import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { describeIngestError, readAppLog, toIngestRpcError } from '../core/ingest-rpc';

/**
 * "Nhật ký" (A.4, docs/ux-design.md § Phụ lục A.4 — màn cuối cùng còn thiếu
 * của phụ lục này) — hiển thị lại file log kỹ thuật mà `tauri_plugin_log` đã
 * ghi từ lâu (`src-tauri/src/lib.rs::run()`, bật cả ở release, KHÔNG chỉ
 * debug — xem doc comment ở đó). Trước slice này log chỉ xem được bằng cách
 * tự mở file ở app-data; màn này chỉ THÊM CHỖ XEM + COPY, không đổi cách ghi
 * log đã có, không log thêm gì mới từ phía Angular.
 *
 * "Chỗ để dán khi báo lỗi; không log session/token" (mockup A.4) — vế thứ
 * hai đã đúng từ khi bật `tauri_plugin_log` (2026-09-11): log chỉ ghi thao
 * tác giao thức MTProto cấp thấp (connect, salt, request/response...), không
 * có `auth_key`/session token. Vế thứ nhất là phần màn này thêm: nút "Sao
 * chép" (qua `@tauri-apps/plugin-clipboard-manager` — official Tauri
 * plugin, không dùng `navigator.clipboard` trần vì hành vi Clipboard API
 * trong webview Tauri không đảm bảo nhất quán giữa `cargo tauri dev` và bản
 * đóng gói).
 *
 * Đọc TOÀN BỘ file mỗi lần (`readAppLog()`) — rotation `KeepOne` mặc định
 * của plugin giữ tối đa 40KB nên không cần tự phân trang/giới hạn. Không tự
 * poll — nút "Làm mới" là hành động chủ động của admin, cùng nguyên tắc
 * "Đối soát" ở Trình quản lý catalog (không tự chạy lúc mount).
 */
@Component({
  selector: 'app-logs',
  imports: [MatButtonModule, MatToolbarModule, MatTooltipModule],
  templateUrl: './logs.html',
  styleUrl: './logs.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Logs implements OnInit {
  private readonly router = inject(Router);

  @ViewChild('logBox') private readonly logBox?: ElementRef<HTMLElement>;

  protected readonly loading = signal(true);
  protected readonly loadError = signal<string | null>(null);
  protected readonly logText = signal('');
  protected readonly copyState = signal<'idle' | 'copied' | 'error'>('idle');

  ngOnInit(): void {
    void this.load();
  }

  protected async onRefresh(): Promise<void> {
    await this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.logText.set(await readAppLog());
      // Log mới nhất nằm CUỐI file (append-only) — cuộn xuống đáy ngay sau
      // khi DOM cập nhật để admin thấy sự kiện gần nhất không cần tự cuộn,
      // đúng tinh thần "chỗ để dán khi VỪA gặp lỗi".
      queueMicrotask(() => {
        const el = this.logBox?.nativeElement;
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    } catch (err) {
      this.loadError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.loading.set(false);
    }
  }

  protected async onCopy(): Promise<void> {
    try {
      await writeText(this.logText());
      this.copyState.set('copied');
    } catch {
      this.copyState.set('error');
    }
    setTimeout(() => this.copyState.set('idle'), 2000);
  }

  protected onBack(): void {
    void this.router.navigateByUrl('/workspace');
  }
}
