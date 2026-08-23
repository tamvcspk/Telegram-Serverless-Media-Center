# Architecture Decision Records (ADR)

Mỗi ADR ghi lại **một** quyết định kiến trúc: bối cảnh, các phương án đã cân nhắc, quyết định, và cái giá phải trả.

- Định dạng: [MADR](https://adr.github.io/madr/) rút gọn.
- Trạng thái: `Proposed` → `Accepted` → (`Deprecated` | `Superseded by ADR-XXXX`).
- **Không sửa** ADR đã `Accepted`. Muốn đổi ý → viết ADR mới và đánh dấu ADR cũ là `Superseded`.

| # | Quyết định | Trạng thái |
|---|-----------|-----------|
| [0001](./0001-kien-truc-client-heavy-khong-backend.md) | Kiến trúc Client-Heavy, không backend | Accepted |
| [0002](./0002-angular-zoneless-signals-va-signalstore.md) | Angular zoneless + Signals + NgRx SignalStore | Accepted |
| [0003](./0003-chon-thu-vien-mtproto-gramjs.md) | GramJS làm MTProto client | Accepted |
| [0004](./0004-mo-hinh-da-luong.md) | Mô hình đa luồng: Main / Core Worker / Service Worker | Accepted |
| [0005](./0005-streaming-qua-service-worker-http-range.md) | Streaming qua Service Worker + HTTP Range | Accepted |
| [0006](./0006-download-pipeline-dc-pool-flood-wait.md) | Download pipeline: DC pool, song song, FLOOD_WAIT | Accepted |
| [0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md) | Lưu trữ cục bộ: IndexedDB qua Dexie | Accepted |
| [0008](./0008-tim-kiem-client-side-minisearch.md) | Tìm kiếm client-side bằng MiniSearch | Accepted |
| [0009](./0009-dong-bo-state-event-log-va-snapshot.md) | Đồng bộ state: event log + snapshot compaction | Accepted |
| [0010](./0010-catalog-spec-v1-va-chien-luoc-indexing.md) | Catalog Spec v1 & chiến lược lập chỉ mục | Accepted |
| [0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) | Bảo mật session & nội dung không tin cậy | Accepted |
| [0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md) | Triển khai static PWA & cấu trúc workspace | Accepted |
| [0013](./0013-bot-dong-hanh-va-pipeline-ingest.md) | Bot đồng hành & pipeline ingest/chuẩn hoá media | Accepted |
| [0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) | Mô hình kênh: media dùng chung, state riêng tư | Accepted |
| [0015](./0015-moi-truong-kiem-thu-firebase-hosting.md) | Môi trường kiểm thử trên Google Cloud free tier | Accepted |
| [0016](./0016-angular-material-va-cdk.md) | Angular Material + CDK làm thư viện UI | Accepted |
