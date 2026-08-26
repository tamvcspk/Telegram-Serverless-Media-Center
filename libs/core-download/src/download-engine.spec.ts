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

describe('createDownloadEngine — hardening: AIMD + circuit breaker (ADR-0006 §3/§4)', () => {
  it('tăng dần độ song song sau nhiều lượt tải thành công liên tiếp, chạm trần mặc định 4', async () => {
    // 10 sub-chunk — đủ để 2 cửa sổ 5-sub-chunk liên tiếp ramp từ 2 (khởi
    // đầu) → 3 → 4 (trần mặc định) đúng theo cách tính ở download-engine.ts.
    const gateway = createFakeDownloadGateway({ ref: makeRef({ size: 10 * SUB_CHUNK_SIZE }) });
    const engine = createDownloadEngine(gateway);

    await engine.fetchWindow('c1', 1, 0, 5 * SUB_CHUNK_SIZE, 'w1');
    // Cửa sổ đầu chạy ở pool=2 (giá trị khởi đầu) — nhưng đã ramp tới 4 SAU
    // 5 lần thành công liên tiếp (2 rồi 3 lần) — cửa sổ THỨ HAI mới thật sự
    // chạy 4 worker song song, lộ ra qua peakConcurrency.
    await engine.fetchWindow('c1', 1, 5 * SUB_CHUNK_SIZE, 5 * SUB_CHUNK_SIZE, 'w2');

    expect(gateway.peakConcurrency).toBe(4);
  });

  it('flood nghiêm trọng (>60s, tín hiệu duy nhất quan sát được — xem comment isFloodWaitTooLong) giảm một nửa độ song song; 3 lần liên tiếp trên cùng DC mở circuit breaker chặn lần gọi kế tiếp không tốn round-trip', async () => {
    const gateway = createFakeDownloadGateway({
      ref: makeRef({ size: 10 * SUB_CHUNK_SIZE }),
      errorAtCall: new Map([
        [0, () => new FakeFloodWaitTooLongError(65)],
        [1, () => new FakeFloodWaitTooLongError(65)],
        [2, () => new FakeFloodWaitTooLongError(65)]
      ])
    });
    const engine = createDownloadEngine(gateway);

    // Mỗi cửa sổ đúng 1 sub-chunk — cô lập khỏi ảnh hưởng của AIMD ramp-up
    // (pool luôn kẹp về 1 vì offsets.length=1), chỉ kiểm tra circuit breaker.
    await expect(engine.fetchWindow('c1', 1, 0, SUB_CHUNK_SIZE, 'a')).rejects.toMatchObject({ name: 'FloodWaitTooLongError', seconds: 65 });
    await expect(engine.fetchWindow('c1', 1, SUB_CHUNK_SIZE, SUB_CHUNK_SIZE, 'b')).rejects.toMatchObject({ name: 'FloodWaitTooLongError', seconds: 65 });
    // Lần FLOOD thứ 3 liên tiếp trip circuit breaker — lỗi trả về là backoff
    // MỚI (2s, ADR-0006 §4 "bắt đầu 2s"), không phải seconds=65 đã script.
    await expect(engine.fetchWindow('c1', 1, 2 * SUB_CHUNK_SIZE, SUB_CHUNK_SIZE, 'c')).rejects.toMatchObject({ name: 'FloodWaitTooLongError', seconds: 2 });

    const callsBefore = gateway.calls.length;
    await expect(engine.fetchWindow('c1', 1, 3 * SUB_CHUNK_SIZE, SUB_CHUNK_SIZE, 'd')).rejects.toMatchObject({ name: 'FloodWaitTooLongError' });
    // Circuit breaker chặn NGAY khi còn đang "nghỉ" — không gọi gateway.fetchFileChunk() dù chỉ một lần.
    expect(gateway.calls.length).toBe(callsBefore);
  });

  it('nhiều worker cùng gặp file_reference hết hạn gần như đồng thời — chỉ làm mới đúng MỘT lần, mọi offset đều tự retry thành công', async () => {
    const staleRef = makeRef({ fileReference: 'stale', size: 4 * SUB_CHUNK_SIZE });
    const freshRef = makeRef({ fileReference: 'fresh', size: 4 * SUB_CHUNK_SIZE });
    let getPlaybackDocumentCalls = 0;
    const fetchCalls: number[] = [];
    const gateway: DownloadGateway = {
      async getPlaybackDocument() {
        getPlaybackDocumentCalls++;
        return getPlaybackDocumentCalls === 1 ? staleRef : freshRef;
      },
      async fetchFileChunk(ref: PlaybackDocumentRef, offset: number, limit: number): Promise<ArrayBuffer> {
        fetchCalls.push(offset);
        if (ref.fileReference === 'stale') {
          throw new FakeFileReferenceExpiredError();
        }
        return new Uint8Array(limit).buffer;
      }
    };
    const engine = createDownloadEngine(gateway);

    // Cửa sổ 2 sub-chunk, pool khởi đầu = 2 → cả hai worker cùng gọi
    // fetchFileChunk với ref CŨ trước khi worker nào kịp làm mới nó.
    const buf = await engine.fetchWindow('c1', 1, 0, 2 * SUB_CHUNK_SIZE, 'corr-refresh');

    expect(buf.byteLength).toBe(2 * SUB_CHUNK_SIZE);
    // 1 lần resolve ban đầu (không force) + đúng 1 lần force-refresh dùng
    // chung cho cả hai worker — KHÔNG phải 3 (mỗi worker tự làm mới riêng).
    expect(getPlaybackDocumentCalls).toBe(2);
    expect(fetchCalls.filter((o) => o === 0)).toHaveLength(2);
    expect(fetchCalls.filter((o) => o === SUB_CHUNK_SIZE)).toHaveLength(2);
  });
});
