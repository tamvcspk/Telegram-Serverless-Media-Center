import { describe, expect, it } from 'vitest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { flattenMetadataTree, seasonGroupKey, seriesGroupKey } from './metadata-tree';

interface Row {
  id: number;
  metadata: CatalogItemV1;
}

function row(id: number, metadata: Omit<CatalogItemV1, 'msgId'>): Row {
  return { id, metadata: { msgId: id, ...metadata } };
}

const getMetadata = (r: Row) => r.metadata;

describe('flattenMetadataTree', () => {
  it('phim lẻ ra đúng một dòng "movie", không có header nào', () => {
    const rows = [row(1, { title: 'Inception' }), row(2, { title: 'Dune' })];
    const result = flattenMetadataTree(rows, getMetadata, new Set());
    expect(result).toEqual([
      { kind: 'movie', row: rows[1] }, // "Dune" < "Inception"
      { kind: 'movie', row: rows[0] }
    ]);
  });

  it('phim bộ nhóm theo series.name > season, đúng thứ tự tăng dần', () => {
    const rows = [
      row(1, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 2 } }),
      row(2, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 1 } }),
      row(3, { kind: 'episode', series: { name: 'Breaking Bad', season: 2, episode: 1 } })
    ];
    const result = flattenMetadataTree(rows, getMetadata, new Set());
    expect(result).toEqual([
      { kind: 'series-header', seriesName: 'Breaking Bad', episodeCount: 3, collapsed: false },
      { kind: 'season-header', seriesName: 'Breaking Bad', season: 1, episodeCount: 2, collapsed: false },
      { kind: 'episode', row: rows[1] }, // episode 1 trước episode 2
      { kind: 'episode', row: rows[0] },
      { kind: 'season-header', seriesName: 'Breaking Bad', season: 2, episodeCount: 1, collapsed: false },
      { kind: 'episode', row: rows[2] }
    ]);
  });

  it('nhóm cấp cao nhất (phim lẻ + tên series) xen kẽ alphabet, không tách khối', () => {
    const rows = [
      row(1, { title: 'Zootopia' }),
      row(2, { kind: 'episode', series: { name: 'Avatar: The Last Airbender', season: 1, episode: 1 } }),
      row(3, { title: 'Amélie' })
    ];
    const result = flattenMetadataTree(rows, getMetadata, new Set());
    const topLevelNames = result
      .filter((r) => r.kind === 'movie' || r.kind === 'series-header')
      .map((r) => (r.kind === 'movie' ? getMetadata(r.row).title : r.kind === 'series-header' ? r.seriesName : null));
    expect(topLevelNames).toEqual(['Amélie', 'Avatar: The Last Airbender', 'Zootopia']);
  });

  it('series/season đang collapsed thì không sinh dòng con nào', () => {
    const rows = [row(1, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 1 } })];
    const result = flattenMetadataTree(rows, getMetadata, new Set([seriesGroupKey('Breaking Bad')]));
    expect(result).toEqual([{ kind: 'series-header', seriesName: 'Breaking Bad', episodeCount: 1, collapsed: true }]);
  });

  it('season đang collapsed thì ẩn episode nhưng series header vẫn hiện', () => {
    const rows = [row(1, { kind: 'episode', series: { name: 'Breaking Bad', season: 1, episode: 1 } })];
    const result = flattenMetadataTree(rows, getMetadata, new Set([seasonGroupKey('Breaking Bad', 1)]));
    expect(result).toEqual([
      { kind: 'series-header', seriesName: 'Breaking Bad', episodeCount: 1, collapsed: false },
      { kind: 'season-header', seriesName: 'Breaking Bad', season: 1, episodeCount: 1, collapsed: true }
    ]);
  });

  it('series.name rỗng/thiếu gộp vào nhóm "(Không tên)", không tạo nhiều nhóm rỗng', () => {
    const rows = [
      row(1, { kind: 'episode', series: { name: '', season: 1, episode: 1 } }),
      row(2, { kind: 'episode', series: { name: '', season: 1, episode: 2 } })
    ];
    const result = flattenMetadataTree(rows, getMetadata, new Set());
    expect(result[0]).toEqual({ kind: 'series-header', seriesName: '(Không tên)', episodeCount: 2, collapsed: false });
  });

  it('season/episode không rõ số rơi xuống cuối', () => {
    const rows = [
      row(1, { kind: 'episode', series: { name: 'Show', season: 1, episode: 1 } }),
      row(2, { kind: 'episode', series: { name: 'Show', season: undefined, episode: undefined } }),
      row(3, { kind: 'episode', series: { name: 'Show', season: 2, episode: 1 } })
    ];
    const result = flattenMetadataTree(rows, getMetadata, new Set());
    const seasons = result.filter((r) => r.kind === 'season-header').map((r) => (r.kind === 'season-header' ? r.season : null));
    expect(seasons).toEqual([1, 2, undefined]);
  });

  it('mảng rỗng trả về mảng rỗng', () => {
    expect(flattenMetadataTree([], getMetadata, new Set())).toEqual([]);
  });
});
