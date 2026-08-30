// Kế thừa metadata từ tập trước cùng series — ADR-0013 § Cập nhật
// 2026-08-29: nỗi đau gõ tay đã xác nhận là CÓ THẬT (user tự trải nghiệm),
// nên thiết kế UX kế thừa phải có ngay từ v1 của CLI, không đợi GUI.
//
// Tái dùng `parseFilenameFallback()` (libs/core-index/src/filename-parser.ts)
// để suy season/episode từ TÊN FILE MỚI — season/episode LUÔN lấy từ file
// đang xử lý (mỗi tập một số khác nhau), KHÔNG copy nguyên từ item trước.
// Mọi field khác (title/genres/cast/director/year/topic...) copy nguyên vẹn
// từ item liền trước trong cùng series — admin sửa đè ở lớp CLI nếu cần,
// hàm ở đây chỉ tính giá trị SEED, không có I/O/prompt nào.
import { parseFilenameFallback } from '@tsmc/core-index';
import type { CatalogItemV1 } from '@tsmc/shared-models';

/** Item đầu tiên của một series (hoặc file đứng một mình) — seed thuần từ tên file, không có gì để kế thừa. */
export function seedMetadataFromFilename(msgId: number, fileName: string): CatalogItemV1 {
  return parseFilenameFallback(msgId, fileName);
}

/**
 * Item kế tiếp trong cùng series — kế thừa toàn bộ field từ `previous`, chỉ
 * ghi đè `msgId` (bắt buộc đổi, đây là message MỚI) và `season`/`episode`
 * theo TÊN FILE MỚI (mỗi tập một số khác nhau). `series.name` LUÔN kế thừa
 * từ `previous` (tên phim/series không đổi giữa các tập) — KHÔNG lấy
 * `series.name` từ `parseFilenameFallback()` của file mới, vì tên file
 * nhiều khi CHỈ có `SxxExx` (vd "S01E02.mp4") không mang tên phim nào —
 * dùng thẳng phần đó làm `series.name` sẽ ghi đè mất tên phim thật đã nhập ở
 * item trước bằng chuỗi filename vô nghĩa. Phát hiện thật (2026-08-30, chạy
 * tài khoản thật): catalog thật cho thấy đúng lỗi này — `series.name` ra
 * `"S01E02.mp4"` thay vì tên phim.
 *
 * Nếu tên file mới không khớp được season/episode nào (regex không match),
 * giữ nguyên `series` của `previous` — KHÔNG tự đoán tăng season/episode +1
 * một cách mù quáng, vì file có thể không thực sự cùng series dù admin bấm
 * "kế thừa" (vd file dọn dẹp/trailer chen giữa) — để admin tự sửa tay ở lớp
 * CLI.
 */
export function inheritMetadata(msgId: number, fileName: string, previous: CatalogItemV1): CatalogItemV1 {
  const seeded = parseFilenameFallback(msgId, fileName);
  const seriesName = previous.series?.name ?? previous.title ?? seeded.series?.name;
  const series = seeded.series && seriesName !== undefined ? { ...seeded.series, name: seriesName } : (seeded.series ?? previous.series);

  return {
    ...previous,
    msgId,
    series,
    kind: seeded.series ? 'episode' : previous.kind
  };
}
