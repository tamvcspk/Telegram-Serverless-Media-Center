import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatStepperModule } from '@angular/material/stepper';
import * as Comlink from 'comlink';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import { COUNTRY_DIAL_CODES, toE164 } from './country-codes';

type LoginStatus = 'checking' | 'phone' | 'code' | 'password';

const API_ID_PATTERN = /^\d+$/;
const API_HASH_PATTERN = /^[0-9a-fA-F]{32}$/;

/**
 * Màn đăng nhập (F1.1, Màn hình 1 mobile-first — docs/ux-design.md). Vertical
 * `MatStepper` 2-3 bước: API_ID/API_HASH + số điện thoại → mã xác nhận →
 * mật khẩu 2FA (nếu có). Mỗi bước chờ user nhập qua một callback
 * Comlink-proxy được TelegramGateway.login gọi ngược lại từ Core Worker
 * (ADR-0003/0004) — xem libs/core-mtproto/src/gateway.ts.
 *
 * KHÔNG còn nhánh 'authenticated' render tại chỗ (khác bản trước) — sau khi
 * xác thực xong (dù bằng session cũ hay đăng nhập mới), component điều
 * hướng sang `/home` (MainShell, xem shell/auth.guard.ts) thay vì tự vẽ
 * Sync/Browse/Index. Login vì vậy không còn gọi `initSync()` — guard là nơi
 * DUY NHẤT gọi, tránh gọi trùng khi user quay lại 'home' từ route khác.
 *
 * `stepIndex` ánh xạ MỘT CHIỀU từ `status` sang chỉ số MatStepper — luồng
 * hoàn toàn do Core Worker dẫn dắt. `[linear]="false"` (không phải gate
 * linear gốc của CdkStepper) — race điều kiện thật khi lái selectedIndex/
 * completed bằng binding qua signal, chi tiết ở ADR-0016 addendum
 * 2026-08-27.
 */
@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule, MatStepperModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Login {
  private readonly client = createCoreWorkerClient();
  private readonly router = inject(Router);

  private pendingCode: ((code: string) => void) | null = null;
  private pendingPassword: ((password: string) => void) | null = null;

  readonly countryDialCodes = COUNTRY_DIAL_CODES;
  readonly defaultDialCode = COUNTRY_DIAL_CODES[0].dialCode;

  readonly status = signal<LoginStatus>('checking');
  readonly errorMessage = signal<string | null>(null);
  readonly passwordHint = signal<string | undefined>(undefined);
  readonly codeViaApp = signal(false);
  readonly submitting = signal(false);

  // Giá trị sống của API_ID/API_HASH — CHỈ để tính formatValid (khoá/mở nhãn
  // Bước 2 trong mockup, xem docs/ux-design.md "Bị khoá, sẽ mở sau B1"),
  // KHÔNG dùng để submit (submit vẫn đọc thẳng từ template ref như cũ).
  private readonly apiIdLive = signal('');
  private readonly apiHashLive = signal('');
  protected readonly credentialsValid = computed(
    () => API_ID_PATTERN.test(this.apiIdLive().trim()) && API_HASH_PATTERN.test(this.apiHashLive().trim())
  );

  protected readonly stepIndex = computed(() => {
    switch (this.status()) {
      case 'code':
        return 1;
      case 'password':
        return 2;
      default:
        return 0;
    }
  });

  constructor() {
    void this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const summary = await this.client.restoreSession();
      if (summary) {
        await this.router.navigateByUrl('/home');
        return;
      }
    } catch (err) {
      // Phiên cũ lỗi (session chết, hết hạn) không chặn onboarding — chỉ
      // coi như chưa đăng nhập, không phải lỗi cần hiển thị ngay.
      console.warn('[login] restoreSession lỗi:', err);
    }
    this.status.set('phone');
  }

  onApiIdInput(value: string): void {
    this.apiIdLive.set(value);
  }

  onApiHashInput(value: string): void {
    this.apiHashLive.set(value);
  }

  async onSubmitPhone(
    event: Event,
    apiIdRaw: string,
    apiHash: string,
    dialCode: string,
    nationalNumber: string
  ): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);

    if (!this.credentialsValid()) {
      this.errorMessage.set('API_ID phải là số, API_HASH phải là chuỗi hexa 32 ký tự.');
      return;
    }
    if (!nationalNumber.trim()) {
      this.errorMessage.set('Nhập số điện thoại.');
      return;
    }
    const apiId = Number(apiIdRaw);
    const phoneNumber = toE164(dialCode, nationalNumber);

    this.submitting.set(true);
    try {
      // QUAN TRỌNG: bọc CẢ object callbacks bằng một Comlink.proxy() duy
      // nhất, không bọc từng hàm rời rồi nhét vào object thường — Comlink
      // chỉ kiểm tra marker proxy ở đối số cấp cao nhất, không đệ quy vào
      // thuộc tính bên trong object thường. Bọc riêng lẻ từng hàm khiến
      // Comlink rơi về structured-clone mặc định của postMessage cho CẢ
      // object chứa (vì bản thân object đó không có marker) → lỗi
      // "could not be cloned" (Chrome) / "the object cannot be cloned"
      // (Safari/iOS) — đã tái hiện thật trên cả hai nền tảng.
      await this.client.login(
        { apiId, apiHash },
        phoneNumber,
        Comlink.proxy({
          phoneCode: (isCodeViaApp?: boolean) => {
            this.codeViaApp.set(Boolean(isCodeViaApp));
            this.status.set('code');
            return new Promise<string>((resolve) => {
              this.pendingCode = resolve;
            });
          },
          password: (hint?: string) => {
            this.passwordHint.set(hint);
            this.status.set('password');
            return new Promise<string>((resolve) => {
              this.pendingPassword = resolve;
            });
          },
          onError: async (err: Error) => {
            this.errorMessage.set(err.message);
            return false;
          }
        })
      );
      await this.router.navigateByUrl('/home');
    } catch (err) {
      this.errorMessage.set(err instanceof Error ? err.message : 'Đăng nhập thất bại.');
      this.status.set('phone');
    } finally {
      this.submitting.set(false);
    }
  }

  onSubmitCode(event: Event, code: string): void {
    event.preventDefault();
    this.errorMessage.set(null);
    this.pendingCode?.(code);
    this.pendingCode = null;
  }

  onSubmitPassword(event: Event, password: string): void {
    event.preventDefault();
    this.errorMessage.set(null);
    this.pendingPassword?.(password);
    this.pendingPassword = null;
  }
}
