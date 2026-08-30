# Việc còn lại (Roadmap)

> **Cách dùng tài liệu này:** đây CHỈ là danh sách việc **sẽ làm** — gap còn thiếu so với 7 màn hình + hạ tầng. Việc đã xong → xem [docs/changelog.md](./changelog.md). Tại sao một giới hạn tồn tại (quyết định kiến trúc, đánh đổi đã chấp nhận) → xem ADR liên quan, không lặp lại rationale ở đây. Bài học kỹ thuật đã trả giá bằng debug thật → [docs/lessons.md](./lessons.md).
>
> **Nhãn trạng thái:** `[Chưa bắt đầu]` — chưa ai làm. `[Hoãn có chủ đích]` — đã quyết định hoãn, có lý do ghi rõ. `[Cần kiểm chứng thiết bị thật]` — code đã viết nhưng chưa có traffic/thiết bị thật xác nhận đúng.
>
> **Cách cập nhật:** khi bắt đầu làm một mục, xoá khỏi danh sách này và thêm mục mới vào [docs/changelog.md](./changelog.md) khi xong. Khi một slice mới phát hiện gap mới, thêm 1 dòng vào đúng nhóm bên dưới.

## UI theo từng màn hình

- **Browse (Màn hình 2):** filter Tất cả/Cá nhân/Cộng đồng — cần thêm field phân loại vào `SourceRef` ở tầng dữ liệu trước khi UI khớp được. `[Chưa bắt đầu]`
- **Browse → Collections:** tạo bộ sưu tập mới trực tiếp từ Browse (hiện phải qua tab BST trước). `[Chưa bắt đầu]`
- **Collections (Màn hình 3):** phân biệt `NO_ACCESS` (mất quyền truy cập, cho "Tham gia lại") vs `DELETED` (đã xoá file, cho "Gỡ khỏi BST") — cần bắt lỗi tầng MTProto. `[Hoãn có chủ đích]`
- **Sources (Màn hình 4):** `scanSource()` báo tiến trình theo số (vd "Đang nạp 1500/5000 tin") — cần job nền resumable, hiện chỉ có `MatProgressBar` indeterminate. `[Chưa bắt đầu]`
- **Sources:** `SyncStatus` (công cụ debug outbox) cần một chỗ đàng hoàng hơn, hiện tạm host cuối trang `home/sources`. `[Chưa bắt đầu]`
- **Ingest Editor (Màn hình 6):** lọc quyền ghi trước khi hiện icon ✏️ ở mỗi row Browse (hiện hiện ở MỌI row, kiểm tra quyền diễn ra ở đích đến). `[Hoãn có chủ đích]`
- **Ingest Editor:** retry/rollback khi `FLOOD_WAIT` rơi giữa chuỗi 3 RPC ghi liên tiếp của `publishCatalogDocument()` (`sendFile → pinMessage → deleteMessages`). Xem [ADR-0014 addendum, SPIKE-06](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md#cập-nhật-sau-khi-accepted-2026-08-28-spike-06). `[Chưa bắt đầu]`
- **Poster ảnh thật:** pipeline tải Telegram Photo (khác Document/video đã có) để thay placeholder gradient ở Browse/Collections — ngoài phạm vi F4, cần thiết kế riêng (tải ảnh lúc duyệt danh sách lớn dễ dính `FLOOD_WAIT`). `[Chưa bắt đầu]`

## Ingest

- **`tsmc-ingest` CLI (ADR-0013 mục 1) — verify Hạng C thật (2026-08-30) + subtitle upload đã nối dây (2026-08-30, chưa verify thiết bị thật).** `apps/tsmc-ingest` + `libs/core-ingest` (phân hạng A/B/C/D, kế thừa metadata theo series, gộp catalog) + `libs/core-mtproto/src/gateway-ingest.ts` (`uploadVideoDocument()`, `uploadSubtitleDocument()`). Pipeline: probe (`ffprobe` cục bộ) → phân hạng → remux/re-encode nếu cần → rút + upload phụ đề text → thumbnail → metadata (kế thừa từ tập trước cùng series) → upload → gộp + publish `catalog.json` một lần/batch. Chi tiết: [ADR-0013 § Cập nhật 2026-08-30, nối dây subtitle upload](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-nối-dây-subtitle-upload--phụ-đề-text-không-còn-bị-bỏ-phí). Còn thiếu (checklist ở [docs/pending-device-tests.md](./pending-device-tests.md)): verify subtitle upload bằng tài khoản thật; đối chiếu ngưỡng phân hạng A/B/C/D với file mẫu thật — **hoãn có chủ đích** (brainstorm 2026-08-30: cả ba hạng chỉ là biến thể của cùng cơ chế remux đã verify ở Hạng C). Hướng core lib Rust bọc FFmpeg (native FFI qua `ffmpeg-next`, cho một Tauri GUI tương lai) đang thử nghiệm ở spike mới — xem [SPIKE-09](./spikes/README.md#spike-09). `@tsmc_bot` (mục 2) và quyết định GUI Tauri vẫn để ngỏ, ngoài phạm vi CLI này. `[Cần kiểm chứng thiết bị thật]`

## Index / quét nguồn

- **Hashtag/Forum topic làm tín hiệu index (đã code 2026-08-29):** hashtag làm tín hiệu suy luận metadata + Forum Topic làm category — cả hai đã code, xem [docs/changelog.md](./changelog.md#2026-08-29--index-category-theo-forum-topic--hashtag-làm-tín-hiệu-fallback). Còn thiếu: verify bằng kênh Forum + hashtag thật trên thiết bị thật (unit test dùng fake gateway) — checklist chi tiết ở [docs/pending-device-tests.md](./pending-device-tests.md#index-forum-topic-category--hashtag-fallback-2026-08-29). `[Cần kiểm chứng thiết bị thật]`

## Sync & dữ liệu

- **Kênh state riêng:** `publishSnapshot()` chưa được xác nhận trên thiết bị thật riêng (khác kênh test dùng cho SPIKE-06). Xem [ADR-0009 addendum, 2026-08-24](./adr/0009-dong-bo-state-event-log-va-snapshot.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-sync-f12f13). `[Cần kiểm chứng thiết bị thật]`
- **Kênh state riêng:** nén snapshot (>200 event hoặc snapshot >7 ngày) và gộp nhiều kênh state — xem [ADR-0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) — chưa tự phát sinh trong một lần dùng bình thường nên chưa qua kiểm chứng thiết bị thật. `[Cần kiểm chứng thiết bị thật]`
- **Kênh state riêng — nén định kỳ có thể cấu hình + vá trần phân trang khi hydrate:** brainstorm 2026-08-29 (chưa viết ADR addendum, chỉ ghi nhận ở roadmap). Một ràng buộc kiến trúc (mục 1) + ba việc nên làm cùng lúc (mục 2-4):
  1. **KHÔNG dùng bot** cho việc này — kênh state là 1-đổi-1 riêng tư tuyệt đối, cấm thêm bất kỳ thành viên nào kể cả bot (CLAUDE.md bất biến #5, [ADR-0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)) — khác hẳn kênh media, nơi `@tsmc_bot` ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md)) làm admin được vì kênh đó vốn multi-user. Cũng không thể chạy như một cron server-side (ADR-0001: không thành phần server nào trong đường chạy, kể cả bảo trì) — cách duy nhất khả thi trong kiến trúc này là compaction cơ hội (opportunistic) ngay trong app, chạy bởi chính session MTProto của user, mỗi khi tab leader hoạt động — đúng cơ chế `maybeCompact()` đã có, không có cách "chạy hộ" nào khác.
  2. **Đưa ngưỡng `COMPACTION_MAX_SNAPSHOT_AGE_MS`** (`libs/core-sync/src/compaction.ts`, hiện hardcode 7 ngày) **thành cấu hình được ở Settings** (ví dụ mặc định 7 ngày như ADR-0009 gốc, cho phép chỉnh, ví dụ 30 ngày) — đổi **giá trị mặc định** khỏi 7 ngày là sửa tham số của Quyết định đã Accepted ở ADR-0009, cần addendum khi thực sự code, không chỉ sửa số; còn lại (thêm khả năng cấu hình, giữ mặc định 7 ngày) không đụng nội dung Quyết định gốc. Ngưỡng >200 event vẫn giữ làm lưới an toàn cứng — không đổi, không cấu hình được, đảm bảo dùng nặng vẫn nén dù chưa tới hạn ngày.
  3. **Phát hiện một trần ẩn khi hydrate — quan trọng hơn cả việc cấu hình:** `fetchEventsSince()` (`libs/core-mtproto/src/gateway-sync.ts:128`) gọi `getMessages({..., limit: FETCH_EVENTS_PAGE_LIMIT })` với `FETCH_EVENTS_PAGE_LIMIT = 500`, **một trang duy nhất, không có vòng lặp phân trang**. Compaction bình thường giữ event luôn dưới ~200 nên 500 dư dả — nhưng nếu compaction KHÔNG chạy đủ lâu (đúng kịch bản "không dọn định kỳ" mà mục này lo ngại) và số event vượt 500, một lần **hydrate mới** (thiết bị mới, hoặc app dọn IndexedDB) sẽ **âm thầm chỉ replay 500 event đầu, bỏ sót phần còn lại** — đây mới là cách thật state có thể "mất" (không phải Telegram xoá gì — event vẫn còn nguyên trên kênh, chỉ là code không đọc hết). Cần: hoặc `fetchEventsSince()` tự lặp gọi `getMessages` tới khi hết, hoặc `hydrate()` phát hiện đã chạm đúng `FETCH_EVENTS_PAGE_LIMIT` (dấu hiệu "có thể còn dữ liệu") và gọi tiếp — không được coi một trang là đủ.
  4. Thêm chỉ báo ở Settings: "state chưa nén trong N ngày" (đã gợi ý sẵn ở [ADR-0009 Hệ quả](./adr/0009-dong-bo-state-event-log-va-snapshot.md#hệ-quả) — "thêm chỉ báo tình trạng đồng bộ trong Cài đặt", chưa làm) — khác `SyncStatus` debug tool ở mục Sources bên trên (đó là công cụ dev, đây là tín hiệu cho user thường). Cùng chỗ đặt UI cấu hình ngưỡng ở mục 2.

  `[Chưa bắt đầu]`

## Download / hardening

- **CDN_REDIRECT:** code đã viết theo đặc tả TL (AES-CTR qua WebCrypto + verify SHA-256, `libs/core-mtproto/src/gateway-download.ts`) nhưng chưa từng gặp traffic thật (SPIKE-02 vẫn 0/250 lần). Không có cách chủ động kích hoạt mà không tạo tải giả lên hạ tầng Telegram. Xem [docs/architecture.md §7](./architecture.md#7-rủi-ro-lớn-nhất--trạng-thái-kiểm-chứng). `[Cần kiểm chứng thiết bị thật]`
- **Trần song song 8:** rủi ro `FLOOD_WAIT` ở mức tải cao nhất mới có Settings UI (2026-08-28) — hiện chỉ có unit test với fake gateway, chưa có traffic thật kiểm chứng. `[Cần kiểm chứng thiết bị thật]`
- **Scheduler ưu tiên P0–P3** (ADR-0006 §2, "known gap") — cần tính năng prefetch đa video trước, app hiện chưa có tính năng đó nên chưa tới lượt làm. `[Chưa bắt đầu]`
