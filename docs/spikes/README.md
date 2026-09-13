# Spikes — kiểm chứng giả thuyết trước khi cam kết kiến trúc

Mỗi spike ở đây tồn tại vì một ADR đang **đặt cược vào một điều chưa được chứng minh**. Spike chưa chạy thì kết luận trong ADR vẫn chỉ là giả thuyết, và tài liệu phải nói đúng như vậy.

Quy tắc: **một spike chỉ đóng khi có số liệu từ thiết bị thật**, không đóng bằng lập luận hay bằng tài liệu của bên thứ ba.

| ID | Câu hỏi | Đặt cược ở ADR | Trạng thái |
|---|---|---|---|
| [SPIKE-01](#spike-01) | Media element có đi qua Service Worker không, đặc biệt trên Safari/iOS? | [0005](../adr/0005-streaming-qua-service-worker-http-range.md), [0004](../adr/0004-mo-hinh-da-luong.md) | 🟢 **ĐẠT trên iPad thật (WebKit)** và Chrome desktop; rủi ro chính đã gỡ |
| [SPIKE-02](#spike-02) | GramJS xử lý `CDN_REDIRECT` tới đâu? | [0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md), [0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) | 🟡 **Đã đóng (chấp nhận)** — 250/250 chunk thành công qua đường tải không-CDN; CDN_REDIRECT chưa từng xảy ra trong test, chấp nhận rủi ro thấp cho use-case chính, xử lý khi gặp thật |
| [SPIKE-03](#spike-03) | Bundle GramJS nặng bao nhiêu, TTI ra sao? | [0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md) | 🟢 Đạt (236 KB brotli, ~110 ms) — 🔴 nhưng phát hiện `telegram` đã bị archive, cần bạn quyết hướng đi |
| [SPIKE-04](#spike-04) | Tốc độ tải thực tế và ngưỡng `FLOOD_WAIT` | [0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) | 🟡 **Đã đóng (chấp nhận)** — ~1.1 GB tải liên tục ở mức 4/8 request đồng thời, 0 lần gặp `FLOOD_WAIT`; trần thật chưa lộ ra nhưng đủ bằng chứng cho use-case phát phim thật |
| [SPIKE-05](#spike-05) | Angular Material + CDK ăn bao nhiêu ngân sách app shell? | [0016](../adr/0016-angular-material-va-cdk.md) | ⏳ Chưa dựng — chạy ngay sau khi scaffold |
| [SPIKE-06](#spike-06) | Ghi `catalog.json` lên kênh media qua MTProto thật (`sendFile`→`pinMessage`→`deleteMessages`) có đúng như thiết kế không? | [0014](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md), [0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md), [0009](../adr/0009-dong-bo-state-event-log-va-snapshot.md) | 🟢 **Đạt (2026-08-28)** — cả 5 tiêu chí A-E đạt trên tài khoản thật, publish/update/xoá đều đúng như thiết kế |
| [SPIKE-07](#spike-07) | Forum Topics API của GramJS `2.26.22` có dùng được để categorize phim theo topic không? | [0010](../adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md) | 🟢 **Đạt (2026-08-29)** — tạo nhóm forum, tạo topic, `GetForumTopics` liệt kê đúng, và quét lịch sử suy ra đúng topic mỗi message thuộc về (`replyToTopId ?? replyToMsgId` khi `forumTopic`) — cả 4 lần chạy trên tài khoản thật, lần cuối A-E đều đạt |
| [SPIKE-08](#spike-08) | Trong 3 API dò khả năng phát (`canPlayType`/`MediaSource.isTypeSupported`/WebCodecs `isConfigSupported`), cái nào khớp đúng khả năng phát THẬT của `<video src>` theo ADR-0005 (progressive, không MSE)? | [0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md), [0005](../adr/0005-streaming-qua-service-worker-http-range.md) | ⏳ Chưa dựng |
| [SPIKE-09](#spike-09) | `ffmpeg-next`/`ffmpeg-sys-next` (native Rust FFI) có khả thi thay shell-out CLI hiện tại của `tsmc-ingest`, với chi phí/tốc độ nào so với baseline 40.8x realtime đã đo? | [0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md) | 🟢 **Đạt, có caveat (2026-09-03, tích hợp thật + sửa số liệu 2026-09-04)** — cả 3 việc chạy được, 72.1x realtime (file mẫu tổng hợp), 7 DLL ~21.3 MB tự chứa (không cần PATH); hai rủi ro khác hẳn nhau đã đo được thật: sai tham số FFI → **segfault**, thiếu DLL → **DLL_NOT_FOUND** (không phải segfault) |
| [SPIKE-10](#spike-10) | Trong 4 tổ hợp runtime khả dĩ cho GUI ingest desktop (Tauri), tổ hợp nào chịu được upload file ≥2 GB với RAM phẳng + có tiến trình/huỷ + không mất việc khi `FLOOD_WAIT` + crash FFmpeg không giết UI, với chi phí viết mới và đóng gói thấp nhất? | [0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md), [0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md), [0012](../adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md), [0017](../adr/0017-grammers-cho-cong-cu-ingest-desktop.md) | 🟡 **Đã đóng, chấp nhận rủi ro (2026-09-07)** — chọn R3 (`grammers-client`), xem [ADR-0017](../adr/0017-grammers-cho-cong-cu-ingest-desktop.md). M1/M2/M3/M5/M7/M8/P1 ĐẠT thật trên tài khoản Telegram thật; R4 (ferogram) trượt M2 dứt khoát (transfer pool riêng, không public). M4 cải thiện 13.5%→24.4% nhưng chưa qua ngưỡng pass 80% (chấp nhận, không phải trần kiến trúc); **M6 (`FLOOD_WAIT`) để ngỏ có chủ đích, không chủ động ép** — đây là lý do đóng 🟡 thay vì 🟢, KHÔNG đổi dù Đ1/Đ2 sau này đều ĐẠT. **Cập nhật 2026-09-13:** Đ2 (giấy phép FFmpeg) đo thật lúc đóng gói `.exe` lần đầu — giữ LGPL, không kéo GPL (encoder H264 thật là `h264_mf` của Windows, không phải `libx264`). **Cập nhật tiếp cùng ngày:** Đ1 (đóng gói máy sạch) ĐẠT — user xác nhận cài+chạy bản đóng gói (MSI/NSIS kèm 7 DLL) trên máy không có vcpkg/LLVM/Rust/Node, không còn lỗi thiếu FFmpeg; Đ3 vẫn chưa đo |

---

## SPIKE-01

**Câu hỏi:** Khi `<video src="/_stream/...">`, request của media element có đi vào `fetch` handler của Service Worker không — và nếu có, chuỗi `Range` diễn ra thế nào khi tua?

**Vì sao quan trọng:** nếu câu trả lời là "không" trên iOS, toàn bộ Epic 4 không chạy được trên iPhone/iPad và ta phải biết điều đó **trước khi** viết download scheduler, chứ không phải sau.

> **Mã nguồn đã xoá (2026-08-24)** sau khi spike đóng và số liệu đã ghi lại đầy đủ bên dưới — không còn cần kiểm chứng lại, xem [docs/adr/README.md](../adr/README.md) cho nguyên tắc "một spike chỉ đóng khi có số liệu thật". Lịch sử mã nguồn vẫn còn trong git log nếu cần soi lại. Phần "Cách chạy" dưới đây mô tả cách spike ĐÃ chạy, không còn thực thi được nữa.

### Bàn thử nghiệm
`spike/` (đã xoá) — trang tĩnh độc lập, **không cần Telegram, không cần build, không phụ thuộc Angular**.

Nó dựng lại đúng đường đi thật của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md), chỉ thay nguồn byte:

```text
KIẾN TRÚC THẬT :  <video> → SW → Core Worker → MTProto → Telegram DC
TESTBED        :  <video> → SW → tab (File.slice) → file trên máy
                            ↑ giống hệt nhau: MessageChannel + ArrayBuffer transferable
```

Việc cố ý tách khỏi Telegram là điểm mấu chốt: nếu spike hỏng, ta biết chắc lỗi thuộc về trình duyệt chứ không phải MTProto, GramJS hay mạng.

### Cách chạy (lịch sử — mã nguồn đã xoá)
```bash
# Tự động trên Chrome/Edge cài sẵn (chỉ phủ được desktop Chromium)
npm run spike:auto -- "D:/duong/dan/phim.mp4"

# Thủ công, cục bộ (localhost là secure context nên SW chạy được)
npm run spike

# Trên thiết bị thật — bắt buộc cho phần iOS
npm run deploy:spike        # → https://<project>--spike-01-<hash>.web.app
```

Mở URL trên máy cần test → chọn một file video → bấm lần lượt A, B, C → bấm **Copy báo cáo** → dán vào bảng kết quả bên dưới.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| A | `fetch()` kèm `Range: bytes=1000-1999` | status `206`, đúng 1000 byte. Đây là baseline — hỏng ở đây nghĩa là testbed sai, không phải trình duyệt sai |
| **B1** | SW có thấy request với `destination: "video"` | **Đây là câu trả lời của spike.** Không thấy = media element đi vòng qua SW |
| B2 | Video phát được | có sự kiện `loadeddata` |
| C | Tua tới 80% | có sự kiện `seeked`, và SW ghi nhận một `Range` mới với offset lớn |
| D | Chịu được độ trễ | đặt độ trễ giả lập 500 ms, B2 và C vẫn đạt (mô phỏng round-trip thật tới DC) |

### Ma trận thiết bị cần phủ

| Nền tảng | A | B1 | B2 | C | D | Ghi chú |
|---|---|---|---|---|---|---|
| Chrome 151 (Win 11, headless) | ✅ | ✅ | ✅ | ✅ | ✅ | 2026-08-23, chạy tự động |
| **iPad, iPadOS 26.6 (thiết bị thật, CriOS/WebKit)** | ✅ | ✅ | ✅ | ✅ | — (chưa test độ trễ giả lập) | **2026-08-23, chạy tay — kết luận chính của SPIKE-01** |
| Firefox desktop | — | — | — | — | — | chưa chạy |
| Safari macOS | — | — | — | — | — | chưa chạy |
| Safari iOS (bản Safari gốc, không phải CriOS) | — | — | — | — | — | không bắt buộc — xem ghi chú dưới |
| Chrome Android | — | — | — | — | — | chưa chạy |

> Chrome trên iOS dùng WebKit, nên nó **không** là một phép thử độc lập — kết quả của nó đi cùng Safari iOS.

### Kết quả

#### Chrome 151 / Windows 11 · 2026-08-23 · file MP4 H.264 14.2 MB

| Mã | Kết quả | Số đo |
|---|---|---|
| A | ✅ ĐẠT | `206`, `Content-Range: bytes 1000-1999/14933151`, đúng 1000 byte |
| **B1** | ✅ **ĐẠT** | SW thấy request với `destination: "video"` — media element **có** đi qua Service Worker |
| B2 | ✅ ĐẠT | khung hình đầu tiên sau **100 ms** |
| C | ✅ ĐẠT | seek tới 80% mất **272 ms** |
| D | ✅ ĐẠT | với độ trễ giả lập 500 ms/chunk: khung đầu sau **2101 ms** (4 chunk nối tiếp) |

**Quan sát đáng giá hơn cả kết quả đạt/không đạt:**

1. Chrome mở đầu bằng `Range: bytes=0-`, rồi **lập tức nhảy tới gần cuối file** (`bytes=12419072-`) để tìm `moov` atom, rồi mới quay lại `bytes=1048576-`. Đây là bằng chứng thực nghiệm cho yêu cầu `+faststart` ở [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md): file không faststart sẽ tốn thêm một vòng round-trip tới **cuối** file trước khi phát được khung hình đầu tiên — với MTProto là vài trăm ms bị mất trắng ở mỗi lần mở phim.
2. Player **không** yêu cầu tuần tự. Chỉ trong một lần seek nó phát ra 5 range chồng lấn nhau. Điều này xác nhận rằng scheduler ở [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) phải huỷ được request đang bay, nếu không mỗi thao tác tua sẽ để lại vài pipeline mồ côi.
3. Chiến lược "cửa sổ giới hạn" của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md) hoạt động đúng như thiết kế: trả 2 MB cho một `Range: bytes=0-` mở, và player tự xin tiếp mà không phàn nàn.
4. Phép đo D lần đầu cho ra 52 ms — **sai**, do media element phục vụ lại từ cache khi URL không đổi. Đã sửa testbed để mỗi lần chạy dùng token mới. Ghi lại ở đây vì đây đúng là loại bẫy sẽ làm sai lệch mọi benchmark streaming về sau.

#### iPad, iPadOS 26.6 / Chrome iOS (CriOS 151, WebKit) · 2026-08-23 · deploy thật trên `tsmc-staging.web.app`, không phải localhost

File thử: `IMG_0953.mov` (65.9 MB, 35.2s) và `IMG_0842.mov` (119.4 MB, 63.9s) — video quay trực tiếp bằng camera thiết bị, mã hoá `video/quicktime`.

| Mã | Kết quả | Số đo |
|---|---|---|
| A | ✅ ĐẠT | `206`, đúng `Content-Range`, đúng 1000 byte |
| **B1** | ✅ **ĐẠT** | SW thấy request với `destination: "video"` — **media element có đi qua Service Worker trên WebKit thật** |
| B2 | ✅ ĐẠT | khung hình đầu tiên sau **124 ms** (file 1) / **124 ms** (file 2) |
| C | ✅ ĐẠT | seek tới 80% mất **257 ms** |
| D | — | chưa bấm nút test độ trễ giả lập trong lần chạy này |

**Đây là câu trả lời của toàn bộ SPIKE-01: trên WebKit thật, `<video>` đi qua Service Worker và toàn bộ chuỗi HTTP Range hoạt động đúng như thiết kế của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md).** Rủi ro "Epic 4 chết trên iOS" ở [architecture.md § 7](../architecture.md#7-rủi-ro-lớn-nhất--trạng-thái-kiểm-chứng) được gỡ.

**Lưu ý về phạm vi bằng chứng:** trình duyệt thử là Chrome iOS (CriOS), không phải Safari gốc. Trên iOS, Apple bắt buộc **mọi** trình duyệt — kể cả Chrome — dùng chung engine WebKit và chung cơ chế Service Worker/media pipeline của hệ điều hành (khác Android, nơi Chrome dùng Blink riêng). Vì vậy kết quả này về nguyên tắc áp dụng cho Safari luôn. Test Safari gốc một lần là việc nên làm cho chắc chắn tuyệt đối, nhưng không còn là việc chặn tiến độ.

**Quan sát khác với hành vi trên desktop Chrome — cần đưa vào thiết kế thật:**

1. **WebKit dò khả năng trước khi xin dữ liệu thật:** request đầu tiên luôn là `Range: bytes=0-1` (probe 2 byte) rồi mới tới `Range: bytes=0-<hết file>` (open-ended, không giới hạn như desktop Chrome vốn tự giới hạn cửa sổ). SW của testbed vẫn tự kẹp về `windowSize` (2 MB) đúng như thiết kế — **nhưng đây là bằng chứng cho thấy scheduler thật không được tin vào `end` mà client gửi lên, phải luôn tự áp trần cửa sổ**, đúng nguyên tắc đã có ở [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md), giờ được xác nhận là cần thiết chứ không phải phòng xa thừa.
2. **WebKit bắn request dồn dập và trùng lặp nhiều hơn hẳn desktop khi tua/kéo thanh tiến trình** — có thời điểm ghi nhận 7 request giống hệt nhau (`Range: bytes=69140480-69141961`) trong vòng chưa tới 10 ms. Đây là tín hiệu mạnh cho [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md): scheduler thật **bắt buộc phải de-dup request trùng offset đang bay** trước khi bắn RPC MTProto mới, nếu không mỗi lần user kéo thanh tua trên iOS sẽ nhân bản request gấp nhiều lần so với desktop và tiêu tốn oan uổng ngân sách song song ([ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md)).
3. Một chunk mất **1009 ms** để phục vụ dù độ trễ giả lập = 0 (dòng `22:25:38.941`) — nhiều khả năng do tab bị điều tiết nền hoặc áp lực bộ nhớ trên thiết bị thật, thứ không bao giờ xuất hiện khi test trên desktop/headless. Đúng loại rủi ro mà chỉ thiết bị thật mới lộ ra.
4. File `.mov`/QuickTime từ camera Apple phát được ngay dù cảnh báo compat của testbed nói "có thể không giải mã được" ([ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md)) — hợp lý vì đây là định dạng gốc của chính hệ sinh thái Apple. Không nói lên gì về khả năng phát MKV/AVI từ kho cộng đồng, bảng phân hạng compat ở ADR-0013 vẫn giữ nguyên.

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động |
|---|---|
| Đạt hết mọi nơi *(đã xảy ra)* | [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md) được xác nhận thực nghiệm. Việc còn lại: đưa 2 quan sát về de-dup request và không tin `end` của client vào thiết kế scheduler thật ở Epic 4, không phải viết lại kiến trúc |
| Đạt trừ iOS | *(đã loại — iOS đạt)* |
| B1 đạt nhưng C hỏng khi có độ trễ | Vấn đề nằm ở timeout/cửa sổ, không phải kiến trúc — chỉnh kích thước cửa sổ và chiến lược readahead ở [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) |
| B1 hỏng ở mọi nơi | *(đã loại)* |

---

## SPIKE-02

**Câu hỏi:** GramJS xử lý `CDN_REDIRECT` (`upload.getCdnFile` + AES-CTR + `upload.getCdnFileHashes`) tới mức nào? Nếu thiếu, chi phí tự viết là bao nhiêu?

**Cần:** `API_ID`/`API_HASH` thật, một tài khoản test, một file lớn (> 1 GB) trên kênh công khai đông người tải — vì chuyển hướng CDN chỉ xảy ra với file phổ biến.

**Ghi lại:** tần suất gặp `CDN_REDIRECT` trên nhiều lần tải chunk rải khắp file; GramJS có tự xử lý không (`downloadMedia()` cấp cao có trả đúng kích thước không); nếu có, nó có xác minh hash không.

### Vì sao Claude không tự chạy spike này

Trạng thái đăng nhập MTProto không phải là "một API key" — nó là **toàn quyền tài khoản Telegram thật**: đọc/gửi tin nhắn, xoá tài khoản, mạo danh chủ tài khoản. Việc đăng nhập đòi hỏi số điện thoại và mã OTP gửi trực tiếp tới thiết bị của bạn — một luồng tương tác con người không thể (và không nên) chạy qua tool call của Claude. Đây đúng là mô hình đe doạ mà chính [ADR-0011](../adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) mô tả cho ứng dụng thật; áp dụng luôn cho cách ta kiểm chứng spike.

> **Mã nguồn đã xoá (2026-08-24)** sau khi đóng spike — số liệu bên dưới là bằng chứng đã ghi lại, không còn cần chạy lại. Lịch sử mã nguồn vẫn còn trong git log.

### Cách chạy (lịch sử — mã nguồn đã xoá) — **bạn tự chạy trong terminal của bạn**

Tool từng ở `tools/spike-02/`, chia hai bước tách bạch:

```bash
cd tools/spike-02
npm install

# Bước 1 — đăng nhập một lần. Hỏi số điện thoại + mã OTP ngay trong terminal.
# Session sinh ra chỉ ghi vào file cục bộ .session.local (đã gitignore),
# không bao giờ in ra, không dán vào chat với Claude.
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run login

# Bước 2 — quét một kênh public đông người tải, tìm file lớn, đo CDN_REDIRECT.
# Gọi "node scan.mjs" trực tiếp, KHÔNG dùng "npm run scan -- ...": trên
# PowerShell (và một số shell Windows khác), npm tự nuốt mất mọi --flag đứng
# sau dấu -- khi chạy qua "npm run" — kể cả dạng --flag=value — coi chúng là
# cấu hình riêng của npm thay vì chuyển vào script. Gọi node trực tiếp thì
# không bị ăn mất.
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  node scan.mjs --peer <username_kenh> --limit 60 --minSizeMb 500
```

Kết quả ghi ra `docs/spikes/spike-02-result.local.json` — file này **chỉ chứa số liệu tổng hợp** (kích thước file, số lần redirect, kết quả `downloadMedia()`), không chứa session, không chứa số điện thoại. An toàn để dán nội dung vào chat cho Claude đọc và viết lại phần Kết quả bên dưới.

**`--peer` là số thuần** (ví dụ copy từ link `t.me/c/<id>/...`): script tự ép về `BigInt` và, nếu channel chưa có trong cache của session, tự gọi `getDialogs()` một lần để nạp cache rồi thử lại — không cần tự làm gì thêm. Nếu vẫn không tìm thấy, khả năng cao tài khoản đang dùng chưa là thành viên của kênh đó.

### Kết quả

#### "Group học tập" · 2026-08-23 · 5 file, 530–962 MB, 50 chunk/file (250 chunk tổng)

| File | Kích thước | Bình thường | CDN_REDIRECT | Lỗi | `downloadMedia()` cấp cao |
|---|---|---|---|---|---|
| 1 | 530 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 2 | 575 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 3 | 735 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 4 | 629 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |
| 5 | 962 MB | 50/50 | 0 | 0 | ✅ đúng kích thước |

**Đọc kết quả này cho đúng — không vội kết luận "GramJS xử lý tốt CDN_REDIRECT":**

- Đây là kết quả **0/250, không phải "đạt 250/250"** theo nghĩa tích cực. Cả tầng thấp (`upload.getFile` trực tiếp) lẫn tầng cao (`downloadMedia()`) đều **không hề gặp một lần `CDN_REDIRECT` nào**, nên spike **chưa thực sự kiểm chứng được** cách GramJS xử lý redirect đó — vì tình huống đó chưa từng xảy ra trong lần chạy này.
- Lý do rất có thể: `CDN_REDIRECT` chỉ được Telegram kích hoạt cho file bị **rất nhiều người tải đồng thời** (để giảm tải DC gốc) — tiêu chí gốc của spike ghi rõ "kênh công khai đông người tải". "Group học tập" là nhóm riêng tư/nhỏ, không tạo đủ tải để kích hoạt cơ chế đó. Tiêu chí ">1 GB" cũng chưa đạt (file lớn nhất 962 MB).
- **Điều spike này CÓ chứng minh được, và có giá trị thật:** đường tải chính (không qua CDN) hoạt động **hoàn toàn ổn định và chính xác** ở quy mô file gần 1 GB — 250/250 lần gọi `upload.getFile` thành công, không một lỗi `FILE_REFERENCE`/`FLOOD_WAIT` nào xuất hiện, và `downloadMedia()` cấp cao khớp byte-chính-xác cả 5 lần. Đây chính là đường đi thật của **tuyệt đại đa số nội dung trong kho cá nhân và các nhóm cộng đồng vừa/nhỏ mà TSMC nhắm tới** ([ADR-0014](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)) — không phải nội dung viral hàng chục nghìn lượt tải cùng lúc.

**Đã chốt (2026-08-23):** chấp nhận kết quả hiện tại, đóng spike ở đây — không chạy thêm trên kênh public đông người tải. Lý do: [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) đã thiết kế phòng thủ sẵn cho `CDN_REDIRECT` (xác minh hash bắt buộc) bất kể tần suất gặp phải trong thực tế; rủi ro còn lại (chưa kiểm chứng cách GramJS xử lý redirect thật) được đánh giá là thấp cho đúng use-case chính của TSMC — kho cá nhân và nhóm cộng đồng vừa/nhỏ ([ADR-0014](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)), không phải kênh viral hàng chục nghìn lượt tải đồng thời. Sẽ xử lý khi gặp thật ở giai đoạn build Epic 4.

---

## SPIKE-03

**Trạng thái:** 🟢 Đã chạy (2026-08-23) — kèm một phát hiện ngoài dự kiến làm phát sinh quyết định cần bạn duyệt, xem cuối mục.

**Câu hỏi:** GramJS đóng gói cho trình duyệt nặng bao nhiêu (gzip/brotli), và mất bao lâu để khởi tạo client trên máy tầm trung?

**Ngưỡng chấp nhận:** app shell dưới 300 KB brotli (không tính GramJS, được lazy-load riêng theo [ADR-0004](../adr/0004-mo-hinh-da-luong.md)); Core Worker nạp lười và không chặn màn hình đăng nhập.

> **Mã nguồn đã xoá (2026-08-24)** sau khi đóng spike — cấu hình esbuild (polyfill Node cho `fs`/`net`/`tls`) đã được đưa nguyên xi vào `libs/worker-host/build.mjs` khi triển khai slice Auth (F1.1), xem [ADR-0012 § Cập nhật sau khi Accepted](../adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-auth-f11). Lịch sử mã nguồn vẫn còn trong git log.

### Cách chạy (lịch sử — mã nguồn đã xoá)
```bash
node tools/spike-03/build.mjs     # bundle bằng esbuild, in kích thước raw/gzip/brotli
node tools/spike-03/measure.mjs   # nạp bundle trong Chrome thật, đo thời gian import + khởi tạo
```
Không cần credential — chỉ dựng object `TelegramClient`, không gọi `connect()`.

### Kết quả — GramJS (`telegram@2.26.22`, bundle bằng esbuild + `esbuild-plugin-polyfill-node`)

| Số đo | Giá trị |
|---|---|
| Bundle raw | 986.7 KB |
| Bundle gzip | 284.1 KB |
| **Bundle brotli** | **236.2 KB** |
| Thời gian nạp module (Chrome thật, localhost) | 106.7–112.4 ms |
| Thời gian `new TelegramClient(...)` | 0.7–1.3 ms |
| **Tổng, từ 0 tới có client sẵn sàng** | **~108–114 ms** |

Build **thành công ngay cả khi stub rỗng cho `fs`/`net`/`tls`** — nghĩa là nhánh code thật sự chạy trong browser (transport WebSocket) không đụng tới các API đó lúc runtime, dù bundler vẫn cần phân giải chúng tĩnh. Xác nhận đúng tuyên bố "hỗ trợ browser" ở [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md). 236 KB brotli cho một thư viện MTProto đầy đủ (TL schema, crypto, transport) là con số tốt, và vì nó nằm trong Core Worker lazy-load ([ADR-0004](../adr/0004-mo-hinh-da-luong.md)) nên không cộng vào ngân sách app shell 300 KB.

> ⚠️ **Sửa lại một kết luận ở trên (2026-08-24, slice Auth F1.1):** "không đụng tới các API đó lúc runtime" **đúng cho `fs`/`net`/`tls`**, nhưng **sai cho `crypto`** — spike này chỉ đo lúc *nạp* bundle (`new TelegramClient(...)`, không gọi `connect()`, xem "Cách chạy" ở trên), nên chưa từng chạm nhánh code thật sự dùng `crypto.randomBytes` lúc bắt tay MTProto. Khi slice Auth (F1.1) gọi `connect()` thật, `esbuild-plugin-polyfill-node` hoá ra polyfill `crypto` = rỗng theo mặc định (khác với `fs`/`net`/`tls`, vốn được stub rỗng **có chủ đích** ở đây) — build vẫn thành công nhưng vỡ runtime. Cùng lúc đó lộ ra một vấn đề lớn hơn: GramJS tự nhận diện Node/browser sai hẳn trong Dedicated Worker (không có `window`), kéo theo cả việc chọn nhầm địa chỉ kết nối. Chi tiết đầy đủ + cách vá ở [ADR-0003 § Cập nhật 2026-08-24](../adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-24-slice-auth-f11). Bài học giữ lại cho spike sau: "build thành công" và "load được" không chứng minh một code path chưa từng thực thi (ở đây là toàn bộ connect()) là đúng — chỉ số liệu từ đúng code path đó mới tính.

### 🔴 Phát hiện ngoài dự kiến — cần quyết định, không chỉ ghi nhận

Khi cài đặt: **`telegram` (GramJS) đã bị archive, ngừng bảo trì.** npm tự in cảnh báo:
```
npm warn deprecated telegram@2.26.22: This package is archived and no longer maintained.
Development continues in teleproto, a largely compatible, actively maintained fork.
```

Đã thử bundle song song `teleproto@1.228.5` (fork được khuyến nghị) để so sánh:

| | GramJS (`telegram`) | teleproto |
|---|---|---|
| Trạng thái bảo trì | ⚠️ Archived | ✅ Đang bảo trì (publish gần nhất 2026-08-03) |
| Bundle raw | 986.7 KB | 2566.0 KB |
| Bundle brotli | 236.2 KB | 327.8 KB |
| Chạy được trong Chrome thật? | ✅ Có | ❌ **Crash lúc khởi tạo**: `Cannot set property cwd of #<Object> which has only a getter` |
| Mô tả trên npm | "MTProto client... Node.js" (nhưng có browser build đã kiểm chứng ở trên) | **"Modern Telegram MTProto client for Node.js"** — không có trường `browser`/`exports`, không tuyên bố hỗ trợ browser |
| Dependency đáng chú ý | — | `socks` (proxy TCP, chỉ có nghĩa ở Node), `node-localstorage` (session lưu file, chỉ Node) |

Lỗi crash của teleproto tới từ xung đột giữa cách nó dùng biến `process` toàn cục với các polyfill browser tiêu chuẩn — có thể sửa được với đủ thời gian, nhưng bản thân việc phải sửa, cộng với mô tả "for Node.js" và các dependency thiên Node, là tín hiệu khá rõ: **fork đang được bảo trì có vẻ đang ưu tiên hướng Node.js/userbot, không còn ưu tiên browser như bản gốc.**

**Vì sao đây chưa phải khủng hoảng:** [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md) đã cố ý bọc GramJS sau cổng `TelegramGateway`, chính vì lường trước rủi ro khoá cứng vào một thư viện. Nhờ vậy, thư viện MTProto có thể thay thế sau này với chi phí giới hạn trong một package, không lan ra toàn bộ codebase.

**Nhưng đây là quyết định thật cần bạn duyệt, không phải việc tôi tự chốt:** dùng một thư viện core không còn ai vá lỗi/theo kịp thay đổi giao thức Telegram là rủi ro vận hành dài hạn thật sự, vượt ngoài phạm vi kỹ thuật thuần tuý của một ADR. Ba hướng khả dĩ:

1. **Giữ GramJS, ghim chặt phiên bản**, chấp nhận rủi ro, tự vá nếu Telegram đổi TL schema và GramJS không theo kịp. Phù hợp nếu ưu tiên "chạy được ngay trong browser hôm nay".
2. **Đầu tư sửa teleproto cho browser** (fix xung đột `process`, đóng góp ngược upstream nếu maintainer đồng ý), chấp nhận rủi ro "chưa ai kiểm chứng dài hạn". Phù hợp nếu ưu tiên "có người vá lỗi lâu dài".
3. **Theo dõi định kỳ**, khởi động với GramJS (đã kiểm chứng hoạt động), đặt lịch đánh giá lại (ví dụ mỗi quý, hoặc ngay khi Telegram đổi giao thức làm GramJS hỏng thật) — tận dụng đúng lớp bọc `TelegramGateway` đã thiết kế sẵn cho tình huống này.

**Đã chốt (2026-08-23): hướng 1** — giữ GramJS, ghim cứng `telegram@2.26.22` ở mọi package tiêu thụ nó (lúc spike còn chạy: `tools/spike-02`, `tools/spike-03`; nay: `libs/core-mtproto`). Chi tiết và lý do đầy đủ ghi ở phần "Cập nhật sau khi Accepted" của [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-08-23-spike-03).

---

## SPIKE-04

**Trạng thái:** 🟡 **Đã đóng, chấp nhận rủi ro (2026-08-26)** — chạy bằng `tools/spike-04/` (đăng nhập MTProto không được Claude chạy hộ, xem "Vì sao Claude không tự chạy spike này" ở [SPIKE-02](#spike-02) — cùng lý do áp dụng ở đây). ~1.1 GB tải liên tục ở mức 4 và 8 request đồng thời, 0 lần gặp `FLOOD_WAIT`. Xem "Kết quả" và "Đã chốt" bên dưới.

**Câu hỏi:** Với 2/4/8 request `upload.getFile` bay đồng thời, tốc độ tải thực tế là bao nhiêu và `FLOOD_WAIT` bắt đầu xuất hiện ở đâu?

**Vì sao quan trọng:** [ADR-0006 § Cập nhật sau khi Accepted](../adr/0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-26-slice-playback-f4--vertical-slice-tối-thiểu) ghi rõ slice F4 ship 1 sender/DC tuần tự, **chưa** làm AIMD (§3 của Quyết định) — mọi tham số (độ song song khởi đầu, trần mặc định 4/trần nâng cấp 8) hiện là giả thuyết chưa có số liệu thiết bị thật. Không có số liệu này thì slice hardening sau F4 sẽ chọn tham số bằng đoán, đúng thứ nguyên tắc spike ở đây cấm.

**Lưu ý đạo đức:** chạy trên **tài khoản test dùng một lần**, không chạy trên tài khoản chính — mục tiêu là **tìm trần an toàn**, không phải tìm tốc độ tối đa. `bench.mjs` cố ý dừng leo thang lên mức song song cao hơn ngay khi gặp `FLOOD_WAIT` đầu tiên, và tôn trọng thời gian chờ tuyệt đối như [ADR-0006 §4](../adr/0006-download-pipeline-dc-pool-flood-wait.md).

> **Mã nguồn đã xoá (2026-08-26)** sau khi spike đóng và số liệu đã ghi lại đầy đủ bên dưới — không còn cần chạy lại. Lịch sử mã nguồn vẫn còn trong git log. Phần "Cách chạy" dưới đây mô tả cách spike ĐÃ chạy, không còn thực thi được nữa.

### Bàn thử nghiệm

`tools/spike-04/` — script Node độc lập, gọi thẳng `upload.getFile` tầng thấp qua GramJS (không qua `libs/core-mtproto`/`libs/core-download`, cùng lý do tách với SPIKE-02: nếu spike hỏng, biết chắc là hành vi giao thức/tài khoản chứ không phải bug ở code pipeline thật).

**Phát hiện đã lộ ra khi viết tool, trước khi chạy (đáng ghi lại ngay):** `client.getSender(dcId)` của GramJS (`telegram@2.26.22`) cache **đúng một** exported sender cho mỗi `dcId` (`_exportedSenderPromises` trong `telegramBaseClient.js`) — không có API công khai để mở nhiều `MTProtoSender` song song tới cùng DC. Vì vậy spike này (và cả pipeline thật ở F4) đo **N request bay đồng thời trên cùng một sender/kết nối MTProto** (multiplex nhiều RPC trên một transport), **không phải** N kết nối TCP/MTProto vật lý tách biệt như cách đọc "connection pool" theo nghĩa đen ở [ADR-0006 §1](../adr/0006-download-pipeline-dc-pool-flood-wait.md). Đây vẫn là phép đo đúng cho câu hỏi cốt lõi — `FLOOD_WAIT` giới hạn theo tần suất gọi method phía Telegram, không theo số kết nối vật lý — nhưng nếu muốn pool nhiều sender thật như Quyết định gốc mô tả, sẽ cần tự khởi tạo `MTProtoSender` thủ công, bỏ qua lớp cache của client — việc chưa xây ở F4 lẫn ở spike này.

### Cách chạy (lịch sử — mã nguồn đã xoá)

```bash
cd tools/spike-04
npm install

# Bước 1 — đăng nhập MỘT LẦN bằng tài khoản TEST (không phải tài khoản chính).
# Session chỉ ghi vào .session.local (đã gitignore), không bao giờ dán vào chat.
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run login

# Bước 2 — đo. Gọi "node bench.mjs" trực tiếp, KHÔNG dùng "npm run bench -- ...".
# (PowerShell/nhiều shell Windows nuốt mất --flag khi đi qua "npm run").
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  node bench.mjs --peer <username_kenh_hoac_id> --minSizeMb 80
```

Kết quả ghi ra `docs/spikes/spike-04-result.local.json` (đã gitignore) — **chỉ chứa số liệu tổng hợp** (throughput, số chunk, giây `FLOOD_WAIT`), không chứa session, không chứa số điện thoại. An toàn để dán vào chat cho Claude đọc và viết lại phần Kết quả dưới đây.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| A | Mức 2 request đồng thời chạy hết `chunksPerLevel` không lỗi | throughput đo được > tốc độ 1 sender tuần tự của F4 (baseline: xem log verify F4, chưa có số cụ thể) |
| B | Mức 4 và 8 chạy được ít nhất một phần trước khi (nếu có) gặp `FLOOD_WAIT` | có số throughput ở từng mức đạt tới, dù mức cao nhất có thể dừng giữa chừng |
| **C** | Ghi nhận được mức song song đầu tiên gây `FLOOD_WAIT`, và số giây chờ | **Đây là câu trả lời chính của spike** — không cần "đạt" theo nghĩa không gặp `FLOOD_WAIT`, gặp được và đo được mới là mục tiêu |
| D | Không cần retry `FILE_MIGRATE`/`file_reference` thủ công ngoài script | script tự xử lý cả hai qua `errors.FileMigrateError` (đổi sender) — nếu vẫn phải sửa tay, ghi lại là phát hiện |

### Ma trận thiết bị cần phủ

Không áp dụng — kết quả phụ thuộc **tài khoản/DC/thời điểm** (theo đúng lý do chọn AIMD ở [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md#quyết-định): "dung lượng đường truyền và ngưỡng chịu đựng của Telegram khác nhau theo tài khoản, theo DC và theo thời điểm"), không phụ thuộc trình duyệt/hệ điều hành như SPIKE-01. Một lần chạy trên một tài khoản test là đủ để có **một điểm dữ liệu thật**, không phải để phủ ma trận thiết bị.

### Kết quả

Tài khoản test, kênh "Group học tập" (private, nhỏ), file 1384 MB, DC 5, `chunkSizeBytes` 512 KB. Hai lần chạy, cùng ngày:

#### Lần 1 · 2026-08-26 15:17 UTC · burst ngắn — 40 chunk (20 MB) / mức

| Mức đồng thời | Chunk OK | Thời gian | Throughput | Lỗi | `FLOOD_WAIT` |
|---|---|---|---|---|---|
| 2 | 40/40 | 3670 ms | 5.71 MB/s | 0 | không |
| 4 | 40/40 | 1471 ms | 14.26 MB/s | 0 | không |
| 8 | 40/40 | 631 ms | 33.25 MB/s | 0 | không |

#### Lần 2 · 2026-08-26 15:24 UTC · sustained — 1000 chunk (500 MB) / mức, chỉ mức 4 và 8

| Mức đồng thời | Chunk OK | Thời gian | Throughput | Lỗi | `FLOOD_WAIT` |
|---|---|---|---|---|---|
| 4 | 1000/1000 | 26106 ms | 20.08 MB/s | 0 | không |
| 8 | 1000/1000 | 16761 ms | 31.28 MB/s | 0 | không |

**Đọc kết quả này cho đúng — cùng cách đọc đã áp dụng cho SPIKE-02:**

- Đây là kết quả **0/2000+ chunk gặp `FLOOD_WAIT`, không phải "đạt trần 8 an toàn tuyệt đối"**. Ngưỡng thật của Telegram **chưa từng lộ ra** trong hai lần chạy này, nên spike **chưa kiểm chứng được** con số ngưỡng cụ thể — vì tình huống đó chưa từng xảy ra.
- Lý do rất có thể giống hệt SPIKE-02: "Group học tập" là kênh riêng tư/nhỏ, và tổng khối lượng thử (~1.1 GB gộp cả hai lần) vẫn có thể chưa đủ để kích hoạt cơ chế giới hạn của Telegram trên tài khoản/DC/thời điểm này.
- **Điều spike này CÓ chứng minh được, và có giá trị thật:** ở đúng hai mức mà sản phẩm thật sự dùng (mặc định 4, trần nâng cấp tối đa 8 — [ADR-0006 §3](../adr/0006-download-pipeline-dc-pool-flood-wait.md)), tải **liên tục 500 MB** (đủ cho phần lớn phiên xem phim mở đầu, không chỉ một burst vài giây) không gây lỗi, không gây `FLOOD_WAIT`, và throughput không suy giảm theo thời gian (20–31 MB/s duy trì suốt 17–26 giây, không có dấu hiệu bị điều tiết dần).
- **Quan sát phụ, đáng ghi lại:** throughput ở mức 4 tăng từ burst (14.26 MB/s) lên sustained (20.08 MB/s), còn mức 8 lại giảm nhẹ (33.25 → 31.28 MB/s). Chênh lệch này nằm trong biên độ nhiễu mạng bình thường (mẫu burst chỉ 40 chunk, quá ít để kết luận), không phải dấu hiệu suy giảm hệ thống — nhưng có nghĩa là **không nên coi số throughput ở đây là một benchmark chính xác**, chỉ là bằng chứng "đủ nhanh, không lỗi" ở đúng hai mức sản phẩm dùng.
- **Phát hiện thiết kế quan trọng hơn cả số liệu** (ghi ở "Bàn thử nghiệm" trên): độ song song đo được ở đây là N request multiplex trên **một** sender GramJS/DC, không phải N kết nối vật lý — nên kết luận "mức 8 an toàn" áp dụng đúng cho kiến trúc mà F4 **thực tế đang dùng** (và sẽ tiếp tục dùng trừ khi ai đó tự xây pool `MTProtoSender` thủ công), không phải cho một pool nhiều kết nối TCP như cách đọc nghĩa đen ở Quyết định gốc §1.

**Đã chốt (2026-08-26):** chấp nhận kết quả hiện tại, đóng spike ở đây theo nhánh đầu tiên của bảng "Ta sẽ làm gì với từng kết quả" bên dưới — không dò tiếp lên khối lượng lớn hơn (nhiều GB / nhiều phút liên tục). Lý do: mục tiêu đạo đức của spike này là "tìm trần an toàn, không phải tốc độ tối đa" — cố tình dò tới khi tài khoản test bị `FLOOD_WAIT` chỉ để có một con số ngưỡng chính xác không mang lại giá trị thiết kế tương xứng, vì sản phẩm đã tự giới hạn cứng ở mức 8 ([ADR-0006 §3](../adr/0006-download-pipeline-dc-pool-flood-wait.md)) bất kể ngưỡng thật của Telegram cao hơn bao nhiêu. AIMD (bắt đầu thấp, lùi khi gặp `FLOOD_WAIT`) vẫn là cơ chế đúng cần giữ nguyên — số liệu ở đây không đổi Quyết định gốc, chỉ xác nhận trần 4/8 không gây rắc rối ngay lập tức cho use-case phát phim thật. Xem addendum ở [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md#cập-nhật-sau-khi-accepted-2026-08-26-spike-04).

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động |
|---|---|
| Không mức nào gặp `FLOOD_WAIT` (kể cả mức 8) | Trần mặc định 4 / trần nâng cấp 8 ở [ADR-0006 §3](../adr/0006-download-pipeline-dc-pool-flood-wait.md) coi như an toàn cho tài khoản test — vẫn giữ AIMD (không cố định) vì Quyết định gốc đã nói rõ ngưỡng khác nhau theo tài khoản/DC/thời điểm, một lần chạy không chứng minh mọi tài khoản đều an toàn |
| Gặp `FLOOD_WAIT` ở mức 4 | Trần mặc định 4 hiện tại đã ở ngay biên — cân nhắc hạ trần mặc định xuống 2-3, giữ AIMD để tự lùi khi chạm |
| Gặp `FLOOD_WAIT` ở mức 2 | Phát hiện nghiêm trọng — một kết nối tuần tự (F4 hiện tại) có thể đã gần chạm trần; viết addendum [ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md) đánh giá lại có nên tăng song song chút nào không trước khi làm AIMD đầy đủ |
| `FLOOD_WAIT` > 60s ở bất kỳ mức nào | Xác nhận đúng nhánh "dừng hẳn pipeline, báo UI" ở [ADR-0006 §4](../adr/0006-download-pipeline-dc-pool-flood-wait.md) là bắt buộc, không phải phòng xa thừa — ưu tiên cao cho UI báo lỗi rõ ràng ở slice hardening sau F4 |
| Script phải sửa tay giữa chừng (lỗi tool, không phải hành vi Telegram) | Ghi lại là phát hiện về công cụ, không tính là số liệu FLOOD_WAIT — sửa tool rồi chạy lại trước khi đóng spike |

---

## SPIKE-05

**Câu hỏi:** Angular Material + CDK ăn bao nhiêu ngân sách app shell, và có còn dưới ngưỡng 300 KB brotli của [SPIKE-03](#spike-03) không?

**Vì sao quan trọng:** [ADR-0016](../adr/0016-angular-material-va-cdk.md) chọn Material dựa trên giá trị của virtual scroll + a11y + overlay, nhưng **chưa đo** cái giá. Nếu Material một mình đã ăn hết ngân sách thì phải cắt bớt component, hoặc dùng CDK thuần cho phần lớn giao diện và chỉ lấy Material ở vài chỗ.

**Đo gì:**

| Cấu hình | Kỳ vọng |
|---|---|
| App shell trống (Angular 22, zoneless, không Material) | mốc chuẩn |
| + CDK thuần (overlay, a11y, virtual scroll, portal) | mức tăng nhỏ, gần như không có CSS |
| + Material tối thiểu (button, icon, dialog, chips, sidenav) + theme M3 tự định nghĩa | **con số quyết định** |

**Ngưỡng:** app shell (không tính GramJS, vốn lazy-load trong Core Worker) dưới **300 KB brotli**.

**Nếu vượt ngưỡng:** giảm dần theo thứ tự — bỏ theme dựng sẵn, thay component Material bằng CDK + CSS tự viết ở những chỗ giao diện đơn giản, `@defer` các component chỉ dùng trong dialog/cài đặt.

**Chưa dựng** — chạy ngay sau khi scaffold workspace, vì cần một app thật để đo.

---

## SPIKE-06

**Trạng thái:** 🟢 **Đã chạy, ĐẠT (2026-08-28)** — xem "Kết quả" và "Đã chốt" bên dưới.

**Câu hỏi:** `publishCatalogDocument()` (`libs/core-mtproto/src/gateway-index.ts`, slice Ingest Editor — Màn hình 6) — chuỗi `sendFile → pinMessage → deleteMessages` lên **kênh media** thật — có hoạt động đúng như thiết kế không? Cụ thể: publish lần đầu có đọc lại đúng nội dung không, và một chu trình "sửa rồi Lưu lại" (publish lần hai, xoá bản cũ) có thật sự chuyển pin sang bản mới VÀ xoá sạch bản cũ không (không phải chỉ unpin, để lại rác)?

**Vì sao quan trọng:** [ADR-0014 § Cập nhật sau khi Accepted (2026-08-28)](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md#cập-nhật-sau-khi-accepted-2026-08-28-slice-ingest-editor--metadata-editor-màn-hình-6) ghi rõ: đây là lần đầu tiên `sendFile`/`pinMessage`/`deleteMessages` được gọi cho **kênh media** trong toàn bộ codebase — trước đó ba hàm này (dùng chung khuôn với `publishSnapshot()`, [ADR-0009](../adr/0009-dong-bo-state-event-log-va-snapshot.md)) chỉ có test đơn vị với fake gateway. Nếu đường ghi này hỏng theo cách âm thầm (vd pin sai message, xoá nhầm, hoặc để lại 2 catalog cùng ghim), user sẽ mất một phần metadata của chính Kho Cá Nhân họ — một thao tác **ghi thật lên tài khoản Telegram thật**, không phải lỗi đọc có thể sửa bằng quét lại.

### Bàn thử nghiệm

`tools/spike-06/` — script Node độc lập, gọi thẳng GramJS tầng thấp (không qua `libs/core-mtproto`/`libs/core-index`, cùng lý do tách như SPIKE-02/SPIKE-04: nếu spike hỏng, biết chắc là hành vi giao thức/tài khoản chứ không phải bug ở pipeline thật).

**Điểm an toàn cốt lõi:** script tự **tạo một kênh test mới** (`channels.CreateChannel`) cho mỗi lần chạy, không bao giờ đụng tới kênh có sẵn nào của bạn — khác SPIKE-02/04 (cần `--peer` trỏ vào kênh thật có sẵn để có đủ dữ liệu/tải mô phỏng). Ở đây không cần dữ liệu thật, chỉ cần MỘT kênh mà chính tài khoản test là creator (đúng điều kiện `isOwn` mà [ADR-0014 §4](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) yêu cầu) — tạo mới đảm bảo sạch tuyệt đối, không rủi ro pin/xoá nhầm nội dung đang dùng thật. Script mặc định tự xoá kênh test khi xong (`channels.DeleteChannel`); cờ `--keep` giữ lại để tự kiểm tra bằng mắt trong app Telegram trước khi xoá tay.

> **Mã nguồn đã xoá (2026-08-28)** sau khi spike đóng và số liệu đã ghi lại đầy đủ bên dưới — không còn cần chạy lại. Lịch sử mã nguồn vẫn còn trong git log (commit đã ghi ở lần đóng slice Ingest Editor). Phần "Cách chạy" dưới đây mô tả cách spike ĐÃ chạy, không còn thực thi được nữa.

### Cách chạy (lịch sử — mã nguồn đã xoá)

```bash
cd tools/spike-06
npm install

# Bước 1 — đăng nhập một lần (hoặc copy .session.local từ spike-02/04 nếu còn).
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run login

# Bước 2 — chạy chuỗi tạo kênh → publish A → đọc lại → publish B → xoá A → đọc lại → tự xoá kênh.
# Gọi "node test.mjs" trực tiếp, KHÔNG dùng "npm run test -- ..." (PowerShell nuốt --flag qua npm run).
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx node test.mjs

# Thêm --keep nếu muốn tự xem kênh test trong Telegram trước khi xoá tay:
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx node test.mjs --keep
```

Kết quả ghi ra `docs/spikes/spike-06-result.local.json` (đã gitignore) — **chỉ chứa số liệu tổng hợp** (đạt/không đạt từng bước, thời gian mỗi RPC), không chứa session, không chứa số điện thoại, không chứa id kênh thật (kênh test đã bị xoá ngay sau khi chạy trừ khi dùng `--keep`). An toàn để dán nội dung vào chat cho Claude đọc và viết lại phần Kết quả bên dưới.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| A | Tạo kênh test, `creator === true` | Kênh tạo thành công, đúng là kênh do tài khoản test sở hữu |
| B | `sendFile` + `pinMessage` catalog A, đọc lại | Nội dung đọc lại (`GetFullChannel.pinnedMsgId` → `getMessages` → `downloadMedia` → JSON) khớp byte-chính-xác với JSON đã gửi |
| **C** | `sendFile` + `pinMessage` catalog B + `deleteMessages(A)`, đọc lại | **Đây là câu trả lời chính của spike** — pin phải chuyển hẳn sang B (không phải vẫn còn trỏ A hoặc rơi vào trạng thái không xác định), nội dung đọc lại khớp B |
| D | Message A đã bị xoá thật | `getMessages([A.msgId])` không còn trả về media (rỗng hoặc `MessageEmpty`) — không phải chỉ unpin còn message vẫn sống trong lịch sử kênh |
| E | Không cần can thiệp tay giữa chừng | Toàn bộ 4 bước trên chạy tự động, không lỗi ngoại lệ nào bị bắt ở nhánh `catch` |

### Ma trận thiết bị cần phủ

Không áp dụng — đây là hành vi API/tài khoản Telegram (giống SPIKE-02/04), không phụ thuộc trình duyệt/hệ điều hành. Một lần chạy trên một tài khoản là đủ để có bằng chứng cho câu hỏi cốt lõi; không cần phủ nhiều thiết bị.

### Kết quả

#### Tài khoản thật, kênh test tự sinh (id `3721156441`, đã tự xoá sau khi chạy) · 2026-08-28T14:16:23Z

| Mã | Bước | Kết quả | Số đo |
|---|---|---|---|
| A | Tạo kênh test | ✅ ĐẠT | `creator=true` — đúng điều kiện `isOwn` ADR-0014 §4 |
| B | `sendFile` + `pinMessage` catalog A, đọc lại | ✅ ĐẠT | `sendFile` 433 ms, `pinMessage` 122 ms; đọc lại khớp byte-chính-xác |
| **C** | `sendFile` + `pinMessage` catalog B + `deleteMessages(A)`, đọc lại | ✅ **ĐẠT** | `sendFile` 185 ms, `pinMessage` 117 ms, `deleteMessages` 62 ms; pin đã chuyển hẳn sang B, đọc lại khớp byte-chính-xác |
| D | Message A đã bị xoá thật | ✅ ĐẠT | `getMessages([A.msgId])` không còn trả về media sau `deleteMessages` |
| E | Không cần can thiệp tay | ✅ ĐẠT | Toàn bộ chuỗi chạy tự động, không rơi vào nhánh `catch` |

Toàn bộ 5/5 tiêu chí đạt trong một lần chạy duy nhất — không có bước nào mơ hồ hay cần diễn giải thêm (khác SPIKE-02/04, nơi tình huống cần đo — `CDN_REDIRECT`/`FLOOD_WAIT` — chưa từng xảy ra nên câu hỏi gốc vẫn treo). Ở đây câu hỏi gốc ("chuỗi ghi có đúng thiết kế không") có câu trả lời dứt khoát: **có**.

**Đọc kết quả này cho đúng — phạm vi bằng chứng:** một lần chạy, một tài khoản, một kênh test mới tạo (không có publisher/admin nào khác, không có nội dung/catalog.json có sẵn để xung đột). Đây là bằng chứng đủ mạnh cho câu hỏi **đúng/sai của một chuỗi API call xác định** (không phải câu hỏi ngưỡng phụ thuộc tài khoản/thời điểm như `FLOOD_WAIT` ở SPIKE-04) — nếu cơ chế có lỗi thiết kế, nó sẽ lộ ra ở MỌI lần chạy, không phải một hiện tượng ngẫu nhiên cần nhiều mẫu mới thấy. Chưa test: kênh có catalog.json lớn (nhiều item), kênh có nhiều publisher, hay tình huống `FLOOD_WAIT` xảy ra giữa chuỗi 3 RPC ghi liên tiếp — những rủi ro này thuộc phạm vi khác (ADR-0006), không phải câu hỏi của spike này.

**Đã chốt (2026-08-28):** đạt, gỡ rủi ro "chưa traffic-verified" cho cơ chế `publishCatalogDocument()`. Gỡ dòng rủi ro tương ứng ở [architecture.md §7](../architecture.md#7-rủi-ro-lớn-nhất--trạng-thái-kiểm-chứng). Xem addendum SPIKE-06 ở [ADR-0014](../adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md).

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động |
|---|---|
| Cả 5 mã (A-E) đạt | `publishCatalogDocument()` được xác nhận đúng thiết kế trên ít nhất một tài khoản/kênh thật — gỡ rủi ro "chưa traffic-verified" ở addendum ADR-0014 2026-08-28, đóng spike 🟢 |
| B đạt, C thất bại (pin không chuyển sang B, hoặc đọc lại sai nội dung) | Lỗi nghiêm trọng ở chính cơ chế "cập nhật" — Ingest Editor's Save trên item THỨ HAI trở đi sẽ ghi sai; phải sửa `gateway-index.ts` trước khi khuyến nghị dùng thật, dù publish LẦN ĐẦU (B) vẫn ổn |
| B, C đạt nhưng D thất bại (A không bị xoá thật) | `deleteMessages` không hoạt động như kỳ vọng (vd cần quyền khác, hoặc `revoke:true` không đủ) — catalog cũ tồn đọng vĩnh viễn trong kênh, không mất dữ liệu MỚI nhưng kênh media tích rác theo thời gian; hạ mức ưu tiên xuống "chấp nhận, dọn tay" nếu không sửa được ngay |
| A thất bại (không tạo được kênh, hoặc `creator !== true`) | Vấn đề ở quyền tài khoản test hoặc API, không phải bug thiết kế — thử tài khoản khác trước khi kết luận gì về `publishCatalogDocument()` |
| Ngoại lệ không rõ nguyên nhân ở bất kỳ bước nào | Ghi lại nguyên văn lỗi GramJS (`errorMessage`) vào phần Kết quả — có thể là giới hạn API chưa biết (vd rate limit riêng cho `channels.CreateChannel`/`DeleteChannel`), cần điều tra thêm trước khi đóng spike theo hướng nào |

---

## SPIKE-07

**Trạng thái:** 🟢 **Đã chạy, ĐẠT (2026-08-29)** — xem "Kết quả" và "Đã chốt" bên dưới.

**Câu hỏi:** GramJS `2.26.22` (bản ghim, đã archive — [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md)) có hỗ trợ đủ **Forum Topics** để dùng làm tín hiệu categorize phim (phim lẻ/phim bộ) không — cụ thể hai câu hỏi con:
1. `channels.GetForumTopics` có liệt kê đúng topic + title của một supergroup có bật Topics không?
2. Một message quét được qua lịch sử (`getMessages`/`messages.getHistory`) có xác định được nó thuộc topic nào (`replyTo.topMsgId`) không, hay phải gọi thêm RPC riêng cho từng message?

**Vì sao quan trọng:** đây là follow-up của brainstorm cải thiện `libs/core-index/src/index-engine.ts` (dùng hashtag + forum topic làm tín hiệu suy luận metadata bên cạnh filename, xem `docs/roadmap.md` § Index/quét nguồn). Hashtag không cần spike — chỉ đọc `message.entities` đã có sẵn trong response quét, không phải API mới. Forum Topics thì có: đây là bề mặt GramJS **hoàn toàn chưa ai chạm tới trong repo** (không có `isForum`/`topicId`/`getForumTopics` ở đâu cả) trên một thư viện đã bị archive. Nếu spike đạt, cần addendum [ADR-0010](../adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md) thêm field category/topic vào `CatalogItemV1` và mở rộng `IndexGateway`. Nếu không đạt, roadmap đóng lại mục đó theo hướng "không khả thi với thư viện hiện tại", không phải xoá âm thầm.

**Đã kiểm tra tĩnh trước khi viết tool (không tính là spike, chỉ là điều kiện cần):** đọc `node_modules/telegram/tl/api.d.ts` xác nhận schema TL của bản ghim `2.26.22` **có** `channels.CreateChannel({megagroup, forum})`, `channels.CreateForumTopic`, `channels.GetForumTopics`, và `MessageReplyHeader.topMsgId`/`forumTopic`. Điều này chỉ chứng minh **thư viện biên dịch được với các type này** — giống hệt tình huống SPIKE-03 ban đầu ("build thành công") hoá ra sai cho nhánh `crypto` khi chạm `connect()` thật. Spike này là bước kiểm chứng **hành vi runtime trên tài khoản thật**, không phải lặp lại việc đọc `.d.ts`.

### Bàn thử nghiệm

`tools/spike-07/` — script Node độc lập, gọi thẳng GramJS tầng thấp (không qua `libs/core-index`/`libs/core-mtproto`, cùng lý do tách như SPIKE-02/04/06: nếu spike hỏng, biết chắc là hành vi giao thức/tài khoản/thư viện chứ không phải bug ở pipeline thật).

**Điểm an toàn cốt lõi:** script tự **tạo một supergroup test mới** (`channels.CreateChannel({megagroup:true, forum:true})`) cho mỗi lần chạy, không bao giờ đụng tới nhóm/kênh có sẵn nào của bạn — cùng mô hình an toàn với SPIKE-06. Script mặc định tự xoá nhóm test khi xong (`channels.DeleteChannel`); cờ `--keep` giữ lại để tự kiểm tra bằng mắt trong app Telegram trước khi xoá tay.

> **Mã nguồn đã xoá (2026-08-29)** sau khi spike đóng và số liệu đã ghi lại đầy đủ bên dưới — không còn cần chạy lại. Lịch sử mã nguồn vẫn còn trong git log (4 lần chạy thật trên tài khoản, xem "Kết quả" dưới). Phần "Cách chạy" dưới đây mô tả cách spike ĐÃ chạy, không còn thực thi được nữa. `tools/env.example` và quy ước `tools/.env` dùng chung cho mọi spike (xem [skill spike](../../.claude/skills/spike/SKILL.md)) vẫn giữ nguyên, không bị xoá theo.

### Cách chạy

**Khuyến nghị — dùng chung `tools/.env`** (mới, xem `tools/env.example`): copy `tools/env.example` thành `tools/.env` (một cấp trên `tools/spike-07/`, đã gitignore, sống sót qua các lần mở/đóng spike), điền `TSMC_API_ID`/`TSMC_API_HASH`/`TSMC_PHONE`. `login.mjs`/`test.mjs` tự đọc file này — không cần gõ tay biến môi trường mỗi lần, và dùng lại được cho spike-08, spike-09... sau này.

```bash
cd tools/spike-07
npm install
npm run login    # chỉ còn hỏi mã OTP nếu đã điền TSMC_PHONE trong tools/.env
node test.mjs
node test.mjs --keep   # muốn tự xem nhóm test trong Telegram trước khi xoá tay
```

**Không muốn tạo `.env`** — gõ tay từng lần như các spike trước:

```bash
cd tools/spike-07
npm install

# Bước 1 — đăng nhập một lần (hoặc copy .session.local từ spike-02/04/06 nếu còn).
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npm run login

# Bước 2 — chạy chuỗi tạo nhóm forum → tạo 2 topic → GetForumTopics → gửi
# message vào từng topic → quét lại lịch sử → đối chiếu → tự xoá nhóm.
# Gọi "node test.mjs" trực tiếp, KHÔNG dùng "npm run test -- ..." (PowerShell nuốt --flag qua npm run).
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx node test.mjs

# Thêm --keep nếu muốn tự xem nhóm test trong Telegram trước khi xoá tay:
TSMC_API_ID=xxxxx TSMC_API_HASH=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx node test.mjs --keep
```

Kết quả ghi ra `docs/spikes/spike-07-result.local.json` (đã gitignore) — **chỉ chứa số liệu tổng hợp** (đạt/không đạt từng bước, id/title topic test, thời gian), không chứa session, không chứa số điện thoại, không chứa id nhóm thật (nhóm test đã bị xoá ngay sau khi chạy trừ khi dùng `--keep`). An toàn để dán nội dung vào chat cho Claude đọc và viết lại phần Kết quả bên dưới.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| A | Tạo supergroup test với `forum=true` ngay lúc `channels.CreateChannel` | `channel.megagroup === true && channel.forum === true` sau khi tạo |
| B | `channels.CreateForumTopic` tạo 2 topic ("Phim lẻ", "Phim bộ") không lỗi | Cả hai lệnh gọi trả về `Updates` không throw |
| **C** | `channels.GetForumTopics` liệt kê đúng 2 topic vừa tạo, đúng title, có id | **Câu trả lời chính #1** — topic list + title đọc được đúng như đã tạo, không cần suy đoán id từ `Updates` của bước B |
| **D** | Gửi message vào từng topic (`InputReplyToMessage{topMsgId}`), quét lại bằng `getMessages()`, `replyTo.topMsgId` khớp đúng topic đã gửi | **Câu trả lời chính #2** — quét lịch sử tự nhiên (không gọi thêm RPC/message) đã đủ biết message thuộc topic nào |
| E | Message gửi KHÔNG chỉ định topic — ghi nhận `replyTo` đọc lại là gì | Không phải đạt/không đạt — là quan sát bắt buộc: cần biết giá trị mặc định (undefined? topic "General" id nào?) để thiết kế fallback khi kênh bật Forum nhưng post không thuộc topic cụ thể |
| F | Dọn dẹp — xoá nhóm test thành công (trừ khi `--keep`) | `channels.DeleteChannel` không lỗi |

### Ma trận thiết bị cần phủ

Không áp dụng — đây là hành vi API/tài khoản Telegram (giống SPIKE-02/04/06), không phụ thuộc trình duyệt/hệ điều hành. Một lần chạy trên một tài khoản là đủ bằng chứng cho câu hỏi đúng/sai của một chuỗi API call xác định (cùng loại câu hỏi với SPIKE-06, khác với ngưỡng phụ thuộc tài khoản/thời điểm như SPIKE-04).

### Kết quả

#### Tài khoản thật, nhóm test tự sinh (id `4355095639`, tự xoá sau khi chạy — script tự dọn ngay cả khi lỗi giữa chừng) · 2026-08-29T09:02:43Z · lần 1/2

| Mã | Kết quả | Số đo/chi tiết |
|---|---|---|
| A | ✅ ĐẠT | `megagroup=true, forum=true` ngay lúc `channels.CreateChannel` — không cần `channels.ToggleForum` riêng |
| B | ✅ ĐẠT | `channels.CreateForumTopic("Phim lẻ")` → id đoán từ `Updates` = 2; `("Phim bộ")` → id = 3 |
| **C** | ✅ **ĐẠT** | `channels.GetForumTopics` trả về **3** topic: `General`(id=1, tự sinh mặc định khi bật Forum — không phải do script tạo) , `Phim lẻ`(id=2), `Phim bộ`(id=3) — khớp chính xác với id đoán từ `Updates` ở bước B, xác nhận **câu trả lời chính #1**: liệt kê topic + title hoạt động đúng như tài liệu TL mô tả |
| D | ❌ **Crash — bug ở script, không phải ở Telegram/GramJS** | `client.sendMessage()` ném `Invalid message type: VirtualClass` |

**Phân tích lỗi (đã sửa, xem `tools/spike-07/test.mjs` comment tại chỗ gọi `sendMessage`):** script lần 1 tự dựng `new Api.InputReplyToMessage({replyToMsgId, topMsgId})` rồi gán vào `replyTo` của `client.sendMessage()`. Đọc `node_modules/telegram/client/messages.js` (dòng ~486-491) mới thấy: hàm cấp cao **tự dựng** `InputReplyToMessage` nội bộ từ `replyTo`/`topMsgId` dạng **số thuần**, qua `Utils.getMessageId()` (`node_modules/telegram/Utils.js:1122`) — hàm này chỉ chấp nhận `number` hoặc object có field `.id` (một `Message` thật), ném lỗi cho bất kỳ type khác. `InputReplyToMessage` tự tay dựng có field `replyToMsgId`, không có `.id` → rơi vào nhánh `throw`. Sửa: gọi `sendMessage(channel, { message, replyTo: topicId, topMsgId: topicId })` — cả hai đều số, để GramJS tự lo phần dựng `InputReplyToMessage`.

**Phát hiện phụ đáng giá hơn cả việc sửa bug:** `client.sendMessage()` (và `client.sendFile()`, cùng file dòng ~476) đều nhận thẳng tham số `topMsgId` ở tầng cao — nghĩa là **không cần tự tay dựng `Api.InputReplyToMessage` ở code thật** (`libs/core-mtproto/src/gateway-index.ts` sau này) nếu implement gửi/publish theo topic; chỉ cần truyền thêm `topMsgId` vào lệnh gọi `sendFile`/`sendMessage` sẵn có.

#### Cùng tài khoản, nhóm test tự sinh (id `4389650027`) · 2026-08-29T09:06:01Z · lần 2/3

Sau khi sửa bug `sendMessage()` ở lần 1, script chạy hết được tới bước 5 — nhưng lộ ra một phát hiện thật thứ hai, **không phải lỗi Telegram/GramJS mà là lỗi đọc sai tên field trong chính script**:

| Mã | Kết quả | Số đo/chi tiết |
|---|---|---|
| A-C | ✅ ĐẠT | Giống hệt lần 1 |
| Gửi message vào 2 topic + 1 message không topic | ✅ ĐẠT | `sendMessage(channel, { replyTo: topicId, topMsgId: topicId })` (đã sửa) chạy trơn tru — xác nhận phát hiện phụ ở lần 1 (không cần tự dựng `InputReplyToMessage`) là đúng |
| D | ❌ Vẫn không khớp — **nhưng vì lý do khác lần 1** | `"Phim lẻ": expected=2, actual replyTo.topMsgId=undefined, replyTo.forumTopic=true` — `forumTopic=true` ĐÃ đúng (chứng minh Telegram có gắn message vào topic thật), chỉ riêng `topMsgId` đọc ra `undefined` |

**Phân tích (đã sửa, xem `tools/spike-07/test.mjs` comment tại chỗ đọc `message.replyTo`):** đọc lại `tl/api.d.ts` phần định nghĩa `MessageReplyHeader` (type trả về khi ĐỌC message, khác `InputReplyToMessage` là type dùng khi GỬI) — field mang id topic ở đây tên là **`replyToTopId`**, không phải `topMsgId`. Đây là kiểu bất đối xứng tên field giữa chiều gửi/nhận **giống hệt** phát hiện `senderId` đã gặp ở [ADR-0010 addendum 2026-08-25](../adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md#cập-nhật-sau-khi-accepted-2026-08-25-slice-index-f2) (đọc code TL thật thay vì đoán tên field theo trực giác luôn là cách an toàn duy nhất với GramJS). `forumTopic: true` đọc đúng ngay từ lần 1 vì tên field đó **giống nhau** ở cả hai class — chỉ riêng field mang id là khác tên. Sửa: đọc `msg.replyTo.replyToTopId` thay vì `msg.replyTo.topMsgId`.

**Đọc kết quả 2 lần chạy cho đúng:** cả hai lần "không đạt" ở D đều là **lỗi trong chính script test**, không phải bằng chứng Telegram/GramJS thiếu hỗ trợ — thực ra dữ liệu đã đúng cả hai lần (`forumTopic=true` ngay từ đầu), script chỉ đọc sai tên field. Đây chính xác là loại "phép đo sai và vì sao sai" mà quy ước ghi spike yêu cầu giữ lại, không xoá đi khi sửa.

#### Cùng tài khoản, nhóm test tự sinh (id `4335005210`) · 2026-08-29T09:09:16Z · lần 3/4

Sửa tên field xong, chạy lại — D **vẫn không khớp, nhưng lần này là phát hiện THẬT về Telegram, không phải bug script nữa**:

| Mã | Kết quả | Số đo/chi tiết |
|---|---|---|
| A-C, gửi message | ✅ ĐẠT | Giống hệt lần 2 |
| D | ❌ Không khớp — **giá trị đọc về là `null` chứ không phải thiếu field** | `"Phim lẻ": expected=2, actual replyTo.replyToTopId=null, replyTo.forumTopic=true` |

**Đây là tín hiệu khác hẳn hai lần trước:** `null` nghĩa là field TỒN TẠI trong response thật của Telegram nhưng server không set giá trị — không phải lỗi đọc sai tên (đã sửa đúng tên ở lần 2). Giả thuyết (khớp hành vi đã biết công khai ở Bot API: *"message_thread_id = reply_to_top_message_id nếu có, ngược lại reply_to_message_id khi is_topic_message"*): Telegram chỉ set `replyToTopId` cho message trả lời **sâu hơn** một message khác **bên trong** topic; với message gửi **thẳng** vào topic (top-level — đúng cách spike này gửi), server chỉ set `replyToMsgId` = chính id topic, bỏ trống `replyToTopId` vì coi là dư thừa (`top == replyToMsgId` đã ngầm hiểu).

Đã sửa script (`tools/spike-07/test.mjs`) để đọc CẢ `replyToTopId` lẫn `replyToMsgId`, suy ra topic id theo thứ tự ưu tiên `replyToTopId ?? (forumTopic ? replyToMsgId : undefined)` — đây chính là logic sẽ cần dùng thật ở tầng suy luận metadata sau này (không phải đọc một field đơn lẻ).

#### Cùng tài khoản, nhóm test tự sinh (id `4301117864`) · 2026-08-29T09:11:15Z · lần 4/4 — **CÂU TRẢ LỜI CUỐI CÙNG**

| Mã | Kết quả | Số đo/chi tiết |
|---|---|---|
| A | ✅ ĐẠT | `megagroup=true, forum=true` |
| B | ✅ ĐẠT | topic id 2 ("Phim lẻ"), 3 ("Phim bộ") |
| **C** | ✅ **ĐẠT** | `GetForumTopics` liệt kê đúng `{"General":1,"Phim bộ":3,"Phim lẻ":2}` |
| **D** | ✅ **ĐẠT** | `"Phim lẻ": expected=2, replyToTopId=null, replyToMsgId=2, forumTopic=true, derived=2` — và tương tự cho "Phim bộ" (derived=3). Logic suy luận `replyToTopId ?? (forumTopic ? replyToMsgId : undefined)` khớp đúng 100% |
| E | ✅ Quan sát rõ ràng | Message không thuộc topic nào: `replyTo=undefined` — tín hiệu "không có topic" hoàn toàn không mơ hồ, không lẫn với message thuộc "General" |
| F | ✅ (ngầm định, giống 3 lần trước — script không lỗi ở bước dọn dẹp) | Nhóm test tự xoá, không để lại rác |

**Đọc kết quả 4 lần chạy cho đúng — khác hẳn cách đọc "0/N lần gặp" của SPIKE-02/04:** đây không phải trường hợp "tình huống cần đo chưa từng xảy ra". Cả hai câu hỏi chính đều có câu trả lời **dứt khoát, tái lập được**: (1) `GetForumTopics` liệt kê đúng topic+title — **có**; (2) quét lịch sử tự nhiên (không cần RPC riêng/message) xác định được message thuộc topic nào — **có, với điều kiện dùng đúng logic suy luận 2-field**, không phải đọc một field đơn lẻ như trực giác ban đầu. 3 lần "không đạt" trước đó (2 bug script + 1 phát hiện hành vi thật) đều được giữ nguyên trong tài liệu này, không xoá đi — đúng quy ước ghi spike ("ghi cả phép đo sai và vì sao sai").

**Chi phí RPC — quan trọng cho thiết kế thật:** `channels.GetForumTopics` là **một** lệnh gọi/kênh (giống `getChannelAdmins`, cache được theo TTL) để có bảng `topicId → title`; sau đó **không cần RPC nào thêm mỗi message** — `replyToTopId`/`replyToMsgId` đã có sẵn trong response `messages.getHistory`/`getMessages` mà `scanHistoryItems()` (`libs/core-index/src/index-engine.ts`) đã gọi. Nghĩa là categorize-theo-topic **rẻ giống hashtag**, không đắt như lo ngại ban đầu ở "Ta sẽ làm gì với từng kết quả" bên dưới (nhánh "D hỏng, cần RPC riêng mỗi message" — nhánh đó **không xảy ra**).

**Đã chốt (2026-08-29):** đạt, gỡ rủi ro "Forum Topics API chưa kiểm chứng" ở [architecture.md §7](../architecture.md#7-rủi-ro-lớn-nhất--trạng-thái-kiểm-chứng). Việc tiếp theo (viết addendum ADR-0010 + code `CatalogItemV1`/`IndexGateway` thật) là quyết định riêng, chưa tự làm ở đây — xem `docs/roadmap.md` § Index/quét nguồn.

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động |
|---|---|
| **A-F đều đạt** *(đã xảy ra, lần 4)* | Forum Topics dùng được đúng như kỳ vọng — viết addendum [ADR-0010](../adr/0010-catalog-spec-v1-va-chien-luoc-indexing.md) thêm field category/topic vào `CatalogItemV1` + `topicId`/`listForumTopics()` vào `IndexGateway` (`libs/core-index/src/gateway-port.ts`), cập nhật `docs/catalog-spec.md`, đóng spike 🟢. Cập nhật roadmap: bỏ "chờ SPIKE-07", mở việc code thật |
| A đạt, B/C hỏng (tạo topic được nhưng không liệt kê lại đúng, hoặc ngược lại) | API vỡ ở nửa đường — ghi rõ nửa nào hỏng, đánh giá xem có cách vòng khác (vd suy đoán topic từ title thay vì id) trước khi quyết bỏ hẳn hướng này |
| A, B, C đạt nhưng D hỏng (quét lịch sử không thấy `topMsgId`, hoặc cần RPC riêng mỗi message) | Đây là kết quả tệ nhất về mặt chi phí: categorize theo topic **khả thi về mặt dữ liệu nhưng đắt về RPC** (N message × N lookup — rủi ro `FLOOD_WAIT`, giống lý do ADR-0010 §3 cấm tra cứu publisher theo từng item lúc quét). Nhiều khả năng đóng theo hướng "chấp nhận rủi ro — không làm", hoặc giới hạn categorize-theo-topic chỉ cho T1 (catalog.json admin tự ghi tay category, không suy luận lúc quét) |
| A hỏng (không tạo được nhóm forum, hoặc `forum` không phải field hợp lệ lúc tạo) | Vấn đề ở phiên bản schema/quyền tài khoản test, không phải câu hỏi cốt lõi — thử tài khoản/flow khác (vd `channels.ToggleForum` sau khi tạo, thay vì set `forum:true` ngay lúc `CreateChannel`) trước khi kết luận API không dùng được |
| Ngoại lệ không rõ nguyên nhân ở bất kỳ bước nào | Ghi lại nguyên văn lỗi GramJS (`errorMessage`) vào phần Kết quả — có thể là giới hạn API chưa biết, cần điều tra thêm trước khi đóng spike theo hướng nào |

---

## SPIKE-08

**Trạng thái:** ⏳ Chưa dựng.

**Câu hỏi:** Trong ba API trình duyệt có thể dùng để dò khả năng phát trước khi upload (`HTMLVideoElement.canPlayType()`, `MediaSource.isTypeSupported()`, WebCodecs `VideoDecoder.isConfigSupported()`/`MediaCapabilities.decodingInfo()`), **cái nào khớp đúng với khả năng phát THẬT** của `<video src="/_stream/...">` — đường phát progressive qua Service Worker + HTTP Range mà [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md) đã chọn (**không** dùng `MediaSource`/`appendBuffer`)? Và một parser MP4 box thuần JS (kiểu mp4box.js, không phải `ffmpeg.wasm` đầy đủ) có trích đúng codec string (`avc1.xx`, `hev1.xx`, `av01.xx`...) từ header để đưa vào API đó không?

**Vì sao quan trọng:** ~~ban đầu mở để tự động hoá bước "probe ngay trong trình duyệt" ở mục 3 "Chế độ Admin trong web app" của ADR-0013~~ — hướng đó đã **bị bác bỏ** ([ADR-0013 § Cập nhật 2026-08-29 "phản biện auto-probe"](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-29-phản-biện-auto-probe-sau-khi-quét--quyết-định-thứ-tự-xây)): probe container/codec qua mạng lúc `scanSource()` vừa tốn ≥2 round-trip/file (`moov` cuối file với MP4 không-faststart) vừa bắt tài khoản người xem gánh rủi ro `FLOOD_WAIT` diện rộng — compat quay lại đúng thiết kế gốc là `ffprobe` cục bộ trên máy admin (`tsmc-ingest` CLI), không qua browser API nào.

**Phạm vi còn lại (ưu tiên thấp hơn, không gate đường ingest nữa):** cảnh báo live phía `Player.checkCompat()` (`apps/web/src/app/player/player.ts`) — nếu sau này muốn cá nhân hoá cảnh báo theo từng trình duyệt/thiết bị đang xem (Safari giải mã HEVC được, Chrome desktop thường không), vẫn cần biết API nào khớp đúng khả năng phát thật của `<video src>`. Rủi ro cụ thể không đổi: WebCodecs trả lời "thiết bị giải mã được codec này", không phải "`<video>` demux/phát được container này" — và vì kiến trúc dùng progressive playback chứ không phải MSE, ngay cả `MediaSource.isTypeSupported()` cũng có thể là API sai.

### Bàn thử nghiệm

Trang tĩnh độc lập ở `tools/spike-08/` (theo đúng mô hình cô lập của [SPIKE-01](#spike-01): không cần Telegram, không cần build Angular — nếu spike hỏng, biết chắc lỗi ở hành vi trình duyệt chứ không phải ở pipeline ingest thật). Cần chuẩn bị trước một bộ file mẫu nhỏ bằng `ffmpeg` cục bộ (ghi lại đúng lệnh dùng để biết "sự thật nền" của mỗi file):

| File mẫu | Container/codec | Kỳ vọng (giả thuyết, CHƯA kiểm chứng) |
|---|---|---|
| `a.mp4` | MP4 + H.264 + AAC | phát được mọi nơi |
| `b.mp4` | MP4 + HEVC + AAC | Safari có, Chrome desktop thường không |
| `c.mp4` | MP4 + AV1 + Opus | Chrome/Firefox mới có, Safari cũ không |
| `d.mkv` | MKV + H.264 (codec bên trong bình thường phát được) | **unplayable ở `<video src>` bất kể codec** — đây là giả thuyết nền của toàn bộ bảng phân hạng ADR-0013, đáng kiểm lại chứ không chỉ suy luận |
| `e.mkv` | Nội dung thực chất là hồ sơ WebM (VP9 + Opus) nhưng đổi đuôi/mimetype thành mkv | câu hỏi phụ: trình duyệt chặn theo đuôi/mimetype khai báo, hay tự dò nội dung thật? |

Với mỗi file, trang test chạy song song 4 phép thử và so khớp:

- **A** — `video.canPlayType(mime)` với chuỗi mime+`codecs=` parse được từ file
- **B** — `MediaSource.isTypeSupported(mime)` cùng chuỗi
- **C** — WebCodecs `VideoDecoder.isConfigSupported({codec})` cùng codec string
- **D — sự thật nền** — gắn thẳng file vào `<video src>` qua chính SW đang chạy (dựng lại đường `/_stream/*` giống hệt SPIKE-01: `<video>` → SW → tab (`File.slice`) → file trên máy), đợi sự kiện `loadeddata` hoặc `error`. Đây là câu trả lời đúng duy nhất — A/B/C chỉ có giá trị nếu khớp D.

Song song đó, trang test tự trích codec string bằng một MP4 box parser JS thuần (mp4box.js hoặc tương đương, chỉ đọc header — không tải hết file), so với giá trị biết trước từ chính lệnh `ffmpeg` đã dùng để tạo file mẫu.

### Cách chạy

Chưa dựng — khi build, theo đúng mẫu SPIKE-01: `npm run spike:auto` cho Chrome/Edge desktop tự động; `npm run deploy:spike` để lấy URL test trên thiết bị thật, **bắt buộc cho Safari/iOS và Chrome Android** vì đây chính xác là nơi ba API A/B/C được kỳ vọng trả lời khác nhau — desktop Chrome một mình không đủ để trả lời câu hỏi của spike này.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| A vs D | `canPlayType` khớp `loadeddata`/`error` thật | Khớp ở mọi file mẫu — đây là API "đúng theo lý thuyết" vì `<video src>` không dùng MSE, nhưng "đúng theo lý thuyết" chưa phải bằng chứng |
| B vs D | `MediaSource.isTypeSupported` khớp D | Nếu **không** khớp, xác nhận MSE là API sai cho kiến trúc progressive này dù nó hay được chọn mặc định |
| **C vs D** | WebCodecs `isConfigSupported` khớp D | **Câu trả lời chính của spike** — nếu lệch, đặc biệt **sai dương** (C nói "được" nhưng D là `error`), xác nhận đúng rủi ro đã nêu: không được dùng WebCodecs một mình để quyết định compat |
| Parser | Codec string trích từ MP4 box parser khớp giá trị biết trước (từ lệnh `ffmpeg` đã tạo file) | Khớp 100% cho mọi file mẫu MP4 |
| MKV (`d.mkv`) | D luôn là `error` bất kể codec bên trong | Xác nhận quy tắc "MKV = unplayable ở mức container, không phải per-codec" ở ADR-0013 vẫn đúng |
| WebM-giả-mkv (`e.mkv`) | Ghi lại D là gì | Không phải đạt/không đạt — là quan sát bắt buộc, xem "Ta sẽ làm gì" |

### Ma trận thiết bị cần phủ

| Nền tảng | Bắt buộc | Lý do |
|---|---|---|
| Chrome desktop (Windows) | Có | baseline, chạy tự động qua `spike:auto` |
| Safari iOS hoặc macOS thật | **Có** | nơi kỳ vọng HEVC lệch rõ nhất so với Chrome — không có thiết bị này thì spike không trả lời được câu hỏi chính |
| Chrome Android | Nên có | đại diện thiết bị phổ thông nhất trong số user thật của TSMC |
| Firefox desktop | Tuỳ chọn | không phải mục tiêu chính nhưng rẻ để thêm cùng lúc |

### Kết quả

*(để trống tới khi có số liệu thiết bị thật)*

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động |
|---|---|
| A khớp D ở mọi nơi; B và/hoặc C lệch D | Xác nhận giả thuyết ban đầu — dùng `canPlayType()` làm API chính thức cho cả Ingest Editor lẫn `Player.checkCompat()`; viết addendum [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md) chỉ định rõ API, cấm dùng `MediaCapabilities`/WebCodecs một mình để quyết định compat; đóng spike 🟢 |
| Cả A, B, C đều khớp D ở mọi nơi | Không có rủi ro sai-API như lo ngại — vẫn ưu tiên `canPlayType()` vì nhẹ nhất (không cần tạo `MediaSource`/`VideoDecoder`), có thể dùng thêm `MediaCapabilities.decodingInfo()` cho tín hiệu phụ (`powerEfficient`/`smooth`) nếu muốn UI tinh hơn; đóng spike 🟢 |
| A cũng lệch D ở một số file/thiết bị (kể cả API "đúng theo lý thuyết" cũng sai) | Phát hiện nghiêm trọng hơn dự kiến — không API tĩnh nào đáng tin một mình; quay lại phương án "thử phát thật, bắt sự kiện `error`" (chính là D) làm cơ chế fallback bắt buộc, không chỉ dò trước; viết addendum ADR-0013 hạ mức tin cậy của bước probe tĩnh |
| Parser trích sai codec string (vd nhầm HEVC profile/level) ở một số file | Không chặn được hướng đi — dùng `canPlayType()` với MIME thô (không kèm `codecs=`) làm fallback kém chính xác hơn khi parser thất bại, ghi rõ giới hạn này trong addendum ADR-0013 |
| `e.mkv` (nội dung WebM, đuôi/mimetype mkv) lại **phát được** trên một trình duyệt nào đó | Phát hiện ngoài dự kiến đáng giá — nghĩa là bảng phân hạng ADR-0013 "MKV luôn Hạng C/D" bảo thủ hơn cần thiết trong một ca hẹp; ghi lại làm quan sát, **không đổi** quy tắc mặc định (remux vẫn an toàn hơn phát hiện từng ca đặc biệt) |
| Không thiết bị Safari/iOS thật nào sẵn có để chạy | Không đóng spike ở trạng thái 🟢/🟡 — giữ ⏳/🔬, vì thiếu đúng nền tảng mà câu hỏi chính nhắm tới (giống lý do SPIKE-01 bắt buộc chờ iPad thật trước khi kết luận) |

---

## SPIKE-09

**Trạng thái:** 🟢 **Đạt, có caveat rõ (2026-09-03, tích hợp thật vào `apps/tsmc-ingest` + sửa số liệu "Đóng gói" ngày 2026-09-04)** — dựng thật, chạy thật trên máy Windows 11 thật (máy dùng cho toàn bộ session này, không phải CI/VM giả lập) với `vcpkg`/LLVM/MSVC đã cài sẵn. Xem "Kết quả" và "Phạm vi bằng chứng — đọc cho đúng" bên dưới trước khi dùng số liệu này quyết định gì. **Số "6 DLL" ở lần đo đầu (2026-09-03) SAI — đúng là 7 DLL, xem ghi chú sửa trong mục "Đóng gói" và [ADR-0013 § Cập nhật 2026-09-04](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-04-tích-hợp-thật-vào-tsmc-ingest--sửa-số-liệu-đóng-gói-ở-addendum-trên).**

**Câu hỏi:** `ffmpeg-next`/`ffmpeg-sys-next` (native Rust FFI binding tới libavcodec/libavformat, kiểu binding dùng trong project tham chiếu `vid-kit-simple` mà user đưa) có khả thi **thay thế** cách shell-out hiện tại của `tsmc-ingest` (`apps/tsmc-ingest/src/ffmpeg.ts`, gọi thẳng binary `ffmpeg`/`ffprobe` hệ thống qua `child_process`) cho đúng ba việc CLI cần — remux copy-video + encode-audio-AAC với `+faststart`, sinh thumbnail JPEG, rút subtitle stream ra `.srt` — trên máy Windows thật? Với chi phí build/đóng gói nào, và tốc độ có bằng/hơn baseline **40.8x realtime** đã đo bằng shell-out (verify thật 2026-08-30, xem [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-verify-hạng-c-bằng-tài-khoảnkênh-thật-lần-đầu)) không?

**Vì sao quan trọng:** đây là điều kiện tiên quyết cho hướng "core lib Rust bọc FFmpeg" mà user muốn khám phá cho một Tauri GUI tương lai — ADR-0013 để ngỏ câu hỏi "có bọc `tsmc-ingest` bằng GUI Tauri + Angular không", chưa quyết. User yêu cầu rõ (brainstorm 2026-08-30): **thử native FFI TRƯỚC, đánh giá SAU, không quyết trước khi có số liệu** — đúng kỷ luật spike của project này. Có fallback rõ ràng nếu native không đáng công sức: Rust shell-out ra binary `ffmpeg`/`ffprobe` (port gần 1:1 `ffmpeg.ts`/`ffprobe.ts` sang `std::process::Command`, giữ nguyên hành vi đã proven, không cần toolchain vcpkg/bindgen/MSVC). Đáng chú ý: tài liệu tham chiếu của user tự thừa nhận pipeline transcode thật của chính project gốc (`vid-kit-simple`) vẫn là **scaffold chưa xong** — thiếu đúng phần lõi (`send_frame`/`receive_packet`/`write_trailer`) — nên đây thật sự là câu hỏi cần đo, không phải "chỉ cần copy pattern có sẵn".

**Không liên quan tới [SPIKE-08](#spike-08)** — SPIKE-08 hỏi về browser API (`canPlayType`/`MediaSource`/WebCodecs) cho web app player, hoàn toàn khác cơ chế gọi FFmpeg phía CLI admin ở đây.

### Bàn thử nghiệm

Crate Rust độc lập ở `tools/spike-09/` (Cargo project, **không** nối vào pnpm workspace hiện có của repo) — cùng nguyên tắc cô lập của [SPIKE-01](#spike-01)/[SPIKE-08](#spike-08): nếu spike hỏng, biết chắc lỗi nằm ở hành vi Rust/FFmpeg-FFI, không phải ở pipeline `tsmc-ingest` thật (pipeline đó đã verify riêng, xem ADR-0013).

### Cách chạy

Chưa dựng. Kế hoạch khi build:

1. Cài prerequisite trên máy Windows thật: `vcpkg install ffmpeg:x64-windows`, LLVM/libclang (bắt buộc cho `bindgen`), MSVC Build Tools — ghi lại version cụ thể đã dùng (khác máy khác version có thể ra kết quả khác, phải nêu rõ phạm vi bằng chứng).
2. Viết crate tối thiểu dùng `ffmpeg-next`, implement **đầy đủ** (không dừng ở log như scaffold của project tham chiếu) một pipeline: input → decode → copy stream video + encode AAC audio → mux MP4 `+faststart`. Đây chính là phần `send_frame`/`receive_packet`/`write_trailer` mà project tham chiếu chưa làm xong — viết theo ví dụ `zmwangx/rust-ffmpeg examples/transcode-x264.rs`.
3. Thêm hai việc còn lại CLI cần: trích 1 frame làm thumbnail JPEG (decode + scale + encode), rút subtitle stream ra `.srt` (copy/convert codec).
4. Đo trên đúng file mẫu Hạng C đã dùng ở lần verify CLI thật (`[KST.VN].The.Big.Bang.Theory.S01Tap01.HD.[KSTE].mkv`, MKV/H.264 1280x720/audio AC3, ~22 phút) để so trực tiếp với baseline 40.8x.
5. Không cần tài khoản Telegram/MTProto nào cho spike này — chỉ xử lý file cục bộ, không thuộc diện "spike cần login thật" ở mục Ranh giới an toàn của skill `/spike`.

### Tiêu chí đạt/không đạt

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| Build | Clean build từ máy chưa có `vcpkg`/LLVM cài sẵn tới lúc chạy được | Ghi lại thời gian thật + số bước thủ công cần làm — không có ngưỡng "đạt/không đạt" cứng, chỉ cần số liệu thật để so sánh với chi phí build gần-bằng-0 của phương án shell-out |
| Tốc độ transcode | Remux copy-video + encode-audio-AAC trên file mẫu Hạng C | So trực tiếp với 40.8x baseline — chậm hơn rõ rệt (vd &lt;20x) là tín hiệu mạnh nghiêng về giữ shell-out |
| Đóng gói | Tổng dung lượng DLL/asset cần bundle cùng app, số DLL | Càng gần "một binary, không DLL rời" càng tốt cho mục tiêu Tauri distributable; nhiều DLL lớn là chi phí thật phải cân nhắc |
| Phủ đủ 3 việc | Transcode + thumbnail + subtitle extract đều chạy được bằng `ffmpeg-next`, không chỉ transcode | Thiếu một trong ba nghĩa là chưa đủ để thay thế toàn bộ `ffmpeg.ts`, phải ghi rõ phần nào còn thiếu |

### Kết quả

**Máy chạy:** Windows 11 Home Single Language 10.0.26200 thật (không phải VM/CI giả lập) — `cargo 1.90.0`/`rustc 1.90.0`, `ffmpeg-next = "7"` (khoá về `7.1.0`, kéo `ffmpeg-sys-next 7.1.3`), FFmpeg qua `vcpkg install ffmpeg:x64-windows` (**đã có sẵn từ trước, không phải cài mới cho spike này** — xem caveat "Build" bên dưới) — `avcodec`/`avformat`/`avutil`/`avfilter`/`swresample`/`swscale` 7.1.1, triplet dynamic. LLVM/libclang cho `bindgen` cũng đã có sẵn.

**Build:** `cargo build --release` sạch, không lỗi bindgen/linker, **14.2s** cho một crate mới hoàn toàn (`cargo clean` trước đó). **Caveat quan trọng:** đây CHỈ là chi phí build crate Rust — `vcpkg`/LLVM/MSVC Build Tools đã có sẵn trên máy này từ trước (không rõ tại sao, có thể từ việc khác), spike **không đo được** chi phí cài đặt lần đầu từ máy sạch hoàn toàn (bước 1 của kế hoạch gốc). Đây là gap thật của bằng chứng, không phải "coi như bằng 0" — `vcpkg install ffmpeg:x64-windows` trên máy sạch nổi tiếng là chậm (build FFmpeg từ source, kéo theo `abseil`/`protobuf` cho vài feature phụ), có thể tính bằng chục phút tới vài giờ tuỳ máy, KHÔNG được suy diễn từ con số 14.2s này.

**Tốc độ transcode (remux copy-video + encode-audio AAC + faststart):** **72.1x realtime** tổng cho cả pipeline (`all`: remux 73.5x + thumb 0.03s + subs 0.05s, tổng 4.16s cho clip 300.006s) — build release. **Caveat quan trọng:** đo trên **file mẫu tổng hợp** (`testsrc2` 1280x720 25fps + `sine` stereo + `ffmpeg -c:a ac3`), KHÔNG phải file thật `[KST.VN].The.Big.Bang.Theory...mkv` đã dùng cho baseline 40.8x ([ADR-0013 § verify Hạng C](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-08-30-verify-hạng-c-bằng-tài-khoảnkênh-thật-lần-đầu)) — file thật không có trong repo (đúng quy tắc CLAUDE.md, không commit media). Nội dung tổng hợp (test pattern) nén dễ hơn nội dung quay thật, nên **72.1x so 40.8x không phải so sánh ngang hàng tuyệt đối** — chỉ đủ để kết luận "cùng cấp độ nhanh, không chậm hơn hẳn", không đủ để khẳng định "nhanh gấp 1.77 lần" theo nghĩa chặt.

**Đóng gói:** ~~6 DLL~~ **7 DLL runtime thật cần phân phối cùng app** — `avcodec-61.dll` (13.5 MB), `avfilter-10.dll` (3.78 MB), `avformat-61.dll` (2.36 MB), `avutil-59.dll` (0.9 MB), `swscale-8.dll` (0.62 MB), `avdevice-61.dll` (75 KB), `swresample-5.dll` (124 KB) — **tổng ~21.3 MB**. Cộng `VCRUNTIME140.dll` + vài `api-ms-win-crt-*.dll` (runtime MSVC chuẩn, thường có sẵn Windows 10/11). Không phải "một binary không DLL" như kỳ vọng tốt nhất, nhưng 7 DLL + ~21.3 MB là con số quản lý được cho một Tauri installer — và verify thật (2026-09-04): copy đủ 7 file này cạnh `spike09.exe` là **chạy được không cần set `PATH`** (Windows tự ưu tiên tìm DLL cùng thư mục `.exe`).

> ⚠️ **Sửa lại một kết luận ở trên (2026-09-04):** phép đo ban đầu chỉ chạy `llvm-objdump -p` trên **chính `spike09.exe`**, đọc được đúng 6 DLL nó **gọi trực tiếp** — kết luận "swresample KHÔNG bị kéo vào" từ đó **sai**: `avcodec-61.dll` tự nó phụ thuộc **transitive** vào `swresample-5.dll` (dùng nội bộ cho một số codec, dù code Rust ở đây không gọi API `swresample` nào thẳng). Thiếu đúng 1 file này khiến `spike09.exe` thoát `0xC0000135` (`STATUS_DLL_NOT_FOUND`) — phát hiện thật khi chạy qua `apps/tsmc-ingest` lần đầu trên file thật, xem [ADR-0013 § Cập nhật 2026-09-04](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-04-tích-hợp-thật-vào-tsmc-ingest--sửa-số-liệu-đóng-gói-ở-addendum-trên). **Bài học chung:** `objdump`/`dumpbin` trên một binary chỉ cho import trực tiếp — đo dependency DLL đầy đủ phải đệ quy qua toàn bộ cây, hoặc đơn giản hơn: xoá `PATH` liên quan rồi chạy thật trên đúng bộ file dự định phân phối.

**Phủ đủ 3 việc:** cả ba chạy đúng, verify bằng `ffprobe` chứ không chỉ "không crash":
- `remux`: `moov` box nằm ở offset 40 (trước `mdat` ở offset ~355 KB) — **faststart xác nhận đúng bằng cách đọc box order thật**, không chỉ tin cờ đã set. Video H.264 1280x720 giữ nguyên (stream copy, không decode), audio AAC 44100 stereo đúng.
- `thumb`: JPEG hợp lệ (`ffd8` magic bytes, `ffprobe` đọc đúng `mjpeg` 1280x720).
- `subs`: đúng 2 cue, **đúng thời gian, đúng nội dung** khớp 100% với `sub.srt` gốc đưa vào fixture.

### Ba bug thật gặp phải khi code — giá trị hơn cả con số tốc độ

1. **MKV→MP4 stream-copy video cần `fflags=+genpts` lúc mở input**, nếu không mp4 muxer lỗi `Invalid argument` do vài packet đầu của stream có B-frame bị demuxer Matroska để `dts=None` (chưa đủ lookahead để tính reorder). Đây là hành vi FFmpeg chuẩn (chính `ffmpeg` CLI thật cũng in cảnh báo tương tự với input tương tự), không phải bug riêng của `ffmpeg-next` — nhưng **không tự động, phải biết mà bật**, khác hẳn giả định ban đầu "remux chỉ là copy packet".
2. **AAC encoder đòi đúng `frame_size` (1024 sample/frame), không chấp nhận nhiều hơn** — `filter::Graph` phải gọi `sink().set_frame_size(encoder.frame_size())` (đúng pattern ở ví dụ chính thức `transcode-audio.rs` mà lúc đầu tôi bỏ sót một dòng) nếu không encoder trả `Invalid argument` ngay frame đầu.
3. **🔴 Quan trọng nhất — sai số kênh audio làm CRASH tiến trình (segfault), không trả lỗi Rust:** khi buffer frame cấp cho encoder (channel_layout STEREO, 2 kênh) chỉ được điền dữ liệu thật ở kênh 0 (do code đọc nhầm `dec.channel_layout().channels()` = 1 từ một fixture vô tình mono trong khi encoder đã chọn STEREO), `avcodec_send_frame()` **segfault thẳng** (exit code 139), không phải panic Rust có backtrace, không phải `Result::Err`. Sau khi sửa fixture thành stereo đúng, cùng đường code chạy sạch — xác nhận nguyên nhân đúng là buffer/channel-count không khớp, không phải bug ẩn khác của crate.

   **Hệ quả thiết kế, không phải chi tiết vụn:** đây là khác biệt về **loại rủi ro**, không chỉ mức độ, so với shell-out hiện tại. Một bug tương đương ở `apps/tsmc-ingest/src/ffmpeg.ts` (gọi sai tham số `ffmpeg` CLI) chỉ làm **tiến trình con** thoát mã lỗi — CLI cha vẫn sống, báo lỗi rõ ràng, xử lý file tiếp theo bình thường. Cùng loại bug ở native FFI **giết luôn tiến trình cha** — nếu tiến trình đó là một Tauri desktop app, nghĩa là **cả ứng dụng crash**, không chỉ một job ingest thất bại. Đây là chi phí ẩn (Rust `unsafe`/C ABI không có validation nào giữa Rust code gọi sai và C library segfault) mà bảng tiêu chí gốc của spike này (viết trước khi chạy) không liệt kê — bảng gốc chỉ hỏi "build được không/nhanh không/gọn không", không hỏi "sai một tham số thì hậu quả tới đâu". Ghi nhận đây là **quan sát quan trọng hơn cả số liệu đạt/không đạt**, đúng tinh thần mục "Ghi kết quả" của skill `/spike`.

### Phạm vi bằng chứng — đọc cho đúng trước khi dùng số liệu này

- **Không phải máy sạch:** toolchain (`vcpkg`/LLVM/MSVC) đã có sẵn — chi phí "cài lần đầu" chưa được đo, xem "Build" ở trên.
- **Không phải file thật:** file mẫu là test pattern tổng hợp, không phải file media thật admin từng dùng cho baseline 40.8x — số so sánh tốc độ mang tính chỉ dấu ("cùng cấp độ"), không phải phép đo khoa học ngang hàng.
- **Chỉ một lần chạy, một loại nội dung** (H.264 1280x720 + AC3 stereo, Hạng C) — chưa thử HEVC/AV1 (Hạng B) hay codec cần re-encode video thật (Hạng D), nơi native FFI có thể lộ thêm vấn đề khác (ví dụ hardware-accel, hoặc CPU cost thật của encode video thay vì chỉ audio).

### Tích hợp thật vào `apps/tsmc-ingest` (2026-09-04) — gỡ một phần caveat "chưa test qua CLI thật"

Sau lần chạy độc lập ở `tools/spike-09/` (trên), đã nối `apps/tsmc-ingest` gọi được `spike09.exe` thật qua một backend chọn được (`TSMC_INGEST_FFMPEG_BACKEND=native`, mặc định vẫn giữ shell-out — không đổi hành vi production) — `ffmpeg-native.ts`/`ffmpeg-backend.ts` mới, `upload.ts` đổi đúng 1 dòng import. Admin chạy thật lệnh `upload` trên file AVI thật (Hạng D, ~21 phút) với biến bật native:

- Hạng D đúng như thiết kế (`ffmpeg-backend.ts`: `reencodeToMp4` LUÔN shell-out, `spike09.exe` chưa cài re-encode video) — remux rơi về `ffmpeg` CLI thật, chạy đúng (~40s, 30x realtime).
- Bước `generateThumbnail()` (unconditional, chạy cho mọi hạng) gọi `spike09.exe` thật lần đầu qua CLI production — và lộ ra bug đóng gói thật: thiếu `swresample-5.dll` (xem "Đóng gói" ở trên) làm `spike09.exe` thoát `0xC0000135`. Đã sửa (copy đủ 7 DLL) và verify lại sạch qua `ProcessStartInfo` giả lập đúng cách Node gọi tiến trình con.
- Lần chạy thật này còn lộ 2 bug code (không phải bug FFmpeg/Rust): thông điệp lỗi đoán nhầm "có thể segfault" cho một lỗi DLL_NOT_FOUND, và nhãn timing log sai backend cho nhánh Hạng D — cả hai đã sửa. Chi tiết đầy đủ: [ADR-0013 § Cập nhật 2026-09-04](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-04-tích-hợp-thật-vào-tsmc-ingest--sửa-số-liệu-đóng-gói-ở-addendum-trên).

**Vẫn CHƯA test:** đường native cho chính bước remux nặng nhất (Hạng A/B/C) qua CLI thật — lần chạy 2026-09-04 dùng file Hạng D nên chỉ native-path cho `generateThumbnail()` được thực thi qua production, chưa phải `remuxToMp4`. Cách chạy để tự bổ sung bằng chứng này: `apps/tsmc-ingest/README.md` § "Backend ffmpeg thử nghiệm".

### Quyết định — khớp nhánh đầu của bảng "Ta sẽ làm gì" gốc, có sửa đổi

Kết quả khớp nhánh 1 của bảng gốc bên dưới ("Build khả thi, tốc độ ≥ baseline, đóng gói gọn") — nhưng phát hiện #3 ở trên (rủi ro segfault) là thông tin MỚI mà bảng gốc chưa lường tới khi viết trước khi chạy. **Quyết định: đóng spike 🟢 với điều kiện** — native FFI đáng theo đuổi cho core lib Tauri VỀ MẶT hiệu năng/đóng gói, NHƯNG bất kỳ addendum ADR-0013 nào đề xuất hướng này bắt buộc phải giải quyết rủi ro process-crash (ví dụ: chạy pipeline FFmpeg trong tiến trình con/tác vụ tách biệt trong Tauri thay vì in-process, hoặc validate nghiêm ngặt format/channel trước mọi lệnh gọi `avcodec_send_*`) — không được mang nguyên trạng thái "một sai lầm ở tầng dữ liệu = segfault cả app" vào một GUI người dùng cuối. Xem addendum tương ứng ở [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md).

Mã nguồn giữ nguyên ở `tools/spike-09/` (không xoá như các spike xác nhận-rồi-bỏ khác) vì kết quả 🟢 nghĩa là code này có giá trị làm điểm khởi đầu thật cho core lib Tauri nếu hướng đó được chọn sau này — xem `tools/spike-09/README.md` cho cách build lại.

### Ta sẽ làm gì với từng kết quả (bảng gốc, viết trước khi chạy — giữ nguyên để đối chiếu)

| Kết quả | Hành động |
|---|---|
| Build khả thi trong thời gian hợp lý, tốc độ transcode ≥ baseline, đóng gói gọn (ít DLL) | Native FFI đáng theo đuổi cho core lib Tauri — viết addendum [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md) đề xuất hướng này cho quyết định GUI Tauri (vẫn để ngỏ riêng, spike này không tự quyết "có làm Tauri hay không"); đóng spike 🟢 |
| Build khả thi nhưng tốc độ/đóng gói kém hơn rõ rệt shell-out | Ghi nhận native FFI khả thi về mặt kỹ thuật nhưng không đáng đổi chi phí — khuyến nghị phương án "Rust shell-out ra ffmpeg/ffprobe CLI" cho core lib Tauri (nếu sau này quyết làm); đóng spike 🟡 (chấp nhận rủi ro không theo đuổi tiếp, có lý do rõ) |
| Không build được trên Windows thật trong thời gian hợp lý (vcpkg/bindgen/MSVC xung đột, lỗi khó sửa) | Bằng chứng mạnh chống lại hướng native FFI cho project này — đóng spike 🟡, ghi rõ lỗi cụ thể gặp phải để không ai lặp lại nỗ lực này mà không biết trước rào cản |
| Build được, transcode đúng, nhưng thumbnail hoặc subtitle extract không làm được/quá phức tạp bằng `ffmpeg-next` | Phát hiện đáng giá — có thể vẫn dùng native FFI cho riêng phần transcode (việc nặng nhất) và giữ shell-out cho hai việc còn lại (hybrid); ghi lại làm quan sát, không đóng dứt khoát 🟢/🔴 |

---

## SPIKE-10

**Trạng thái:** 🟡 **Đã đóng, chấp nhận rủi ro (2026-09-07)** (mở 2026-09-05). `r3-grammers`/`r4-ferogram` đã chạy thật nhiều lần trên kênh `tsmc_mediacenter`. `r1-webview`/`r2-sidecar` **chưa dựng**, và người quyết định (user) đã chọn KHÔNG gate qua R1 trước khi đánh giá R3/R4 (khác cây quyết định gốc bên dưới — xem ghi chú ngay trước mục "Cây quyết định"). Cho R3: **M1/M2/M3/M5/M7/M8/P1 ĐẠT** trên tài khoản thật, **M4** cải thiện đáng kể (13.5%→24.4%) nhưng chưa qua ngưỡng pass 80% (không phải trần kiến trúc, xem "Kết quả"), **M6 để ngỏ có chủ đích** (không chủ động ép FLOOD_WAIT — CLAUDE.md + SPIKE-04 đã là nơi dò ngưỡng) — **đây là lý do đóng 🟡 chứ không phải 🟢 sạch**. R4 trượt M2 dứt khoát — không còn là ứng viên khả thi dù M4 nhỉnh hơn R3 một chút. Đ1-Đ3 (đóng gói/giấy phép/chi phí) chưa đo — chỉ áp dụng khi thật sự đóng gói app, để dành cho lúc đó.

**Quyết định:** chọn R3 (`grammers-client` 0.10.0) làm MTProto library cho công cụ ingest desktop — xem [ADR-0017](../adr/0017-grammers-cho-cong-cu-ingest-desktop.md) cho quyết định đầy đủ, bốn điều kiện bắt buộc, và các việc để ngỏ. Addendum tương ứng đã ghi ở [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-07-adr-0017--chốt-hướng-gui-tauri) (chốt hướng Tauri) và [ADR-0012](../adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md#cập-nhật-sau-khi-accepted-2026-09-07-adr-0017--ranh-giới-workspace-cho-công-cụ-ingest-desktop) (ranh giới workspace).

**Câu hỏi:** Trong **bốn tổ hợp runtime** khả dĩ cho GUI ingest desktop bằng Tauri, tổ hợp nào đáp ứng đủ bốn ràng buộc đo được — (1) upload file ≥2 GB với RAM tiến trình phẳng, (2) báo tiến trình và huỷ được giữa chừng, (3) `FLOOD_WAIT` không làm mất việc đang dở, (4) crash của pipeline FFmpeg không giết UI — với **chi phí viết mới + đóng gói thấp nhất**?

Bốn ứng viên (khác nhau **chỉ ở tầng MTProto**; mọi tầng khác giữ nguyên, xem "Tech stack" bên dưới):

| Mã | Tổ hợp | Ý tưởng | Rủi ro chính chưa biết |
|---|---|---|---|
| **R1** | GramJS chạy trong webview + upload theo chunk | Giữ đúng một implementation MTProto. Thay `sendFile(path)` (vốn cần `fs` của Node) bằng vòng lặp raw-API `upload.saveBigFilePart`, mỗi part đọc từ đĩa qua Tauri command trả `ArrayBuffer` | Thông lượng IPC Tauri chưa ai đo; trần 2 GB/4 GB của `saveBigFilePart`; lượng code raw-API phải tự viết |
| **R2** | Node sidecar | Đóng gói `apps/tsmc-ingest` hiện tại (đã verify thật nhiều vòng) thành sidecar binary, Tauri chỉ làm vỏ UI | Ship 2 runtime JS trong 1 app (~50-80 MB Node **cộng** 7 DLL FFmpeg) — gần như xoá sạch lý do chọn Tauri thay Electron |
| **R3** | `grammers` (Rust MTProto) | Rust làm cả FFmpeg lẫn MTProto; webview thuần UI, không giữ session | `upload_file`/`upload_stream` **không có** progress/cancel/pause sẵn (đọc docs.rs 0.10.0) → phải tự viết adapter `AsyncRead` đếm byte + cờ huỷ |
| **R4** | `ferogram` (Rust MTProto) | Như R3 nhưng thư viện có `TransferHandle` (progress + pause + cancel) và `upload_sequential` (RAM ≈ một chunk) sẵn theo docs | Thư viện mới (bản đầu 2026-03-29, 23 phiên bản trong 5 tháng, một người bảo trì); bằng chứng production nằm ở **cuộc gọi thoại/video**, không phải upload file lớn |

**Vì sao quan trọng:** ba lý do, mỗi lý do đủ để không được đoán:

1. **ADR-0013 đang để ngỏ đúng câu hỏi này.** Addendum 2026-09-03 và 2026-09-04 đều kết bằng "quyết định GUI Tauri vẫn để ngỏ". SPIKE-09 chỉ trả lời phần FFmpeg — phần khó hơn (MTProto trong môi trường không có Node) chưa ai đo.
2. **R3/R4 phá vụ cược trung tâm của [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md)** ("chi phí đổi thư viện MTProto giữ ở mức một package"). Chọn Rust MTProto **không phải là thay GramJS** — `apps/web` chạy trong trình duyệt, cả `grammers` lẫn `ferogram` lẫn `tellers-mtproto` đều dùng `tokio` + TCP, không có transport WASM/WebSocket. Nên app xem giữ GramJS **vĩnh viễn**; R3/R4 nghĩa là repo có **hai** implementation MTProto song song. Đó là một ADR mới, không phải một addendum — và không được viết trước khi có số liệu.
3. **Rủi ro lặp lại đúng sai lầm đã trả giá.** Bất biến #9 (ghim cứng `telegram@2.26.22`) tồn tại vì repo lỡ phụ thuộc vào một package sau đó bị archive. R4 đặt stack **mới** lên một thư viện 5 tháng tuổi, một người bảo trì. Nếu chọn R4 thì phải chọn **bằng số đo**, không phải bằng bảng tính năng đẹp trong docs.

**Không thay thế [SPIKE-09](#spike-09)** — SPIKE-09 đã đóng 🟢 cho câu hỏi FFmpeg native FFI. Spike này *kế thừa* kết quả đó (dùng lại `tools/spike-09/` làm media worker) và chỉ kiểm chứng thêm **điều kiện áp dụng** mà SPIKE-09 ghi lại: "pipeline FFmpeg native không được chạy in-process cùng luồng chính của Tauri app" — ở đây là tiêu chí P1.

### Trạng thái dựng (2026-09-05) — code thật, chưa phải số đo M1-M8

`tools/spike-10/` đã có: workspace Cargo (`rpc-trait` + `r3-grammers` + `r4-ferogram`), CLI `login`/`upload` đối xứng cho cả hai nhánh Rust, `shared/generate-sample.mjs` (đã smoke-test clip 2 giây, chưa sinh bản đầy đủ ≥2 GB). `cargo build --workspace` sạch, không warning. `r1-webview`/`r2-sidecar` chưa có một dòng code nào.

**Phát hiện thật khi dựng** (đọc trực tiếp mã nguồn `grammers-client-0.10.0`/`ferogram-0.6.5` tải về `~/.cargo/registry/src/...` — không đoán từ README/docs.rs, cùng phương pháp `tools/spike-09/`; chi tiết đầy đủ ở [tools/spike-10/README.md](../../tools/spike-10/README.md)):

1. `grammers-client` 0.10.0 không build "out of the box": `grammers-crypto` pin `num-bigint ^0.4.6` nhưng bắc cầu qua `glass_pumpkin` (pin lỏng, tự trôi lên `2.0.0-rc1`) kéo theo `num-bigint 0.5.1` xung đột kiểu. Vá được (`cargo update -p glass_pumpkin --precise 2.0.0-rc0`) nhưng là tín hiệu thật về chi phí bảo trì.
2. API `grammers-client` 0.10.0 khác hẳn tutorial cũ — không có `Client::connect(Config)`, phải tự dựng `SenderPool` + `Client::new(handle)`. `upload_stream`/`upload_file` xác nhận đúng rủi ro đã liệt kê trước khi dựng: không có progress/cancel, phải tự bọc `AsyncRead`.
3. `ferogram` 0.6.5 có sẵn `TransferHandle` (progress/pause/cancel) + `upload_sequential()` (RAM ≈ một chunk, kiểm tra huỷ ở MỖI part) — tốt hơn thực tế grammers ở đúng hai tiêu chí M3/M5, đúng như kỳ vọng ban đầu.
4. **🔴 Rủi ro THẬT mới, chưa từng liệt kê trước khi dựng:** `ferogram::media::UploadedFile` (kết quả upload) không có API công khai nào để gắn `DocumentAttributeVideo(supportsStreaming)` hay `thumb` — field `inner: InputFile` cần để tự xây `InputMedia` là `pub(crate)`. Nếu đúng vậy khi chạy M2 thật, **R4 có thể không đáp ứng được điều kiện cốt lõi của [ADR-0005](../adr/0005-streaming-qua-service-worker-http-range.md)** (progressive playback cần `supportsStreaming: true`) bằng API công khai hiện tại — ứng viên hàng đầu để loại R4 nếu M2 thật xác nhận đúng.
5. `ferogram::Client::delete_messages()` public chỉ gọi `messages.deleteMessages` (không nhận peer) — không đúng cho supergroup/channel (cần `channels.deleteMessages` + access_hash). Đã vá bằng cách tự trích access_hash từ `get_chat_full()` rồi `invoke()` raw.

**Việc tiếp theo:** chạy `login`/`upload` thật (người dùng tự chạy, xem "Ranh giới an toàn" dưới) — ưu tiên xác nhận/bác bỏ phát hiện #4 trước, vì nó quyết định R4 có đáng đo tiếp M3-M8 hay không.

### Tech stack — cái gì đã chắc, cái gì spike này phải quyết

| Tầng | Chọn | Trạng thái bằng chứng |
|---|---|---|
| Vỏ desktop | Tauri v2 | **Chưa dùng trong repo.** Spike phải xác nhận: webview có mở được WebSocket tới DC Telegram không (cho R1), và `invoke` trả `ArrayBuffer` nhanh tới đâu |
| UI | Angular 22.1 zoneless + signals + Material/CDK | 🟢 Đã chứng minh ở `apps/web` ([ADR-0002](../adr/0002-angular-zoneless-signals-va-signalstore.md), [ADR-0016](../adr/0016-angular-material-va-cdk.md)). Spike **không** dựng UI thật — chỉ harness đo, xem "Bàn thử nghiệm" |
| Logic ingest thuần | `libs/core-ingest` (TypeScript) — phân hạng A/B/C/D, `inheritMetadata`, `mergeCatalogItems`, sidecar subs | 🟢 Có test, đã verify thật. **Ràng buộc thiết kế: KHÔNG port sang Rust ở bất kỳ nhánh nào** — bảng phân hạng phải giữ đúng một nguồn sự thật. Rust (nếu chọn R3/R4) chỉ nhận lệnh thực thi, không chứa luật nghiệp vụ |
| Schema catalog | `libs/shared-models` catalog v1 | 🟢 Đã chạy thật |
| FFmpeg | `ffmpeg-next` 7 (FFI) trong **tiến trình worker riêng**, kế thừa `tools/spike-09/` | 🟢 [SPIKE-09](#spike-09) — 72.1x realtime, 7 DLL ~21.3 MB tự chứa. Còn hở: **Hạng D (re-encode video) và phụ đề ảnh PGS chưa có bản native** |
| **MTProto** | **← chính là câu hỏi của spike này (R1/R2/R3/R4)** | ❓ Chưa đo gì |
| Hàng đợi bền | R1: IndexedDB/Dexie trong webview · R3/R4: SQLite phía Rust | ❓ Chưa quyết, phụ thuộc kết quả |
| Lưu session | R1: Dexie + WebCrypto key non-extractable (y như app web) · R3/R4: file mã hoá hoặc keychain OS qua Tauri | Nhánh R1 🟢 (đã dùng thật ở web); nhánh R3/R4 ❓ |
| Ranh giới RPC | Trait/interface `IngestRpc` gói đúng **7 thao tác** (resolve kênh, kiểm tra quyền ghi, đọc catalog ghim, tải document đó, upload video + attributes/thumb, upload phụ đề, publish+pin+delete) | Nguyên tắc mượn từ `TelegramGateway` của [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md): **bắt buộc áp dụng cho cả 4 nhánh**, để lựa chọn thư viện sau này đổi được trong một file |

### Bàn thử nghiệm

`tools/spike-10/` — **harness đo, không phải GUI**. Cùng nguyên tắc cô lập của [SPIKE-01](#spike-01)/[SPIKE-09](#spike-09): nếu hỏng, phải biết chắc lỗi nằm ở tầng runtime đang đo, không phải ở pipeline `tsmc-ingest` thật (pipeline đó đã verify riêng, xem [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md)).

Bốn thư mục con, **cùng một kịch bản, cùng một file mẫu, cùng một kênh test** — chỉ khác tầng MTProto:

```text
tools/spike-10/
  shared/       kịch bản đo dùng chung + sinh file mẫu + mẫu báo cáo .local.json
  r1-webview/   Tauri tối thiểu: 1 trang HTML + GramJS + Tauri command đọc chunk
  r2-sidecar/   Tauri tối thiểu + apps/tsmc-ingest đóng gói SEA làm sidecar
  r3-grammers/  crate Rust, trait IngestRpc, impl bằng grammers
  r4-ferogram/  crate Rust, CÙNG trait IngestRpc, impl bằng ferogram
```

R3 và R4 **bắt buộc dùng chung một trait** — nếu không, phép so sánh mất giá trị và không chứng minh được luận điểm "đổi thư viện = đổi một file".

**Không dựng UI Angular trong spike này.** Câu hỏi ở đây là runtime, không phải giao diện; thêm Angular chỉ làm chậm và làm nhiễu nguyên nhân khi hỏng. UI để dành cho slice thật sau khi ADR chốt.

### Cách chạy

Chưa dựng. Kế hoạch:

1. **Sinh file mẫu tổng hợp ≥2 GB** bằng `ffmpeg` (`testsrc2` + `sine`, H.264/AAC, đủ dài để vượt 2 GB) — **không dùng phim thật**, vừa tránh commit media (CLAUDE.md) vừa tránh đẩy nội dung có bản quyền lên kênh test. Ghi lại kích thước byte chính xác.
2. **Đo baseline upload** bằng Telegram Desktop trên **cùng máy, cùng file, cùng khung giờ** — mọi con số tốc độ của 4 nhánh so với baseline này, không so với nhau qua các lần chạy khác giờ (băng thông ISP dao động theo giờ, so chéo giờ là phép đo sai).
3. Chạy lần lượt 4 nhánh trên **cùng một kênh test tự tạo**, mỗi nhánh chạy trọn kịch bản M1→M8.
4. Tiêu chí **P1** (ranh giới crash) chạy riêng, không cần MTProto: cố tình truyền tham số sai cho media worker (lặp lại đúng lỗi channel-layout đã gây segfault ở [SPIKE-09](#spike-09)) và xác nhận tiến trình cha sống sót.
5. Tiêu chí **Đ1-Đ3** (đóng gói/giấy phép/chi phí) đo sau cùng, chỉ cho (các) nhánh đã qua M1-M8.
6. Ghi kết quả ra `tools/spike-10/spike-10-result.local.json` — **chỉ số liệu tổng hợp**, không session, không số điện thoại, không tên file thật.

Credential dùng chung từ `tools/.env` (khuôn [SPIKE-07](#spike-07)); mã OTP luôn gõ tay.

### Tiêu chí đạt/không đạt

Quyết trước khi chạy. Nhóm **M** đo tầng MTProto (áp cho cả 4 nhánh), **P** đo ranh giới tiến trình, **Đ** đo chi phí.

| Mã | Kiểm tra | Đạt khi |
|---|---|---|
| M1 | Đăng nhập tài khoản user thật (phone + code + 2FA) và lưu phiên | Chạy lần thứ hai **không hỏi lại OTP**; phiên lưu ở dạng đã mã hoá, nằm ngoài repo |
| M2 | Upload file ≥2 GB kèm `DocumentAttributeVideo(supportsStreaming)` + thumbnail | Telegram app thật **phát được và tua được**; kiểm bằng mắt, không chỉ tin mã trả về |
| M3 | RAM khi upload | **RAM đỉnh tiến trình < 500 MB** và **không tăng tuyến tính theo kích thước file** — đo bằng `Get-Process`, lấy mẫu mỗi 5s. Đây là tiêu chí loại thẳng: nạp cả file vào RAM là hỏng |
| M4 | Tốc độ upload | **≥ 80%** baseline Telegram Desktop ở bước 2. Dưới 50% là tín hiệu mạnh loại nhánh đó |
| M5 | Tiến trình + huỷ | Báo tiến trình **≤ 2s/lần cập nhật**; bấm huỷ thì lưu lượng mạng về 0 **trong ≤ 3s**, tiến trình không treo, không phải kill tay |
| M6 | `FLOOD_WAIT` | Gặp thật (upload liên tiếp nhiều file) hoặc dựng lại được: thư viện trả lỗi **phân biệt được + đọc ra số giây**; việc đang dở không mất. Tuyệt đối **không** né bằng đổi DC ([ADR-0006](../adr/0006-download-pipeline-dc-pool-flood-wait.md)) |
| M7 | Trần kích thước | Ghi rõ ngưỡng thật gặp phải (2 GB hay 4 GB Premium) **và thông điệp lỗi khi vượt** — biết trước để chặn ở UI, thay vì hỏng ở part cuối sau 40 phút upload |
| M8 | Publish catalog 3 RPC | `sendFile` → `pin` → `delete` bản cũ đúng như [SPIKE-06](#spike-06); đọc lại **byte-chính-xác** |
| P1 | Ranh giới crash FFmpeg | Cố tình gây lỗi FFI kiểu SPIKE-09 → **media worker chết một mình**, tiến trình cha + hàng đợi sống, file kế tiếp trong batch vẫn chạy |
| Đ1 | Đóng gói trên máy sạch | Máy **không** có `vcpkg`/Node/LLVM/PATH liên quan → cài và chạy được. Ghi **tổng MB installer + số file runtime** (bài học 7-DLL của SPIKE-09: phải chạy thật trên máy sạch, không suy từ `objdump`) |
| Đ2 | Giấy phép FFmpeg | Bộ FFmpeg dự định phân phối có kéo **GPL** (x264, cần cho re-encode Hạng D) hay giữ được **LGPL**? Ghi rõ kết luận + nguồn |
| Đ3 | Chi phí viết mới | Số dòng thật để đạt M1-M8, đếm bằng `cloc`, **không tính test** — con số này vào thẳng cây quyết định |

### Ma trận nền tảng

| Nền tảng | Phạm vi spike | Ghi chú |
|---|---|---|
| Windows 11 (máy đã dùng cho SPIKE-09) | **Bắt buộc** — toàn bộ M/P/Đ | Cùng máy để so được với số liệu SPIKE-09 |
| macOS / Linux | **Ngoài phạm vi, có chủ đích** | Mỗi OS là một bộ FFmpeg + quy trình ký số riêng. Phải ghi rõ ở "Phạm vi bằng chứng" rằng kết luận chỉ áp cho Windows |

### Ranh giới an toàn

- **Người dùng tự chạy trong terminal của mình.** Spike này cần đăng nhập MTProto thật (M1-M8) → Claude không chạy hộ, không nhận OTP, không cầm session ([ADR-0011](../adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)).
- **Kênh test tự tạo, tự xoá sau khi xong** — khuôn [SPIKE-06](#spike-06). Không đụng vào kênh media thật nào.
- **File mẫu tổng hợp**, không phải phim thật (mục "Cách chạy" bước 1).
- **Tôn trọng `FLOOD_WAIT` tuyệt đối.** M6 là để *quan sát* hành vi thư viện khi gặp, không phải để dò ngưỡng — dò ngưỡng là việc của [SPIKE-04](#spike-04) và đã đóng.
- Báo cáo `*.local.json` **chỉ chứa số liệu tổng hợp**.

### Kết quả

**2026-09-05, tài khoản thật, kênh `tsmc_mediacenter`.** Chi tiết đầy đủ + hai bug thật phát hiện lúc chạy (clap `--session` không nhận global, `.env` sai một cấp thư mục, `tl::enums::ChatFull` hai thư viện đặt tên biến thể khác nhau cho channel) ở [tools/spike-10/README.md](../../tools/spike-10/README.md). Tóm tắt:

| Mã | R3 (grammers) | R4 (ferogram) |
|---|---|---|
| M1 (login không hỏi lại OTP) | ✅ ĐẠT (nhiều lần chạy) | ✅ ĐẠT (nhiều lần chạy) |
| M2 (phát + tua được, xác nhận bằng ảnh) | ✅ **ĐẠT** — hiện đúng video, thumbnail, thời lượng, tua được | ❌ **TRƯỢT — dứt khoát**, xem dưới |
| M4 (throughput, baseline Telegram Desktop 16.48 MB/s cùng file 419 471 800 byte) | ⚠️ **24.4%** (4.01 MB/s, 104.5s — sau vá multi-connection, xem dưới) | ⚠️ **28.6%** (4.71 MB/s, 89.0s — sau vá pipelined, xem dưới) |
| M3, M5, M6, M7, M8, P1, Đ1-Đ3 | Chưa đo | Chưa đo |

**M4 đã điều tra thêm cho cả hai nhánh (2026-09-05 → 2026-09-06):**
- **R4:** root cause của số ban đầu (9.2%) là chọn sai method (`upload_sequential` — đúng nghĩa đen tuần tự, không pipeline); `ferogram-mtsender::DcPool` hỗ trợ tới 3 kết nối TCP thật/DC. Đổi sang `upload_file()` (pipelined) đưa lên **28.6%**.
- **R3:** root cause của số ban đầu (13.5%) là `SenderPool` cache ĐÚNG MỘT connection/dc_id vĩnh viễn (`upload_stream()`'s 4 "worker" chỉ multiplex trên 1 TCP connection). Khác ferogram, `grammers-mtsender` lộ công khai đủ mảnh (`connect_with_auth`, `Sender::invoke`, `Session::dc_option()`) để tự mở THÊM connection RAW tái dùng auth_key — đúng cách `SenderPool` tự làm nội bộ, không phải hack. Tự cài 3-connection song song đưa R3 từ 13.5% lên **24.4%** (1.81 lần) — **xác nhận bằng mắt: video phát được trọn vẹn**, không có vấn đề ráp file. Chi tiết ở [tools/spike-10/README.md](../../tools/spike-10/README.md).

Cả hai vẫn dưới ngưỡng pass 80% của M4, và còn hướng cải thiện thêm chưa thử (nhiều connection hơn, part size lớn hơn, tái dùng connection giữa các lần upload) — throughput tuyệt đối vẫn là câu hỏi mở, nhưng bằng chứng hiện tại nói rõ: **cả hai thư viện đều KHÔNG bị trần cứng** — trần ban đầu chỉ là do dùng API mặc định chưa tối ưu.

**P1 (ranh giới crash FFmpeg, Cổng 0 — chặn mọi lựa chọn) — ĐẠT (2026-09-06), tự chạy được không cần MTProto:** `tools/spike-10/shared/p1-crash-boundary.mjs` chạy `spike09.exe` (từ SPIKE-09) như tiến trình con trên một batch 3 việc, việc đầu cố ý là file hỏng. Kết quả thật: việc 1 panic sạch (exit 101), tiến trình cha (Node) không bị ảnh hưởng, việc 2 và 3 chạy bình thường ngay sau đó. Không tái tạo được đúng bug segfault gốc của SPIKE-09 (code hiện tại tự suy `channel_layout` từ decoder thay vì hardcode, nên đã bền hơn — mọi input hỏng thử được đều panic sạch, không phải access violation) nhưng kết luận kiến trúc như nhau: worker chết không kéo cha chết theo. Chi tiết ở [tools/spike-10/README.md](../../tools/spike-10/README.md#p1-ranh-giới-crash-ffmpeg--đạt-tự-chạy-được-không-cần-mtproto-2026-09-06).

**M3/M5/M7 cho R3 — ĐẠT, số liệu thật (2026-09-06/07):**
- **M3 (RAM):** 142 mẫu suốt 143.1s upload 400 MB, RSS dao động 16.7–21.1 MB, không tỉ lệ theo tiến trình — dưới xa ngưỡng 500 MB.
- **M5 (huỷ):** `--cancel-after-secs 5` huỷ đúng mốc 5.0s, dừng ngay, không sinh msgId.
- **M7 (ngưỡng kích thước, tài khoản Premium):** 2.307 GiB (4 726 part @512 KiB) upload thành công; 4.327 GiB (8 862 part) ném `FILE_PARTS_INVALID` (RPC 400) từ `upload.saveBigFilePart`. Ngưỡng thật nằm giữa hai mốc này, khớp con số vẫn đồn "4000 MB Premium" (**4 000 000 000 byte thập phân, KHÁC 4 GiB nhị phân**) — ở part size 512 KiB tương đương ~7 630 part. Lỗi là hằng số giao thức thô, không phải câu người dùng đọc được — xác nhận đúng lý do M7 tồn tại. Chi tiết + phát hiện "fail nhanh không đợi cuối" ở [tools/spike-10/README.md](../../tools/spike-10/README.md#kết-quả-thật-m3m5m7m8-cho-r3-2026-09-0607).

**M8 (catalog roundtrip) — ĐẠT (2026-09-07):** publish/pin/xoá-bản-cũ/đọc-lại đúng cả khuôn SPIKE-06, xác nhận **byte-chính-xác** sau khi sửa lỗi encoding của file test cục bộ (không phải lỗi Telegram/grammers).

**Còn lại cho R3:** chỉ M6 (`FLOOD_WAIT`) — để ngỏ có chủ đích, không chủ động ép (CLAUDE.md + SPIKE-04 đã là nơi dò ngưỡng). R3 đạt mọi tiêu chí đo được khác (M1/M2/M3/M5/M7/M8/P1); M4 cải thiện đáng kể (13.5%→24.4%, không phải trần kiến trúc) nhưng chưa qua ngưỡng pass 80%. Đ1-Đ3 (đóng gói/giấy phép/chi phí) chưa đo, chỉ cấp thiết khi thật sự đóng gói app. Bảng đầy đủ ở [tools/spike-10/README.md](../../tools/spike-10/README.md#tổng-kết-r3-sau-toàn-bộ-đợt-chạy-thật-2026-09-05--2026-09-07).

**M2 cho R4 giờ là KẾT LUẬN DỨT KHOÁT, không phải "chưa tìm ra cách":** thử vá bằng cách tự viết chunk-upload gọi thẳng `client.invoke()` (bypass `UploadedFile`) để vừa lấy tốc độ vừa tự gắn `DocumentAttributeVideo` — chạy thật ném `ConnectionReset` ở 1.7%. Đọc mã nguồn xác nhận: ferogram cố tình tách một "transfer pool" hoàn toàn riêng (auth key/transport/session riêng) cho file traffic, và hàm route vào đó (`rpc_transfer_on_dc_pub`) không phải API công khai — nghĩa là **không có cách an toàn nào từ ngoài crate vừa dùng đúng transfer pool vừa tự chọn attributes**. Chi tiết đầy đủ ở [tools/spike-10/README.md](../../tools/spike-10/README.md#điều-tra-m4-2026-09-05--vá-được-throughput-của-r4-nhưng-lộ-ra-giới-hạn-kiến-trúc-thật-chặn-hẳn-m2).

**Đọc cho đúng, không hợp lý hoá:** M2 giờ nghiêng hẳn về R3 với lý do CHẮC CHẮN hơn (giới hạn kiến trúc của ferogram đã xác nhận bằng cả đọc mã nguồn lẫn một lần chạy thật thất bại, không phải "chưa thử hết"). M4 cải thiện đáng kể cho CẢ HAI (R3: 13.5%→24.4%, R4: 9.2%→28.6%) — không còn ai bị coi là "trần cứng kiến trúc", chỉ là chưa tối ưu hết; R4 vẫn nhỉnh hơn R3 một chút trên trục thuần throughput nhưng khoảng cách đã hẹp lại nhiều. Cả hai vẫn dưới ngưỡng pass (80%) — throughput tuyệt đối vẫn là vấn đề mở, không phải điểm phân biệt quyết định giữa R3/R4 nữa (M2 mới là điểm phân biệt quyết định). Không dùng bảng này để kết luận "chọn R3" là quyết định cuối — còn 7 tiêu chí chưa đo, trong đó P1 (Cổng 0) chặn mọi lựa chọn bất kể MTProto nào thắng.

### Ghi chú thứ tự thử nghiệm thật (2026-09-05) — khác cây quyết định gốc bên dưới

Cây quyết định gốc (viết lúc mở spike, giữ nguyên bên dưới làm lịch sử — không sửa) đặt R1 ở Cổng 1, ưu tiên thử TRƯỚC R3/R4, đúng tinh thần giữ nguyên vẹn vụ cược "một thư viện MTProto" của [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md). Khi thật sự tới lúc chạy, người quyết định (user) chọn **không** theo thứ tự đó — lý do: R1 (GramJS chạy trong Tauri webview qua `upload.saveBigFilePart` viết tay + IPC đọc chunk) là lựa chọn CHƯA CÓ MỘT DÒNG CODE NÀO và đòi viết mới toàn bộ phần raw-API — rủi ro cao nhất trong bốn nhánh theo đúng bảng "Rủi ro chính chưa biết" ở đầu mục này, trong khi R3 đã có sẵn code chạy được (dựng cùng ngày, xem "Trạng thái dựng" trên) và nhanh chóng cho ra bằng chứng thật (M2 đạt). Đây là quyết định **thứ tự thử trước-sau dựa trên bằng chứng mới** (R1 tốn công viết mới nhất, R3 đã sẵn sàng đo nhất), không phải huỷ bỏ tiêu chí hay hạ thấp thanh chuẩn M1-M8/P1 — cây quyết định gốc vẫn là căn cứ để đọc kết quả, chỉ thứ tự chạy thay đổi. Xem addendum tương ứng ở [ADR-0003](../adr/0003-chon-thu-vien-mtproto-gramjs.md#cập-nhật-sau-khi-accepted-2026-09-05-spike-10--ngoại-lệ-khả-dĩ-cho-công-cụ-ingest-desktop).

### Cây quyết định (gốc, viết trước khi chạy — giữ nguyên để đối chiếu)

Đọc từ trên xuống, dừng ở nhánh đầu tiên khớp. Cổng 0 chặn tất cả — không có ranh giới crash thì mọi lựa chọn MTProto đều vô nghĩa với một app người dùng cuối.

```text
CỔNG 0 — P1: media worker crash có giết UI không?
├─ Giết UI ──▶ DỪNG. Sửa ranh giới tiến trình trước, chưa chọn gì cả.
│              (SPIKE-09 đã ghi đây là điều kiện bắt buộc, không phải tuỳ chọn)
└─ Không giết ──▶ CỔNG 1

CỔNG 1 — R1 (GramJS trong webview + chunk qua IPC) đạt M1-M8?
├─ ĐẠT, và M4 ≥ 80% baseline
│     ──▶ CHỌN R1. Dừng, KHÔNG cần đo tiếp R3/R4.
│         Một implementation MTProto duy nhất; ADR-0003 còn nguyên vẹn;
│         phần chunked upload viết ra dùng lại được cho ADR-0013 mục 3
│         (upload thẳng từ app web) vốn đang kẹt đúng vì lý do này.
├─ ĐẠT nhưng M4 < 80% hoặc M3 phồng RAM ──▶ CỔNG 2
└─ KHÔNG ĐẠT (M7 chặn ở 2 GB không vượt được, hoặc Đ3 > ~600 dòng) ──▶ CỔNG 2

CỔNG 2 — chấp nhận HAI implementation MTProto trong repo không?
├─ KHÔNG ──▶ CHỌN R2 (Node sidecar).
│            Xấu về đóng gói (2 runtime), nhưng zero rewrite, zero rủi ro mới,
│            giữ nguyên toàn bộ đường đã verify thật của ADR-0013.
└─ CÓ ──▶ CỔNG 3   (kèm điều kiện: phải viết ADR mới, xem "Plan sau spike")

CỔNG 3 — R3 (grammers) đạt M1-M8 với adapter tiến trình/huỷ ≤ 150 dòng?
├─ ĐẠT ──▶ CHỌN R3. Tuổi đời (2019+) và hệ sinh thái thắng sự tiện của R4.
└─ Trượt ở M5 (tiến trình/huỷ) hoặc M6 (FLOOD_WAIT) ──▶ CỔNG 4

CỔNG 4 — R4 (ferogram) đạt ĐÚNG chỗ R3 vừa trượt?
├─ ĐẠT ──▶ CHỌN R4, kèm ba điều kiện bắt buộc, không thương lượng:
│            1. Ghim cứng phiên bản (không `^`), y như bất biến #9 với `telegram`
│            2. Toàn bộ RPC nằm sau trait IngestRpc — đổi thư viện = đổi một file
│            3. Không dùng hàm `upload()` nhận AsyncRead (docs ghi rõ:
│               nạp toàn bộ nguồn vào RAM) — chỉ `upload_file`/`upload_sequential`
└─ KHÔNG ĐẠT ──▶ Quay về R2 (Node sidecar).
                  Kết luận trung thực lúc đó: Tauri chỉ đáng làm vỏ UI,
                  chưa đáng làm nơi chứa MTProto.
```

**Nhánh phụ, độc lập với cây trên** (quyết sau khi cây trên xong, dựa vào Đ2):

```text
Hạng D (re-encode video) + phụ đề ảnh PGS — SPIKE-09 chưa cài bản native
├─ Đ2 nói bộ FFmpeg phân phối được giữ ở LGPL
│     ──▶ cài nốt vào crate Rust, bỏ hẳn phụ thuộc ffmpeg.exe hệ thống
└─ Đ2 nói phải kéo x264 → GPL
      ──▶ KHÔNG đóng gói kèm. Giữ shell-out `ffmpeg` hệ thống cho riêng hai
          nhánh này (user tự cài) — giữ app ở LGPL và giữ luôn ranh giới
          tiến trình an toàn sẵn có cho phần nặng nhất.
```

### Ta sẽ làm gì với từng kết quả

| Kết quả | Hành động | Trạng thái spike |
|---|---|---|
| Cổng 0 hỏng (P1 không đạt) | Không chọn runtime nào. Thiết kế lại ranh giới tiến trình rồi chạy lại spike — đây là điều kiện SPIKE-09 đã nêu, không phải phát hiện mới | Giữ mở ⏳ |
| R1 thắng ở Cổng 1 | Addendum [ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md) chốt "làm GUI Tauri, MTProto giữ GramJS trong webview". **Không** cần ADR mới cho ADR-0003 — vụ cược "một thư viện" còn nguyên. Ghi phần chunked upload vào roadmap như tài sản dùng chung với ADR-0013 mục 3 | 🟢 |
| R2 thắng ở Cổng 2 | Addendum ADR-0013 chốt Tauri **chỉ làm vỏ UI**; ghi rõ chi phí đóng gói 2 runtime là đã biết và chấp nhận, kèm số MB thật đo được | 🟡 (chấp nhận đánh đổi có chủ đích) |
| R3 hoặc R4 thắng | **ADR mới** (không phải addendum): "Chọn runtime MTProto thứ hai cho công cụ ingest desktop" — nêu rõ nó thu hẹp phạm vi vụ cược của ADR-0003 xuống còn `apps/web`, và app xem vẫn phụ thuộc GramJS archived. Cộng addendum ADR-0013 chốt Tauri, và addendum [ADR-0012](../adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md) cho cấu trúc workspace + ranh giới ESLint mới | ✅ **XẢY RA (2026-09-07)** — R3 thắng, M6 để ngỏ nên đóng 🟡 đúng như dự kiến ở nhánh này. Xem [ADR-0017](../adr/0017-grammers-cho-cong-cu-ingest-desktop.md) + addendum ADR-0013/ADR-0012 tương ứng — cả ba đã viết |
| Cả 4 nhánh trượt M3 hoặc M6 | Kết quả 🔴 thật sự: hướng GUI desktop cho ingest chưa khả thi ở mức chất lượng đã đặt ra. Giữ `tsmc-ingest` CLI làm đường chính thức, ghi rõ lý do để không ai làm lại từ đầu mà không biết rào cản | 🔴 |
| M7 lộ trần cứng 2 GB ở mọi nhánh | Phát hiện độc lập, giá trị riêng: phải chặn tại UI **trước** khi remux (một file 4K remux dễ vượt 2 GB), và ghi vào roadmap như ràng buộc sản phẩm — không phải chi tiết kỹ thuật | Ghi làm quan sát |
| Đ1 lộ thêm file runtime chưa lường (kiểu `swresample-5.dll` của SPIKE-09) | Cập nhật danh sách đóng gói + ghi vào [docs/lessons.md](../lessons.md) — bài học "đo dependency phải chạy thật trên máy sạch" đã có một lần, lặp lại nghĩa là bài học chưa đủ rõ | Ghi làm quan sát |

### Plan sau spike — thứ tự viết tài liệu và code

Chỉ bắt đầu sau khi cây quyết định cho ra một nhánh. Thứ tự này cố ý đặt tài liệu trước code:

1. **ADR** — theo bảng "Ta sẽ làm gì" ở trên (addendum ADR-0013 ở mọi nhánh; thêm ADR mới + addendum ADR-0012 nếu là R3/R4). Dùng skill `/adr`, không sửa nội dung Quyết định đã Accepted.
2. **`docs/ux-design.md`** — thêm mục cho công cụ desktop. Phải nói rõ ngay đầu mục: đây **không** thuộc 7 màn hình mobile-first của app xem; ngôn ngữ thiết kế khác hẳn (dày đặc, bàn phím trước, bảng thay vì card).
3. **`docs/roadmap.md`** — thêm nhóm việc GUI ingest; xoá/điều chỉnh các dòng CLI mà GUI thay thế.
4. **Quyết định phụ còn treo**, ghi thẳng vào ADR tương ứng thay vì để trôi: số phận `tsmc-ingest` CLI (giữ song song hay khai tử sau khi GUI đạt parity); tra metadata online kiểu TMDB (được phép về kiến trúc vì nằm phía admin, nhưng gửi tên phim sang bên thứ ba — nếu làm thì opt-in, mặc định tắt); `@tsmc_bot` ([ADR-0013](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md) mục 2) có còn cần không khi GUI làm được `/publish` và `/check`.
5. **Code** — scaffold app thật, không phải harness spike. `tools/spike-10/` giữ lại hay xoá theo đúng tiền lệ: giữ nếu nhánh thắng dùng lại được code (như `tools/spike-09/`), xoá nếu chỉ để trả lời câu hỏi (như [SPIKE-01](#spike-01)).

### Cập nhật sau khi đóng (2026-09-13, đo Đ2 thật — lần đầu app đóng gói `.exe`)

Đ2 ("bộ FFmpeg phân phối kéo GPL hay giữ LGPL?") lúc đóng spike (2026-09-07) để "chưa đo, chỉ cấp thiết khi thật sự đóng gói app". Nay `cargo tauri build` chạy thật lần đầu (2026-09-13) nên đo:

- Configure string nhúng trong `avcodec-61.dll` (vcpkg `ffmpeg:x64-windows`) có `--disable-libx264 --disable-libx265` — build KHÔNG link x264/x265.
- `cargo run --example check_h264_encoder -p ingest-ffmpeg` (script mới, `apps/tsmc-ingest-desktop/ingest-ffmpeg/examples/`) xác nhận encoder H264 THẬT ở `reencode.rs` (Hạng D) là `h264_mf` (Windows Media Foundation), KHÔNG PHẢI `libx264` như comment gốc (copy từ ví dụ `ffmpeg-next` giả định build có x264).

**Kết luận Đ2: giữ LGPL, không kéo GPL** — đúng nhánh "Đ2 nói bộ FFmpeg phân phối được giữ ở LGPL" trong cây quyết định phụ ở trên. Chi tiết đầy đủ + phát hiện phụ (option `preset=medium` bị `h264_mf` bỏ qua thầm lặng, không phải bug) ở [ADR-0013 § addendum 2026-09-13](../adr/0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-13-trả-lời-đ2--đóng-gói-dll-ffmpeg-thật-lần-đầu).

**Đ1 ĐẠT (cùng ngày, sau khi user tự verify):** cài đặt bản đóng gói (`.msi`/NSIS setup, kèm 7 DLL FFmpeg qua `build.rs` copy) trên một máy KHÔNG có `vcpkg`/LLVM/Rust/Node → mở app chạy đúng, không còn lỗi "thiếu library cần thiết của ffmpeg" đã gặp trước bản vá. Mức bằng chứng: "cài + mở chạy được" — CHƯA có số liệu chi tiết Đ1 đòi hỏi đầy đủ (tổng MB installer, danh sách file runtime đối chiếu từng cái, thử riêng Hạng D trên máy đó) — checklist còn mở ở [docs/pending-device-tests.md](../pending-device-tests.md#gui-ingest-desktop-appstsmc-ingest-desktop--đóng-gói-bản-phân-phối-exeinstaller-trên-máy-sạch-2026-09-13). **Đ3 (chi phí viết mới) vẫn chưa đo** — không đóng thêm lần này. Đ1/Đ2 ĐẠT không đổi lý do đóng 🟡 của spike (M6 để ngỏ có chủ đích) — chỉ dọn xong hai hạng mục phụ, spike vẫn giữ nguyên trạng thái 🟡 đã đóng.
