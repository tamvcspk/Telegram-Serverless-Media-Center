# Nhật ký triển khai (Changelog)

> **Cách dùng tài liệu này:** lịch sử những gì đã CHẠY THẬT, theo mốc ngày/slice, mới nhất ở trên. Đây **không phải** nơi ghi việc sẽ làm (→ [docs/roadmap.md](./roadmap.md)) hay bài học/gotcha (→ [docs/lessons.md](./lessons.md)). Chi tiết kỹ thuật đầy đủ của mỗi phát hiện nằm ở addendum ADR tương ứng — mục dưới đây chỉ tóm tắt 1–2 dòng rồi trỏ sang, không thuật lại.
>
> **Cách cập nhật:** sau khi đóng một slice (thường đi kèm commit "Doc sync: đóng slice ..."), thêm 1 mục mới lên đầu danh sách dưới.

## 2026-08-30 — `tsmc-ingest` CLI — re-verify bản vá `series.name` bằng tài khoản thật — ĐẠT

Upload thêm file thứ ba cùng series (`S01E08.mkv`, chọn "kế thừa") sau khi build lại CLI với bản vá `series.name` (xem mục ngay dưới cùng ngày) — `catalog.v1.json` thật ra đúng `series.name: "The big bang theory"` (khớp title), không còn lỗi ra chuỗi filename trần trụi. Catalog vẫn gộp đủ 5 item qua nhiều lần publish liên tiếp. Đóng nốt mục "Còn thiếu" cuối cùng của lần verify Hạng C — checklist đã gỡ ở [docs/pending-device-tests.md](./pending-device-tests.md#tsmc-ingest-cli--loginprobeupload-thật-2026-08-29). Chi tiết: [ADR-0013 § Cập nhật 2026-08-30, re-verify series.name — ĐẠT](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-re-verify-bản-vá-seriesname-bằng-tài-khoản-thật--đạt).

## 2026-08-30 — `tsmc-ingest` CLI — nối dây subtitle upload + mở SPIKE-09 (native Rust FFmpeg binding)

Phụ đề text (`.srt`) rút ra bằng `extractSubtitles()` (Hạng C) giờ được upload thành document rời (`uploadSubtitleDocument()` mới, `libs/core-mtproto/src/gateway-ingest.ts`, `forceDocument: true`) và ghi vào `subs: [{ lang, msgId }]` của catalog item — trước đây chỉ lưu cục bộ rồi bỏ. Phụ đề ảnh (`.sup`, PGS) vẫn giữ nguyên hành vi cũ (chỉ lưu cục bộ). Brainstorm cùng ngày quyết định hoãn có chủ đích việc verify Hạng A/B/D bằng file mẫu thật (biến thể của cùng cơ chế đã verify ở Hạng C) để ưu tiên gap này. `npm run lint`/`tsc --noEmit`/`npm run test:libs` (283/283)/`npm run build:ingest` đều sạch — CHƯA verify upload subtitle thật bằng tài khoản Telegram, checklist ở [docs/pending-device-tests.md](./pending-device-tests.md#tsmc-ingest-cli--loginprobeupload-thật-2026-08-29). Chi tiết: [ADR-0013 § Cập nhật 2026-08-30, nối dây subtitle upload](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-nối-dây-subtitle-upload--phụ-đề-text-không-còn-bị-bỏ-phí).

Cũng mở [SPIKE-09](./spikes/README.md#spike-09) (chưa dựng): thử nghiệm `ffmpeg-next` (native Rust FFI) có đáng thay thế shell-out `ffmpeg`/`ffprobe` hiện tại cho một core lib Tauri tương lai không — theo yêu cầu user "thử trước, đánh giá sau", có fallback rõ ràng về shell-out nếu native không đáng công sức. Quyết định "có xây Tauri GUI hay không" vẫn để ngỏ như ADR-0013 gốc, spike này chỉ trả lời câu hỏi cơ chế gọi FFmpeg.

## 2026-08-30 — `tsmc-ingest` CLI — verify Hạng C bằng tài khoản/kênh thật lần đầu

`probe`/`upload` chạy thật trên file MKV/H.264/AC3 thật (kênh `tsmc_mediacenter`): phân hạng đúng Hạng C, remux (copy video + encode audio AAC) qua ffmpeg thật (~33s/~22 phút nội dung, 40.8x), prompt metadata hoạt động, upload thành công (`msgId 3`), `compat` suy đúng "full" sau remux, `catalog.v1.json` ghim đúng — xác nhận bằng Telegram app thật. Cũng sửa hai bug lộ ra khi chạy thật lần đầu (không phải unit test bắt được): CLI treo vô thời hạn sau khi xong việc (GramJS giữ kết nối MTProto mở, event loop Node không tự rỗng — `cli.ts` giờ `process.exit()` khi `main()` xong), và thêm đọc `TSMC_PHONE_NUMBER` tuỳ chọn từ `.env` để bỏ qua prompt số điện thoại lúc test lặp lại. Test tiếp file thứ hai cùng series (`S01E02`) xác nhận kế thừa season/episode + gộp catalog (3 item, không mất item cũ) đều đúng — nhưng lộ bug thật: `series.name` bị ghi đè bằng chuỗi tên file trần trụi (`"S01E02.mp4"`) thay vì tên phim, do `inheritMetadata()` lấy nguyên `series` từ file mới thay vì chỉ lấy season/episode, cộng với việc sửa Title qua prompt không đồng bộ lại `series.name`. Đã vá cả hai chỗ + thêm 2 unit test tái hiện bug (282/282 qua) — CHƯA re-verify bản vá bằng tài khoản thật. Còn thiếu: mẫu Hạng A/B/D thật, re-verify kế thừa metadata sau vá — checklist ở [docs/pending-device-tests.md](./pending-device-tests.md#kết-quả-verify-2026-08-30-hạng-c-lần-đầu-tiên-trên-tài-khoảnkênh-thật).

## 2026-08-29 — `tsmc-ingest` CLI (ADR-0013 mục 1) — lần code đầu tiên

CLI mới `apps/tsmc-ingest` (Node, esbuild → `dist/cli.js`): `login` (phone/2FA qua terminal), `probe <file...>` (ffprobe + phân hạng A/B/C/D, dry run), `upload --channel <ref> <file...>` (probe → remux/re-encode → thumbnail → metadata kế thừa từ tập trước cùng series → upload → publish `catalog.json` một lần/batch). Logic thuần (phân hạng, kế thừa metadata, gộp catalog) ở lib mới `libs/core-ingest`, test bằng fixture — không cần ffprobe/ffmpeg thật lúc `test:libs`. `libs/core-mtproto` thêm `gateway-ingest.ts` (`uploadVideoDocument()`, việc mới duy nhất — `publishCatalogDocument()` tái dùng nguyên vẹn) và tách `SessionStoragePort` khỏi Dexie để CLI tự lưu session mã hoá ở `~/.tsmc-ingest/session.local.json`. Đã verify lint/tsc/test:libs (280/280)/build CLI thật; CHƯA verify login/probe/upload bằng tài khoản Telegram + ffmpeg thật — checklist ở [docs/pending-device-tests.md](./pending-device-tests.md#tsmc-ingest-cli--loginprobeupload-thật-2026-08-29). Chi tiết phát hiện lúc code (esbuild bundle Node, key extractable...): [ADR-0013 § Cập nhật 2026-08-29, lần code đầu tiên](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-29-tsmc-ingest-cli--lần-code-đầu-tiên).

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
