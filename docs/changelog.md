# Nhật ký triển khai (Changelog)

> **Cách dùng tài liệu này:** lịch sử những gì đã CHẠY THẬT, theo mốc ngày/slice, mới nhất ở trên. Đây **không phải** nơi ghi việc sẽ làm (→ [docs/roadmap.md](./roadmap.md)) hay bài học/gotcha (→ [docs/lessons.md](./lessons.md)). Chi tiết kỹ thuật đầy đủ của mỗi phát hiện nằm ở addendum ADR tương ứng — mục dưới đây chỉ tóm tắt 1–2 dòng rồi trỏ sang, không thuật lại.
>
> **Cách cập nhật:** sau khi đóng một slice (thường đi kèm commit "Doc sync: đóng slice ..."), thêm 1 mục mới lên đầu danh sách dưới.

## 2026-08-29 — Index: category theo Forum Topic + hashtag làm tín hiệu fallback

Quét lịch sử (T2/T3) giờ suy ra `topic` (tên Forum Topic, `channels.GetForumTopics`, cache 1h/kênh — file mới `libs/core-index/src/forum-topics.ts`) và hợp nhất hashtag (`message.entities`) với fallback tên file (file mới `libs/core-index/src/hashtag-parser.ts`, tách khỏi `parseFilenameFallback()` cũ) — hashtag ưu tiên trước filename cho season/episode, filename luôn thắng cho title, hashtag lạ gộp vào `genres`. `docs/catalog-spec.md` cập nhật field `topic` mới. Chưa verify bằng kênh Forum thật (khác SPIKE-07 vốn verify bằng script test riêng) — chi tiết: [ADR-0010 § Cập nhật 2026-08-29](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md#cập-nhật-sau-khi-accepted-2026-08-29-spike-07--brainstorm-cải-thiện-quét-nguồn).

## 2026-08-29 — Redesign kiểu Netflix

Browse đổi từ list sang lưới card (CDK virtual scroll virtualize theo hàng), tap card mở `ItemDetailSheet`. Collections tách 2 tầng: danh sách tile (`home/collections`) → chi tiết một bộ sưu tập (`home/collections/:id`, route con mới). Sources: `AddSourceSheet` đổi từ toggle-mở-rộng-tại-chỗ sang 3 bước điều hướng trong cùng một sheet. Toolbar chung (`MainShell`) thay cho toolbar riêng của Browse. Chi tiết mockup/rationale từng màn: [docs/ux-design.md](./ux-design.md).

## 2026-08-28 — Ingest Editor (Màn hình 6) + SPIKE-06

Route `/metadata/:sourceId/:msgId`: sửa title/năm/compat rồi ghi đè `catalog.json` thật lên kênh media (`publishCatalogDocument()`), chỉ hợp lệ cho Kho Cá Nhân (`checkSourceWritable()`). SPIKE-06 đóng — kiểm chứng bằng tài khoản thật: publish lần đầu, publish-cập-nhật, đọc lại byte-chính-xác đều đạt; mã nguồn spike đã xoá sau khi đóng, số liệu giữ ở [docs/spikes/README.md](./spikes/README.md#spike-06). Chi tiết ranh giới quyền/rủi ro chưa kiểm chứng: [ADR-0014 addendum, 2026-08-28 SPIKE-06](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md#cập-nhật-sau-khi-accepted-2026-08-28-spike-06).

## 2026-08-28 — Settings (Màn hình 7) + Player (Màn hình 5)

Settings: khối Tài khoản (đăng xuất đúng Logout Journey — flush outbox → dừng timer → `auth.LogOut` → xoá IndexedDB, dừng ngay ở bước lỗi), Lưu trữ, Mạng (`setMaxConcurrency()` 4↔8), Debug. Chi tiết trần song song: [ADR-0006 addendum, 2026-08-28 slice Settings](./adr/0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-28-slice-settings--màn-hình-7). Player: `compat-warning-sheet.ts` chặn phát khi `compat` là `partial`/`unplayable`, `flood-wait-notice.ts` bắc cầu tín hiệu `FloodWaitTooLongError` sang `MatSnackBar`.

## 2026-08-28 — Browse/Collections/Sources mobile-first (Màn hình 2/3/4)

Browse: thanh tìm kiếm + chip lọc nguồn cố định trên cùng. Collections: CRUD thật (tạo/đổi tên/xoá, kéo-thả sắp xếp qua op `collection.reorder` mới). Sources: thẻ nguồn thật (tier/số phim/lỗi quét) + `AddSourceSheet` (`MatBottomSheet`, chặn dán ID thô theo ADR-0014 §1) + gỡ nguồn.

## 2026-08-27 — UI Login mobile-first (Màn hình 1) + skeleton routing

Banner cảnh báo + Vertical `MatStepper` theo đúng Màn hình 1. Route `login` (full-bleed) → `home` (gate qua `authGuard`, `MainShell` bottom nav tự ghép) → `player/...` (immersive). Phát hiện icon font ligature + MatStepper race: [ADR-0016 addendum, 2026-08-27](./adr/0016-angular-material-va-cdk.md#cập-nhật-sau-khi-accepted-2026-08-27-slice-ui-login).

## 2026-08-26 — Playback (F4) end-to-end + hardening

SW giả lập HTTP Range, tải chunk qua MTProto, phát video thật (tài khoản thật). Sau đó slice hardening bổ sung AIMD + circuit breaker theo DC + CDN redirect (AES-CTR + verify SHA-256). SPIKE-04 đóng (chấp nhận rủi ro — ~1.1 GB tải liên tục ở mức 4/8 request, 0 lần FLOOD_WAIT). Chi tiết: [ADR-0006 addendum, 2026-08-26 slice hardening](./adr/0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-hardening--aimd--circuit-breaker--cdn-redirect).

## 2026-08-26 — Browse (F3) end-to-end

Lưới duyệt phim (CDK virtual scroll dạng list), lọc theo nguồn, tìm kiếm MiniSearch chuẩn hoá tiếng Việt. Phát hiện field `fileName` không tồn tại trong data model thật: [ADR-0008 addendum, 2026-08-25](./adr/0008-tim-kiem-client-side-minisearch.md#cập-nhật-sau-khi-accepted-2026-08-25-slice-browse-f3).

## 2026-08-25 — Index (F2) end-to-end

3 tầng catalog/delta/full-scan. Phát hiện mô hình tin cậy phải đổi từ nhị phân sang phân tầng do giới hạn quyền thật của Telegram API: [ADR-0010 addendum, 2026-08-25](./adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md#cập-nhật-sau-khi-accepted-2026-08-25-slice-index-f2).

## 2026-08-24 — Sync & Hydration (F1.2/F1.3) end-to-end

Event log + snapshot, kênh state riêng tư, đồng bộ optimistic. Phát hiện Core Worker phải là singleton cấp tab: [ADR-0004 addendum, 2026-08-24](./adr/0004-mo-hinh-da-luong.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-sync-f12f13).

## 2026-08-24 — Auth (F1.1) end-to-end

`TelegramGateway.login` thật + màn đăng nhập. Vá GramJS chạy sai trong Worker (`randomBytes` vỡ + kết nối nhầm IP thô): [ADR-0003 addendum, 2026-08-24](./adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-auth-f11). SPIKE-01/02/03 đóng, mã nguồn xoá sau khi đóng (số liệu giữ ở [docs/spikes/README.md](./spikes/README.md)).

## 2026-08-24 — Dựng nền workspace

Scaffold workspace theo [ADR-0012](./adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md) (Nx-style monorepo, static PWA, `apps/web` không import `core-mtproto`/`core-download`).
