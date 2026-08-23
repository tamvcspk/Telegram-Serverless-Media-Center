import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import * as Comlink from 'comlink';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { TelegramUserSummary } from '@tsmc/shared-models';

type LoginStatus = 'checking' | 'phone' | 'code' | 'password' | 'authenticated';

/**
 * Màn đăng nhập tối thiểu (F1.1). Wizard 3 bước: API_ID/API_HASH + số điện
 * thoại → mã xác nhận → mật khẩu 2FA (nếu có). Mỗi bước chờ user nhập qua
 * một callback Comlink-proxy được TelegramGateway.login gọi ngược lại từ
 * Core Worker (ADR-0003/0004) — xem libs/core-mtproto/src/gateway.ts.
 */
@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class Login {
  private readonly client = createCoreWorkerClient();

  private pendingCode: ((code: string) => void) | null = null;
  private pendingPassword: ((password: string) => void) | null = null;

  readonly status = signal<LoginStatus>('checking');
  readonly user = signal<TelegramUserSummary | null>(null);
  readonly errorMessage = signal<string | null>(null);
  readonly passwordHint = signal<string | undefined>(undefined);
  readonly codeViaApp = signal(false);
  readonly submitting = signal(false);

  constructor() {
    void this.restore();
  }

  private async restore(): Promise<void> {
    try {
      const summary = await this.client.restoreSession();
      if (summary) {
        this.user.set(summary);
        this.status.set('authenticated');
        return;
      }
    } catch (err) {
      // Phiên cũ lỗi (session chết, hết hạn) không chặn onboarding — chỉ
      // coi như chưa đăng nhập, không phải lỗi cần hiển thị ngay.
      console.warn('[login] restoreSession lỗi:', err);
    }
    this.status.set('phone');
  }

  async onSubmitPhone(event: Event, apiIdRaw: string, apiHash: string, phoneNumber: string): Promise<void> {
    event.preventDefault();
    this.errorMessage.set(null);

    const apiId = Number(apiIdRaw);
    if (!apiId || !apiHash.trim() || !phoneNumber.trim()) {
      this.errorMessage.set('Điền đầy đủ API_ID, API_HASH và số điện thoại.');
      return;
    }

    this.submitting.set(true);
    try {
      const summary = await this.client.login(
        { apiId, apiHash },
        phoneNumber,
        {
          phoneCode: Comlink.proxy((isCodeViaApp?: boolean) => {
            this.codeViaApp.set(Boolean(isCodeViaApp));
            this.status.set('code');
            return new Promise<string>((resolve) => {
              this.pendingCode = resolve;
            });
          }),
          password: Comlink.proxy((hint?: string) => {
            this.passwordHint.set(hint);
            this.status.set('password');
            return new Promise<string>((resolve) => {
              this.pendingPassword = resolve;
            });
          }),
          onError: Comlink.proxy(async (err: Error) => {
            this.errorMessage.set(err.message);
            return false;
          })
        }
      );
      this.user.set(summary);
      this.status.set('authenticated');
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

  async onLogout(): Promise<void> {
    await this.client.logout();
    this.user.set(null);
    this.errorMessage.set(null);
    this.status.set('phone');
  }
}
