import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoginCallbacks, TelegramCredentials } from '@tsmc/shared-models';

// GramJS thật đã được kiểm tra trực tiếp (tarball telegram@2.26.22) để xác
// nhận đúng hành vi retry/lỗi của client.signInUser (xem gateway.ts và plan
// slice này) — mock ở đây KHÔNG tái hiện logic nội bộ của GramJS (đã là thư
// viện ngoài, đã đọc source để tin tưởng), chỉ kiểm tra gateway.ts của ta
// nối dây đúng: forward đúng tham số, mã hoá/lưu session đúng lúc, đúng thứ
// tự logout, và không rò type GramJS ra ngoài toUserSummary.
const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  signInUser: vi.fn(),
  checkAuthorization: vi.fn(),
  getMe: vi.fn(),
  invoke: vi.fn(),
  getSessionRecord: vi.fn(),
  putSessionRecord: vi.fn(),
  deleteSessionRecord: vi.fn()
}));

vi.mock('telegram', () => {
  class FakeUser {
    id: bigint;
    firstName?: string;
    lastName?: string;
    username?: string;
    phone?: string;
    constructor(data: { id: bigint; firstName?: string; lastName?: string; username?: string; phone?: string }) {
      this.id = data.id;
      this.firstName = data.firstName;
      this.lastName = data.lastName;
      this.username = data.username;
      this.phone = data.phone;
    }
  }
  class FakeLogOut {}
  class FakeStringSession {
    constructor(private value = '') {}
    save(): string {
      return this.value;
    }
  }
  class FakeTelegramClient {
    session: FakeStringSession;
    connect = mocks.connect;
    signInUser = mocks.signInUser;
    checkAuthorization = mocks.checkAuthorization;
    getMe = mocks.getMe;
    invoke = mocks.invoke;
    constructor(session: FakeStringSession) {
      this.session = session;
    }
  }
  return {
    Api: { User: FakeUser, auth: { LogOut: FakeLogOut } },
    TelegramClient: FakeTelegramClient,
    sessions: { StringSession: FakeStringSession }
  };
});

vi.mock('@tsmc/core-storage', () => ({
  getSessionRecord: mocks.getSessionRecord,
  putSessionRecord: mocks.putSessionRecord,
  deleteSessionRecord: mocks.deleteSessionRecord
}));

const { Api } = await import('telegram');
const { createTelegramGateway } = await import('./gateway');
const { encryptSessionString, generateSessionKey } = await import('./session-crypto');

const credentials: TelegramCredentials = { apiId: 1, apiHash: 'test-hash' };
const noopCallbacks: LoginCallbacks = {
  phoneCode: vi.fn(),
  password: vi.fn(),
  onError: vi.fn()
};

describe('@tsmc/core-mtproto createTelegramGateway', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('login(): forward đúng tham số cho signInUser, mã hoá + lưu session, map đúng DTO', async () => {
    mocks.connect.mockResolvedValue(undefined);
    mocks.signInUser.mockResolvedValue(new Api.User({ id: 111n, firstName: 'Tam', username: 'tamvcspk' }));

    const gateway = createTelegramGateway();
    const result = await gateway.login(credentials, '+84123456789', noopCallbacks);

    expect(result).toEqual({ id: '111', firstName: 'Tam', lastName: undefined, username: 'tamvcspk', phone: undefined });
    expect(mocks.signInUser).toHaveBeenCalledWith(credentials, {
      phoneNumber: '+84123456789',
      phoneCode: noopCallbacks.phoneCode,
      password: noopCallbacks.password,
      onError: noopCallbacks.onError
    });

    expect(mocks.putSessionRecord).toHaveBeenCalledTimes(1);
    const record = mocks.putSessionRecord.mock.calls[0][0];
    expect(record.apiId).toBe(credentials.apiId);
    expect(record.apiHash).toBe(credentials.apiHash);
    expect(record.iv).toBeInstanceOf(Uint8Array);
    expect(record.ciphertext).toBeInstanceOf(ArrayBuffer);
  });

  it('login(): reject thẳng khi signInUser lỗi, không lưu session', async () => {
    mocks.connect.mockResolvedValue(undefined);
    mocks.signInUser.mockRejectedValue(new Error('PHONE_NUMBER_INVALID'));

    const gateway = createTelegramGateway();
    await expect(gateway.login(credentials, '+84123456789', noopCallbacks)).rejects.toThrow('PHONE_NUMBER_INVALID');
    expect(mocks.putSessionRecord).not.toHaveBeenCalled();
  });

  it('restoreSession(): không có bản ghi → null, không kết nối', async () => {
    mocks.getSessionRecord.mockResolvedValue(undefined);

    const gateway = createTelegramGateway();
    const result = await gateway.restoreSession();

    expect(result).toBeNull();
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('restoreSession(): bản ghi hợp lệ + checkAuthorization true → giải mã và trả về user', async () => {
    const key = await generateSessionKey();
    const { iv, ciphertext } = await encryptSessionString(key, 'gramjs-session-string');
    mocks.getSessionRecord.mockResolvedValue({ id: 'default', apiId: 1, apiHash: 'test-hash', iv, ciphertext, cryptoKey: key });
    mocks.connect.mockResolvedValue(undefined);
    mocks.checkAuthorization.mockResolvedValue(true);
    mocks.getMe.mockResolvedValue(new Api.User({ id: 222n, firstName: 'Restored' }));

    const gateway = createTelegramGateway();
    const result = await gateway.restoreSession();

    expect(result).toEqual({ id: '222', firstName: 'Restored', lastName: undefined, username: undefined, phone: undefined });
    expect(mocks.deleteSessionRecord).not.toHaveBeenCalled();
  });

  it('restoreSession(): checkAuthorization false → xoá bản ghi cục bộ, trả về null', async () => {
    const key = await generateSessionKey();
    const { iv, ciphertext } = await encryptSessionString(key, 'gramjs-session-string');
    mocks.getSessionRecord.mockResolvedValue({ id: 'default', apiId: 1, apiHash: 'test-hash', iv, ciphertext, cryptoKey: key });
    mocks.connect.mockResolvedValue(undefined);
    mocks.checkAuthorization.mockResolvedValue(false);

    const gateway = createTelegramGateway();
    const result = await gateway.restoreSession();

    expect(result).toBeNull();
    expect(mocks.deleteSessionRecord).toHaveBeenCalledTimes(1);
  });

  it('logout(): gọi auth.LogOut TRƯỚC khi xoá session cục bộ', async () => {
    mocks.connect.mockResolvedValue(undefined);
    mocks.signInUser.mockResolvedValue(new Api.User({ id: 111n }));
    mocks.invoke.mockResolvedValue(undefined);

    const gateway = createTelegramGateway();
    await gateway.login(credentials, '+84123456789', noopCallbacks);
    await gateway.logout();

    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.calls[0][0]).toBeInstanceOf(Api.auth.LogOut);
    expect(mocks.deleteSessionRecord).toHaveBeenCalledTimes(1);
    expect(mocks.invoke.mock.invocationCallOrder[0]).toBeLessThan(mocks.deleteSessionRecord.mock.invocationCallOrder[0]);
  });

  it('logout(): chưa từng đăng nhập trong phiên worker này → chỉ xoá local, không gọi invoke', async () => {
    const gateway = createTelegramGateway();
    await gateway.logout();

    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.deleteSessionRecord).toHaveBeenCalledTimes(1);
  });
});
