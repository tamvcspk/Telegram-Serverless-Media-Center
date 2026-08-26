import { describe, expect, it } from 'vitest';
import { createDownloadEngine, SUB_CHUNK_SIZE } from './download-engine';
import { createFakeDownloadGateway, FakeFileReferenceExpiredError, FakeFloodWaitTooLongError, makeRef } from './test-fakes';
import type { DownloadGateway, PlaybackDocumentRef } from './gateway-port';

function expectedByte(offset: number): number {
  return offset % 256;
}

describe('createDownloadEngine — ADR-0006 vertical slice tối thiểu', () => {
  it('gộp nhiều sub-chunk 512 KB thành đúng cửa sổ yêu cầu', async () => {
    const gateway = createFakeDownloadGateway({ ref: makeRef({ size: 4 * SUB_CHUNK_SIZE }) });
    const engine = createDownloadEngine(gateway);

    const buf = await engine.fetchWindow('c1', 1, 0, 2 * SUB_CHUNK_SIZE, 'corr-1');

    expect(buf.byteLength).toBe(2 * SUB_CHUNK_SIZE);
    const bytes = new Uint8Array(buf);
    expect(bytes[0]).toBe(expectedByte(0));
    expect(bytes[SUB_CHUNK_SIZE]).toBe(expectedByte(SUB_CHUNK_SIZE));
    expect(gateway.calls).toEqual([
      { offset: 0, limit: SUB_CHUNK_SIZE },
      { offset: SUB_CHUNK_SIZE, limit: SUB_CHUNK_SIZE }
    ]);
  });

  it('dừng sớm khi sub-chunk trả về ngắn hơn limit (hết file) và cắt đúng theo dung lượng còn lại', async () => {
    const tailSize = SUB_CHUNK_SIZE + 300_000;
    const gateway = createFakeDownloadGateway({ ref: makeRef({ size: tailSize }) });
    const engine = createDownloadEngine(gateway);

    const buf = await engine.fetchWindow('c1', 1, SUB_CHUNK_SIZE, SUB_CHUNK_SIZE, 'corr-2');

    expect(buf.byteLength).toBe(300_000);
    expect(gateway.calls).toEqual([{ offset: SUB_CHUNK_SIZE, limit: SUB_CHUNK_SIZE }]);
  });

  it('làm mới file_reference một lần khi gateway báo hết hạn, rồi retry đúng offset đó', async () => {
    const staleRef = makeRef({ fileReference: 'stale' });
    const freshRef = makeRef({ fileReference: 'fresh' });
    const gateway = createFakeDownloadGateway({
      ref: staleRef,
      errorAtCall: new Map([
        [
          0,
          () => {
            gateway.setRef(freshRef);
            return new FakeFileReferenceExpiredError();
          }
        ]
      ])
    });
    const engine = createDownloadEngine(gateway);

    const buf = await engine.fetchWindow('c1', 1, 0, SUB_CHUNK_SIZE, 'corr-3');

    expect(buf.byteLength).toBe(SUB_CHUNK_SIZE);
    // Lần gọi 0 thất bại (offset 0) + lần retry cũng offset 0 sau khi refresh.
    expect(gateway.calls).toEqual([
      { offset: 0, limit: SUB_CHUNK_SIZE },
      { offset: 0, limit: SUB_CHUNK_SIZE }
    ]);
  });

  it('ném nguyên văn lỗi FLOOD_WAIT vượt ngưỡng — không nuốt, không retry ngầm (ADR-0006 §4)', async () => {
    const gateway = createFakeDownloadGateway({
      errorAtCall: new Map([[0, () => new FakeFloodWaitTooLongError(120)]])
    });
    const engine = createDownloadEngine(gateway);

    await expect(engine.fetchWindow('c1', 1, 0, SUB_CHUNK_SIZE, 'corr-4')).rejects.toMatchObject({ name: 'FloodWaitTooLongError', seconds: 120 });
  });

  it('cancel() trước khi gọi fetchWindow chặn ngay, không tốn round-trip nào', async () => {
    const gateway = createFakeDownloadGateway();
    const engine = createDownloadEngine(gateway);

    engine.cancel('corr-5');
    await expect(engine.fetchWindow('c1', 1, 0, SUB_CHUNK_SIZE, 'corr-5')).rejects.toMatchObject({ name: 'CancelledError' });
    expect(gateway.calls).toHaveLength(0);
  });

  it('cancel() giữa vòng lặp chặn round-trip TIẾP THEO (không abort round-trip đang bay)', async () => {
    const correlationId = 'corr-6';
    // `fetchFileChunk` chỉ THỰC SỰ được gọi lúc `engine.fetchWindow(...)` chạy
    // (sau khi `engine` đã gán xong) nên tham chiếu `engine` trong closure ở
    // đây an toàn dù khai báo `const engine` nằm SAU object `gateway`.
    const gateway: DownloadGateway & { calls: number[] } = {
      calls: [],
      async getPlaybackDocument() {
        return makeRef({ size: 4 * SUB_CHUNK_SIZE });
      },
      async fetchFileChunk(_ref: PlaybackDocumentRef, offset: number, limit: number): Promise<ArrayBuffer> {
        this.calls.push(offset);
        if (this.calls.length === 1) {
          // Mô phỏng cancel() đến GIỮA lúc sub-chunk đầu tiên đang bay.
          engine.cancel(correlationId);
        }
        return new Uint8Array(limit).buffer;
      }
    };
    const engine = createDownloadEngine(gateway);

    await expect(engine.fetchWindow('c1', 1, 0, 3 * SUB_CHUNK_SIZE, correlationId)).rejects.toMatchObject({ name: 'CancelledError' });
    // Sub-chunk đầu đã hoàn tất bình thường (đúng giới hạn đã biết — không abort round-trip đang bay);
    // vòng lặp dừng lại TRƯỚC sub-chunk thứ hai.
    expect(gateway.calls).toEqual([0]);
  });
});
