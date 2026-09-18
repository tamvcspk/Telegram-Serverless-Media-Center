// Nhóm bảng metadata thành dạng cây (brainstorm 2026-09-18) — phim lẻ MỘT
// dòng, phim bộ nhóm theo `series.name` > `season` > dòng tập. Hàm thuần,
// KHÔNG đụng CDK/virtual-scroll — tầng gọi (`workspace.ts`/`catalog-manager.ts`)
// tự feed mảng phẳng trả về vào `cdk-virtual-scroll-viewport` đã có sẵn
// (repo cố ý không dùng `MatTree`/`mat-table` — xem comment đầu file các màn
// đó — nên cây ở đây là MỘT MẢNG PHẲNG có discriminant `kind`, không phải
// cấu trúc lồng nhau thật, để giữ nguyên khả năng virtual scroll với
// `itemSize` cố định).
//
// Generic theo `T` (khác nhau giữa hai màn: `QueueItem` ở Workspace bọc
// `CatalogItemV1` trong field `metadata`, còn Catalog Manager dùng thẳng
// `CatalogItemV1`) — tầng gọi truyền `getMetadata` để hàm này không cần biết
// shape cụ thể của `T`.
import type { CatalogItemV1 } from '@tsmc/shared-models';

const UNNAMED_SERIES = '(Không tên)';

export type FlatMetadataRow<T> =
  | { kind: 'movie'; row: T }
  | { kind: 'series-header'; seriesName: string; episodeCount: number; collapsed: boolean }
  | { kind: 'season-header'; seriesName: string; season: number | undefined; episodeCount: number; collapsed: boolean }
  | { kind: 'episode'; row: T };

/** Khoá nhóm dùng cho tập `collapsedGroups` (Set<string>, sở hữu bởi tầng
 * gọi — collapse là UI state, không phải dữ liệu). */
export function seriesGroupKey(seriesName: string): string {
  return `series:${seriesName}`;
}

export function seasonGroupKey(seriesName: string, season: number | undefined): string {
  return `series:${seriesName}:season:${season ?? 'unknown'}`;
}

/**
 * Phẳng hoá `rows` thành cây hiển thị — phim lẻ (`kind !== 'episode'`) ra
 * MỘT dòng `{ kind: 'movie' }`; phim bộ (`kind === 'episode'`) gộp theo
 * `series.name` (rỗng/không có → nhóm `"(Không tên)"`, tránh nhiều nhóm rỗng
 * trộn lẫn), rồi theo `season` (không có → nhóm cuối "không rõ season").
 *
 * Sắp xếp: nhóm CẤP CAO NHẤT (phim lẻ VÀ tên series) xen kẽ alphabet theo
 * tên (không tách khối phim-lẻ-trước/phim-bộ-sau) — dễ tìm theo tên hơn.
 * Season tăng dần, season không rõ ở cuối. Episode tăng dần, episode không
 * rõ ở cuối.
 *
 * KHÔNG kèm dòng header cho nhóm đang collapsed con của nó (season-header/
 * episode ẩn khi series đang collapsed; episode ẩn khi season đang
 * collapsed) — tầng gọi chỉ cần lặp thẳng qua mảng trả về, không cần tự
 * kiểm tra `collapsed` thêm lần nữa.
 */
export function flattenMetadataTree<T>(rows: T[], getMetadata: (row: T) => CatalogItemV1, collapsedGroups: ReadonlySet<string>): FlatMetadataRow<T>[] {
  interface SeriesGroup {
    name: string;
    rows: T[];
  }

  const movies: T[] = [];
  const seriesGroups = new Map<string, SeriesGroup>();

  for (const row of rows) {
    const meta = getMetadata(row);
    if (meta.kind !== 'episode') {
      movies.push(row);
      continue;
    }
    const name = meta.series?.name?.trim() || UNNAMED_SERIES;
    let group = seriesGroups.get(name);
    if (!group) {
      group = { name, rows: [] };
      seriesGroups.set(name, group);
    }
    group.rows.push(row);
  }

  type TopLevelEntry = { sortKey: string } & ({ type: 'movie'; row: T } | { type: 'series'; group: SeriesGroup });
  const topLevel: TopLevelEntry[] = [
    ...movies.map((row): TopLevelEntry => ({ type: 'movie', row, sortKey: getMetadata(row).title ?? '' })),
    ...[...seriesGroups.values()].map((group): TopLevelEntry => ({ type: 'series', group, sortKey: group.name }))
  ];
  topLevel.sort((a, b) => a.sortKey.localeCompare(b.sortKey, undefined, { sensitivity: 'base' }));

  const result: FlatMetadataRow<T>[] = [];
  for (const entry of topLevel) {
    if (entry.type === 'movie') {
      result.push({ kind: 'movie', row: entry.row });
      continue;
    }

    const { name, rows: seriesRows } = entry.group;
    const collapsed = collapsedGroups.has(seriesGroupKey(name));
    result.push({ kind: 'series-header', seriesName: name, episodeCount: seriesRows.length, collapsed });
    if (collapsed) {
      continue;
    }

    const seasonGroups = new Map<number | undefined, T[]>();
    for (const row of seriesRows) {
      const season = getMetadata(row).series?.season;
      const list = seasonGroups.get(season);
      if (list) {
        list.push(row);
      } else {
        seasonGroups.set(season, [row]);
      }
    }
    const sortedSeasons = [...seasonGroups.entries()].sort(([a], [b]) => {
      if (a === undefined) return b === undefined ? 0 : 1;
      if (b === undefined) return -1;
      return a - b;
    });

    for (const [season, seasonRows] of sortedSeasons) {
      const seasonCollapsed = collapsedGroups.has(seasonGroupKey(name, season));
      result.push({ kind: 'season-header', seriesName: name, season, episodeCount: seasonRows.length, collapsed: seasonCollapsed });
      if (seasonCollapsed) {
        continue;
      }
      const sortedEpisodes = [...seasonRows].sort((a, b) => {
        const ea = getMetadata(a).series?.episode;
        const eb = getMetadata(b).series?.episode;
        if (ea === undefined) return eb === undefined ? 0 : 1;
        if (eb === undefined) return -1;
        return ea - eb;
      });
      for (const row of sortedEpisodes) {
        result.push({ kind: 'episode', row });
      }
    }
  }

  return result;
}
