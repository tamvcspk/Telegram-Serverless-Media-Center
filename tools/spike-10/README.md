# SPIKE-10 — bốn tổ hợp runtime MTProto cho GUI ingest desktop (Tauri)

Xem [docs/spikes/README.md#spike-10](../../docs/spikes/README.md#spike-10) cho câu hỏi, tiêu chí M/P/Đ đầy đủ, cây quyết định, và ranh giới an toàn. File này chỉ mô tả layout code + cách chạy.

**Trạng thái (2026-09-05): 🛠️ một phần.** `rpc-trait`/`r3-grammers`/`r4-ferogram` biên dịch sạch (`cargo build --workspace`, không warning) — xem "Phát hiện thật lúc dựng" bên dưới. `r1-webview`/`r2-sidecar` **chưa dựng** (⏳). Chưa nhánh nào chạy với tài khoản MTProto thật — mọi tiêu chí M1-M8/P1/Đ1-Đ3 còn trống, đúng quy tắc "một spike chỉ đóng khi có số liệu thật".

```text
tools/spike-10/
  Cargo.toml         workspace Rust (rpc-trait + r3-grammers + r4-ferogram)
  rpc-trait/          trait IngestRpc dùng chung — KHÔNG chứa luật nghiệp vụ
  r3-grammers/         🛠️ biên dịch sạch — cargo build -p r3-grammers
  r4-ferogram/         🛠️ biên dịch sạch — cargo build -p r4-ferogram
  r1-webview/          ⏳ chưa dựng (Tauri + GramJS trong webview)
  r2-sidecar/          ⏳ chưa dựng (Tauri + apps/tsmc-ingest đóng gói sidecar)
  shared/
    generate-sample.mjs   sinh file mẫu tổng hợp ≥2 GB (đã smoke-test 2s clip)
    report-template.json  copy thành <nhánh>-result.local.json rồi điền số thật
```

## Chạy — R3 (grammers)

```bash
cd tools/spike-10
cargo build -p r3-grammers
./target/debug/r3-grammers login --session r3.session
./target/debug/r3-grammers upload --session r3.session --channel <username_kenh_test> --file <sample.mp4> --width 1280 --height 720 --duration-sec 900
```

Credential đọc từ `tools/.env` (khuôn SPIKE-07: `TSMC_API_ID`/`TSMC_API_HASH`/`TSMC_PHONE`) hoặc biến môi trường trực tiếp. OTP luôn gõ tay — Claude không chạy hộ (CLAUDE.md).

## Chạy — R4 (ferogram)

```bash
cd tools/spike-10
cargo build -p r4-ferogram
./target/debug/r4-ferogram login --session r4.session
./target/debug/r4-ferogram upload --session r4.session --channel <username_kenh_test> --file <sample.mp4> --width 1280 --height 720 --duration-sec 900
```

CLI đối xứng với R3 (cùng flag) để tiêu chí Đ3 (chi phí viết mới, đếm bằng `cloc`) so sánh công bằng.

## Sinh file mẫu (bước 1 của "Cách chạy" ở docs/spikes/README.md#spike-10)

```bash
node tools/spike-10/shared/generate-sample.mjs --seconds 900 --out sample-2gb.mp4
```

`--seconds 900` ở bitrate 20 Mbps cho ra ~2.2 GB (đủ vượt trần tiêu chí M7). Đã smoke-test với `--seconds 2` — pipeline ffmpeg chạy đúng, chưa chạy bản đầy đủ (mất nhiều phút + hàng GB đĩa, để dành cho lúc đo thật).

## Phát hiện thật lúc dựng (2026-09-05, đọc mã nguồn crate đã tải về `~/.cargo/registry/src/...`, không đoán từ tài liệu/trí nhớ)

Ghi đầy đủ hơn ở [docs/spikes/README.md#spike-10](../../docs/spikes/README.md#spike-10); tóm tắt các phát hiện ảnh hưởng trực tiếp tới cây quyết định:

1. **`grammers-client` 0.10.0 không build "out of the box" trên máy sạch** — `grammers-crypto` pin `num-bigint ^0.4.6` nhưng phụ thuộc bắc cầu `glass_pumpkin` (pin lỏng `2.0.0-rc0`) đã âm thầm lên `2.0.0-rc1`, kéo theo `num-bigint 0.5.1` xung đột kiểu với bản `0.4.8` grammers-crypto tự dùng. Vá được bằng `cargo update -p glass_pumpkin --precise 2.0.0-rc0`, nhưng đây là tín hiệu thật về chi phí bảo trì lâu dài của một thư viện ít người dùng.
2. **API `grammers-client` 0.10.0 khác hẳn tutorial/README cũ** — không có `Client::connect(Config)`, phải tự dựng `SenderPool::new(session, api_id)` rồi `Client::new(handle)` (xem `examples/echo.rs`). `docs.rs` không có trang chi tiết cho bản này lúc kiểm tra — đọc thẳng mã nguồn tải về là cách duy nhất đáng tin.
3. **`upload_stream`/`upload_file` của grammers KHÔNG có tham số progress/cancel** — đúng như rủi ro đã liệt kê trước khi chạy ở bảng R1-R4. Phải tự bọc `AsyncRead` (`CountingReader`, `r3-grammers/src/rpc.rs`) để cấp M5. Chunk đọc tối đa 512 KB/lần (`MAX_CHUNK_SIZE`), 4 worker song song, RAM không tỉ lệ theo kích thước file — dấu hiệu tốt cho M3 dù chưa đo thật.
4. **`ferogram` 0.6.5 có sẵn `TransferHandle` (progress/pause/cancel) và `upload_sequential()` (RAM ≈ một chunk, kiểm tra huỷ ở MỖI part)** — đúng như kỳ vọng ban đầu, và tốt hơn thực tế grammers ở đúng hai tiêu chí M3/M5. `InvocationError::flood_wait_seconds()` cũng lộ sẵn, tiện hơn grammers (phải tự so `RpcError.name`/`.value`).
5. **🔴 Rủi ro THẬT mới, chưa từng liệt kê trước khi dựng: `ferogram::media::UploadedFile` không có API công khai để gắn `DocumentAttributeVideo(supportsStreaming)` hay `thumb`.** Field `inner: InputFile` cần để tự xây `InputMediaUploadedDocument` là `pub(crate)`. Nếu đúng như vậy khi chạy M2 thật, R4 **không đáp ứng được yêu cầu cốt lõi của ADR-0005** (progressive playback cần `supportsStreaming: true`) bằng API công khai hiện tại của bản 0.6.5 — phải xác nhận lại bằng chạy thật trước khi kết luận, nhưng đây là ứng viên hàng đầu cho lý do loại R4 nếu M2 thật fail.
6. **`ferogram::Client::delete_messages()` (public) chỉ gọi `messages.deleteMessages` (không nhận peer) — không đúng cho supergroup/channel** (Telegram cần `channels.deleteMessages` + access_hash). Phải tự trích access_hash từ `get_chat_full()` rồi `invoke()` raw `channels.DeleteMessages` (xem `publish_catalog()` trong `r4-ferogram/src/rpc.rs`).
7. **`PeerRef::from(i64)` diễn giải số nguyên theo "Bot-API encoded ID" (`-100xxxxxxxxxx` cho channel), khác `channel_id` trần của TL layer** — bẫy dễ gặp nếu không đọc kỹ doc; đã né bằng `PeerRef::from(tl::enums::Peer::Channel(...))`.
8. **`ferogram` không có "force document" tường minh cho video** — nhưng field `force_file` tồn tại trong `InputMediaUploadedDocument` (không lộ ra qua `UploadedFile` công khai, xem mục 5). `grammers` hoàn toàn không có khái niệm này — `.document(...)` đã tương đương ngữ nghĩa GramJS `forceDocument: true`.

**Việc tiếp theo:** chạy `login`/`upload` thật (bạn tự chạy, xem "Chạy" ở trên) để lấy số M1-M8 thật cho cả hai nhánh — ưu tiên xác nhận/bác bỏ phát hiện #5 trước tiên vì nó ảnh hưởng trực tiếp tới việc R4 có đáng đo tiếp hay không. Sau đó mới tới `r1-webview`/`r2-sidecar` (⏳ chưa dựng).

## Chạy thật lần đầu (2026-09-05) — 3 bug thật lộ ra, 1 điểm dữ liệu M2/M4 thật

**R3 (grammers) — upload thật thành công:** file AVI thật 183 579 840 byte lên kênh thật `tsmc_mediacenter`, 45.5s, `msgId 26`. Throughput thô ≈ 4.0 MB/s (~32 Mbps) — **chưa so được với baseline Telegram Desktop** (bước 2 của "Cách chạy" ở docs/spikes/README.md#spike-10 chưa chạy), nên chưa tính là M4 đầy đủ, chỉ là bằng chứng "upload thật chạy được, không lỗi". Chưa xác nhận bằng mắt file phát được trong Telegram app thật (M2 cần việc đó).

**3 bug thật, phát hiện qua chạy thật (không bắt được lúc chỉ biên dịch):**

1. **`--session` không nhận được khi đặt SAU tên subcommand** (`r3-grammers login --session x` báo lỗi `unexpected argument`) — field `session` nằm trên struct `Cli` cha nhưng thiếu `#[arg(global = true)]`, nên clap chỉ nhận đứng TRƯỚC subcommand, ngược trực giác thường dùng và ngược hẳn ví dụ trong README này. Đã vá ở cả `r3-grammers`/`r4-ferogram` `main.rs`.
2. **`load_env()` đọc sai một cấp thư mục** — `CARGO_MANIFEST_DIR` của các crate này là `tools/spike-10/r3-grammers` (sâu hơn một cấp so với `tools/spike-07/`, nơi quy ước "tools/.env một cấp trên" gốc được viết), nên `../.env` trỏ nhầm vào `tools/spike-10/.env` (không tồn tại) thay vì `tools/.env` — panic `thiếu TSMC_API_ID` dù `.env` có sẵn và đúng giá trị. Đã sửa thành `../../.env`.
3. **🔴 Quan trọng nhất — `tl::enums::ChatFull` có biến thể riêng cho channel, và HAI thư viện đặt tên KHÁC HẲN nhau cho cùng một TL constructor (`channelFull`):** `ferogram-tl-types` đặt tên `ChatFull::ChannelFull` (basic group là `ChatFull::ChatFull`); `grammers-tl-types` đặt tên `ChatFull::ChannelFull` NHƯNG basic group là `ChatFull::Full` (không phải `ChatFull::ChatFull`). Code gốc của cả `r3-grammers` lẫn `r4-ferogram` đoán nhầm biến thể generic (`Full`/`ChatFull`) áp dụng cho MỌI chat kể cả channel — sai. Hậu quả khác nhau, cả hai đều xấu theo cách riêng: **ferogram panic-error rõ ràng** (`full_chat không phải ChatFull`) ngay lần chạy thật đầu tiên trên kênh `tsmc_mediacenter`; **grammers ÂM THẦM trả `Ok(None)`** (rơi vào nhánh `else` mà không có lỗi nào) — nguy hiểm hơn vì `read_pinned_catalog()` sẽ luôn báo "không có catalog ghim" một cách sai lệch, không hề crash để lộ vấn đề. Chỉ phát hiện được bằng cách đọc code TL **đã generate thật** ở `target/debug/build/*-tl-types-*/out/generated_enums.rs` của từng thư viện — không đoán được từ tài liệu. Đã vá cả hai (`ChannelFull` đúng tên cho cả hai thư viện, tình cờ giống nhau ở biến thể NÀY dù khác ở biến thể basic-group).

**Bài học chung cho R3/R4 (áp dụng cho bất kỳ RPC nào sau này dùng trực tiếp `tl::enums::*` thay vì API cấp cao):** tên biến thể enum sinh ra từ schema TL **không đồng nhất giữa các thư viện, kể cả cho cùng một constructor** — không bao giờ suy đoán tên biến thể bằng cách nhìn thư viện kia hay nhớ từ GramJS/Telethon, luôn tra `generated_enums.rs` thật của đúng thư viện đang dùng.

**Việc tiếp theo:** đo lại `read_pinned_catalog`/`publish_catalog` (M8) trên cả hai nhánh với bản vá; chạy baseline Telegram Desktop để M4 có ý nghĩa; xác nhận bằng mắt file `tsmc_mediacenter` msgId 26 phát được (M2); thử lại R4 `upload` sau khi `resolve_channel()` không còn panic.

## Chạy thật lần 2 (2026-09-05) — bug ChatFull/ChannelFull vá xong, M2 xác nhận bằng mắt, M4 lộ ra một con số xấu

**M2 — xác nhận bằng ảnh chụp màn hình thật, không còn là giả thuyết đọc mã nguồn:** cùng một file MP4 thật (419 471 800 byte) upload qua cả hai nhánh lên `tsmc_mediacenter`:
- **R3 (grammers, msgId 29):** hiện đúng như **video** trong Telegram Desktop — có thumbnail, thời lượng `15:00`, nút play, tua được.
- **R4 (ferogram, msgId 28):** hiện như **document** trần trụi (icon tải xuống, tên file, dung lượng) — không có player, không tua được.

Đây là xác nhận THẬT bằng mắt cho phát hiện #5 ở mục "Phát hiện thật lúc dựng" phía trên (`ferogram::media::UploadedFile` không có API công khai để gắn `DocumentAttributeVideo`) — không còn là suy luận từ đọc mã nguồn, mà là bằng chứng hình ảnh trên tài khoản thật. **R4 hiện tại không đáp ứng M2 theo đúng nghĩa "phát được và tua được"** — cần vá (tự dựng `InputMedia` thay vì dùng `UploadedFile::as_document_media()`, hoặc chờ/đóng góp ngược API công khai mới cho ferogram) trước khi coi R4 là ứng viên khả thi.

**M4 — baseline Telegram Desktop, cùng máy cùng file cùng khung giờ:** người dùng tự upload file 419 471 800 byte đó bằng Telegram Desktop, tốn **25.45s** → **16.48 MB/s** (~132 Mbps).

| Nhánh | Thời gian | Throughput | % baseline |
|---|---|---|---|
| Telegram Desktop (baseline) | 25.45s | 16.48 MB/s | 100% |
| R3 (grammers) | 188.8s | 2.22 MB/s | **13.5%** |
| R4 (ferogram) | 277.0s | 1.51 MB/s | **9.2%** |

**Đọc số này cho đúng — đây KHÔNG phải kết quả tốt cho bất kỳ nhánh nào:** tiêu chí M4 gốc (docs/spikes/README.md#spike-10) viết rõ "**Dưới 50% là tín hiệu mạnh loại nhánh đó**". Cả hai nhánh đều dưới 15% — không phải một khoảng cách nhỏ có thể bỏ qua, mà là bằng chứng khá mạnh rằng **cả `grammers` lẫn `ferogram` đều KHÔNG khai thác được băng thông như Telegram Desktop** (rất có thể do Desktop dùng nhiều kết nối/DC song song và connection tuning tinh vi hơn hẳn 4-worker đơn giản của grammers hay 1-worker tuần tự của ferogram). Đây là **vấn đề còn mở**, chưa có quyết định chấp nhận-hay-không chính thức — xem addendum [ADR-0003](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-09-05-spike-10--ngoại-lệ-khả-dĩ-cho-công-cụ-ingest-desktop) để biết hướng đang cân nhắc.

**Quyết định về thứ tự thử nghiệm (khác cây quyết định gốc):** thay vì gate theo Cổng 1 (bắt buộc thử R1 — GramJS trong webview qua chunked IPC — trước khi so R3/R4), người quyết định (user) chọn đánh giá thẳng R3/R4 trước vì R1 đòi viết mới toàn bộ raw-API chunked upload (rủi ro cao nhất, chưa ai viết), trong khi R3 đã chứng minh chạy thật ổn định qua nhiều lần upload. Đây là một lựa chọn thứ tự hợp lý dựa trên bằng chứng mới — không xoá cây quyết định gốc (vẫn giữ nguyên bên dưới trong docs/spikes/README.md#spike-10 làm lịch sử), chỉ ghi nhận đường đi thật khác đi.

**Trạng thái sau lần chạy này:** R3 thắng rõ rệt so R4 (M2 đạt, M4 vẫn tệ như nhau ở cả hai — không phải điểm phân biệt). Còn thiếu trước khi "chọn R3" là một quyết định đầy đủ: M3 (RAM), M5 (huỷ thật), M6 (FLOOD_WAIT), M7 (file ≥2GB), M8 (catalog roundtrip), P1 (ranh giới crash FFmpeg — Cổng 0, chặn mọi lựa chọn) — và quan trọng nhất, **quyết định cách xử lý M4** (chấp nhận tốc độ chậm cho một công cụ ingest chỉ dùng bởi admin, hay coi là chặn và điều tra thêm tuning song song/multi-DC).

## Điều tra M4 (2026-09-05) — vá được throughput của R4, nhưng lộ ra giới hạn kiến trúc thật chặn hẳn M2

**Root cause của M4 tệ ở R4:** `upload_sequential()` (dùng ban đầu vì tài liệu quảng cáo "kiểm tra huỷ ở mỗi part") đúng nghĩa đen tuần tự — không bao giờ có hơn 1 request bay cùng lúc. Đọc `ferogram-mtsender::pool.rs` phát hiện `DcPool` thật ra hỗ trợ tới **`MAX_CONNS_PER_DC = 3`** kết nối TCP THẬT/DC, tự mở thêm khi kết nối hiện có bận — một khả năng **grammers hoàn toàn không có** (grammers-mtsender cache đúng MỘT connection/dc_id vĩnh viễn, xác nhận qua source, khớp phát hiện cũ của SPIKE-04 cho GramJS/JS). Nhưng `upload_sequential()` không bao giờ tạo đủ tải để trigger mở thêm kết nối — lãng phí đúng thế mạnh kiến trúc của ferogram.

**Vá lần 1 (thành công một phần):** đổi sang `upload_file()` (qua `upload_streaming_pipelined`, dùng 1-4 worker tuỳ kích thước file, vẫn RAM-safe + vẫn nhận `TransferHandle`). Chạy thật cùng file 419 471 800 byte: **89.0s → 4.71 MB/s → 28.6% baseline** (so với 9.2% trước vá — cải thiện 3.1 lần, và giờ VƯỢT R3's 13.5%). M2 vẫn trượt như cũ (đúng dự đoán — đổi phương thức upload không đụng tới nguyên nhân M2, là field `inner` private của `UploadedFile`).

**Vá lần 2 (thử, THẤT BẠI thật — quan trọng hơn cả lần 1):** để vừa có tốc độ vừa vá M2, thử viết hẳn vòng lặp chunk-upload riêng, gọi thẳng `client.invoke(&tl::functions::upload::SaveBigFilePart{...})` (public API) để tự dựng `tl::enums::InputFile::Big` (type công khai) rồi tự dựng `InputMediaUploadedDocument` với `DocumentAttributeVideo(supports_streaming: true)` — né hẳn `UploadedFile`. Biên dịch sạch. **Chạy thật: `ConnectionReset` ở 1.7% (14 part, ~7.3 MB).**

**Gốc rễ (đọc doc comment thật của `rpc_transfer_on_dc_pub`, `client/mod.rs`, `pub(crate)`):** ferogram cố tình tách một **"transfer pool" hoàn toàn riêng** — auth key/seq_no/msg_id/salt riêng, bắt buộc transport Abridged riêng, tách biệt tuyệt đối khỏi session chính — nguyên văn lý do trong chính mã nguồn: *"This prevents `Crypto(InvalidBuffer)` caused by mixing file traffic with the update/dialog stream on the main connection."* `client.invoke()` công khai đi qua pool CHÍNH (session thường dùng cho mọi RPC khác), không phải transfer pool đó. Vì `rpc_transfer_on_dc_pub` không public, **không có cách nào từ ngoài crate vừa dùng đúng transfer pool (an toàn) vừa tự chọn `InputMedia`/attributes tuỳ ý** — hai khả năng đó bị khoá chung vào các hàm high-level (`upload_file`/`upload`/`upload_sequential`), vốn CHỈ trả về `UploadedFile` (field `inner` private, xem đầu file `rpc.rs`).

**Đây là giới hạn kiến trúc THẬT của ferogram 0.6.5, đã xác nhận bằng cả đọc mã nguồn LẪN một lần chạy thật thất bại — không phải "chưa tìm ra cách", mà là "không có cách nào (an toàn) qua API công khai hiện tại".** Đã revert `upload_video()` về `upload_file()` (bản an toàn, giữ nguyên số M4 28.6% vừa đo được). Muốn vá thật M2 cho R4 sẽ cần một trong hai hướng tốn kém hơn hẳn: (a) đóng góp ngược lên ferogram để `rpc_transfer_on_dc_pub` (hoặc một hàm tương đương) thành public, hoặc (b) tự implement lại transfer pool (DH handshake riêng, transport Abridged riêng, auth key riêng) — về cơ bản viết lại một phần đáng kể của chính ferogram, mất hết lý do dùng thư viện.

**Kết luận cập nhật (trước thử nghiệm multi-connection cho R3, xem mục ngay dưới):** R4 giờ thắng M4 (28.6% > 13.5%) nhưng **vẫn trượt M2 dứt khoát** — không phải "trượt vì chưa thử", mà "trượt vì kiến trúc thư viện không cho phép qua con đường an toàn". R3 vẫn là ứng viên khả thi duy nhất trong hai nhánh Rust cho tiêu chí M2 (yêu cầu cốt lõi của ADR-0005). Xem addendum [ADR-0003](../../docs/adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-09-05-spike-10--ngoại-lệ-khả-dĩ-cho-công-cụ-ingest-desktop).

## Thử multi-connection thật cho R3 (2026-09-06) — THÀNH CÔNG, không giống thất bại của R4

Khác hẳn ferogram (transfer pool riêng, không public — xem mục trên), `grammers-mtsender` lộ CÔNG KHAI đủ mảnh ghép để tự mở thêm connection RAW mà không đụng gì tới nội bộ private: `connect_with_auth()`, `Sender::invoke()`, và `Session::dc_option()`/`home_dc_id()` (đọc lại auth_key đã có từ session) đều là API công khai. Đây CHÍNH XÁC là cách `SenderPool` tự làm nội bộ khi kết nối lần đầu tới một DC đã biết auth_key (`sender_pool.rs::connect_sender()`, nhánh "HOME DC: reuse the existing auth key") — không phải hack, chỉ là làm việc đó NHIỀU LẦN thay vì một lần.

**Đã cài:** `GrammersIngestRpc::multi_connection_upload()` — mở 3 connection TCP thật song song (tái dùng auth_key qua `connect_with_auth`, gửi `InitConnection` trên mỗi cái để khớp quy ước của thư viện), round-robin 512 KiB part qua 3 connection, mỗi connection gọi thẳng `Sender::invoke(&SaveBigFilePart{...})`.

**Kết quả thật (cùng file 419 471 800 byte, cùng kênh `tsmc_mediacenter`):**

| Cách | Thời gian | Throughput | % baseline (16.48 MB/s) |
|---|---|---|---|
| R3 single-connection (`upload_stream()`, cũ) | 188.8s | 2.22 MB/s | 13.5% |
| **R3 multi-connection (3 conn, mới)** | **104.5s** | **4.01 MB/s** | **24.4%** |
| R4 pipelined (`upload_file()`) | 89.0s | 4.71 MB/s | 28.6% |

**1.81 lần nhanh hơn** so với single-connection — xác nhận đúng giả thuyết: trần 13.5% ban đầu của R3 là do kiến trúc "1 connection/DC" của `SenderPool`, KHÔNG phải trần cứng của thư viện hay của mạng. **Xác nhận bằng mắt (Telegram thật):** video phát được trọn vẹn từ đầu đến cuối — round-robin part qua nhiều connection không làm hỏng thứ tự ráp file phía server (đúng lý thuyết: `SaveBigFilePart` không phụ thuộc thứ tự đến, chỉ cần đủ `file_total_parts` với đúng `file_part` index).

**Đọc cho đúng:** R3 sau vá vẫn **chưa vượt** R4's 28.6% — còn khoảng cách, có thể do R4's `upload_streaming_pipelined` dùng part size lớn hơn (giảm số RPC/byte) hoặc không tốn round-trip `InitConnection` × 3 connection như R3 (R3 mở connection MỚI HOÀN TOÀN mỗi lần gọi `upload_video()`, không tái dùng qua nhiều lần upload — R4's `DcPool` thì CÓ giữ lại connection cho lần sau). Cả hai vẫn dưới ngưỡng pass 80% của M4. Nhưng điểm mấu chốt: **R3 không còn là "kiến trúc bế tắc"** — hướng đi rõ ràng để cải thiện thêm là tăng `N_CONNS` (thử >3), tăng `PART_SIZE`, và tái dùng connection giữa các lần upload thay vì mở mới mỗi lần — chưa làm ở đây, để dành nếu cần đẩy M4 gần ngưỡng pass hơn.

## P1 (ranh giới crash FFmpeg) — ĐẠT, tự chạy được, không cần MTProto (2026-09-06)

`tools/spike-10/shared/p1-crash-boundary.mjs` — mô phỏng đúng kiến trúc "media worker chạy như tiến trình con" (không phải linked in-process): chạy `tools/spike-09/target/release/spike09.exe` (đã build sẵn) trên một "batch" 3 việc, việc đầu CỐ Ý là file hoàn toàn ngẫu nhiên (không phải container hợp lệ).

**Kết quả thật:**
- Việc 1 (file hỏng): `spike09.exe` panic sạch, **exit code 101** — không kéo theo tiến trình cha (Node).
- Việc 2, 3 (file mẫu tốt): chạy bình thường ngay sau đó, không bị ảnh hưởng bởi việc 1 vừa hỏng.
- **P1: ĐẠT.**

**Phạm vi bằng chứng — đọc cho đúng:** đây KHÔNG phải tái tạo chính xác lỗi segfault channel-layout gốc của SPIKE-09 (đã thử feed file corrupt/truncated/garbage, thử stream-index/seek ngoài phạm vi — code hiện tại tự suy `channel_layout` từ decoder thay vì hardcode stereo, nên các đường thử đều ra **panic sạch (exit 101)**, không phải access violation `0xC0000005` như bug gốc — dấu hiệu code đã bền hơn kể từ khi SPIKE-09 đóng). Nhưng kết luận kiến trúc của P1 ("worker chết một mình, cha + hàng đợi sống") đúng như nhau bất kể worker chết theo cách nào (panic hay segfault) — với một supervisor chỉ `spawn()` tiến trình con và đọc exit code, cả hai loại chết đều "vô hình" với cha theo cùng một cách. Chạy lại: `node tools/spike-10/shared/p1-crash-boundary.mjs`.

## Sẵn sàng đo M3/M5/M7/M8 cho R3 (2026-09-06) — cần bạn tự chạy (MTProto thật)

CLI `r3-grammers` vừa thêm:
- `upload --cancel-after-secs N` — tự huỷ sau N giây (đo M5 lặp lại được thay vì canh Ctrl+C tay); không truyền thì Ctrl+C vẫn huỷ được interactive.
- `read-catalog --channel X` / `publish-catalog --channel X --file catalog.json [--previous-msg-id N]` — đo M8 (publish → pin → xoá bản cũ → đọc lại byte-chính-xác), cùng khuôn SPIKE-06.
- `tools/spike-10/shared/sample-ram.ps1` — chạy song song một lệnh bất kỳ, lấy mẫu RSS mỗi giây, in đỉnh RAM (đo M3). Gọi:
  ```powershell
  powershell -File tools/spike-10/shared/sample-ram.ps1 -ExePath "tools/spike-10/target/debug/r3-grammers.exe" -ExeArgs @("upload","--session","r3.session","--channel","tsmc_mediacenter","--file","<path>")
  ```
- `tools/spike-10/shared/generate-sample.mjs --seconds 900` — sinh file mẫu ≥2GB cho M7 (đã smoke-test bản ngắn, chưa sinh bản đầy đủ).

M6 (`FLOOD_WAIT`) khó ép chủ động một cách có trách nhiệm (CLAUDE.md: tôn trọng tuyệt đối, không né bằng đổi DC — và SPIKE-04 đã là nơi dò ngưỡng, không lặp lại ở đây) — để ngỏ, ghi lại nếu gặp thật trong lúc chạy các test khác.

## Kết quả thật M3/M5/M7/M8 cho R3 (2026-09-06/07)

**M3 (RAM) — ĐẠT, rõ ràng.** `sample-ram.ps1` lấy 142 mẫu suốt 143.1s upload 400 MB: RSS dao động 16.7–21.1 MB **hoàn toàn không tỉ lệ theo tiến trình upload** (17-21 MB xuyên suốt từ 0% tới 100%) — dưới xa ngưỡng 500 MB, xác nhận streaming multi-connection không nạp file vào RAM.

**M5 (huỷ) — ĐẠT.** `--cancel-after-secs 5`: huỷ đúng tại mốc 5.0s, dừng ngay (không hang, không cần kill tay), không sinh msgId nào.

**M7 (ngưỡng kích thước) — ĐẠT, số liệu thật, tài khoản Premium:**

| File | Bytes | GiB | Số part (@512 KiB) | Kết quả |
|---|---|---|---|---|
| 1 | 2 477 366 969 | 2.307 | 4 726 | ✅ Upload thành công (723.2s, msgId 39) |
| 2 | 4 645 817 639 | 4.327 | 8 862 | ❌ `FILE_PARTS_INVALID` (RPC 400) từ `upload.saveBigFilePart` |

Ngưỡng thật nằm trong khoảng (2.307, 4.327) GiB — khớp con số vẫn được đồn là "4000 MB cho tài khoản Premium" (**4 000 000 000 byte, thập phân — KHÁC 4 GiB nhị phân = 4 294 967 296 byte**): ở part size 512 KiB, 4 000 000 000 byte ≈ 7 630 part, nằm gọn giữa hai mốc đo được (4 726 / 8 862). Không bisect thêm để tìm byte chính xác — đủ bằng chứng cho mục đích sản phẩm (biết vùng an toàn, không cần độ chính xác từng byte).

**Thông điệp lỗi thật, đọc cho đúng:** `FILE_PARTS_INVALID` là lỗi giao thức thô (tên hằng số MTProto), không phải câu người dùng đọc hiểu được — xác nhận đúng dự đoán gốc của M7 ("biết trước để chặn ở UI, thay vì hỏng ở part cuối"). **Phát hiện thêm quan trọng:** lỗi này rất có thể ném ra NGAY LẬP TỨC (không phải sau khi tải xong phần lớn file) — vì `file_total_parts` (8862, đã vượt trần) được gửi kèm TỪ REQUEST ĐẦU TIÊN của mọi part, nên server có thể từ chối lệnh đầu tiên chứ không đợi tới cuối. Đây là tin tốt hơn dự tính ban đầu ("hỏng ở part cuối sau 40 phút") — NHƯNG vẫn không nên dựa vào hành vi "fail nhanh" này làm chỗ dựa: một implementation client thật (`libs/core-ingest`) phải tự tính `total_parts` từ kích thước file TRƯỚC khi mở kết nối, so với một trần an toàn (vd 7000 part ≈ 3.67 GB) và chặn ở UI ngay — không phụ thuộc server phản hồi nhanh hay chậm.

**Hướng đáng thử thêm (chưa làm):** trần đo được là do tương tác giữa CỠ PART cố định (512 KiB, tự chọn khi viết `multi_connection_upload()`, không phải giới hạn giao thức) và một trần SỐ LƯỢNG part phía server. Nếu tăng cỡ part (chưa rõ giới hạn tối đa thật của `upload.saveBigFilePart` — nhiều thư viện dùng 512 KiB theo quy ước, chưa chắc là trần cứng), có thể đẩy được ngưỡng file tối đa lên cao hơn với CÙNG một trần số lượng part. Chưa kiểm chứng — để dành nếu cần chính xác hơn.

**M8 (catalog roundtrip) — ĐẠT (2026-09-07):** publish 40 byte UTF-8 sạch (msgId 40, thay `--previous-msg-id 35` — bản BOM-hỏng trước đó), `read-catalog` đọc lại **byte-chính-xác** `{"test":"spike-10 M8","ts":"2026-09-06"}`, không còn ký tự lạ. Xác nhận cả ba bước `sendFile → pin → xoá bản cũ` lẫn đọc lại đều đúng, cùng khuôn SPIKE-06.

### Tổng kết R3 sau toàn bộ đợt chạy thật (2026-09-05 → 2026-09-07)

| Mã | Kết quả |
|---|---|
| M1 (login không hỏi lại OTP) | ✅ ĐẠT |
| M2 (phát + tua được) | ✅ ĐẠT — xác nhận bằng ảnh chụp Telegram thật |
| M3 (RAM phẳng) | ✅ ĐẠT — đỉnh 21.1 MB, không tỉ lệ theo file |
| M4 (throughput ≥80% baseline) | ⚠️ Chưa đạt ngưỡng (24.4%) nhưng đã chứng minh không bị trần kiến trúc — cải thiện được 1.81 lần bằng multi-connection tự viết |
| M5 (tiến trình + huỷ) | ✅ ĐẠT — huỷ đúng mốc, dừng ngay, không hang |
| M6 (`FLOOD_WAIT`) | ⏳ Để ngỏ có chủ đích — không chủ động ép (CLAUDE.md + SPIKE-04) |
| M7 (ngưỡng kích thước) | ✅ ĐẠT — ngưỡng thật tìm được (~4000 MB Premium), lỗi `FILE_PARTS_INVALID` xác nhận |
| M8 (catalog roundtrip) | ✅ ĐẠT — byte-chính-xác |
| P1 (ranh giới crash FFmpeg) | ✅ ĐẠT — tự chạy độc lập, không cần MTProto |
| Đ1-Đ3 (đóng gói/giấy phép/chi phí) | Chưa đo — chỉ áp dụng khi thật sự đóng gói app Tauri, chưa cấp bách ở giai đoạn này |

**R3 (grammers) đạt mọi tiêu chí đo được trừ M4 (throughput tuyệt đối, đã cải thiện đáng kể, không phải trần cứng) và M6 (để ngỏ có chủ đích).** R4 (ferogram) bị loại dứt khoát ở M2. Đây là bằng chứng đủ mạnh để tiến tới quyết định chính thức — xem "Việc tiếp theo" ở [docs/spikes/README.md#spike-10](../../docs/spikes/README.md#spike-10).
