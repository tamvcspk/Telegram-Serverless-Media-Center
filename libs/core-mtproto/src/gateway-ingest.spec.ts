import { beforeEach, describe, expect, it, vi } from 'vitest';

// createIngestGatewayMethods() nhận `getClient` qua tham số, cùng quy ước với
// gateway-index.spec.ts — không cần dựng lại luồng login/session.
const mocks = vi.hoisted(() => ({
  getEntity: vi.fn(),
  sendFile: vi.fn()
}));

vi.mock('telegram', () => {
  class FakeChannel {
    id: { toString(): string };
    constructor(data: { id: number }) {
      this.id = { toString: () => String(data.id) };
    }
  }
  class FakeDocumentAttributeFilename {
    fileName: string;
    constructor(data: { fileName: string }) {
      this.fileName = data.fileName;
    }
  }
  class FakeDocumentAttributeVideo {
    w: number;
    h: number;
    duration: number;
    supportsStreaming?: boolean;
    constructor(data: { w: number; h: number; duration: number; supportsStreaming?: boolean }) {
      this.w = data.w;
      this.h = data.h;
      this.duration = data.duration;
      this.supportsStreaming = data.supportsStreaming;
    }
  }
  class FakeTelegramClient {
    getEntity = mocks.getEntity;
    sendFile = mocks.sendFile;
  }
  return {
    Api: {
      Channel: FakeChannel,
      DocumentAttributeFilename: FakeDocumentAttributeFilename,
      DocumentAttributeVideo: FakeDocumentAttributeVideo
    },
    TelegramClient: FakeTelegramClient
  };
});

const { createIngestGatewayMethods } = await import('./gateway-ingest');

interface SendFileOptions {
  file: string;
  thumb?: string;
  forceDocument: boolean;
  caption?: string;
  attributes: Array<{ w?: number; h?: number; duration?: number; supportsStreaming?: boolean; fileName?: string }>;
}

async function makeClient() {
  return new (await import('telegram')).TelegramClient('' as never, 0, '', {} as never);
}

describe('@tsmc/core-mtproto createIngestGatewayMethods', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uploadVideoDocument(): gửi file bằng đường dẫn (không nạp Buffer vào bộ nhớ), forceDocument=false để Telegram xử lý như video streaming được', async () => {
    const client = await makeClient();
    const methods = createIngestGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce({ id: { toString: () => '1' } });
    mocks.sendFile.mockResolvedValueOnce({ id: 999 });

    const result = await methods.uploadVideoDocument('1', {
      filePath: '/tmp/movie.mp4',
      fileName: 'Movie.2024.mp4',
      video: { w: 1920, h: 1080, durationSec: 3600 },
      thumbnailPath: '/tmp/thumb.jpg',
      caption: 'Movie (2024)'
    });

    expect(result).toEqual({ msgId: 999 });
    expect(mocks.sendFile).toHaveBeenCalledTimes(1);
    const [, options] = mocks.sendFile.mock.calls[0] as [unknown, SendFileOptions];
    expect(options.file).toBe('/tmp/movie.mp4');
    expect(options.thumb).toBe('/tmp/thumb.jpg');
    expect(options.forceDocument).toBe(false);
    expect(options.caption).toBe('Movie (2024)');
  });

  it('uploadVideoDocument(): DocumentAttributeVideo mang đúng w/h/duration + supportsStreaming=true (điều kiện phát qua HTTP Range, ADR-0005)', async () => {
    const client = await makeClient();
    const methods = createIngestGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce({ id: { toString: () => '1' } });
    mocks.sendFile.mockResolvedValueOnce({ id: 1 });

    await methods.uploadVideoDocument('1', {
      filePath: '/tmp/movie.mp4',
      fileName: 'Movie.2024.mp4',
      video: { w: 1920, h: 1080, durationSec: 3600 }
    });

    const [, options] = mocks.sendFile.mock.calls[0] as [unknown, SendFileOptions];
    const videoAttr = options.attributes.find((a) => a.supportsStreaming !== undefined);
    const filenameAttr = options.attributes.find((a) => a.fileName !== undefined);
    expect(videoAttr).toMatchObject({ w: 1920, h: 1080, duration: 3600, supportsStreaming: true });
    expect(filenameAttr).toMatchObject({ fileName: 'Movie.2024.mp4' });
  });

  it('uploadVideoDocument(): không có thumbnailPath → thumb undefined, không throw', async () => {
    const client = await makeClient();
    const methods = createIngestGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce({ id: { toString: () => '1' } });
    mocks.sendFile.mockResolvedValueOnce({ id: 1 });

    await methods.uploadVideoDocument('1', {
      filePath: '/tmp/movie.mp4',
      fileName: 'Movie.2024.mp4',
      video: { w: 1920, h: 1080, durationSec: 3600 }
    });

    const [, options] = mocks.sendFile.mock.calls[0] as [unknown, SendFileOptions];
    expect(options.thumb).toBeUndefined();
  });

  it('uploadSubtitleDocument(): forceDocument=true (file phụ trợ, không phải media streaming), không có caption', async () => {
    const client = await makeClient();
    const methods = createIngestGatewayMethods(() => client);
    mocks.getEntity.mockResolvedValueOnce({ id: { toString: () => '1' } });
    mocks.sendFile.mockResolvedValueOnce({ id: 42 });

    const result = await methods.uploadSubtitleDocument('1', {
      filePath: '/tmp/movie.vi.srt',
      fileName: 'Movie.2024.vi.srt'
    });

    expect(result).toEqual({ msgId: 42 });
    const [, options] = mocks.sendFile.mock.calls[0] as [unknown, SendFileOptions];
    expect(options.file).toBe('/tmp/movie.vi.srt');
    expect(options.forceDocument).toBe(true);
    expect(options.caption).toBeUndefined();
    const filenameAttr = options.attributes.find((a) => a.fileName !== undefined);
    expect(filenameAttr).toMatchObject({ fileName: 'Movie.2024.vi.srt' });
  });
});
