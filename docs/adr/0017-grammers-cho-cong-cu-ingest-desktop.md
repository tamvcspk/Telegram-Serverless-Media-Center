# ADR-0017: `grammers` làm MTProto library cho công cụ ingest desktop (Tauri)

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-07
- **Liên quan:** [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md), [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md), [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md), [ADR-0014](./0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) (addendum 2026-09-17 — ingest-desktop là nơi duy nhất cho biên tập catalog nâng cao, Ingest Editor web app đóng băng ở field đơn giản), [ADR-0018](./0018-task-id-lam-khoa-tuong-quan-ipc-ingest-desktop.md), [ADR-0019](./0019-tich-hop-tra-cuu-tmdb-o-buoc-draft.md) (chốt hướng tra cứu TMDB, gỡ "để ngỏ"), [ADR-0020](./0020-ma-hoa-bi-mat-app-data-qua-os-keyring.md) (mã hoá `credentials.json` qua OS keyring), [ADR-0021](./0021-ma-hoa-session-sqlite-qua-session-tu-implement.md) (mã hoá `session.sqlite3` — điều kiện bắt buộc #1 "ghim cứng `grammers-*`" mở rộng sang `libsql`)

## Bối cảnh

[ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md) để ngỏ từ 2026-08-29: `tsmc-ingest` CLI (Node + GramJS qua `libs/core-mtproto`) đã verify thật, nhưng hướng "bọc thêm GUI Tauri + Angular" (autocomplete, kế thừa metadata) chưa quyết — vì GramJS `sendFile(path)` dựa vào `fs` của Node, và một app Tauri không có Node.

[SPIKE-10](../spikes/README.md#spike-10) (mở 2026-09-05, đóng 2026-09-07) đo bốn tổ hợp runtime MTProto khả dĩ cho GUI đó. **Chỉ hai trong bốn nhánh được dựng và chạy thật** — R1 (GramJS trong Tauri webview qua `upload.saveBigFilePart` viết tay + IPC đọc chunk) và R2 (Node sidecar, tái dùng nguyên `tsmc-ingest`) **không được dựng**, theo quyết định thứ tự thử của người quyết định (không phải cây quyết định gốc của spike, vốn đặt R1 lên trước): R1 đòi viết mới toàn bộ raw-API chunked upload — rủi ro cao nhất trong bốn nhánh, chưa có một dòng code nào — trong khi R3 (`grammers-client`) và R4 (`ferogram`) đã có code chạy được ngay trong buổi dựng spike và nhanh chóng cho ra bằng chứng thật. Xem [ghi chú "thứ tự thử nghiệm thật"](../spikes/README.md#spike-10) trong spike để biết đầy đủ lý do.

### Số liệu thật, tài khoản Telegram thật, kênh `tsmc_mediacenter`

| Mã | R3 (`grammers-client` 0.10.0) | R4 (`ferogram` 0.6.5) |
|---|---|---|
| M1 (login không hỏi lại OTP) | ✅ ĐẠT | ✅ ĐẠT |
| M2 (video phát + tua được, xác nhận bằng ảnh chụp Telegram thật) | ✅ **ĐẠT** | ❌ **TRƯỢT — dứt khoát** |
| M3 (RAM phẳng, đỉnh 21.1 MB suốt upload 400 MB) | ✅ ĐẠT | Chưa đo |
| M4 (throughput, baseline Telegram Desktop 16.48 MB/s) | ⚠️ 24.4% (đã vá từ 13.5% bằng 3 connection RAW song song tự mở) | ⚠️ 28.6% (đã vá từ 9.2% bằng đổi sang API pipelined) |
| M5 (tiến trình + huỷ) | ✅ ĐẠT | Chưa đo |
| M7 (ngưỡng kích thước, tài khoản Premium) | ✅ ĐẠT — tìm được ngưỡng thật (~4 000 000 000 byte, `FILE_PARTS_INVALID`) | Chưa đo |
| M8 (catalog roundtrip byte-chính-xác) | ✅ ĐẠT | Chưa đo |
| P1 (ranh giới crash FFmpeg, chặn mọi lựa chọn) | ✅ ĐẠT (tự chạy độc lập, không cần MTProto) | (chung, không phụ thuộc nhánh MTProto) |

**R4 bị loại dứt khoát, không phải "chưa thử hết":** `ferogram::media::UploadedFile` (kết quả các hàm upload công khai) có field `inner: tl::enums::InputFile` là `pub(crate)` — không có API công khai nào để gắn `DocumentAttributeVideo(supports_streaming: true)`. Thử vá bằng cách tự viết chunk-upload gọi thẳng `client.invoke(&upload::SaveBigFilePart{...})` để né giới hạn đó — chạy thật ném `ConnectionReset` ở 1.7% tiến trình. Đọc mã nguồn xác nhận gốc rễ: `ferogram` cố tình tách một "transfer pool" hoàn toàn riêng (auth key/transport/session riêng, tránh trộn traffic file với luồng update/dialog trên cùng kết nối chính) cho `SaveBigFilePart`/`GetFile`, và hàm route vào pool đó (`rpc_transfer_on_dc_pub`) không phải API công khai. Kết luận: không có cách an toàn nào từ ngoài crate vừa dùng đúng transfer pool vừa tự chọn `InputMedia`/attributes — giới hạn kiến trúc thật, không phải thiếu sót có thể vá bằng code cẩn thận hơn.

**R3 ngược lại có thể vá được, an toàn, bằng API công khai:** `grammers-mtsender` lộ công khai `connect_with_auth()`, `Sender::invoke()`, và `Session::dc_option()`/`home_dc_id()` — đủ để tự mở thêm connection MTProto RAW tái dùng auth_key đã có, **đúng cách `SenderPool` tự làm nội bộ khi kết nối lần đầu** (không phải hack). Nhờ vậy M4 (13.5% → 24.4%, gấp 1.81 lần) cải thiện được mà không đụng gì tới API private.

Chi tiết đầy đủ, mọi số liệu, và hai bug thật phát hiện lúc dựng (clap `--session` không nhận global, `.env` sai một cấp thư mục, `tl::enums::ChatFull` hai thư viện đặt tên biến thể channel khác nhau) ở [docs/spikes/README.md § SPIKE-10](../spikes/README.md#spike-10) (mã nguồn `tools/spike-10/` đã xoá sau khi khai tử `apps/tsmc-ingest` CLI, 2026-09-13 — số liệu vẫn đầy đủ ở đó).

## Các phương án

### A. R1 — GramJS trong Tauri webview, chunk qua IPC
- ✅ Giữ đúng MỘT implementation MTProto (GramJS) cho toàn bộ dự án — không thu hẹp vụ cược của [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md).
- ❌ **Chưa có một dòng code nào.** Đòi viết mới toàn bộ raw-API `upload.saveBigFilePart` + adapter đọc chunk qua Tauri IPC — rủi ro cao nhất trong bốn phương án, theo đúng bảng "Rủi ro chính chưa biết" viết trước khi chạy spike.
- **Loại (tạm thời, không phải vĩnh viễn)** — vì lý do thứ tự thử nghiệm, không phải vì đã đo và thất bại. Vẫn là lựa chọn hấp dẫn nhất về nguyên tắc nếu ai đó sau này chịu đầu tư viết nó; xem "Việc để ngỏ" bên dưới.

### B. R2 — Node sidecar, tái dùng nguyên `tsmc-ingest`
- ✅ Zero rewrite, giữ nguyên toàn bộ đường ADR-0013 đã verify thật (login/probe/upload/remux/subtitle...).
- ❌ Ship hai runtime JS trong một app (Node sidecar + WebView2/webkit của Tauri) — gần như xoá sạch lý do chọn Tauri thay Electron (đóng gói nhẹ).
- **Chưa thử** — không cần thiết sau khi R3 đã đạt.

### C. R3 — `grammers-client` 0.10.0 (**được chọn**)
- ✅ Đạt M1/M2/M3/M5/M7/M8/P1 thật trên tài khoản Telegram thật.
- ✅ M4 vá được (13.5%→24.4%) bằng API công khai, không cần đụng nội bộ private.
- ⚠️ M4 tuyệt đối vẫn dưới ngưỡng 80% — chưa "đủ nhanh" theo nghĩa lý tưởng, nhưng không phải trần cứng (xem "Hệ quả").
- ⚠️ Thêm một implementation MTProto thứ hai trong repo — xem "Quyết định" mục thu hẹp phạm vi ADR-0003.

### D. R4 — `ferogram` 0.6.5
- ✅ M4 nhỉnh hơn R3 một chút (28.6%) sau khi vá.
- ❌ **Trượt M2 dứt khoát** — không đáp ứng được yêu cầu cốt lõi của [ADR-0005](./0005-streaming-qua-service-worker-http-range.md) (progressive playback cần `supportsStreaming: true`) qua bất kỳ API công khai an toàn nào.
- **Loại.**

## Quyết định

Dùng **`grammers-client` 0.10.0** làm MTProto library cho công cụ ingest desktop (Tauri) — tách biệt hoàn toàn khỏi `apps/web` (vẫn dùng GramJS qua `libs/core-mtproto`, [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md) **không đổi** cho phạm vi đó).

### Bốn điều kiện bắt buộc, không thương lượng khi triển khai thật (không chỉ ở spike)

1. **Ghim cứng phiên bản** (`grammers-client = "=0.10.0"`, không `^`) ở mọi crate tiêu thụ nó — cùng lý do bất biến #9 CLAUDE.md áp dụng cho `telegram`/GramJS: một thư viện community-maintained, đổi version ngoài ý muốn là rủi ro thật.
2. **Toàn bộ RPC nằm sau một trait chung** (`IngestRpc`, đã chứng minh khả thi ở `tools/spike-10/rpc-trait`) — đổi thư viện MTProto sau này (nếu cần) = đổi một file, đúng nguyên tắc bọc cổng đã dùng cho `TelegramGateway` ở ADR-0003.
3. **Không bao giờ nạp cả file vào RAM** để upload — chỉ dùng API stream-từ-đĩa (`upload_stream`/`upload_file`/`multi_connection_upload` tự viết), xác nhận bằng đo RAM thật (M3) mỗi khi đổi cách upload, không chỉ tin đọc code.
4. **Không port bảng phân hạng A/B/C/D, `inheritMetadata`, catalog merge sang Rust.** `libs/core-ingest` (TypeScript, đã verify thật ở ADR-0013) vẫn là nguồn sự thật duy nhất cho luật nghiệp vụ — Rust/`grammers` chỉ nhận lệnh thực thi (upload, publish, resolve...), không tự quyết định gì về compat/metadata.

### Thu hẹp phạm vi vụ cược của ADR-0003 — ghi nhận tường minh, không né tránh

ADR-0003 chọn GramJS với lý do "bọc sau `TelegramGateway`, giữ chi phí đổi thư viện MTProto ở mức một package" — ngầm định đây là **thư viện MTProto duy nhất của toàn dự án**. Quyết định này phá ngầm định đó: **repo từ nay có HAI implementation MTProto độc lập** — `telegram` (GramJS) cho `apps/web` qua `libs/core-mtproto`, `grammers-client` cho công cụ ingest desktop. Đây KHÔNG phải sơ suất — hai runtime hoàn toàn khác nhau (trình duyệt/WebSocket vs Rust native/TCP), không có thư viện nào chạy được cả hai (xem lý do gốc chọn GramJS ở ADR-0003 §"Bối cảnh": "chạy được trong trình duyệt" là tiêu chí đầu tiên, loại trực tiếp mọi thư viện Rust-native). Phạm vi thật của vụ cược ADR-0003 từ nay là **`apps/web` và chỉ `apps/web`** — rủi ro "GramJS đã archive" (ADR-0003 §Cập nhật 2026-08-23) không giảm cũng không tăng vì quyết định này, nó độc lập với phạm vi kia.

## Hệ quả

**Tích cực**
- Công cụ ingest desktop có đường thật (không phải giả thuyết) để: upload file tới ~4000 MB (Premium) với RAM phẳng (~21 MB đỉnh, không tỉ lệ theo kích thước file), báo tiến trình + huỷ giữa chừng đáng tin, và **quan trọng nhất — video phát/tua được thật trên Telegram** (điều `ferogram` không làm được qua API công khai).
- M8 (catalog roundtrip byte-chính-xác) và P1 (ranh giới crash FFmpeg độc lập với lựa chọn MTProto) đã verify — phần còn lại của pipeline ingest desktop (FFmpeg native, [SPIKE-09](../spikes/README.md#spike-09)) không cần đo lại vì lý do MTProto.

**Tiêu cực / phải chấp nhận**
- **Hai implementation MTProto trong repo** — khi Telegram đổi giao thức (thêm method, đổi TL schema), phải vá CẢ HAI độc lập, không còn "một chỗ vá" như ADR-0003 từng hứa cho toàn dự án (chỉ còn đúng cho `apps/web`).
- `grammers-client` cũng là thư viện community-maintained — chưa có bằng chứng dài hạn về tốc độ vá lỗi/theo kịp giao thức Telegram, cùng loại rủi ro (khác mức độ) với GramJS đã archive. Chấp nhận, theo dõi định kỳ giống hướng đã chọn cho GramJS ở ADR-0003.
- **M4 (throughput tuyệt đối) chưa đạt ngưỡng lý tưởng** (24.4% baseline Telegram Desktop, đã cải thiện từ 13.5% nhưng vẫn còn cách xa 80%). Không chặn quyết định này (không phải trần kiến trúc, chỉ chưa tối ưu hết — xem "Việc để ngỏ"), nhưng UX ingest desktop thật sẽ chậm hơn Telegram Desktop native đáng kể cho tới khi tối ưu thêm.
- `multi_connection_upload()` (3 connection RAW tự mở, `tools/spike-10/r3-grammers/src/rpc.rs`) là code TỰ VIẾT, đi vòng qua lớp cache một-connection-mỗi-DC của `SenderPool` — không phải một tính năng chính thức của `grammers-client`. Bất kỳ bản cập nhật nào của thư viện thay đổi cách `Session`/`connect_with_auth` hoạt động đều có thể làm hỏng phần này mà không phải lỗi ở tầng RPC thông thường — cần theo dõi riêng khi nâng cấp version (dù đã ghim cứng, nâng cấp có chủ đích vẫn phải re-test phần này).

## Việc để ngỏ, ghi thẳng thay vì để trôi

- **Tối ưu M4 thêm** (chưa làm ở spike): tăng số connection RAW (>3), tăng part size, tái dùng connection giữa các lần upload thay vì mở mới mỗi lần — trước khi coi throughput ingest desktop là "đủ tốt" cho một sản phẩm thật.
- **R1 (GramJS trong webview) vẫn là hướng hấp dẫn về nguyên tắc**, chỉ bị hoãn vì chi phí viết mới — không bị đóng dứt khoát. Nếu áp lực "chỉ một thư viện MTProto" tăng lên (vd sau khi thấy chi phí bảo trì hai thư viện thật), đây là hướng quay lại đầu tiên.
- **Đặt tên/vị trí code thật** cho công cụ ingest desktop (`apps/tsmc-ingest-desktop`? tên khác?) và cấu trúc package Rust/Tauri — chưa quyết, xem addendum [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md#cập-nhật-sau-khi-accepted-2026-09-07-adr-0017--ranh-giới-workspace-cho-công-cụ-ingest-desktop).
- **Số phận `tsmc-ingest` CLI hiện tại** (giữ song song hay khai tử sau khi GUI đạt parity), tra cứu metadata online (TMDB, opt-in), và `@tsmc_bot` có còn cần không khi GUI làm được `/publish`/`/check` — đều vẫn để ngỏ, chưa phải việc của ADR này (xem addendum [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md) tương ứng).

## Cập nhật sau khi Accepted (2026-09-10, tên/vị trí code thật — gỡ một mục "để ngỏ")

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc (`grammers-client` 0.10.0, bốn điều kiện bắt buộc) **vẫn đứng vững**.
> Mục này GỠ đúng một dòng "để ngỏ" ở trên: "đặt tên/vị trí code thật... chưa
> quyết".

**Chốt: `apps/tsmc-ingest-desktop`.** Đúng tiền lệ đặt tên đã có (`apps/web`,
`apps/tsmc-ingest`) — rõ ràng đây là bản GUI song song với CLI hiện có, không
phải một pipeline ingest riêng biệt hay bản thay thế tức thời.

**Thứ tự scaffold trong lần code đầu tiên:** bắt đầu bằng khung sườn tối
thiểu — Cargo workspace của `apps/tsmc-ingest-desktop` (ranh giới ngoài
`pnpm`/ESLint, đúng nguyên tắc đã ghi ở [ADR-0012 § Cập nhật
2026-09-07](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md#cập-nhật-sau-khi-accepted-2026-09-07-adr-0017--ranh-giới-workspace-cho-công-cụ-ingest-desktop)),
trait `IngestRpc` (điều kiện bắt buộc #2 ở Quyết định gốc), và một impl
`grammers-client` tối thiểu (login + resolve kênh) **tái dùng trực tiếp code
đã chạy thật ở `tools/spike-10/r3-grammers`** — không viết lại từ đầu. UI thật
(webview/Angular cho mockup A.3 ở
[docs/ux-design.md § Phụ lục A](../ux-design.md#phụ-lục-a-công-cụ-ingest-desktop-gui-tauri))
**chưa làm ở bước này** — quyết định riêng, để dành cho slice kế tiếp sau khi
khung sườn Rust/Tauri chạy được.

**Việc tiếp theo:** scaffold khung sườn theo đúng thứ tự trên; cập nhật
[docs/roadmap.md](../roadmap.md) khi khung sườn chạy được lần đầu (đúng quy
ước "xoá khỏi roadmap khi bắt đầu, thêm changelog khi xong" — ở đây là cập
nhật trạng thái, chưa xong hẳn).

## Cập nhật sau khi Accepted (2026-09-10, khung sườn `apps/tsmc-ingest-desktop` — code thật lần đầu)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định
> đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó — quyết
> định gốc **vẫn đứng vững**.

Khung sườn `apps/tsmc-ingest-desktop` đã dựng và build sạch thật (không phải
giả định): `cargo build --workspace` và `cargo clippy --workspace` (3 crate:
`ingest-rpc-trait`, `ingest-grammers`, `src-tauri`) đều 0 warning; `cargo
tauri dev` boot được, tạo cửa sổ WebView2 thật, chạy ổn định (không panic)
cho tới khi bị dừng chủ động — chưa test luồng đăng nhập MTProto thật (CLAUDE.md:
không chạy đăng nhập hộ người dùng), xem checklist mới ở
[docs/pending-device-tests.md](../pending-device-tests.md).

**Đúng như dự kiến — trait + toàn bộ 7 method của `IngestRpc` (bao gồm
`multi_connection_upload()` đã verify M4 ở SPIKE-10) ported gần như nguyên
vẹn** từ `tools/spike-10/rpc-trait` + `tools/spike-10/r3-grammers/src/{rpc,session}.rs`
— chỉ 5 Tauri command wire thật (`check_session`, `request_login_code`,
`submit_otp`, `submit_password` bootstrap phiên đăng nhập, KHÔNG thuộc 7
method của trait; `resolve_channel` là method DUY NHẤT của `IngestRpc` được
wire ở khung sườn này). 6 method còn lại của trait
(`check_write_permission`, `read_pinned_catalog`, `download_document`,
`upload_video`, `upload_subtitle`, `publish_catalog`) đã có implementation
đầy đủ nhưng chưa wire — để dành slice UI thật.

**Một phát hiện thật ngoài dự kiến — không phải giả định trước khi code:**
`session.rs::ensure_logged_in()` của spike (chặn stdin cho phone/OTP/2FA) **không
port được nguyên vẹn** — một webview không có terminal đính kèm để chặn chờ
input. Phải tách thành state machine 4 trạng thái
(`Disconnected → Connected → AwaitingOtp → AwaitingPassword → Ready`,
`src-tauri/src/state.rs`) trải qua nhiều lần round-trip Tauri command thay vì
một hàm chặn. Đây là khác biệt kiến trúc thật giữa "CLI one-shot" và "GUI"
mà không addendum nào trước đó của ADR-0013/ADR-0017 liệt kê — đáng ghi lại
vì bất kỳ implementation MTProto nào khác (R4/ferogram nếu quay lại sau này)
cũng sẽ gặp đúng vấn đề này, không riêng gì `grammers-client`.

**Một bug môi trường thật lặp lại đúng như SPIKE-10 đã ghi, không phải phát
hiện mới:** `grammers-crypto` không build "out of the box" — `num-bigint`
xung đột kiểu qua `glass_pumpkin` (pin lỏng tự trôi lên `2.0.0-rc1`). Vá bằng
đúng lệnh SPIKE-10 đã ghi: `cargo update -p glass_pumpkin --precise
2.0.0-rc0`. Ghi lại lần thứ hai (SPIKE-10 + ở đây) là tín hiệu đáng cân nhắc
ghim `glass_pumpkin` luôn trong `[workspace.dependencies]` nếu điều này còn
gây bất ngờ cho ai khác dựng lại từ đầu — chưa làm ở lần này, chỉ áp dụng
đúng bản vá đã biết.

**Hai fix nhỏ do `cargo clippy` bắt được** (không phải bug chức năng):
`ConnState` đổi từ `impl Default` thủ công sang `#[derive(Default)]` +
`#[default]`; field `password_token` ở biến thể `AwaitingPassword` đổi sang
`Box<PasswordToken>` (`clippy::large_enum_variant` — biến thể đó nặng hơn hẳn
các biến thể khác của enum).

**Điều gì KHÔNG đổi:** bốn điều kiện bắt buộc ở Quyết định gốc đứng nguyên —
đã áp dụng đúng: cả 5 crate `grammers-*` ghim `=0.10.0` (không chỉ
`grammers-client`) trong `[workspace.dependencies]` của
`apps/tsmc-ingest-desktop/Cargo.toml`; toàn bộ RPC sau trait `IngestRpc`;
không nạp cả file vào RAM (`multi_connection_upload()` giữ nguyên cơ chế
đọc theo `PART_SIZE`); không port luật nghiệp vụ sang Rust.

**Việc tiếp theo:** slice UI thật (mockup A.3, `docs/ux-design.md` § Phụ lục
A) thay cho `ui/index.html` placeholder hiện tại; wire 6 method `IngestRpc`
còn lại thành command khi UI cần tới; admin tự verify luồng đăng nhập +
resolve kênh thật (checklist [docs/pending-device-tests.md](../pending-device-tests.md)).

## Cập nhật sau khi Accepted (2026-09-11, `IngestRpc` thêm 2 thao tác không có tương ứng 1-1 phía TS)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**. Mục này nới đúng MỘT câu trong Quyết định
> gốc, không đổi bản chất: `ingest-rpc-trait/src/lib.rs` từng ghi "Bảy thao
> tác này khớp 1-1 với `gateway-index.ts`/`gateway-ingest.ts` — implementation
> Rust KHÔNG được phát minh lại tập hợp thao tác". Addendum này ghi nhận
> ngoại lệ có chủ đích đầu tiên cho câu đó.

Slice "Chọn kênh" (màn A.4) phát hiện gap thật khi làm UI: mockup gốc
(`docs/ux-design.md` § A.4, hàng "Chọn kênh") đòi "danh sách kênh **ghi
được**", nhưng bảy thao tác gốc của `IngestRpc` chỉ có `resolve_channel(ref)`
— resolve MỘT kênh cụ thể theo ref, không có cách "liệt kê". User cũng yêu
cầu thêm "tạo kênh mới" ngay tại màn này thay vì bắt thoát ra app Telegram
gốc. Cả hai đều là nhu cầu THẬT của công cụ desktop, không tồn tại ở
`apps/web` (web app không có luồng "quản lý danh sách kênh của tôi" hay "tạo
kênh media mới" — Sources chỉ *thêm một kênh đã có sẵn* làm nguồn xem).

**Quyết định (bổ sung, không thay đổi 4 điều kiện bắt buộc gốc):** thêm đúng
hai method vào `IngestRpc` — `list_own_channels()` (quét `Client::
iter_dialogs()`, lọc `Peer::Channel` có `raw.creator == true`, đúng semantics
`is_own` đã dùng ở `resolve_channel`) và `create_channel(title)` (raw invoke
`tl::functions::channels::CreateChannel { broadcast: true, megagroup: false,
... }` — cùng lời gọi TL, cùng loại kênh `broadcast` mà `gateway-sync.ts`
(TS) đã dùng cho `createStateChannel()`, chỉ khác mục đích: kênh MEDIA dùng
chung, không phải kênh STATE riêng tư của ADR-0014). Hai method này **KHÔNG**
có tương ứng 1-1 phía `libs/core-mtproto` — chấp nhận đây là ngoại lệ có chủ
đích cho một nhu cầu chỉ tồn tại ở công cụ desktop, không phải một port thiếu
sót. `AppState.selected_channel` (Rust) được dùng làm điểm hội tụ chung: cả
`resolve_channel`, `create_channel`, và một command mới `select_channel`
(chọn một kết quả từ `list_own_channels()`, không resolve lại) đều ghi vào
đây, để `check_write_permission()`/`read_pinned_catalog()` luôn thao tác
đúng "kênh đang chọn" bất kể chọn bằng cách nào trong ba cách.

**Không đổi:** bốn điều kiện bắt buộc ở Quyết định gốc (ghim version, trait
chung, không nạp cả file vào RAM, không port luật nghiệp vụ) đứng nguyên —
hai method mới vẫn đi qua đúng trait, không thêm code MTProto nào ngoài
`ingest-grammers`. `libs/core-ingest` vẫn không đổi vai trò.

**Việc tiếp theo:** 6 method `IngestRpc` chưa wire thành Tauri command giảm
còn 4 (`download_document`, `upload_video`, `upload_subtitle`,
`publish_catalog`) — để dành slice workspace ba vùng (mockup A.3). Admin tự
verify picker/tạo kênh bằng tài khoản thật (checklist
[docs/pending-device-tests.md](../pending-device-tests.md)).

**Cập nhật tiếp trong cùng slice — mở rộng sang supergroup, loại trừ group nhỏ có chủ đích:**
theo yêu cầu user, `list_own_channels()`/`resolve_channel()` ban đầu chỉ
chấp nhận `Peer::Channel` (broadcast) — mở rộng thêm `Peer::Group` mà
`raw` là `tl::enums::Chat::Channel` (grammers xếp supergroup vào `Group` dù
ở tầng TL nó vẫn là `Channel` với `broadcast: false`, cùng họ RPC
`channels.*`/`InputPeer::Channel` với broadcast channel — tương thích với
`read_pinned_catalog()`/`upload_video()`/... hiện có). **Cố ý KHÔNG** mở
rộng tới group nhỏ chưa nâng cấp supergroup (`tl::enums::Chat::Chat`) — kiểu
này dùng hẳn họ RPC `messages.*`/`InputPeer::Chat` khác hẳn, các method còn
lại của `IngestRpc` (hardcode match `InputPeer::Channel`) sẽ vỡ nếu cho lọt
vào, lỗi khó hiểu ("peer không phải InputPeer::Channel") ở bước publish
thay vì báo ngay lúc chọn kênh. Logic gộp vào một helper dùng chung
`channel_like_creator()` (`ingest-grammers/src/rpc.rs`) cho cả
`resolve_channel()` lẫn `list_own_channels()`, tránh lặp lại phân loại
Channel/Group ở hai chỗ.

## Cập nhật sau khi Accepted (2026-09-13, đóng gap thật của M7 — chặn kích thước file TRƯỚC khi upload)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

M7 (§ "Kết quả thật M3/M5/M7/M8" ở trên) đo được ngưỡng thật và khuyến nghị tường minh trong `tools/spike-10/README.md`: "một implementation client thật phải tự tính `total_parts` từ kích thước file TRƯỚC khi mở kết nối... và chặn ở UI ngay — không phụ thuộc server phản hồi nhanh hay chậm". Khuyến nghị này **chưa từng được port** vào `ingest-grammers` thật khi scaffold ban đầu (addendum 2026-09-10) — `IngestRpcError::FileTooLarge` được định nghĩa sẵn trong trait nhưng không nơi nào từng ném ra nó, nên `upload_video()` cứ để `multi_connection_upload()` chạy thẳng và nhận `FILE_PARTS_INVALID` (lỗi giao thức thô, khó hiểu với người dùng) từ Telegram khi file vượt trần.

**Phát hiện lại đúng bằng verify thật 2026-09-13:** admin thả `tools/spike-10/sample-4gb.mp4` (4 645 817 639 byte — đúng file M7 đã dùng để đo ngưỡng) vào Workspace thật, gặp lại đúng `FILE_PARTS_INVALID`. Không phải hồi quy hay bug mới — là gap đã biết từ SPIKE-10 nhưng chưa đóng.

**Vá:** thêm hằng số `MAX_UPLOAD_BYTES = 4_000_000_000` (`ingest-grammers/src/rpc.rs`), chặn ngay đầu `upload_video()` — dùng `total` đã có sẵn từ `tokio::fs::metadata(&input.file_path)` (đọc TRƯỚC khi gọi `multi_connection_upload()`), trả `IngestRpcError::FileTooLarge { max_bytes, actual_bytes }` nếu vượt trần thay vì mở kết nối. `describeIngestError()` (Angular) đổi từ thông báo chung chung sang hiện số GB cụ thể cả hai chiều.

**Giới hạn thật của bản vá — ghi rõ, không giấu:** ngưỡng `4_000_000_000` byte là con số công khai "~4000 MB cho tài khoản Premium", nằm giữa hai mốc M7 đã đo (2.307 GiB ĐẠT / 4.327 GiB TRƯỢT) nhưng **chưa bisect chính xác từng byte** (M7 đã ghi rõ điều này, không phải bỏ sót lúc vá). **Chưa kiểm chứng ngưỡng cho tài khoản KHÔNG Premium** — tài liệu công khai Telegram ghi thấp hơn (ví dụ 2GB); hằng số này chỉ bảo vệ đúng trường hợp Premium đã đo thật, tài khoản thường có thể vẫn gặp `FILE_PARTS_INVALID` thô ở một ngưỡng thấp hơn chưa biết.

**Việc tiếp theo:** admin tự verify lại bằng tài khoản thật — checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--workspace-ba-vùng-bắt-đầu-upload-2026-09-12). Nếu có bằng chứng thật về ngưỡng tài khoản không Premium, cập nhật addendum mới — không đoán trước khi có số liệu.

## Cập nhật sau khi Accepted (2026-09-13, verify bản vá + số liệu thật ngưỡng tài khoản không Premium)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

**Verify 2026-09-13, ĐẠT:** user xác nhận bản vá `MAX_UPLOAD_BYTES` hoạt động đúng — thả lại file >4GB, hiện đúng thông báo `FileTooLarge` thân thiện thay vì `FILE_PARTS_INVALID` thô.

**Số liệu thật mới, gỡ đúng câu "chưa kiểm chứng" ở trên:** ngưỡng tài khoản KHÔNG Premium là **2GB** (user xác nhận). Đây là **gap thật còn lại, chưa vá**: `MAX_UPLOAD_BYTES = 4_000_000_000` hiện hardcode CHUNG cho mọi tài khoản — một tài khoản KHÔNG Premium thả file 2.5GB (dưới trần 4GB hiện tại) sẽ qua được check `FileTooLarge`, rồi vẫn dính `FILE_PARTS_INVALID` thô ở tầng `multi_connection_upload()` — đúng loại lỗi mà bản vá này được viết ra để ngăn, chỉ là cho SAI đối tượng tài khoản. **Chưa vá** — hướng vá đã xác định rõ (đọc code, không phải đoán): `grammers-client::Client::get_me()` trả về `User` với field `pub raw: tl::enums::User` công khai; `tl::enums::User::User(u) => u.premium` (field `bool` có thật trong schema TL `user#31774388`, xem `grammers-tl-types-0.10.0/tl/api.tl`) cho biết tài khoản có Premium hay không — gọi một lần lúc đăng nhập xong, cache vào `AppState`, dùng để chọn `MAX_UPLOAD_BYTES` đúng theo tài khoản (2GB hoặc 4GB) thay vì hardcode một số cho tất cả. Để dành làm việc riêng, không tự vá kèm ADR này.

**Việc tiếp theo:** vá tier-aware threshold theo hướng đã ghi ở trên — xem `docs/roadmap.md § Ingest`.

## Cập nhật sau khi Accepted (2026-09-14, vá tier-aware upload threshold)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Đóng đúng gap để ngỏ ở addendum 2026-09-13 phía trên ("Để dành làm việc riêng, không tự vá kèm ADR này") — theo ĐÚNG hướng đã xác định lúc đó, không phải cách khác:

- `MAX_UPLOAD_BYTES` (hardcode chung một số) tách thành `MAX_UPLOAD_BYTES_PREMIUM = 4_000_000_000` và `MAX_UPLOAD_BYTES_FREE = 2_000_000_000` (`ingest-grammers/src/rpc.rs`).
- `GrammersIngestRpc::new()` đổi từ hàm đồng bộ thành `async fn`, gọi `client.get_me().await` MỘT LẦN lúc đăng nhập xong, đọc cờ Premium qua hàm mới `is_premium(raw: &tl::enums::User)` (`tl::enums::User::User(u) => u.premium`, field `premium:flags.28?true` xác nhận có thật trong `user#31774388` — đối chiếu trực tiếp `grammers-tl-types-0.10.0/tl/api.tl`, không suy đoán). Kết quả lưu vào field `max_upload_bytes: u64` trên struct, tính đúng một lần thay vì đọc lại mỗi `upload_video()`.
- Ba call site ở `src-tauri/src/commands.rs` (`check_session`, `submit_otp`, `submit_password` — cả ba nhánh dựng `GrammersIngestRpc` sau khi xác nhận đăng nhập xong) đổi thành `.await`.
- **Lỗi đọc `get_me()`** (hiếm — network flake ngay sau đăng nhập) mặc định về trần THẤP hơn (`MAX_UPLOAD_BYTES_FREE`, 2GB) thay vì trần cao — an toàn hơn là lỡ cho qua một file sẽ dính `FILE_PARTS_INVALID` thô ở tầng dưới. `User::Empty` (hiếm, tài khoản đã xoá) cũng coi như không Premium, cùng lý do.
- `upload_video()` đổi từ so sánh hằng số toàn cục sang `self.max_upload_bytes`.

`cargo build --workspace`/`cargo clippy --workspace` sạch, 0 warning — verify 2026-09-14.

**Verify 2026-09-14, ĐẠT cho nhánh Premium:** user xác nhận qua `cargo tauri dev` + tài khoản Premium thật — upload vẫn thành công đúng trần 4GB như hành vi cũ. **Nhánh KHÔNG Premium chưa verify được — hiện không có tài khoản loại này để test** (hoãn, không phải lỗi phát hiện). Logic đối xứng (`is_premium() == false` → `MAX_UPLOAD_BYTES_FREE`) đã có trong code, chỉ thiếu bằng chứng thật.

**Việc tiếp theo:** verify nhánh KHÔNG Premium khi có tài khoản phù hợp — checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--tier-aware-upload-threshold-2026-09-14).

## Cập nhật sau khi Accepted (2026-09-14, thêm `sign_out` vào `IngestRpc`)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

[docs/roadmap.md](../roadmap.md) đã ghi gap: `IngestRpc`/`ingest-grammers` không có thao tác sign-out (khác `apps/web` đã có `client.logout()` đầy đủ) — muốn đổi tài khoản, admin phải tự tay xoá `session.sqlite3`/`credentials.json`. Đóng gap này.

**Quyết định (bổ sung, không thay đổi 4 điều kiện bắt buộc gốc):** thêm method thứ tám vào `IngestRpc` — `async fn sign_out(&self) -> Result<(), IngestRpcError>` (`ingest-rpc-trait/src/lib.rs`). Đây là **ngoại lệ thứ ba** (sau `list_own_channels`/`create_channel`, addendum 2026-09-11) không có tương ứng 1-1 phía TS — nhưng khác bản chất hai cái kia: những cái đó về "kênh", cái này về "tài khoản". `apps/web` CÓ đăng xuất (`logout-confirm-sheet.ts`) nhưng đó là một luồng client-heavy phức tạp hơn hẳn (flush outbox, xoá IndexedDB session/sync state/media/index) vì còn state đồng bộ cục bộ cần dọn (ADR-0009) — ingest desktop không có state đó, nên không có gì để "port 1-1", chỉ cần gọi `auth.LogOut` rồi xoá `session.sqlite3`.

**Implementation (`ingest-grammers/src/rpc.rs::GrammersIngestRpc::sign_out()`):** gọi thẳng `self.client.sign_out()` — `grammers-client` 0.10.0 đã có sẵn method này, wrap `auth.LogOut`. Lỗi map qua `to_rpc_error()` đã có (FLOOD_WAIT/USER_RESTRICTED). Theo doc comment gốc của `grammers-client`, method trả `Ok` ngay cả khi "không ai đăng nhập" — chỉ `Err` ở lỗi RPC/mạng thật.

**Command Tauri mới `sign_out` (`src-tauri/src/commands.rs`) — thứ tự BẮT BUỘC, đúng bài học đã ghi ở [ADR-0011](./0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) (xoá cục bộ trước sẽ để lại session sống trong danh sách thiết bị Telegram mà app không còn cách thu hồi):**

1. Gọi `rpc.sign_out()` (server-side `auth.LogOut`) **TRƯỚC**.
2. Chỉ khi `Ok`: `pool_task.abort()` (không cần ownership — `JoinHandle::abort(&self)`), đặt `ConnState` về `Disconnected`, xoá `selected_channel`.
3. Xoá file `session.sqlite3` cục bộ (+ sidecar `-wal`/`-shm` nếu libSQL từng tạo, [ADR-0021](./0021-ma-hoa-session-sqlite-qua-session-tu-implement.md)) — best-effort, không throw.

Lỗi ở bước 1 (FLOOD_WAIT, mất mạng) → trả lỗi ngay, **KHÔNG xoá gì**, `ConnState` giữ nguyên `Ready` — user thử lại được, không rơi vào trạng thái nửa vời.

**Cố ý KHÔNG xoá `credentials.json`/`tmdb_api_key.json` lúc đăng xuất** — giữ để `tryAutoLogin()` (`login.ts`, đã có sẵn) tự điền lại form nhanh, chỉ cần OTP để đăng nhập lại — đúng hành vi đã có sẵn cho case "session hết hạn", không cần code riêng. Muốn đổi hẳn sang tài khoản khác thì tự sửa đè các ô trong form, không phải xoá file.

**UI:** `signOut()` mới trong `ingest-rpc.ts`; nút "Đăng xuất" ở màn Cài đặt (`settings.ts`/`.html`) — LUÔN hỏi xác nhận qua `DialogService.confirm()` trước (tone warn, hành động khó hoàn tác), nội dung dialog đổi tuỳ `QueueStore.uploading()` có đang chạy dở hay không (cảnh báo riêng: đăng xuất giữa chừng cắt kết nối MTProto, upload đang chạy chắc chắn lỗi) — KHÔNG chặn cứng nút, chỉ cảnh báo rõ, quyết định cuối vẫn ở user. Thành công → `SelectedChannelStore.clear()` (method mới thêm vào store) + điều hướng `/login`. Lỗi → hiện tại chỗ, không điều hướng đi đâu.

`cargo build`/`cargo clippy --workspace -- -D warnings` (cần `CMAKE_GENERATOR` trên máy có nhiều bản Visual Studio, xem ADR-0021) sạch. `ng build`/`npm run lint` sạch. **Verify 2026-09-15, ĐẠT (tổng quát)** — user xác nhận chạy `cargo tauri dev` + tài khoản thật, Đăng xuất hoạt động đúng thiết kế; chưa có xác nhận riêng từng bước con (đối chiếu "Thiết bị đang hoạt động" trên app Telegram gốc, nhánh có upload chạy dở, nhánh huỷ dialog, nhánh lỗi server). Checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--đăng-xuất-2026-09-14).

## Cập nhật sau khi Accepted (2026-09-15, "Trình quản lý catalog": `IngestRpc` thêm 2 thao tác)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

[docs/roadmap.md](../roadmap.md) đã ghi gap: 2 màn A.4 còn lại chưa bắt đầu — Trình quản lý catalog, Nhật ký. Slice này đóng "Trình quản lý catalog" (bảng toàn bộ item trong catalog.json đang ghim, đối soát với message thật trong kênh, sửa/xoá/re-publish — [docs/ux-design.md](../ux-design.md#a4-các-màn-còn-lại)).

**Phạm vi đối soát đã chốt (không làm rộng hơn ở slice này):** CHỈ một chiều — phát hiện catalog item trỏ tới message đã bị xoá trên kênh. KHÔNG làm chiều ngược lại (file mồ côi có trong kênh nhưng thiếu trong catalog) — để dành slice sau (cần thêm UI nhập metadata tối thiểu cho item mới phát hiện).

**Quyết định (bổ sung, không thay đổi 4 điều kiện bắt buộc gốc):** thêm 2 method vào `IngestRpc` — **ngoại lệ thứ tư và thứ năm** (sau `list_own_channels`/`create_channel` addendum 2026-09-11, `sign_out` addendum 2026-09-14) không có tương ứng 1-1 phía TS:

- `check_deleted_messages(channel, msg_ids) -> Vec<i64>` — kiểm tra tập `msg_id` catalog đang tham chiếu còn tồn tại trên kênh không, trả đúng tập con KHÔNG còn tồn tại. `gateway-index.ts` không có RPC nào cho nhu cầu này — web app không có màn quản lý catalog tương đương.
- `delete_message(channel, msg_id) -> ()` — xoá hẳn một message khỏi kênh. `gateway-index.ts` chỉ gọi `deleteMessages()` NỘI BỘ trong `publishCatalogDocument()` (dọn catalog cũ), không lộ ra thành một RPC độc lập.

**Thiết kế kỹ thuật đối soát — quyết định thay thế tốt hơn phương án "quét lịch sử kênh" ban đầu đặt ra:** thay vì thêm `list_channel_documents()` quét `iter_messages()`/`GetHistory` (giống cách Index feature quét kênh, cần chọn độ sâu bounded/phân trang), `check_deleted_messages()` dùng thẳng `Client::get_messages_by_id()` (grammers) — tra ĐÚNG tập `msg_id` catalog đang có, trả `Vec<Option<Message>>` cùng thứ tự (doc chính thức của method này nêu ví dụ chính xác use-case: "X out of Y messages were deleted!"). Chính xác tuyệt đối (không có vùng "ngoài cửa sổ quét" như quét lịch sử bounded), số RPC ít hơn hẳn, và tự nhiên bounded theo đúng số item catalog có — không cần khái niệm phân trang nào cả.

**Implementation (`ingest-grammers/src/rpc.rs`):**

- `check_deleted_messages()`: chunk `msg_ids` theo 100/lần (an toàn cho giới hạn `channels.GetMessages`, chưa thấy tài liệu ghim con số chính thức — 100 là mức phổ biến của các client MTProto khác cho lời gọi tương tự), gọi `get_messages_by_id()` từng chunk, gom id có kết quả `None` vào `missing`. `PeerRef` (`grammers-session`) là `Copy` nên tái dùng được qua các lần lặp mà không cần resolve lại peer.
- `delete_message()`: `client.delete_messages(peer_ref, &[msg_id])` — cùng lời gọi đã dùng trong `publish_catalog()` để dọn catalog cũ, không thêm logic mới.
- Cả hai dùng `to_rpc_error()` sẵn có (FLOOD_WAIT phân biệt được).

**Command Tauri mới (`src-tauri/src/catalog.rs`, file riêng theo đúng convention tách theo feature như `probe.rs`/`pipeline.rs`/`upload.rs`):** `check_deleted_messages`/`delete_message`, cả hai đọc `state.selected_channel` (không nhận `ResolvedChannel` qua IPC), cùng khuôn với `check_write_permission`/`read_pinned_catalog`. Không cần DTO struct mới — `Vec<i64>`/`i64` serialize thẳng qua IPC.

`download_document` (method 4 của `IngestRpc`, đã có implementation từ trước) **vẫn để trống** — đối soát ở slice này chỉ cần biết message còn tồn tại hay không (`check_deleted_messages`), không cần tải lại nội dung file.

**UI (`catalog-manager/catalog-manager.{ts,html,scss}`, route `/catalog`, vào qua icon mới ở topbar Workspace cạnh ⚙ Cài đặt):** bảng CDK Virtual Scroll (Title/Năm/Season/Ep sửa trực tiếp, cột msgId + badge trạng thái), nút "Đối soát với kênh" (thủ công, không tự chạy lúc mount — cùng nguyên tắc "Tra TMDB" cũng là nút thủ công). Menu hành động mỗi dòng: "Xoá khỏi catalog" (chỉ gỡ khỏi mảng đang sửa, STAGE tới khi bấm "Lưu catalog") và "Xoá khỏi catalog + xoá message trên kênh" (`DialogService.confirm()` tone warn → `deleteMessage()` chạy NGAY lúc xác nhận — hành động mạng không hoàn tác được — rồi mới gỡ khỏi mảng đang sửa). "Lưu catalog" đọc lại `readPinnedCatalog()` NGAY LÚC publish (không dùng bản đã đọc lúc mount), loại các `msgId` đã bấm xoá ra khỏi bản MỚI NHẤT đó trước khi `mergeCatalogItems()` với mảng đang sửa — cố ý KHÔNG dùng "item nào không còn trong mảng đang sửa" làm tiêu chí loại, vì cách đó sẽ vô tình loại luôn item MỚI xuất hiện đồng thời (vd upload từ Workspace trong lúc màn này đang mở, chỉ đơn giản là chưa có trong `items()` vì màn này nạp trước khi nó xuất hiện, không phải vì user chọn xoá). `withFloodWaitRetry()`/`countdown()` (trước đây private trong `workspace.ts`) tách ra `core/flood-wait-retry.ts` khi trở thành lần dùng thứ hai, tránh hai bản logic đếm ngược lệch nhau theo thời gian — `workspace.ts` đổi sang import hàm dùng chung, không đổi hành vi.

`cargo build`/`cargo clippy --workspace -- -D warnings`, `ng build`/`npm run lint` — sạch. **CHƯA verify bằng `cargo tauri dev` + tài khoản thật** (bị chặn build cục bộ bởi tiến trình `cargo tauri dev` đang chạy sẵn của user lúc code slice này, chưa tự chạy lại kịp — không phải lỗi do thay đổi ở slice này). Checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--trình-quản-lý-catalog-2026-09-15).

**Bug thật phát hiện lúc verify thiết bị thật (cùng ngày, user report): badge "⚠ Message đã xoá" không hiện dù đã xoá tay một message thật.** Nguyên nhân: `check_deleted_messages()` ban đầu chỉ coi `None` (từ `get_messages_by_id()`) là tín hiệu "đã xoá" — nhưng `channels.GetMessages` của Telegram KHÔNG lược bỏ message đã xoá khỏi response, mà trả về biến thể `tl::enums::Message::Empty` (tombstone) đúng vị trí id đó. Sâu hơn: `Message::peer_id()` (grammers) của biến thể `Empty` rơi về `fetched_in` (chính `peer_ref` đã truyền vào lúc gọi) khi `peer_id` trong TL rỗng — nghĩa là filter nội bộ `m.peer_id() == peer.id` của `get_messages_by_id()` KHÔNG loại được `Empty`, nó vẫn nằm trong map kết quả và trả về `Some(Message)` thay vì `None`. Vá bằng kiểm thêm biến thể `Empty` ở field `raw` công khai của `Message` (`ingest-grammers/src/rpc.rs::check_deleted_messages()`): `deleted = message.is_none() || matches!(message.raw, tl::enums::Message::Empty(_))`.

`cargo check -p ingest-grammers -p ingest-rpc-trait`/`cargo clippy -p ingest-grammers -p ingest-rpc-trait -- -D warnings` (`CMAKE_GENERATOR="Visual Studio 17 2022"`, xem ADR-0021 § mục 7) sạch — build toàn workspace qua `src-tauri` (`cargo build --workspace`) vẫn bị chặn cục bộ bởi rust-analyzer/`cargo tauri dev` khác đang chạy nền giữ khoá `ffmpeg-runtime/*.dll`, không liên quan tới đúng/sai của bản vá.

**Verify 2026-09-15, ĐẠT** — user xác nhận qua `cargo tauri dev` + tài khoản thật: xoá tay 1 message thật → "Đối soát với kênh" gắn cờ ĐÚNG đúng item đó (bản vá `Message::Empty` hoạt động đúng). Đi hết checklist còn lại: sửa metadata + "Lưu catalog", "Xoá khỏi catalog", "Xoá khỏi catalog + xoá message trên kênh" (cả nhánh huỷ dialog lẫn xác nhận), nhánh cập nhật đồng thời (upload từ Workspace trong lúc `/catalog` đang mở không bị mất), catalog rỗng — đều ĐẠT. Chỉ còn FLOOD_WAIT lúc "Lưu catalog" chưa test (không chủ động ép, CLAUDE.md), không chặn. Chi tiết: [docs/changelog.md § 2026-09-15, verify ĐẠT](../changelog.md#2026-09-15--gui-ingest-desktop-verify-trình-quản-lý-catalog--đạt), checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--trình-quản-lý-catalog-2026-09-15).

## Cập nhật sau khi Accepted (2026-09-16, "Trình quản lý catalog": đối soát chiều ngược lại — `IngestRpc` thêm 1 thao tác)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Addendum 2026-09-15 chốt phạm vi đối soát CHỈ một chiều (catalog item nào đã bị xoá khỏi kênh) và ghi rõ để dành chiều ngược lại (file mồ côi có trên kênh nhưng thiếu trong catalog) cho slice sau. Slice này đóng chiều ngược lại đó.

**Quyết định (bổ sung, không thay đổi 4 điều kiện bắt buộc gốc):** thêm method thứ mười một vào `IngestRpc` — **ngoại lệ thứ sáu** (sau `list_own_channels`/`create_channel` addendum 2026-09-11, `sign_out` addendum 2026-09-14, `check_deleted_messages`/`delete_message` addendum 2026-09-15) không có tương ứng 1-1 phía TS:

- `scan_channel_videos(channel) -> Vec<ChannelVideoDocument>` — quét TOÀN BỘ lịch sử kênh, trả mọi document có `DocumentAttributeVideo`. Trả THÔ, không so với catalog — tầng gọi (`catalog-manager.ts`) tự tính hiệu tập hợp với `msgId` đang có trong `items()` (điều kiện bắt buộc #4: trait không chứa luật nghiệp vụ). `gateway-index.ts` không có RPC nào cho nhu cầu này — web app không có màn quản lý catalog tương đương.

**Thiết kế kỹ thuật quan trọng nhất — cố ý KHÔNG dùng server-side `MessagesFilter`:** `grammers-client` 0.10.0 có `Client::search_messages().filter(tl::enums::MessagesFilter)`, hỗ trợ `InputMessagesFilterDocument` — trông như cách lọc rẻ nhất (đỡ phải tải mọi loại message về rồi tự lọc). Đọc kỹ semantics trước khi dùng: Telegram xếp document có `DocumentAttributeVideo` ("sent as video", đúng loại video mọi lần app này upload) vào filter **Video**, không phải filter **Document** — lọc server-side kiểu Document sẽ ÂM THẦM BỎ SÓT chính thứ cần tìm, mà không có lỗi nào báo ra để phát hiện sớm (RPC vẫn trả `200`, chỉ là danh sách thiếu). Chọn `Client::iter_messages()` (`messages.getHistory`, không lọc gì phía server) rồi tự kiểm `DocumentAttribute::Video` sau khi tải về — đúng và nhất quán với cách `fetchHistorySince()` (`gateway-index.ts`, bản TypeScript đã verify thật ở web app) đã làm, không dùng `MessagesFilter` nào ở đó.

**Bounded hay không:** quét TOÀN BỘ lịch sử kênh, KHÔNG giới hạn N tin nhắn gần nhất — khác kiểu "T3 full-scan bounded" mà Index/Browse (web app) dùng. Mục đích của "đối soát" là không bỏ sót file mồ côi nằm sâu trong lịch sử cũ; bounded sẽ làm mất đúng thuộc tính đó.

**Scope tối giản có chủ đích, để dành mở rộng nếu verify thật cho thấy cần:** không có cancel, không có progress event — chỉ spinner "Đang quét…" disable nút trong lúc chạy (`catalog-manager.ts::scanningOrphans`). Cùng mức tối giản với `check_deleted_messages()` (cũng không có cả hai).

**Implementation (`ingest-grammers/src/rpc.rs::scan_channel_videos()`):** loop `iter.next().await` (grammers `MessageIter`) tới khi `None`, bỏ qua tombstone `tl::enums::Message::Empty` (phòng thủ đã áp dụng ở `check_deleted_messages()`, dù `getHistory` không chắc trả biến thể này). Với message có `media()` là `Media::Document`, kiểm `doc.raw.document` có attribute `DocumentAttribute::Video` — nếu có, đẩy `ChannelVideoDocument { msg_id, file_name, size, mime_type, duration_sec }` vào kết quả, dùng accessor public sẵn có của `grammers_client::media::Document` (`name()`/`size()`/`mime_type()`/`duration()`), không tự parse thêm attribute nào khác ngoài check "có Video hay không". `file_name` là `Option<String>` — client Telegram di động gửi "as video" nhiều khi KHÔNG gắn `DocumentAttributeFilename` (đã ghi nhận trước ở `ChannelDiagnosticMessage.hasVideoAttrNoFilename`, `gateway-index.ts`).

**Command Tauri mới (`src-tauri/src/catalog.rs`):** `scan_channel_videos` — cùng khuôn `check_deleted_messages`/`delete_message` (đọc `state.selected_channel`, không nhận `ResolvedChannel` qua IPC). DTO mới `ChannelVideoDocumentDto` (`dto.rs`).

**UI (`catalog-manager.ts`/`.html`):** nút toolbar riêng "Tìm file mồ côi" (tách khỏi "Đối soát với kênh" — chi phí RPC khác hẳn nhau, quét toàn bộ lịch sử tốn hơn hẳn tra đúng tập `msgId` đã biết, giữ tường minh không gộp chung một nút). Không có mồ côi nào → `DialogService.alert()`. Có → dialog mới `OrphanReviewDialog` (`shared/dialog/`, sao y khuôn `GradeDDialog` đã có: toggle từng dòng, mặc định TẤT CẢ được chọn, đóng bằng Esc/bấm ra ngoài/nút "Đóng" → mảng rỗng). Dòng được chọn → `seedMetadataFromFilename()` (`@tsmc/core-ingest`, dùng lại nguyên vẹn, không viết lại luật seed) rồi APPEND thẳng vào `items()` đang sửa — không có UI riêng cho "item mới phát hiện", tái dùng đúng luồng sửa/xoá/publish catalog sẵn có (chỉ có hiệu lực thật trên kênh sau khi bấm "Lưu catalog", giống mọi sửa đổi khác ở màn này).

`cargo build`/`cargo clippy --workspace -- -D warnings`, `ng build`/`npm run lint`/`npm run test:libs` — sạch. **CHƯA verify bằng `cargo tauri dev` + tài khoản thật** — checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--trình-quản-lý-catalog-đối-soát-chiều-ngược-lại-2026-09-16).

## Cập nhật sau khi Accepted (2026-09-17, verify chiều ngược lại — ĐẠT một phần)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

User xác nhận qua `cargo tauri dev` + tài khoản thật: 4/7 bước checklist của addendum 2026-09-16 đã ĐẠT — kênh có video ngoài catalog → "Tìm file mồ côi" hiện ĐÚNG đúng file đó; kênh lành mạnh → báo đúng "không tìm thấy"; bỏ tick một phần trong `OrphanReviewDialog` rồi "Thêm vào catalog" → chỉ đúng dòng còn tick được thêm, "Lưu catalog" ra đúng số item; đóng dialog không bấm "Thêm vào catalog" → không thêm gì. Xác nhận `scan_channel_videos()` (lọc bằng `DocumentAttribute::Video`, không dùng server-side `MessagesFilter`) hoạt động đúng như thiết kế trên dữ liệu kênh thật.

**Còn mở, không chặn (để đó theo yêu cầu user):** file mồ côi không có `DocumentAttributeFilename` (fallback hiển thị `#msgId`) chưa test bằng file thật kiểu này; thời gian quét thật trên kênh có vài trăm/nghìn message chưa đo (v1 không có progress bar); FLOOD_WAIT rơi vào lúc quét chưa gặp tự nhiên (không chủ động ép, CLAUDE.md). Checklist đầy đủ ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--trình-quản-lý-catalog-đối-soát-chiều-ngược-lại-2026-09-16) — ba mục này vẫn còn `[ ]` chưa tick, mục còn lại đã `[x]`.

## Cập nhật sau khi Accepted (2026-09-19, chuẩn hoá size — chặn sớm TRƯỚC upload, `IngestRpc` thêm 1 thao tác)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Brainstorm 2026-09-18 (không code) về "chuẩn hoá size bằng ffmpeg" đưa ra 5 hướng (chặn sớm/hạ audio/re-encode theo bitrate/downscale/split file). User chọn 4 hướng A/C/D/E (bỏ hướng hạ riêng audio bitrate — tiết kiệm được quá ít để đáng một slice riêng), quyết định 2026-09-19: **chỉ code option A trong session này**, ba hướng còn lại (C/D/E) cộng "progress event + cancel cho `remux()`/`reencode_to_mp4()`" đưa vào [docs/roadmap.md § Ingest](../roadmap.md#ingest) cho các session sau — mỗi hướng đổi hành vi remux/reencode ở mức khác nhau, không verify chung một lượt.

**Gap thật, khác addendum 2026-09-13 ở trên:** addendum đó chặn size **REACTIVELY** — đúng lúc `upload_video()` mở kết nối, SAU KHI remux/re-encode đã tốn xong thời gian. Mockup [docs/ux-design.md § A.5](../ux-design.md), dòng "Remux xong vượt trần kích thước", ghi ý định khác: "chặn TRƯỚC khi upload kèm gợi ý... thà biết sớm còn hơn hỏng ở part cuối sau 40 phút" — ý định này chưa từng được code, tới addendum này mới đóng.

**Quyết định (bổ sung, không đổi 4 điều kiện bắt buộc gốc):** thêm method thứ 14 vào `IngestRpc` — `fn max_upload_bytes(&self) -> u64` (`ingest-rpc-trait/src/lib.rs`). Cố ý **KHÔNG async** — không có I/O nào để chờ, chỉ đọc lại field `GrammersIngestRpc::max_upload_bytes` đã cache lúc `new()` (addendum 2026-09-14, tier-aware threshold). Đây là **ngoại lệ thứ chín** không tương ứng 1-1 phía TS.

**Implementation:**
- `GrammersIngestRpc::max_upload_bytes()` — trả thẳng field, không RPC.
- Command Tauri mới `get_max_upload_bytes` (`src-tauri/src/upload.rs`) — khoá `state.conn`, đọc qua `IngestRpc`, lỗi `NotAuthorized`-kiểu nếu chưa `ConnState::Ready`.
- `PreparedUploadDto` (`dto.rs`) thêm field `file_size_bytes: u64` — `pipeline.rs::prepare_upload_blocking()` đọc bằng `std::fs::metadata(&remuxed_path_str)` NGAY SAU remux/re-encode (trước khi trả kết quả về Angular). Lỗi đọc metadata (bất thường thật — file vừa ghi xong) trả lỗi rõ, KHÔNG che bằng giá trị mặc định 0 (0 sẽ vô tình luôn "qua" mọi trần).
- Angular (`workspace.ts::startUpload()`): gọi `getMaxUploadBytes()` MỘT LẦN mỗi batch, TRƯỚC KHI đặt `uploading` (một lỗi hiếm ở đây không kẹt UI ở trạng thái "đang upload" mãi). `processItem()` so `prepared.file_size_bytes` với trần đó NGAY SAU `prepareUpload()`, ném lỗi (`describeSizeCapExceeded()`, `ingest-rpc.ts` — cùng cách diễn đạt GB với case `FileTooLarge` cũ, nhưng gợi ý cụ thể hơn vì phát hiện lúc này còn cơ hội sửa) nếu vượt. Lỗi ném **BÊN TRONG** `try` (không trước) để `finally` hiện có vẫn dọn `temp_dir` như mọi lỗi khác — batch tiếp tục cho các file còn lại, cùng triết lý "một file lỗi không chặn batch" đã có ở mọi bước khác của pipeline này.

**Giới hạn có chủ đích — chỉ "biết sớm hơn", KHÔNG tự sửa gì:** không hạ bitrate audio/video, không tự re-encode lại, không cắt file. Ba hướng chủ động hơn đó nằm ở roadmap, mỗi hướng cần quyết định riêng (re-encode theo bitrate mục tiêu buộc Hạng A/B/C phải decode/encode thật giống Hạng D — cần hỏi xác nhận riêng + một SPIKE nhỏ verify `h264_mf` có tôn trọng `set_bit_rate()`; cắt file cần một ADR riêng vì đụng catalog-spec + player).

`cargo build`/`cargo clippy --workspace -- -D warnings`/`ng build`/`npm run lint`/`npm run docs:check`/`npm run test:libs` (320 test, không đổi) sạch. **CHƯA verify bằng tài khoản Telegram thật** — chưa có file thật vượt trần sau remux để thử qua `cargo tauri dev`. Checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--chuẩn-hoá-size-chặn-sớm-trước-upload-2026-09-19).

## Cập nhật sau khi Accepted (2026-09-19, verify chặn sớm TRƯỚC upload — ĐẠT một phần)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

User xác nhận qua `cargo tauri dev` + tài khoản thật, 3/5 bước checklist của addendum ngay trên đã ĐẠT: (1) file vượt trần sau remux dừng đúng NGAY SAU remux/re-encode, KHÔNG chuyển sang `uploading_video`, thông báo `describeSizeCapExceeded()` hiện đúng số GB thật; (2) cùng batch, file không vượt trần vẫn upload bình thường, không bị ảnh hưởng; (3) xác nhận KHÔNG có RPC `upload_video()` nào được gọi cho file vượt trần — đúng hành vi "chặn TRƯỚC" khác hẳn addendum 2026-09-13 (mở kết nối rồi mới bị chặn).

**Còn mở, không chặn (chưa test, không phải phát hiện lỗi):** dọn `temp_dir` của file bị chặn (`cleanupTempDir()` trong `finally`) chưa xác nhận riêng; nhánh `getMaxUploadBytes()` lỗi (vd mất đăng nhập giữa lúc mở Workspace) chưa tái hiện được để test. Checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--chuẩn-hoá-size-chặn-sớm-trước-upload-2026-09-19) — hai mục này vẫn còn `[ ]` chưa tick, ba mục còn lại đã `[x]`.

## Cập nhật sau khi Accepted (2026-09-19, Option C: tự re-encode theo bitrate mục tiêu khi vượt trần, SPIKE-11 ĐẠT)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

**Điều kiện tiên quyết đã gỡ:** [docs/roadmap.md § Ingest, "Option C"](../roadmap.md#ingest) đặt cược công thức `target_video_bitrate = (target_size_bytes*8/duration_sec) - audio_bitrate - overhead_mux`, gán qua `encoder.set_bit_rate()`, để tự re-encode file vượt trần upload xuống đúng dung lượng cho phép — nhưng lo ngại có thật: `h264_mf` (encoder H264 thật ở `reencode.rs`, xem addendum 2026-09-13 ở trên) đã từng bỏ qua thầm lặng option `preset` (AVOption riêng của `libx264`), nên không có gì đảm bảo `bit_rate` (field khác — gán thẳng `AVCodecContext`, không qua AVOption) cũng được tôn trọng.

[SPIKE-11](../spikes/README.md#spike-11) đo thật (2026-09-19, `cargo run --release --example check_bitrate_control -p ingest-ffmpeg`, không nối vào production): ba pass encode nội dung tổng hợp giống hệt nhau ("plasma" — tổng hợp sóng sin/cos, độ phức tạp mô phỏng video thật, không mượt tuyệt đối/không entropy tối đa) ở target 200/1500/8000 kbps (chênh 40x) cho kích thước output **400,638 → 848,854 → 1,593,486 byte** — tăng đơn điệu thật, và tỉ lệ actual/target **hội tụ dần về gần 1** khi target tăng (3.21x → 0.91x → 0.32x), đúng dấu hiệu rate control thật đang hoạt động, khác hẳn `preset` (bị bỏ qua hoàn toàn, kích thước không đổi bất kể option). Hai lần thử nội dung trước đó (gradient mượt, nhiễu ngẫu nhiên thuần) không kết luận được — xem đầy đủ "Ma trận nội dung thử" ở SPIKE-11, giữ lại làm bài học chọn nội dung đo cho đúng.

**Quyết định (bổ sung, không đổi 4 điều kiện bắt buộc gốc):** `set_bit_rate()` AN TOÀN để dùng cho Option C — công thức target_video_bitrate ở roadmap có cơ sở thật để code tiếp, không còn là giả thuyết chưa đo. Theo đúng ràng buộc đã ghi ở roadmap trước khi có số liệu này:

- Option C là MỘT NHÁNH MỞ RỘNG của Hạng D (`ReencodeAll`) — Hạng A/B/C hiện stream-copy video ở `remux()` (rẻ, đúng ADR-0013); khi vượt trần buộc phải đi qua decode/encode thật lần đầu chỉ vì lý do size, nên bắt buộc hỏi xác nhận riêng (cùng mockup A.2 mục 1), không tự động âm thầm chạy.
- `reencode_to_mp4()` (`ingest-ffmpeg/src/reencode.rs`) hiện KHÔNG set `bit_rate` cho video (chỉ audio có `set_bit_rate(160_000)`) — thêm tham số `target_video_bitrate: Option<u64>` (`None` = giữ nguyên hành vi Hạng D thường, mặc định `h264_mf`; `Some(bps)` = case Option C, gọi `video_enc_ctx.set_bit_rate()` trước `open()`).
- **Phạm vi bằng chứng của SPIKE-11 CHƯA phủ hết:** nội dung tổng hợp (không phải file video thật — video thật nén tốt hơn, nhiều khả năng bám target sát hơn số đo ở đây), không mux ra MP4 (chưa verify `reencode_to_mp4()` production set field đúng cách, chỉ verify bản thân field có tác dụng trên `h264_mf`), một độ phân giải/framerate (640×360@25fps — chưa thử 1080p/4K nơi bitrate cần thiết lớn hơn). Khi code Option C thật, verify lại bằng file mẫu thật (không chỉ tin nguyên số liệu SPIKE-11) trước khi tin công thức ước tính dung lượng output cuối cùng.
- Hai hướng còn lại của brainstorm 2026-09-18 (Option D — downscale đi kèm Option C, Option E — cắt/tách file, cần ADR riêng) vẫn để nguyên ở roadmap, chưa đổi gì bởi addendum này.

**Đã code + verify cục bộ trên `reencode_to_mp4()` production (cùng ngày):** `reencode_to_mp4(input, output, Option<u64>)` (`None` = Hạng D như cũ), `prepare_upload` nhận `target_video_bitrate`, công thức nằm ở TS (`computeTargetVideoBitrateBps()`, `libs/core-ingest/src/size-normalize.ts`: trần × 0.92 margin, trừ 2% overhead mux và audio 160 kbps, sàn 100 kbps) — Rust chỉ thực thi. `workspace.ts::processItem()`: vượt trần sau remux → `DialogService.confirm()` ("Nén lại"/"Bỏ qua") → chạy lại `reencode_all` có bitrate ép → kiểm dung lượng lần hai, vẫn vượt thì lỗi rõ (không lặp). Hỏi lúc này (không gộp vào dialog Hạng D đầu batch) vì dung lượng cuối chỉ biết SAU remux. Fixture tổng hợp 1280×720: target 2 Mbps → 8.2 MB, 6 Mbps → 22 MB, đều lớn hơn bản mặc định (5.2 MB) — bitrate áp thật ở hàm production, lấp caveat "chưa verify production" của SPIKE-11. **Phát hiện đo được:** `h264_mf` có MỨC SÀN theo nội dung — target 600 kbps trên fixture này ra đúng kích thước mặc định (~1.2 Mbps), không hạ thêm được; đây là trường hợp "nén xong vẫn vượt trần" mà kiểm dung lượng lần hai bắt, và là lý do Option D (hạ độ phân giải) còn giá trị. **Bug có sẵn phát hiện thêm:** `reencode_to_mp4()` segfault với audio mono (không do Option C) — ghi ở roadmap. CHƯA verify bằng tài khoản Telegram thật, checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--option-c-nén-lại-theo-bitrate-mục-tiêu-khi-vượt-trần-2026-09-19).

## Cập nhật sau khi Accepted (2026-09-19, kế hoạch chuẩn hoá dung lượng: tiền kiểm, chia phần độc lập, chốt sau brainstorm)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

**Nguồn:** user chạy Option C (addendum ngay trên) bằng một file thật vượt trần — kết quả ĐẠT tổng quát, chưa xác nhận riêng từng bước con. Ba quan sát thật: (a) re-encode rất lâu, user không biết đã tới đâu/còn bao lâu; (b) CPU chỉ dao động 16-25%; (c) user "mù" về thông số — hợp user thường, không hợp power user. Brainstorm cùng ngày (không code) chốt kế hoạch dưới đây. Đây là quyết định sản phẩm/kế hoạch, KHÔNG đổi quyết định gốc về `IngestRpc`/grammers. Chưa có code nào ngoài Option C.

**Đính chính thiết kế của Option C:** dialog "Nén lại" hiện hỏi GIỮA batch — batch chạy lúc user vắng mặt sẽ đứng chờ. Phải chuyển thành bước TIỀN KIỂM trước khi bấm Upload (giống dialog Hạng D). Hạng A/B/C copy video nên biết gần đúng dung lượng đầu ra từ trước remux; dialog giữa batch chỉ còn là lưới an toàn cho "nén xong vẫn vượt trần". Hạng D phải gộp bitrate mục tiêu vào đúng MỘT lần encode (hiện chạy hai lần nếu lần đầu vẫn vượt).

**Quyết định (bổ sung):**

1. **Mặc định chọn chiến lược theo mức cần giảm.** Hạng D luôn nén lại. Hạng A/B/C: `r = trần×0.92 / kích thước file`; cần giảm ≤ 15% → mặc định "Nén lại" (chất lượng gần như không đổi, ra một file), ngược lại mặc định "Chia phần" (không mất chất lượng, vài giây, so với nén hàng chục phút). **Ngưỡng 15% là điểm bắt đầu, điều chỉnh sau khi có dữ liệu thật** — có thể thay hoặc bổ sung bằng chỉ báo chất lượng (bits/pixel) của bản nén tự động. Mỗi thẻ lựa chọn hiện thời gian dự kiến để user tự hiểu vì sao có gợi ý đó.
2. **Chế độ Nâng cao là panel collapsible** trong dialog tiền kiểm (slider kích thước mục tiêu/độ phân giải/audio + chỉ báo chất lượng, khởi tạo tự động — chế độ Tự động này chính là Option D). Trạng thái mở/đóng lưu ở app-data, không dùng `localStorage` (tách theo origin, bài học 2026-09-11).
3. **Dự đoán dung lượng không chỉ bằng công thức:** SPIKE-11 và lần verify thật cho thấy actual/target dao động 0.3x-3x tuỳ nội dung và `h264_mf` có mức sàn theo nội dung. Hiện khoảng ước tính tức thì, kèm nút "ước tính chính xác" encode thử 3 đoạn ngắn (~8s ở 20/50/80%) — cho luôn tốc độ để tính ETA. Khi đang encode thật, hiện dung lượng dự phóng cuối và cảnh báo sớm ở ~10% tiến độ nếu sẽ vượt trần.
4. **Chia phần: mỗi phần là video Telegram độc lập, xem được riêng trên Telegram gốc** (moov/thumbnail/duration riêng, caption "Tiêu đề — Phần i/N", tên file `X.partIofN.mp4`) VÀ nối liền thành một video trên web app. Catalog vẫn là MỘT item logic với `parts[]` (không tách N item — tránh làm bẩn Browse/series/tiến độ xem), `msgId` = phần 1 để client cũ vẫn phát được phần đầu, `subs` riêng từng phần (cue rebased về đầu phần, cue vắt ngang điểm cắt nhân đôi và cắt ngắn) để Player không phải tính offset. Cần ADR MỚI trước khi code (đụng catalog-spec + Player + Sources) — addendum này chỉ ghi các quyết định đã chốt làm đầu vào cho ADR đó.
5. **Cách chọn điểm cắt:** stream-copy nên chỉ cắt được tại keyframe IDR (cắt thông minh — encode lại một đoạn quanh điểm cắt — quá phức tạp, để ngoài phạm vi). Ứng viên = các IDR; chấm điểm chuyển cảnh (x264 thường tự đặt IDR ở chuyển cảnh) cộng bonus im lặng (`silencedetect`, vì cắt âm thanh giữa câu lộ hơn cắt hình), CHỈ phân tích cửa sổ quanh vị trí cắt lý tưởng, không quét cả phim. Chia ĐỀU (4.3 GB → 2×2.15 GB, không phải 3.9+0.4). Kích thước phần chính xác đến byte (cộng dồn packet thật) nên margin chỉ cần ~1-3%, không phải 8% như nén lại. Thuật toán chọn điểm cắt là hàm thuần ở TS (`core-ingest`), Rust chỉ trả ứng viên và thực thi cắt (điều kiện bắt buộc #4). User chỉnh được điểm cắt bằng editor timeline (marker, thumbnail trước/sau, kéo sang ứng viên khác, kích thước từng phần cập nhật trực tiếp và bị chặn khi vượt trần).
6. **Chính sách upload dở:** phần còn trong danh sách upload thì giữ; user xoá item khỏi danh sách thì xoá luôn các phần đã lên kênh; tắt app đột ngột thì để "Tìm file mồ côi" xử lý (cần nhận diện phần qua quy ước tên `partIofN`). Xoá message trên kênh là hành động mạng không hoàn tác — nên hỏi xác nhận như tiền lệ "Xoá khỏi catalog + xoá message trên kênh" (chi tiết này CHƯA được user chốt riêng, để ADR mới quyết).
7. **Nén rồi chia** (vd nén xuống 720p rồi cắt) là ghép hai bước theo thứ tự đó, không cần chế độ riêng.
8. **CPU 16-25%:** nghi ngờ CHƯA đo — decoder và `swscale` mặc định 1 thread khi gọi qua API native, vòng lặp decode→scale→encode tuần tự một luồng; chưa biết `h264_mf` dùng MFT phần mềm hay GPU. Spike đo phân bổ thời gian từng khâu TRƯỚC khi sửa (không sửa theo phỏng đoán). Hướng dự kiến: bật threading, tách pipeline, tuỳ chọn CPU/GPU cho power user, hạ ưu tiên luồng để máy vẫn dùng được.
9. **Web giật lúc chuyển phần:** đo trước rồi mới tối ưu — cơ bản đổi `src` khi hết phần và prefetch phần kế (ADR-0005 cấm MSE nên có hụt nhẹ, chấp nhận; cắt ở chuyển cảnh + im lặng giúp che). Chỉ làm double-buffer hai `<video>` nếu đo cho thấy chưa đủ; iOS có thể chặn phát tự động phần kế nên phải test trên iPad thật. Tiến độ xem lưu theo thời điểm TOÀN CỤC để không hỏng nếu sau này chia lại.

**Thứ tự làm** (mỗi giai đoạn một session riêng, chi tiết ở [docs/roadmap.md § Ingest](../roadmap.md#ingest)): 0 vá crash mono + chuyển tiền kiểm; 1 progress/ETA/huỷ + spike CPU; 2 dialog tiền kiểm (dự đoán, thẻ Chia/Nén, panel Nâng cao); 3 ADR item nhiều phần + spike độ trễ chuyển phần; 4 ingest chia file; 5 Player.


## Cập nhật sau khi Accepted (2026-09-19, Giai đoạn 0: vá crash audio mono + chuyển quyết định vượt trần sang bước tiền kiểm)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Thực hiện Giai đoạn 0 của [kế hoạch ngay trên](#cập-nhật-sau-khi-accepted-2026-09-19-kế-hoạch-chuẩn-hoá-dung-lượng-tiền-kiểm-chia-phần-độc-lập-chốt-sau-brainstorm). Không đổi `IngestRpc` (không thêm method nào).

**1. Vá crash audio mono — nguyên nhân gốc KHÁC với phỏng đoán ở roadmap.** Roadmap nghi "encoder AAC chọn `channel_layout` STEREO nhưng frame chỉ có dữ liệu kênh 0" — đúng kết quả, sai nguồn gốc. Tái hiện được (fixture MKV H.264 + AC3 mono, `STATUS_ACCESS_VIOLATION` ngay ở `reencode_to_mp4()`) rồi đo từng bước: hai lỗi chồng nhau, cùng gốc "tin `ffmpeg-next` đang áp ràng buộc layout" trong khi FFmpeg 7.1 (avcodec 61.19, vcpkg) đã đổi API:
- `aac.channel_layouts()` trả `None` (FFmpeg 7.1 không còn điền `AVCodec.ch_layouts` cho encoder `aac`) nên `.unwrap_or(STEREO)` **luôn** kích hoạt — nguồn stereo chạy đúng chỉ vì trùng hợp.
- `abuffersink.set_channel_layout()` của `ffmpeg-next` 7.1.0 set option `channel_layouts` (đã bị FFmpeg 7.0 gỡ, còn `ch_layouts`) và wrapper **nuốt lỗi** (`let _ = ...`) — ràng buộc layout ở sink không bao giờ được áp, graph `anull` trả frame nguyên layout nguồn. Mono: frame 1 kênh vào encoder 2 kênh → `avcodec_send_frame` đọc con trỏ kênh 1 = NULL → segfault. **Nguồn 5.1 cũng sai lặng lẽ:** đo được frame 6 kênh vào encoder stereo (không crash vì đủ plane, nhưng chỉ đọc hai plane đầu — Hạng C/D với 5.1 trước nay không downmix thật).

Sửa (`ingest-ffmpeg/src/audio_layout.rs`, dùng chung `remux()`/`reencode_to_mp4()`): layout đích tự tính từ số kênh nguồn (1 → mono, còn lại → stereo); ép layout bằng filter `aformat=channel_layouts=...` trong chính chuỗi graph thay cho `anull` (không dựa option sink); thêm `ensure_frame_matches_encoder()` trước mỗi `send_frame` — lệch số kênh giờ trả `Err`, không còn segfault. Kiểm bằng `cargo run --release --example check_audio_channels -p ingest-ffmpeg` trên fixture mono/stereo/5.1, CẢ hai đường (Hạng C `remux(.., true)` và Hạng D `reencode_to_mp4`): đầu ra mono→1 kênh, stereo→2, 5.1→2 (downmix thật), âm thanh không câm (`volumedetect`). **Stereo cho ra file giống hệt từng byte** so với code cũ (202173/309347 byte, cùng warning) — không thoái lui. Hạng C (`remux()`) đúng là cũng dính lỗi này (roadmap chưa kiểm) — mono AC3 là ca điển hình cần Hạng C.

**2. Quyết định vượt trần chuyển từ giữa batch sang TIỀN KIỂM (đính chính thiết kế Option C).** `startUpload()` (`workspace.ts`) giờ chạy `planSizeCap()` (hàm thuần mới, `libs/core-ingest/src/size-normalize.ts`, 4 test) cho từng file TRƯỚC khi bất kỳ file nào bắt đầu xử lý, khi user còn ngồi đó:
- Dự đoán = dung lượng file NGUỒN so với trần (`sourceBytes` mới ở `ProbeResultDto.file_size_bytes`, đọc bằng `std::fs::metadata` trong `probe_media`). Gần sát với Hạng A/B/C (stream-copy), chỉ là cận trên thô với Hạng D — cố ý chưa thêm hệ số hiệu chỉnh, Giai đoạn 2 sẽ thay bằng ước tính chính xác.
- **Hạng D vượt trần:** không hỏi thêm (đã đồng ý re-encode ở dialog Hạng D, dialog đó nay ghi chú "nén thẳng theo bitrate mục tiêu để vừa trần") — bitrate mục tiêu gộp vào **đúng MỘT lần encode** (trước đây chạy mặc định rồi nén lần hai nếu vượt). Đây là phần "Hạng D gộp một lần encode" của Giai đoạn 0.
- **Hạng A/B/C vượt trần:** dialog mới `SizeCapDialog` hỏi MỘT LẦN cho cả batch, toggle riêng từng file. Tick (mặc định) = "Nén lại": `processItem()` đi thẳng `reencode_all` với bitrate mục tiêu, **không còn remux thử trước** (trước đây tốn một lượt remux rồi mới nén). Bỏ tick = bỏ qua file đó, ở lại bảng metadata (cùng cách `GradeDDialog`). "Huỷ upload"/Esc = dừng cả lượt, mọi file còn nguyên trong bảng metadata. *(Bản đầu của addendum này để bỏ tick = "thử nguyên file trước" — bỏ ở phần "Sửa sau lần chạy thử đầu" bên dưới.)*
- **Dialog giữa batch còn lại làm lưới an toàn:** chỉ hiện khi file KHÔNG đi đường nén theo kế hoạch mà dung lượng thật sau remux vẫn vượt (dự đoán theo file nguồn trượt — vd nguồn nhỏ hơn trần nhưng Hạng D mặc định ra file to hơn). File đã nén theo bitrate mục tiêu mà vẫn vượt → lỗi thẳng, không encode lặp (`h264_mf` có mức sàn theo nội dung, xem addendum Option C).

**Còn mở, không thuộc giai đoạn này:** hỏi tiền kiểm hiện là dialog riêng nối tiếp dialog Hạng D (hai dialog liên tiếp nếu batch có cả hai) — Giai đoạn 2 gộp thành một dialog tiền kiểm đúng nghĩa; chưa có lựa chọn "Chia phần" (Giai đoạn 3-4).

`cargo build`/`cargo clippy --workspace -- -D warnings`/`ng build`/`npm run lint`/`npm run test:libs` (328 test, 4 mới) sạch. **Phần audio mono đã verify bằng fixture cục bộ (không cần MTProto). Phần tiền kiểm: user đã chạy thử bằng tài khoản Telegram thật, lỗi phát hiện đã sửa và xác nhận hết (xem "Sửa sau lần chạy thử đầu" bên dưới)** — checklist ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--giai-đoạn-0-tiền-kiểm-vượt-trần--vá-audio-mono-2026-09-19).

### Sửa sau lần chạy thử đầu (2026-09-19, user báo ba lỗi)

Ba lỗi user gặp khi chạy thử luồng ở trên, sửa cùng ngày trong `workspace.ts`:
1. **Hàng đợi/footer lệch:** batch có file vượt trần + file hợp lệ, footer báo "Đã tải 0/2" trong khi hàng đợi chỉ có 1 file. Nguyên nhân (có từ trước Giai đoạn 0, lộ ra vì file đầu giờ nén rất lâu): `batchTotal` = số file được chọn nhưng mỗi file chỉ được đẩy từ bảng metadata sang hàng đợi khi TỚI LƯỢT xử lý — file sau nằm ở bảng metadata suốt lúc file đầu chạy. Sửa: đẩy TOÀN BỘ file được duyệt sang hàng đợi (stage `queued`) ngay khi bắt đầu, `batchTotal` chỉ đếm file thật sự chạy (file bỏ tick ở tiền kiểm không tính).
2. **Hỏi hai lần:** bỏ "thử nguyên file trước" khỏi `SizeCapDialog` — lựa chọn đó tự nó buộc hỏi lại lần hai sau remux, đúng thứ bước tiền kiểm sinh ra để tránh. Bỏ tick giờ = bỏ qua file (ở lại bảng metadata). Thêm cờ `preflighting` (khoá nút Upload + chặn `startUpload()` tái nhập) vì `uploading` chỉ bật SAU các dialog, nên bấm Upload lần hai lúc dialog đang mở/đang đọc trần mở chồng hai lượt tiền kiểm.
3. Tách tiền kiểm ra `preflightUpload()` (trả `UploadPlan`: file sẽ chạy + bitrate mục tiêu + trần) để `startUpload()` chỉ còn lo phần chạy.

**Verify 2026-09-20: user xác nhận cả ba lỗi đã hết** sau khi chạy lại (tổng quát, chưa xác nhận riêng từng bước checklist). **Chưa giải thích được hết:** user còn kể lần chạy đầu vẫn qua remux rồi bị hỏi lại, còn lần chạy sau (thêm lại đúng file đó) thì chỉ 1 dialog rồi nén luôn. Đọc code cho thấy nếu `sourceBytes` có giá trị thì đường đó không thể remux trước — nên nghi lần chạy đầu dùng bản Rust cũ (chưa có `file_size_bytes` → `sourceBytes` rỗng → không dự đoán được → đường cũ), nhưng CHƯA xác nhận. Nếu vẫn gặp sau khi khởi động lại `cargo tauri dev` từ đầu, cần dung lượng file nguồn + hạng (A/B/C/D) + trần của tài khoản để truy tiếp.

## Cập nhật sau khi Accepted (2026-09-29, Giai đoạn 1: progress %/tốc độ/ETA/dung lượng dự phóng + cancel cho `remux()`/`reencode_to_mp4()`)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết
> định đã Accepted ở trên. Mục này chỉ ghi nhận thông tin phát sinh sau đó —
> quyết định gốc **vẫn đứng vững**.

Thực hiện Giai đoạn 1 của [kế hoạch chuẩn hoá dung lượng](#cập-nhật-sau-khi-accepted-2026-09-19-kế-hoạch-chuẩn-hoá-dung-lượng-tiền-kiểm-chia-phần-độc-lập-chốt-sau-brainstorm) — chỉ phần "progress event + cancel cho `remux()`/`reencode_to_mp4()`" (docs/roadmap.md § Ingest). Spike đo phân bổ CPU (decode/scale/encode) của cùng giai đoạn **chưa làm** — để lại cho slice sau, cần số liệu thiết bị thật của bản này trước.

**Quyết định kiến trúc: `ingest-ffmpeg` KHÔNG phụ thuộc `ingest-rpc-trait`.** Cần một kiểu cờ huỷ (`CancelFlag`) + một kênh báo tiến trình (`ProgressSink`) cho `remux()`/`reencode_to_mp4()`, hình dạng gần giống hệt `CancelFlag`/`ProgressSink` đã có ở `ingest-rpc-trait` (dùng cho `upload_video()`, SPIKE-10 M5). Đã xác nhận không có rủi ro vòng lặp dependency nếu thêm (`ingest-ffmpeg` trước đó chỉ phụ thuộc `ffmpeg-next` + `thiserror`, không crate nào phụ thuộc ngược lại). Vẫn **cố ý KHÔNG thêm** — `ingest-rpc-trait` tự khai là "hợp đồng RPC MTProto" (`dto.rs` doc comment: "trait đó giữ opinion-free... vì nó là hợp đồng dùng chung"), kéo nó vào một crate xử lý media thuần FFI (không đụng MTProto/async) là lệch tầng. `ingest-ffmpeg` định nghĩa `CancelFlag`/`PipelineProgress`/`PipelineProgressSink` CỤC BỘ (`ingest-ffmpeg/src/progress.rs`, ~50 dòng) — cùng tinh thần trùng lặp có chủ đích đã áp dụng giữa `remux.rs`/`reencode.rs` (audio encoder setup lặp lại nguyên văn, doc comment đầu `reencode.rs`: "tránh rủi ro đổi hành vi ở một chỗ đã chứng minh chạy đúng").

Hệ quả tầng Tauri: `AppState.active_cancel` (một slot duy nhất, `tokio::sync::Mutex<Option<(String, CancelFlag)>>` trước đây) đổi kiểu giữ trong slot thành enum bắc cầu mới `CancelHandle { Rpc(ingest_rpc_trait::CancelFlag), Ffmpeg(ingest_ffmpeg::CancelFlag) }` (`state.rs`) — KHÔNG đổi chính sách "chỉ một slot vì pipeline chạy tuần tự" đã ghi từ SPIKE-10 M5, chỉ đổi kiểu. `prepare_upload` (Tauri command) giờ đăng ký `CancelHandle::Ffmpeg` vào slot này (trước đây chỉ `upload_video` đăng ký `CancelHandle::Rpc`) — `cancel_upload(task_id)` không đổi gì, gọi `.cancel()` qua enum vẫn hoạt động nguyên vẹn cho cả hai loại tác vụ.

**Chi tiết code:**
- `remux()`/`reencode_to_mp4()` đổi `Result<(), ffmpeg::Error>` → `Result<(), ProcessError>` (`ProcessError { Ffmpeg(ffmpeg::Error), Cancelled }`, mirror `ProbeError` đã có ở `lib.rs`) — foreign type `ffmpeg::Error` không có chỗ cho biến thể "đã huỷ". `ProcessError::Cancelled` map sang `IngestRpcErrorDto::Cancelled` đã tồn tại sẵn phía Tauri, tái dùng nguyên thông điệp "Đã huỷ thao tác." đã có phía Angular — `processItem()` (`workspace.ts`) không cần sửa gì, huỷ giữa remux/reencode tự động có UX giống hệt huỷ giữa upload.
- Tick % tính từ timestamp packet/frame đang xử lý: `packet.dts()`/`pts()` trong vòng lặp packet chính của `remux()` (video ở đó chỉ stream-copy, không decode — đọc TRƯỚC khi hai nhánh video/audio gọi `packet.rescale_ts()` mutate ngay chính packet, đọc sau sẽ ra timestamp sai time_base); `decoded.timestamp()` trong `drain_video()` của `reencode_to_mp4()` (video decode/encode thật, granularity per-frame). Cả hai chia cho `duration_sec` lấy từ MỘT LẦN `probe()` MỚI thêm TRƯỚC remux/reencode trong `prepare_upload_blocking` (`pre_probe`, chỉ mở demuxer đọc header — không decode/encode frame nào); `probe()` gốc SAU remux (`final_probe`, đọc container/codec/size THẬT của output) giữ nguyên vị trí, không bị thay thế.
- Throttle bắt buộc bằng `Instant` cục bộ (~250ms/lần, `maybe_tick()` trong `progress.rs`) trước khi gọi callback — khác `upload_video()` gốc (KHÔNG throttle, dựa cỡ part 512 KiB tự giới hạn tần suất, xác nhận qua grep: zero hit `Instant`/`throttle` ở `ingest-grammers`/`ingest-rpc-trait`), vì granularity per-frame ở `drain_video()` cao hơn hẳn per-part-512KiB, gọi callback không throttle sẽ ra hàng nghìn lần/giây.
- Cancel-check trong `reencode_to_mp4()` đặt BÊN TRONG vòng `while decoder.receive_frame(...)` của `drain_video()`, không chỉ ở vòng packet ngoài — vòng ngoài gọi `drain_video()` cả lúc flush EOF (`video_decoder.send_eof()`), một lần gọi lúc đó có thể rút ra NHIỀU frame đã buffer trong decoder, check chỉ ở ngoài sẽ bỏ lỡ đúng lúc đó.
- Tốc độ x-realtime dùng EMA (`0.7*trước + 0.3*hiện tại`, tính ở `pipeline.rs::prepare_upload` qua `SpeedTracker` nội bộ closure `on_progress`, `std::sync::Mutex` — KHÔNG `RefCell`, vì bound `Send + Sync` của `PipelineProgressSink` bắt buộc). 20 giây đầu (`MEASURING_WINDOW`) trả `None` cho `speed_x_realtime`/`eta_sec` ("đang đo", không bịa ETA từ quá ít mẫu — roadmap đã ghi rõ yêu cầu này). `projected_final_bytes` chỉ tính khi `percent >= 10.0` (`PROJECTION_MIN_PERCENT`, đỡ nhiễu lúc vừa bắt đầu) — đọc `bytes_written` bằng `std::fs::metadata(output_path)` (stat file trên đĩa, KHÔNG móc vào bộ đếm byte nội bộ `AVIOContext` qua FFI, tránh thêm bề mặt `unsafe` mới — số byte có thể trễ vài trăm ms so với thực tế do buffer nội bộ libavformat, chấp nhận được vì chỉ dùng để ước lượng).
- DTO mới `PipelineProgressDto` (`task_id`, `path`, `stage`, `percent`, `speed_x_realtime`, `eta_sec`, `projected_final_bytes`), event Tauri mới `"pipeline-progress"` — TÁCH khỏi `"upload-progress"` (`bytes_sent`/`total_bytes` ở đó là byte MẠNG thật của một lần upload, ý nghĩa khác hẳn) và `"pipeline-stage"` (chỉ bắn một lần mỗi lần đổi stage, không có trường số nào).
- Angular: `onPipelineProgress()` wrapper mới (`ingest-rpc.ts`, cùng nhóm và ĐĂNG KÝ TRƯỚC `getCurrentTask()` trong `attachUploadListenersAndHydrate()`, giữ đúng thứ tự bắt buộc ADR-0018 mục 5), `QueueStore.UploadQueueItem` thêm field `pipelineProgress`. Nút Huỷ (`workspace.html`) mở rộng gate từ chỉ `uploading_video` sang cả `remuxing`/`reencoding` — dùng lại NGUYÊN `cancelUpload(taskId)` đã có (generic theo `task_id`, không theo stage), không cần sửa gì thêm ở đó. % hiện trên `mat-progress-spinner` qua `queueItemProgressPercent()`/`queueItemProgressMode()` mở rộng thêm nhánh remuxing/reencoding.
- **Quyết định UI nhỏ đáng ghi lại:** tốc độ/ETA/dung lượng dự phóng KHÔNG thêm một `matListItemLine` thứ hai dưới `stage-line` như phác thảo ban đầu trong lúc lập kế hoạch — `cdk-virtual-scroll-viewport itemSize="64"` (template `workspace.html`) cố định khớp chiều cao "hai dòng" của MDC (title + ĐÚNG MỘT `matListItemLine`, ghi rõ trong `workspace.scss` dòng 140-143), thêm dòng thứ ba sẽ vỡ layout virtual-scroll (mọi hàng phải cùng chiều cao). Sửa bằng cách NỐI chi tiết vào cùng chuỗi `uploadStageLabel()` (`" · "` ngăn cách), `.stage-line` đã có `text-overflow: ellipsis` nên chuỗi dài tự cắt gọn, không tràn dòng.

**Verify:** `cargo build`/`cargo clippy --workspace -- -D warnings` (cả `ingest-ffmpeg` lẫn `tsmc-ingest-desktop`) sạch, `ng build`/`npm run lint` sạch. Thêm ví dụ mới `ingest-ffmpeg/examples/check_progress_and_cancel.rs` (chạy tay, in tick + verify cancel trả lỗi nhanh không treo/segfault, theo đúng convention `check_*.rs` đã có) — **CHƯA chạy được**, máy dev hiện tại không còn file fixture video thật (`tools/spike-09/fixtures/` đã bị xoá ở slice "khai tử `tsmc-ingest` CLI" trước đó). CHƯA verify bằng file thật, cả ví dụ chạy tay lẫn qua `cargo tauri dev` + tài khoản thật. `[Cần kiểm chứng thiết bị thật]` — checklist ở [docs/pending-device-tests.md](../pending-device-tests.md).
