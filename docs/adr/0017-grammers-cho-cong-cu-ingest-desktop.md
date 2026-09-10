# ADR-0017: `grammers` làm MTProto library cho công cụ ingest desktop (Tauri)

- **Trạng thái:** Accepted
- **Ngày:** 2026-09-07
- **Liên quan:** [ADR-0003](./0003-chon-thu-vien-mtproto-gramjs.md), [ADR-0012](./0012-trien-khai-static-pwa-va-cau-truc-workspace.md), [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md)

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

Chi tiết đầy đủ, mọi số liệu, và hai bug thật phát hiện lúc dựng (clap `--session` không nhận global, `.env` sai một cấp thư mục, `tl::enums::ChatFull` hai thư viện đặt tên biến thể channel khác nhau) ở [tools/spike-10/README.md](../../tools/spike-10/README.md).

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
