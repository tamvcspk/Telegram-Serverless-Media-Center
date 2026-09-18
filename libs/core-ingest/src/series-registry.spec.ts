import { describe, expect, it } from 'vitest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { assignToSeries, findRepresentativeEpisode, listSeriesNames, suggestNextEpisode } from './series-registry';

function item(msgId: number, partial: Omit<CatalogItemV1, 'msgId'>): CatalogItemV1 {
  return { msgId, ...partial };
}

describe('listSeriesNames', () => {
  it('lấy tên series phân biệt, bỏ qua phim lẻ và tên rỗng', () => {
    const items = [
      item(1, { title: 'Inception' }),
      item(2, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 1 } }),
      item(3, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 2 } }),
      item(4, { kind: 'episode', series: { name: '  ', season: 1, episode: 1 } }),
      item(5, { kind: 'episode', series: { name: 'Avatar', season: 1, episode: 1 } })
    ];
    expect(listSeriesNames(items)).toEqual(['Avatar', 'Breaking Bad']);
  });

  it('mảng rỗng trả về mảng rỗng', () => {
    expect(listSeriesNames([])).toEqual([]);
  });
});

describe('findRepresentativeEpisode', () => {
  it('trả về item ĐẦU TIÊN khớp series', () => {
    const items = [
      item(1, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 2 }, genres: ['crime'] }),
      item(2, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 1 }, genres: ['drama'] })
    ];
    expect(findRepresentativeEpisode(items, 'Breaking Bad')).toBe(items[0]);
  });

  it('series chưa tồn tại → undefined', () => {
    expect(findRepresentativeEpisode([], 'Breaking Bad')).toBeUndefined();
  });
});

describe('suggestNextEpisode', () => {
  it('series mới (chưa có tập nào) → season 1, episode 1', () => {
    expect(suggestNextEpisode([], 'New Show')).toEqual({ season: 1, episode: 1 });
  });

  it('gợi ý episode kế tiếp trong season LỚN NHẤT đã dùng', () => {
    const items = [
      item(1, { kind: 'episode', series: { name: 'Show', season: 1, episode: 1 } }),
      item(2, { kind: 'episode', series: { name: 'Show', season: 1, episode: 2 } }),
      item(3, { kind: 'episode', series: { name: 'Show', season: 2, episode: 1 } })
    ];
    expect(suggestNextEpisode(items, 'Show')).toEqual({ season: 2, episode: 2 });
  });

  it('bỏ qua item của series khác', () => {
    const items = [
      item(1, { kind: 'episode', series: { name: 'Other Show', season: 5, episode: 9 } }),
      item(2, { kind: 'episode', series: { name: 'Show', season: 1, episode: 1 } })
    ];
    expect(suggestNextEpisode(items, 'Show')).toEqual({ season: 1, episode: 2 });
  });
});

describe('assignToSeries', () => {
  it('không có inheritFrom → giữ nguyên genres/cast/director của target', () => {
    const target = item(1, { title: 'Movie', genres: ['action'], cast: ['A'], director: 'X' });
    const result = assignToSeries(target, 'New Series', 1, 1);
    expect(result).toEqual({ msgId: 1, title: 'Movie', genres: ['action'], cast: ['A'], director: 'X', kind: 'episode', series: { name: 'New Series', season: 1, episode: 1 } });
  });

  it('có inheritFrom → ghi đè genres/cast/director, GIỮ NGUYÊN title/năm/msgId của target', () => {
    const target = item(1, { title: 'The Great Escape', year: 2020 });
    const inheritFrom = item(9, { genres: ['crime', 'drama'], cast: ['B'], director: 'Y' });
    const result = assignToSeries(target, 'Breaking Bad', 3, 5, inheritFrom);
    expect(result.title).toBe('The Great Escape');
    expect(result.year).toBe(2020);
    expect(result.msgId).toBe(1);
    expect(result.genres).toEqual(['crime', 'drama']);
    expect(result.cast).toEqual(['B']);
    expect(result.director).toBe('Y');
    expect(result.series).toEqual({ name: 'Breaking Bad', season: 3, episode: 5 });
    expect(result.kind).toBe('episode');
  });

  it('inheritFrom không có genres/cast/director (undefined) → giữ nguyên của target', () => {
    const target = item(1, { genres: ['own-genre'] });
    const inheritFrom = item(9, {});
    const result = assignToSeries(target, 'Series', 1, 1, inheritFrom);
    expect(result.genres).toEqual(['own-genre']);
  });
});
