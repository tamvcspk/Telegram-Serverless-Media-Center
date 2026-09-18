// "Thêm vào series" / "Tạo series mới" (brainstorm 2026-09-18) — hàm thuần
// cho việc gán một hoặc nhiều item (đang là `kind !== 'episode'`, tức phim
// lẻ hoặc chưa phân loại) vào một series, có sẵn hoặc mới tạo.
import type { CatalogItemV1 } from '@tsmc/shared-models';

/** Danh sách tên series phân biệt, đã có trong `items` — nguồn cho picker
 * "Series có sẵn" (tránh gõ tay gây lệch chữ hoa/thường tạo nhóm trùng lặp
 * trong `flattenMetadataTree()`, vốn nhóm theo string CHÍNH XÁC). Sắp xếp
 * alphabet, bỏ tên rỗng/khoảng trắng. */
export function listSeriesNames(items: CatalogItemV1[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    const name = item.series?.name?.trim();
    if (item.kind === 'episode' && name) {
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/** Item ĐẦU TIÊN (theo thứ tự `items`) thuộc `seriesName` — dùng làm nguồn
 * "kế thừa" genres/cast/director khi thêm item khác vào series đã có sẵn.
 * `undefined` nếu series chưa tồn tại (series mới tạo — không có gì để kế
 * thừa). */
export function findRepresentativeEpisode(items: CatalogItemV1[], seriesName: string): CatalogItemV1 | undefined {
  return items.find((item) => item.kind === 'episode' && item.series?.name === seriesName);
}

/** Gợi ý season/episode kế tiếp cho MỘT item mới thêm vào series đã có sẵn —
 * season = season LỚN NHẤT đã dùng trong series đó (season mới hầu như luôn
 * là "còn tiếp tục season đang chiếu", không phải season 1), episode = số
 * tập LỚN NHẤT trong đúng season đó + 1. Series chưa có tập nào (mới tạo) →
 * `{ season: 1, episode: 1 }`, giá trị khởi đầu hợp lý nhất, không phải suy
 * luận gì đặc biệt. */
export function suggestNextEpisode(items: CatalogItemV1[], seriesName: string): { season: number; episode: number } {
  const episodesInSeries = items.filter((item) => item.kind === 'episode' && item.series?.name === seriesName);
  if (episodesInSeries.length === 0) {
    return { season: 1, episode: 1 };
  }
  const season = Math.max(...episodesInSeries.map((item) => item.series?.season ?? 1));
  const episodesInSeason = episodesInSeries.filter((item) => (item.series?.season ?? 1) === season);
  const maxEpisode = episodesInSeason.reduce((max, item) => Math.max(max, item.series?.episode ?? 0), 0);
  return { season, episode: maxEpisode + 1 };
}

/**
 * Gán `target` vào series — đổi `kind`/`series`, cộng KẾ THỪA CÓ CHỌN LỌC
 * `genres`/`cast`/`director` từ `inheritFrom` (item đại diện của series đã
 * có sẵn, `findRepresentativeEpisode()`) nếu được truyền vào. CỐ Ý không
 * đụng `title`/`year`/`msgId`/mọi field khác của `target` — khác
 * `inheritMetadata()` (kế thừa TOÀN BỘ, dùng cho "tập KẾ TIẾP của CÙNG MỘT
 * phim" lúc seed từ tên file tuần tự): ở đây `target` là MỘT PHIM LẺ CÓ SẴN
 * với tên/năm riêng của chính nó, chỉ genres/cast/director là thứ hợp lý
 * dùng chung giữa các tập cùng series, ghi đè tên phim của nó sẽ mất dữ
 * liệu thật. `inheritFrom` vắng mặt (series mới tạo, không có gì kế thừa) →
 * giữ nguyên genres/cast/director hiện có của `target`.
 */
export function assignToSeries(target: CatalogItemV1, seriesName: string, season: number, episode: number, inheritFrom?: CatalogItemV1): CatalogItemV1 {
  return {
    ...target,
    kind: 'episode',
    series: { name: seriesName, season, episode },
    genres: inheritFrom?.genres ?? target.genres,
    cast: inheritFrom?.cast ?? target.cast,
    director: inheritFrom?.director ?? target.director
  };
}
