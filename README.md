# Telegram Serverless Media Center (TSMC)

Media center chạy **hoàn toàn trong trình duyệt**. Telegram đóng vai identity provider, kho lưu trữ, CDN và cơ sở dữ liệu đồng bộ. Không backend, không chi phí băng thông.

> ⚠️ **Trạng thái: giai đoạn kiến trúc.** Chưa có ứng dụng chạy được. Repo hiện chứa 16 ADR, 5 spike (3 đã đóng bằng số liệu thật), một bàn thử nghiệm streaming đã deploy, và bộ công cụ kiểm tra tài liệu.

## Bắt đầu từ đâu

| Bạn muốn | Đọc |
|---|---|
| Hiểu tổng thể trong 5 phút | [docs/architecture.md](docs/architecture.md) |
| Hiểu **vì sao** mọi thứ được quyết như vậy | [docs/adr/](docs/adr/) — 16 ADR |
| Biết cái gì còn chưa chắc chắn | [docs/spikes/](docs/spikes/) |
| Đăng catalog cho kênh của mình | [docs/catalog-spec.md](docs/catalog-spec.md) |
| Đóng góp code / để Claude làm việc đúng luật | [CLAUDE.md](CLAUDE.md) |

## Cấu trúc repo

```text
apps/       ứng dụng (web) — chưa dựng
libs/       core-mtproto, core-download, core-index, core-sync, core-storage, shared-models — chưa dựng
spike/      bàn thử nghiệm SPIKE-01, static thuần, không phụ thuộc framework
tools/      docs-check, spike-runner, spike-02, spike-03 — đã có
            tsmc-ingest CLI, tsmc-bot — chưa dựng (ADR-0013)
docs/       architecture.md · adr/ · spikes/ · catalog-spec.md
.claude/    skills dùng chung cho contributor: /adr, /spike, /docs-check
```

Ranh giới phụ thuộc giữa `apps/` và `libs/` được quy định ở [ADR-0012](docs/adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md) và sẽ được ép bằng lint, không phải bằng thoả thuận miệng.

## Chạy bàn thử nghiệm

```bash
npm run spike            # http://localhost:5173 — localhost là secure context nên Service Worker chạy được
```

Muốn kiểm chứng trên iPhone/iPad thật (bắt buộc cho SPIKE-01) thì phải deploy — xem phần dưới.

## Deploy lên Firebase Hosting (Google Cloud free tier)

Theo [ADR-0015](docs/adr/0015-moi-truong-kiem-thu-firebase-hosting.md). Ba bước, làm một lần:

```bash
# 1. Tạo project tại https://console.firebase.google.com (gói Spark, miễn phí)
cp .firebaserc.example .firebaserc     # rồi điền project id vào

# 2. Đăng nhập (mở trình duyệt — phải do người thật làm)
npx --yes firebase-tools login

# 3. Deploy
npm run deploy:staging                 # → https://<project>.web.app
npm run deploy:spike                   # → URL preview riêng, tự hết hạn sau 7 ngày
```

Preview channel là thứ nên dùng khi thử spike: mỗi lần thử một URL riêng, mở thẳng trên điện thoại, không đụng vào bản chính.

## Nguyên tắc bất di bất dịch

1. **Không có thành phần server nào trong đường chạy của người xem** ([ADR-0001](docs/adr/0001-kien-truc-client-heavy-khong-backend.md)).
2. **Chỉ Core Worker được mở kết nối MTProto**; Service Worker chỉ là proxy giao thức ([ADR-0004](docs/adr/0004-mo-hinh-da-luong.md)).
3. **Không bao giờ chia sẻ kênh state**, không bao giờ ghi vào kênh media của người khác ([ADR-0014](docs/adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
4. **Không CDN bên thứ ba, không analytics, không crash reporting** — session MTProto trong trình duyệt là toàn quyền tài khoản Telegram của user ([ADR-0011](docs/adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)).
5. **Khả năng phát được quyết định ở lúc upload**, không phải lúc xem ([ADR-0013](docs/adr/0013-bot-dong-hanh-va-pipeline-ingest.md)).

## Yêu cầu với người dùng cuối

App dùng `API_ID`/`API_HASH` **do chính user tạo** tại [my.telegram.org](https://my.telegram.org). Dự án không nhúng credential của mình — lý do ở [ADR-0001](docs/adr/0001-kien-truc-client-heavy-khong-backend.md). Đây là điểm ma sát lớn nhất của onboarding và được chấp nhận một cách có ý thức.
