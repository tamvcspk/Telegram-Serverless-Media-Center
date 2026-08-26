import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock 'telegram' tối thiểu cho ĐÚNG những gì gateway-download.ts đụng tới
// khi tải CDN redirect — cùng quy ước với gateway.spec.ts ("mock KHÔNG tái
// hiện logic nội bộ GramJS, chỉ kiểm tra nối dây của ta"). Giải mã AES-CTR +
// SHA-256 dùng `crypto.subtle` THẬT (Node 20+ có sẵn `globalThis.crypto`,
// không cần mock) — đây chính là phần logic quan trọng nhất cần test thật,
// không phải phần đã mock.
const mocks = vi.hoisted(() => ({
  getSender: vi.fn(),
  invokeWithSender: vi.fn()
}));

vi.mock('telegram', () => {
  class FakeRequest {
    className: string;
    props: Record<string, unknown>;
    constructor(className: string, props: Record<string, unknown>) {
      this.className = className;
      this.props = props;
    }
  }
  class FakeInputDocumentFileLocation extends FakeRequest {
    constructor(props: Record<string, unknown>) {
      super('inputDocumentFileLocation', props);
    }
  }
  class FakeGetFile extends FakeRequest {
    constructor(props: Record<string, unknown>) {
      super('upload.GetFile', props);
    }
  }
  class FakeGetCdnFile extends FakeRequest {
    constructor(props: Record<string, unknown>) {
      super('upload.GetCdnFile', props);
    }
  }
  class FakeGetCdnFileHashes extends FakeRequest {
    constructor(props: Record<string, unknown>) {
      super('upload.GetCdnFileHashes', props);
    }
  }
  class FakeReuploadCdnFile extends FakeRequest {
    constructor(props: Record<string, unknown>) {
      super('upload.ReuploadCdnFile', props);
    }
  }
  class FakeFileCdnRedirect {
    dcId: number;
    fileToken: Uint8Array;
    encryptionKey: Uint8Array;
    encryptionIv: Uint8Array;
    fileHashes: unknown[];
    constructor(props: { dcId: number; fileToken: Uint8Array; encryptionKey: Uint8Array; encryptionIv: Uint8Array; fileHashes: unknown[] }) {
      this.dcId = props.dcId;
      this.fileToken = props.fileToken;
      this.encryptionKey = props.encryptionKey;
      this.encryptionIv = props.encryptionIv;
      this.fileHashes = props.fileHashes;
    }
  }
  class FakeCdnFile {
    bytes: Uint8Array;
    constructor(props: { bytes: Uint8Array }) {
      this.bytes = props.bytes;
    }
  }
  class FakeCdnFileReuploadNeeded {
    requestToken: Uint8Array;
    constructor(props: { requestToken: Uint8Array }) {
      this.requestToken = props.requestToken;
    }
  }
  class FakeFileMigrateError extends Error {
    newDc = 0;
  }
  class FakeFloodWaitError extends Error {
    seconds = 0;
  }
  class FakeTelegramClient {
    getSender = mocks.getSender;
    invokeWithSender = mocks.invokeWithSender;
  }
  return {
    Api: {
      InputDocumentFileLocation: FakeInputDocumentFileLocation,
      upload: {
        GetFile: FakeGetFile,
        GetCdnFile: FakeGetCdnFile,
        GetCdnFileHashes: FakeGetCdnFileHashes,
        ReuploadCdnFile: FakeReuploadCdnFile,
        FileCdnRedirect: FakeFileCdnRedirect,
        CdnFile: FakeCdnFile,
        CdnFileReuploadNeeded: FakeCdnFileReuploadNeeded
      }
    },
    errors: { FileMigrateError: FakeFileMigrateError, FloodWaitError: FakeFloodWaitError },
    TelegramClient: FakeTelegramClient
  };
});

const telegramModule = await import('telegram');
const { TelegramClient } = telegramModule;
// `Api`/`errors` thật đã bị `vi.mock` thay runtime, nhưng TYPE tĩnh của
// `import('telegram')` vẫn phân giải theo .d.ts THẬT (nghiêm ngặt hơn nhiều
// so với các fake tối thiểu ở trên) — ép kiểu MỘT LẦN ở đây (thay vì `as
// never` rải rác mỗi lần dựng) để test fixture chỉ cần đúng những field
// gateway-download.ts thực sự đọc, cùng tinh thần "mock không tái hiện
// GramJS thật" đã ghi ở gateway.spec.ts.
const Api = telegramModule.Api as unknown as {
  InputDocumentFileLocation: new (props: Record<string, unknown>) => unknown;
  upload: {
    GetFile: new (props: Record<string, unknown>) => unknown;
    GetCdnFile: new (props: Record<string, unknown>) => unknown;
    GetCdnFileHashes: new (props: Record<string, unknown>) => unknown;
    ReuploadCdnFile: new (props: Record<string, unknown>) => unknown;
    FileCdnRedirect: new (props: Record<string, unknown>) => unknown;
    CdnFile: new (props: Record<string, unknown>) => unknown;
    CdnFileReuploadNeeded: new (props: Record<string, unknown>) => unknown;
  };
};
const errors = telegramModule.errors as unknown as { FloodWaitError: new (props?: Record<string, unknown>) => Error };
const { createDownloadGatewayMethods, CdnHashMismatchError, FloodWaitTooLongError } = await import('./gateway-download');
const ref = { id: '1', accessHash: '2', fileReference: btoa('ref'), dcId: 2, size: 10_000, mimeType: 'video/mp4' };

async function encryptFixture(plaintext: Uint8Array, offset: number) {
  const encryptionKey = crypto.getRandomValues(new Uint8Array(32));
  const encryptionIv = crypto.getRandomValues(new Uint8Array(16));
  const counter = new Uint8Array(encryptionIv);
  const view = new DataView(counter.buffer);
  const blockIndex = offset / 16;
  view.setUint32(12, (view.getUint32(12, false) + blockIndex) >>> 0, false);
  const key = await crypto.subtle.importKey('raw', encryptionKey as BufferSource, { name: 'AES-CTR' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-CTR', counter: counter as BufferSource, length: 32 }, key, plaintext as BufferSource)
  );
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', plaintext as BufferSource));
  return { encryptionKey, encryptionIv, ciphertext, hash };
}

describe('gateway-download.ts — CDN redirect (ADR-0006 §6)', () => {
  const client = new TelegramClient({} as never, 0, '', {} as never);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSender.mockImplementation(async (dcId: number) => ({ dcId }));
  });

  it('tải qua CDN, giải mã AES-CTR, xác minh SHA-256 khớp — trả về đúng plaintext gốc', async () => {
    const offset = 0;
    const plaintext = new TextEncoder().encode('xin chao tu Telegram CDN, day la du lieu test');
    const { encryptionKey, encryptionIv, ciphertext, hash } = await encryptFixture(plaintext, offset);
    const fileToken = new Uint8Array([9, 9, 9]);

    mocks.invokeWithSender
      .mockResolvedValueOnce(
        new Api.upload.FileCdnRedirect({
          dcId: 5,
          fileToken,
          encryptionKey,
          encryptionIv,
          fileHashes: [{ offset: { toJSNumber: () => offset }, limit: plaintext.length, hash }]
        })
      )
      .mockResolvedValueOnce(new Api.upload.CdnFile({ bytes: ciphertext }));

    const methods = createDownloadGatewayMethods(() => client as never);
    const buf = await methods.fetchFileChunk(ref, offset, plaintext.length);

    expect(new Uint8Array(buf)).toEqual(plaintext);
    // Lần gọi thứ 2 (GetCdnFile) phải đi tới sender của DC CDN (5), không phải DC gốc (2).
    expect(mocks.getSender).toHaveBeenCalledWith(5);
  });

  it('hash không khớp dữ liệu đã giải mã — ném CdnHashMismatchError, không trả bytes chưa xác minh được', async () => {
    const offset = 0;
    const plaintext = new TextEncoder().encode('du lieu se bi lam gia mao boi CDN khong dang tin');
    const { encryptionKey, encryptionIv, ciphertext, hash } = await encryptFixture(plaintext, offset);
    hash[0] ^= 0xff; // làm sai lệch hash

    mocks.invokeWithSender
      .mockResolvedValueOnce(
        new Api.upload.FileCdnRedirect({
          dcId: 5,
          fileToken: new Uint8Array([1]),
          encryptionKey,
          encryptionIv,
          fileHashes: [{ offset: { toJSNumber: () => offset }, limit: plaintext.length, hash }]
        })
      )
      .mockResolvedValueOnce(new Api.upload.CdnFile({ bytes: ciphertext }));

    const methods = createDownloadGatewayMethods(() => client as never);
    await expect(methods.fetchFileChunk(ref, offset, plaintext.length)).rejects.toBeInstanceOf(CdnHashMismatchError);
  });

  it('không có hash nào phủ hết dữ liệu tải về — coi là chưa xác minh được, ném CdnHashMismatchError', async () => {
    const offset = 0;
    const plaintext = new TextEncoder().encode('mot phan du lieu se khong co hash de xac minh');
    const { encryptionKey, encryptionIv, ciphertext } = await encryptFixture(plaintext, offset);

    mocks.invokeWithSender
      .mockResolvedValueOnce(
        new Api.upload.FileCdnRedirect({
          dcId: 5,
          fileToken: new Uint8Array([1]),
          encryptionKey,
          encryptionIv,
          fileHashes: [] // không có đoạn hash nào phủ dữ liệu
        })
      )
      .mockResolvedValueOnce(new Api.upload.CdnFile({ bytes: ciphertext }))
      // fallback gọi GetCdnFileHashes riêng — cũng trả rỗng, vẫn không phủ được.
      .mockResolvedValueOnce([]);

    const methods = createDownloadGatewayMethods(() => client as never);
    await expect(methods.fetchFileChunk(ref, offset, plaintext.length)).rejects.toBeInstanceOf(CdnHashMismatchError);
  });

  it('CdnFileReuploadNeeded → gọi ReuploadCdnFile trên sender DC GỐC, rồi thử lại GetCdnFile thành công', async () => {
    const offset = 0;
    const plaintext = new TextEncoder().encode('du lieu sau khi reupload thanh cong tren CDN');
    const { encryptionKey, encryptionIv, ciphertext, hash } = await encryptFixture(plaintext, offset);
    const fileToken = new Uint8Array([7]);

    mocks.invokeWithSender
      .mockResolvedValueOnce(
        new Api.upload.FileCdnRedirect({
          dcId: 5,
          fileToken,
          encryptionKey,
          encryptionIv,
          fileHashes: [{ offset: { toJSNumber: () => offset }, limit: plaintext.length, hash }]
        })
      )
      .mockResolvedValueOnce(new Api.upload.CdnFileReuploadNeeded({ requestToken: new Uint8Array([1, 2]) }))
      .mockResolvedValueOnce([]) // kết quả ReuploadCdnFile — không dùng tới, chỉ cần resolve
      .mockResolvedValueOnce(new Api.upload.CdnFile({ bytes: ciphertext }));

    const methods = createDownloadGatewayMethods(() => client as never);
    const buf = await methods.fetchFileChunk(ref, offset, plaintext.length);

    expect(new Uint8Array(buf)).toEqual(plaintext);
    expect(mocks.invokeWithSender).toHaveBeenCalledTimes(4);
    // ReuploadCdnFile (lần gọi thứ 3) phải đi qua sender DC GỐC (ref.dcId=2), không phải DC CDN (5).
    const reuploadSender = mocks.invokeWithSender.mock.calls[2][1];
    expect(reuploadSender).toEqual({ dcId: 2 });
  });

  it('FLOOD_WAIT bắt được ở fetchFileChunk luôn là ném thẳng — GramJS đã tự chờ mọi FLOOD_WAIT ≤ 60s trước đó (xem comment FloodWaitTooLongError)', async () => {
    const flood = new errors.FloodWaitError();
    (flood as unknown as { seconds: number }).seconds = 90;
    mocks.invokeWithSender.mockRejectedValueOnce(flood);

    const methods = createDownloadGatewayMethods(() => client as never);
    const err = await methods.fetchFileChunk(ref, 0, 1024).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FloodWaitTooLongError);
    expect(err).toMatchObject({ name: 'FloodWaitTooLongError', seconds: 90 });
  });
});
