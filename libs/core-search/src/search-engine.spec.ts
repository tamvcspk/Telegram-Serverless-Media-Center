import { describe, expect, it } from 'vitest';
import { createSearchEngine } from './search-engine';

describe('createSearchEngine', () => {
  it('index rồi search theo title, đúng nguồn', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Phim Hành Động' }]);

    expect(engine.search('Hành Động')).toEqual([{ sourceId: 'src1', msgId: 1 }]);
  });

  it('chuẩn hoá tiếng Việt — gõ không dấu vẫn khớp title có dấu', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Phim Hành Động' }]);

    expect(engine.search('hanh dong')).toEqual([{ sourceId: 'src1', msgId: 1 }]);
  });

  it('prefix — gõ tới đâu ra kết quả tới đó', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Interstellar' }]);

    expect(engine.search('inters')).toEqual([{ sourceId: 'src1', msgId: 1 }]);
  });

  it('lọc theo sourceId — item nguồn khác không lẫn vào kết quả dù title khớp', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Phim A' }]);
    engine.reindexSource('src2', [{ sourceId: 'src2', msgId: 2, title: 'Phim A' }]);

    expect(engine.search('Phim A', { sourceId: 'src2' })).toEqual([{ sourceId: 'src2', msgId: 2 }]);
  });

  it('reindexSource() thay thế toàn bộ item cũ của nguồn, không cộng dồn trùng lặp', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Phim Cũ' }]);
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Phim Mới' }]);

    expect(engine.search('Phim')).toEqual([{ sourceId: 'src1', msgId: 1 }]);
    expect(engine.search('Cũ')).toEqual([]);
  });

  it('reindexSource() không đụng tới item của nguồn khác', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Alpha' }]);
    engine.reindexSource('src2', [{ sourceId: 'src2', msgId: 2, title: 'Beta' }]);
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Alpha (sửa)' }]);

    expect(engine.search('Beta')).toEqual([{ sourceId: 'src2', msgId: 2 }]);
  });

  it('discardItem() xoá đúng 1 item, giữ nguyên item khác cùng nguồn', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [
      { sourceId: 'src1', msgId: 1, title: 'Alpha' },
      { sourceId: 'src1', msgId: 2, title: 'Beta' }
    ]);
    engine.discardItem('src1', 1);

    expect(engine.search('Alpha')).toEqual([]);
    expect(engine.search('Beta')).toEqual([{ sourceId: 'src1', msgId: 2 }]);
  });

  it('removeSource() xoá toàn bộ item của một nguồn, không đụng nguồn khác', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Alpha' }]);
    engine.reindexSource('src2', [{ sourceId: 'src2', msgId: 2, title: 'Beta' }]);
    engine.removeSource('src1');

    expect(engine.search('Alpha')).toEqual([]);
    expect(engine.search('Beta')).toEqual([{ sourceId: 'src2', msgId: 2 }]);
  });

  it('serialize() rồi nạp lại — kết quả search giống hệt, và bookkeeping nguồn vẫn đúng cho reindexSource() sau đó', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [{ sourceId: 'src1', msgId: 1, title: 'Phim Hành Động' }]);

    const restored = createSearchEngine(engine.serialize());
    expect(restored.search('hanh dong')).toEqual([{ sourceId: 'src1', msgId: 1 }]);

    // Bookkeeping phải theo kịp: reindexSource() trên engine nạp lại phải
    // discard đúng item cũ, không để lại rác từ trước khi serialize.
    restored.reindexSource('src1', [{ sourceId: 'src1', msgId: 3, title: 'Phim Mới' }]);
    expect(restored.search('Hành Động')).toEqual([]);
    expect(restored.search('Phim Mới')).toEqual([{ sourceId: 'src1', msgId: 3 }]);
  });

  it('boost title — khớp title xếp trước khớp cùng độ mạnh ở field khác', () => {
    const engine = createSearchEngine();
    engine.reindexSource('src1', [
      { sourceId: 'src1', msgId: 1, title: 'Phim khác', director: 'Nolan' },
      { sourceId: 'src1', msgId: 2, title: 'Nolan' }
    ]);

    expect(engine.search('Nolan')).toEqual([
      { sourceId: 'src1', msgId: 2 },
      { sourceId: 'src1', msgId: 1 }
    ]);
  });
});
