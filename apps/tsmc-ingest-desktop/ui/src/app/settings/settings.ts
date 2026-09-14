import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { describeIngestError, loadSavedCredentials, signOut, tmdbDeleteKey, tmdbHasKey, tmdbSaveKey, toIngestRpcError } from '../core/ingest-rpc';
import { QueueStore } from '../core/queue-store';
import { SelectedChannelStore } from '../core/selected-channel';
import { DialogService } from '../shared/dialog/dialog.service';

/** Che một chuỗi bí mật ngắn — giữ vài ký tự đầu/cuối để admin tự đối chiếu
 * "đúng cái mình đã nhập chưa" mà không hiện trọn vẹn trên màn hình (vd lúc
 * chụp màn hình báo lỗi). Không phải mã hoá — chỉ là hiển thị, `api_hash`
 * thật vẫn nằm nguyên ở `credentials.json` (app-data, plaintext có chủ đích,
 * xem roadmap § "Mã hoá thông tin lưu ở app-data"). */
function maskSecret(value: string): string {
  if (value.length <= 8) {
    return '•'.repeat(value.length);
  }
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/**
 * Màn "Cài đặt" — KHÔNG có trong mockup A.3/A.4 gốc (docs/ux-design.md § Phụ
 * lục A), thêm mới theo gap ghi ở docs/roadmap.md § Ingest ("Màn Settings —
 * chưa có; TMDB opt-in hiện phải 'mượn' luồng first-use dialog để bù"). Vào
 * qua icon ⚙ ở topbar Workspace (đúng vị trí đã vẽ sẵn trong mockup A.3:
 * `⚙ 👤` góc phải header — trước đây chưa wire).
 *
 * Hai khối:
 * - **Tài khoản:** hiển thị (số điện thoại/API_ID/API_HASH đã che một phần)
 *   đọc từ `credentials.json` qua `loadSavedCredentials()`, cộng nút "Đăng
 *   xuất" (thêm 2026-09-14, ADR-0017 § addendum "thêm sign_out vào IngestRpc")
 *   — gọi `signOut()` (server-side `auth.LogOut` TRƯỚC, xoá `session.sqlite3`
 *   cục bộ SAU), luôn hỏi xác nhận qua `DialogService.confirm()` trước
 *   (đăng xuất là hành động khó hoàn tác — mất session, phải đăng nhập lại
 *   dù `credentials.json` vẫn còn để tự điền). Chặn/cảnh báo riêng nếu đang
 *   có upload chạy dở (`QueueStore.uploading()`) — đăng xuất giữa chừng cắt
 *   luôn kết nối MTProto, upload đang chạy chắc chắn lỗi. KHÔNG có nút đổi
 *   số điện thoại — đó là luồng đăng nhập lại từ `/login`, không thuộc màn
 *   này.
 * - **TMDB:** quản lý key đầy đủ (xem có key/chưa, đổi key, xoá key) — trước
 *   slice này, cách DUY NHẤT "xoá key sai" là tự tay xoá file
 *   `tmdb_api_key.json` ở app-data (xem `describeTmdbError()`), giờ có nút
 *   thật. Dialog nhập key TÁI DÙNG `TmdbKeyDialog`/`DialogService.
 *   promptTmdbApiKey()` NGUYÊN VẸN (cùng dialog màn Workspace dùng lúc
 *   "Tra TMDB" lần đầu) — không viết dialog nhập key thứ hai.
 *
 * Mã hoá `credentials.json`/`tmdb_api_key.json` (roadmap, mục riêng) KHÔNG
 * thuộc phạm vi slice này — màn này chỉ thêm nơi QUẢN LÝ, không đổi cách LƯU.
 */
@Component({
  selector: 'app-settings',
  imports: [MatButtonModule, MatToolbarModule, MatTooltipModule],
  templateUrl: './settings.html',
  styleUrl: './settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Settings implements OnInit {
  private readonly router = inject(Router);
  private readonly dialogService = inject(DialogService);
  private readonly queueStore = inject(QueueStore);
  private readonly selectedChannelStore = inject(SelectedChannelStore);

  protected readonly loadingAccount = signal(true);
  protected readonly phoneDisplay = signal<string | null>(null);
  protected readonly apiIdDisplay = signal<string | null>(null);
  protected readonly apiHashDisplay = signal<string | null>(null);
  protected readonly signingOut = signal(false);
  protected readonly signOutError = signal<string | null>(null);

  protected readonly loadingTmdb = signal(true);
  protected readonly tmdbConfigured = signal(false);
  protected readonly tmdbBusy = signal(false);

  ngOnInit(): void {
    void this.loadAccount();
    void this.refreshTmdbStatus();
  }

  private async loadAccount(): Promise<void> {
    this.loadingAccount.set(true);
    try {
      const saved = await loadSavedCredentials();
      if (saved) {
        this.phoneDisplay.set(`+${saved.dial_code} ${saved.national_number}`);
        this.apiIdDisplay.set(String(saved.api_id));
        this.apiHashDisplay.set(maskSecret(saved.api_hash));
      }
    } finally {
      this.loadingAccount.set(false);
    }
  }

  private async refreshTmdbStatus(): Promise<void> {
    this.loadingTmdb.set(true);
    try {
      this.tmdbConfigured.set(await tmdbHasKey());
    } finally {
      this.loadingTmdb.set(false);
    }
  }

  /** Tái dùng NGUYÊN VẸN `DialogService.promptTmdbApiKey()` — cùng dialog màn
   * Workspace dùng lúc "Tra TMDB" lần đầu (ADR-0019 mục 2), chỉ khác điểm
   * gọi. Trống thì huỷ (dialog đã tự lọc chuỗi rỗng, xem `TmdbKeyDialog.
   * onSave()`), không có gì để lưu. */
  protected async onChangeTmdbKey(): Promise<void> {
    const key = await this.dialogService.promptTmdbApiKey();
    if (!key) {
      return;
    }
    this.tmdbBusy.set(true);
    try {
      await tmdbSaveKey(key);
      await this.refreshTmdbStatus();
    } finally {
      this.tmdbBusy.set(false);
    }
  }

  protected async onDeleteTmdbKey(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Xoá TMDB API Key',
      message: 'Nút "Tra TMDB" sẽ hỏi nhập lại key trong lần dùng kế tiếp. Xoá key đã lưu?',
      confirmText: 'Xoá key',
      tone: 'warn'
    });
    if (!confirmed) {
      return;
    }
    this.tmdbBusy.set(true);
    try {
      await tmdbDeleteKey();
      await this.refreshTmdbStatus();
    } finally {
      this.tmdbBusy.set(false);
    }
  }

  /** Đăng xuất — hỏi xác nhận trước (hành động khó hoàn tác), nội dung dialog
   * đổi tuỳ có upload đang chạy dở hay không (`QueueStore.uploading()`, cắt
   * ngang kết nối MTProto chắc chắn làm hỏng upload đó). Thành công →
   * `signOut()` đã tự đưa `ConnState` (Rust) về `Disconnected` — dọn nốt
   * state phía Angular (`SelectedChannelStore`) rồi điều hướng về `/login`
   * (KHÔNG phải `/workspace` như `onBack()` — đăng xuất xong không còn gì
   * để quay lại đó). Lỗi (FLOOD_WAIT, mất mạng...) → hiện lỗi tại chỗ, KHÔNG
   * điều hướng đi đâu — phía Rust đảm bảo chưa xoá gì nếu bước server thất
   * bại (xem doc comment `commands.rs::sign_out()`). */
  protected async onSignOut(): Promise<void> {
    const uploading = this.queueStore.uploading();
    const confirmed = await this.dialogService.confirm({
      title: 'Đăng xuất',
      message: uploading
        ? 'Đang có upload chạy dở — đăng xuất sẽ NGẮT KẾT NỐI ngay, upload đang chạy chắc chắn lỗi. Số điện thoại/API_ID/API_HASH vẫn được nhớ để đăng nhập lại nhanh (chỉ cần mã OTP). Tiếp tục đăng xuất?'
        : 'Sẽ cần nhập lại mã OTP ở lần đăng nhập kế tiếp. Số điện thoại/API_ID/API_HASH vẫn được nhớ để đăng nhập lại nhanh. Tiếp tục đăng xuất?',
      confirmText: 'Đăng xuất',
      tone: 'warn'
    });
    if (!confirmed) {
      return;
    }

    this.signOutError.set(null);
    this.signingOut.set(true);
    try {
      await signOut();
      this.selectedChannelStore.clear();
      void this.router.navigateByUrl('/login');
    } catch (err) {
      this.signOutError.set(describeIngestError(toIngestRpcError(err)));
    } finally {
      this.signingOut.set(false);
    }
  }

  /** Điều hướng thẳng về `/workspace` (không `Location.back()`) — cùng quy
   * ước `onBackToChannel()` ở `workspace.ts`: nút back luôn có ĐÍCH CỐ ĐỊNH,
   * không phụ thuộc lịch sử trình duyệt (an toàn hơn nếu sau này có thêm
   * đường vào Settings khác ngoài gear icon ở Workspace). */
  protected onBack(): void {
    void this.router.navigateByUrl('/workspace');
  }
}
