# ADR-0023: `libx264` (preset fast, RF kiểu HandBrake) thay `h264_mf` cho re-encode Hạng D — chấp nhận GPL cho riêng công cụ ingest desktop

- **Trạng thái:** Accepted
- **Ngày:** 2026-10-10
- **Liên quan:** [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md) (thay kết luận Đ2 "giữ LGPL" ở addendum 2026-09-13), [ADR-0017](./0017-grammers-cho-cong-cu-ingest-desktop.md) (addendum 2026-10-04 — đặc tính rate control của `h264_mf`; addendum 2026-10-07 — Hạng D nén theo bitrate nguồn), [ADR-0022](./0022-item-nhieu-phan-trong-catalog.md) (chia phần là lối thoát khi nén không đủ)

## Bối cảnh

Hạng D (video trình duyệt không phát được, phải re-encode sang H.264) cho ra hình "mờ và vỡ nét cực kỳ nhiều" ngay cả sau hai đợt vá ([ADR-0017 § addendum 2026-10-04](./0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-10-04-verify-giai-đoạn-2-sửa-lỗi-đo-thời-lượng-mẫu-đặc-tính-rate-control-của-h264_mf) chặn dưới sàn ABR; addendum 2026-10-07 bỏ mặc định của bộ nén). Encoder thật là `h264_mf` (MFT phần mềm của Windows, `hw_encoding=0`) vì bản FFmpeg vcpkg build `--disable-libx264` để giữ LGPL ([ADR-0013 § addendum 2026-09-13](./0013-bot-dong-hanh-va-pipeline-ingest.md#cập-nhật-sau-khi-accepted-2026-09-13-trả-lời-đ2--đóng-gói-dll-ffmpeg-thật-lần-đầu)).

**Số đo 2026-10-10** (máy dev Ryzen 7 8845HS; ffmpeg 9.0.1 CLI full build; nguồn thật WMV VC-1 1080p30 5.7 Mbps dài 3 giờ — muốn vừa trần 2 GB phải xuống ~1.45 Mbps ≈ 0.023 bits/pixel; clip 3 đoạn × 20 s ở 1800/5400/9000 s giải mã ra FFV1 làm tham chiếu; VMAF `libvmaf` ép khung theo chỉ số như ADR-0017; p1 = VMAF của 1% khung tệ nhất):

| Encoder / chế độ, cùng ~1.45 Mbps | VMAF | p1 | Tốc độ thật đọc thẳng WMV |
|---|---|---|---|
| `h264_mf` ABR (hiện tại) | 74.4 | **31.0** | 8.5× |
| `h264_mf` `hw_encoding=1` (chọn MFT của AMD) | 78.2 | 44.7 | — |
| `h264_mf` `rate_control=quality` q=30 (1261 kbps) | 78.3 | 65.4 | — |
| `h264_amf` vbr_peak + preanalysis (iGPU 780M) | 86.1 | 67.3 | — |
| x264 veryfast 2-pass | 80.3 | 69.4 | 7.0× (1-pass) |
| **x264 fast 2-pass** | **81.4** | **71.1** | 4.0× (1-pass) |
| x264 medium 2-pass | 82.8 | 72.1 | 3.4× (1-pass), 2.2× (2-pass) |
| x264 slow 2-pass | 83.0 | 72.8 | 3.0× (1-pass) |
| SVT-AV1 preset 8 (1087 kbps) | 90.5 | 80.5 | — |

Giải mã VC-1 một mình chỉ đạt 14.8× — trần tốc độ của cả pipeline với nguồn này. NVENC (RTX 4060) không đo được: driver 577 cũ hơn mức ffmpeg 9 cần (≥610).

**Vì sao `h264_mf` tệ — phân bổ bit theo thời gian (cửa sổ 3 s, độ khó = bitrate của x264 CRF 23 không trần):** tương quan giữa bitrate và độ khó cảnh là **0.05** với `h264_mf` (cảnh khó 931 kbps → VMAF 35.7, cảnh dễ 1570 kbps → 92.6) so với **0.95** với x264 2-pass (cảnh khó 1856 kbps → 81.6, cảnh dễ 558 kbps → 86.9). x264 lấy bit của cảnh dễ dồn sang cảnh khó; `h264_mf` chia gần như đều bất kể nội dung.

**Từng nút chỉnh của x264** (fast, 2-pass, 1.45 Mbps; mốc 81.4 / p1 71.1): bỏ VBV hoặc nới lên 3× → 81.3–81.4 (trần `maxrate` 2×/`bufsize` 4× không tốn gì); `aq-mode=3` → 81.8 / 72.3; `qcomp` 0.5/0.7 → 81.9/80.9; `rc-lookahead 60` → 81.5; `tune film` → 81.2; **tắt mbtree → 80.0 / 67.7**. Gần như toàn bộ lợi ích đến từ việc đổi encoder + chế độ rate control; chỉnh tay chỉ ±0.5 VMAF.

**Preset gốc của HandBrake** (`preset/preset_builtin.json`, nhóm General "Fast"): x264 `fast`, chất lượng không đổi, RF **22** (1080p30), **21** (720p30), **20** (576p25/480p30); profile `main`; AAC 160 kbps (trùng `REENCODE_AUDIO_BITRATE_BPS`). "Very Fast 1080p30" dùng `veryfast` RF 24.

## Các phương án

### A. Giữ `h264_mf`, chỉnh tham số (`hw_encoding=1`, `rate_control=quality`)
- ✅ Không đổi giấy phép, không đổi build.
- ❌ Trần thấp: tốt nhất đo được 78.3 VMAF ở 1.26 Mbps. `quality` mất cận trên dung lượng — ADR-0017 đã đo là `h264_mf` không có chế độ nào chặn được trần.
- ❌ `hw_encoding=1` chọn MFT theo GPU của máy chạy, chất lượng không đoán trước được.

### B. Encoder GPU gọi trực tiếp (`h264_amf` / `h264_nvenc` / `h264_qsv`, giữ LGPL)
- ✅ AMF đạt 86.1 ở 1.44 Mbps, bám target ±1%, giữ được toàn bộ logic ước tính ABR hiện có.
- ❌ Chất lượng phụ thuộc GPU của từng máy (ba nhà sản xuất, nhiều đời); máy không có GPU rời phải lui về MF. p1 của AMF (67) thấp hơn x264.
- ❌ NVENC chưa đo được (driver). `qvbr` của AMF bỏ qua `maxrate` (ra 3.78 Mbps khi trần 2.9); `hqvbr` treo hẳn trong lần đo.
- **Tạm gác, không loại** — xem "Việc để ngỏ".

### C. `libx264` link trong tiến trình qua `ffmpeg-next`, chấp nhận GPL cho công cụ ingest (**được chọn**)
- ✅ Khung tệ nhất tốt nhất trong mọi cấu hình H.264 đã đo (p1 70–73); kết quả giống nhau trên mọi máy; có đủ chế độ HandBrake dùng (CRF, 2-pass, VBV).
- ✅ Giữ nguyên pipeline native đã vá nhiều lỗi thật (dts AVI packed B-frames, frame rate WMV, audio mono).
- ❌ Chậm hơn: fast 1-pass 4.0× so với 8.5× của `h264_mf`; 2-pass khoảng 2.5× (ước từ tốc độ từng pass, chưa đo trọn).
- ❌ GPL — xem Hệ quả.

### D. Gọi `ffmpeg.exe` (có x264) do user tự cài, chạy như tiến trình con
- ✅ App phân phối vẫn LGPL.
- ❌ Phải viết lại pipeline `ffmpeg-next` thành parse stderr CLI: mất progress/cancel/ETA đã verify, mất các bản vá dts/frame rate phải làm lại bằng cờ CLI. Thêm bước cài đặt cho user.
- **Loại** — tốn công lớn chỉ để né một giấy phép mà user đã chấp nhận.

### E. OpenH264 (BSD, có feature `openh264` trong vcpkg)
- ✅ Giữ LGPL.
- ❌ Chưa đo được (ffmpeg CLI trên máy không có), tài liệu công khai xếp chất lượng kém x264 rõ rệt; không có CRF.
- **Loại** khi GPL đã được chấp nhận.

### F. AV1 (SVT-AV1)
- ✅ Hiệu quả nhất: 90.5 VMAF ở 1.09 Mbps.
- ❌ Catalog xếp AV1 là `compat: "partial"` (Hạng B — [ADR-0013](./0013-bot-dong-hanh-va-pipeline-ingest.md), [catalog-spec](../catalog-spec.md)). Đầu ra của re-encode Hạng D phải phát được ở mọi trình duyệt.
- **Loại** cho Hạng D.

## Quyết định

1. **Encoder video của re-encode Hạng D là `libx264`.** `reencode.rs` tìm encoder **theo tên** (`encoder::find_by_name("libx264")`), không dùng `encoder::find(codec::Id::H264)` nữa, và báo lỗi rõ nếu build thiếu x264. Không lặng lẽ lui về `h264_mf`: "tưởng đang chạy x264, thật ra là `h264_mf`" là đúng cái bẫy đã dính một lần (ADR-0013 § addendum 2026-09-13).
2. **Chấp nhận GPL cho riêng công cụ ingest desktop** (`apps/tsmc-ingest-desktop`). FFmpeg vcpkg build với feature `gpl` + `x264`. `apps/web` và các `libs/*` của web **không bị ảnh hưởng** — chương trình riêng, không link với nhau.
3. **Mặc định giống preset "Fast" của HandBrake:** x264 `preset=fast`, chất lượng không đổi với RF theo **chiều cao đầu ra** — ≥1080 → **22**, ≥720 → **21**, thấp hơn → **20**; AAC 160 kbps giữ nguyên. Các tham số khác để mặc định x264 (mbtree, AQ mode 1, psy-rd), giống HandBrake (`VideoOptionExtra` rỗng). **Một chỗ khác HandBrake:** profile `high` thay vì `main` — HandBrake chọn `main` vì thiết bị phần cứng cũ, còn mọi trình duyệt đích đều giải mã được High.
4. **Hai chế độ rate control, chọn theo trần — logic chọn là hàm thuần ở TS** (`libs/core-ingest`, đúng [ADR-0017 điều kiện bắt buộc #4](./0017-grammers-cho-cong-cu-ingest-desktop.md); Rust chỉ thực thi):
   - **Chất lượng (CRF)** khi dự đoán ở RF đã chọn nằm dưới ngân sách với margin. Luôn kèm **trần VBV** `maxrate` = ngân sách bitrate vừa trần (`bufsize` = 2× `maxrate`). VBV giới hạn bitrate trung bình trên mọi cửa sổ dài bằng `bufsize`, nên dung lượng không vượt trần dù dự đoán sai. Bước kiểm dung lượng sau encode vẫn giữ làm lưới an toàn.
   - **Dung lượng (2-pass ABR)** khi RF đã chọn không vừa trần: nhắm đúng ngân sách bitrate, `maxrate` 2× / `bufsize` 4× target.
   - Không dùng 1-pass ABR làm chế độ chính: chỉ nhìn trước khoảng 40 khung nên không rút được bit từ cảnh dễ trên toàn file (medium 1-pass: 80.1 VMAF và hụt target 10%).
5. **Bật đa luồng tường minh cho decoder và encoder** (`thread_count = 0` = tự động). Giá trị mặc định của `AVCodecContext` khi gọi qua API là 1 luồng, khác CLI. Đây là nghi ngờ đã ghi ở roadmap Giai đoạn 1 nhưng chưa đo — với x264 thì bắt buộc, vì toàn bộ số tốc độ ở trên là của CLI (tự động đa luồng).
6. **Ước tính dung lượng được phép kém chính xác hơn** (user chấp nhận 2026-10-10): chế độ CRF hiện **khoảng** ước tính từ encode mẫu cộng cận trên chắc chắn (= trần), không hứa ±3% như ABR đã hiệu chỉnh. Chế độ 2-pass thì ngược lại, chính xác hơn hiện tại (x264 CLI 2-pass ±2%, ADR-0017 § addendum 2026-10-04).
7. **Tầng điều khiển thủ công theo kiểu HandBrake:** người dùng thường chỉnh **một thanh chất lượng (RF)**; độ phân giải, dung lượng/bitrate cụ thể, preset tốc độ và audio nằm trong phần "Nâng cao" dành cho power user (chi tiết ở Kế hoạch, mục 4c.3).

## Hệ quả

**Tích cực**
- Hết vỡ nét ở vùng bitrate thấp: p1 31 → 71 ở cùng ngân sách; VMAF trung bình +7 điểm.
- Hạng D dưới trần không còn phải giữ 100% bitrate nguồn (`D_REENCODE_SOURCE_FRACTION`): RF thường cho file nhỏ hơn mà đẹp hơn — **giả thuyết**, chưa đo trên file Caribbean (mục 4c.1).
- Chất lượng không phụ thuộc phần cứng của máy chạy ingest.
- Bộ máy hiệu chỉnh target theo mẫu thử chỉ có lý do tồn tại vì `h264_mf` (mức sàn ABR, lệch +10% chưa hiệu chỉnh) — 2-pass làm phần lớn bộ máy đó thành thừa, gỡ được (mục 4c.4).

**Tiêu cực / phải chấp nhận**
- **GPL:** bản `.exe` ingest desktop phân phối ra phải kèm mã nguồn (hoặc lời mời cung cấp mã nguồn) theo GPL-2.0-or-later cho người nhận. Repo là mã nguồn; nghĩa vụ chỉ phát sinh khi đưa `.exe` cho người khác. Phải ghi rõ giấy phép trong `Cargo.toml`/màn hình About.
- **Bằng sáng chế H.264:** khác `h264_mf` (Microsoft đã trả phí), tự phân phối encoder x264 về lý thuyết cần giấy phép bằng sáng chế. Dự án cá nhân, phi thương mại — ghi nhận, không xử lý.
- **Thời gian:** file 3 giờ 1080p từ ~21 phút (`h264_mf`) lên ~45 phút (fast, CRF) hoặc ~70 phút (fast, 2-pass) trên máy 8 nhân/16 luồng; máy 4 nhân có thể chậm thêm 2–3×. CPU chạy 100% suốt thời gian đó.
- **Đóng gói:** bộ DLL đi kèm từ 7 lên 8 (thêm DLL của x264); build vcpkg phải bật thêm `gpl,x264` mà giữ nguyên các feature hiện có. Checklist "máy sạch" trong pending-device-tests đổi theo.
- **Hằng số hiện có mất nghĩa** và phải đo lại hoặc gỡ: `ABR_FLOOR_BITS_PER_PIXEL` 0.045 (mức sàn riêng của `h264_mf`; x264 ở 0.023 bpp vẫn đạt 81), `AUTO_MIN_BITS_PER_PIXEL` 0.06, ngưỡng `qualityLevel`, `D_REENCODE_SOURCE_FRACTION`, khoảng 0.5–1.5× của `estimateReencodeRangeBytes`, `SIZE_SAFETY_MARGIN`/`CALIBRATED_SAFETY_MARGIN`.
- **Giới hạn của số đo:** một nguồn (VC-1, ít chi tiết), clip 60 s, một máy mạnh, chưa nhìn bằng mắt. VMAF không đo được phần psy-rd của x264, có khi còn phạt nó — không chỉnh psy/tune theo VMAF.

## Kế hoạch triển khai — Giai đoạn 4c

Mỗi slice kết thúc bằng `cargo test`/`npm run test:libs` sạch và một lần đo VMAF trên clip chuẩn. Phần cần mắt người hoặc máy khác ghi vào [pending-device-tests](../pending-device-tests.md).

### 4c.1 — Nền: build có x264, encoder theo tên, CRF cho Hạng D dưới trần
- vcpkg: `ffmpeg[<feature hiện có>,gpl,x264]:x64-windows`; cập nhật danh sách 8 DLL và hướng dẫn build. `check_h264_encoder` khẳng định encoder là `libx264`.
- `reencode.rs`: `find_by_name("libx264")`; `thread_count = 0` cho decoder + encoder — **điều kiện bắt buộc**, không phải tối ưu: đo 2026-10-10 x264 fast trên nguồn WMV thật, 1 luồng = 0.5× thời gian thực (file 3 giờ ~6 giờ), 2 = 0.9×, 4 = 1.6×, 8 = 2.0×, tự động (24 luồng) = 4.0×; hiện `ingest-ffmpeg` không đặt luồng ở đâu cả nên mặc định của API là 1 (đo lại trong app sau khi sửa, ghi số); `ReencodeOptions` thêm chế độ rate control (`Crf { rf, maxrate, bufsize }` | `Abr { bps, maxrate, bufsize }`), `preset`, `profile=high`. Bỏ dictionary `preset=medium` đang bị lờ.
- TS: `defaultRf(outputHeight)` theo bảng HandBrake; Hạng D dưới trần chuyển từ "bitrate nguồn" sang CRF + trần VBV. Vượt trần **tạm** dùng x264 1-pass ABR + hiệu chỉnh mẫu hiện có cho tới 4c.2.
- Đưa bộ đo vào repo (`tools/encode-bench/`: dựng clip tham chiếu, ma trận encode, VMAF/p1, trace bitrate theo cửa sổ) để mọi slice sau đo cùng một cách.
- **Nghiệm thu:** nén trọn hai file WMV Caribbean (lỗi gốc của addendum ADR-0017 2026-10-07) — ghi dung lượng so với nguồn, VMAF so với bản `h264_mf`, và user nhìn bằng mắt.

### 4c.2 — 2-pass cho vượt trần, chọn chế độ tự động
- Rust: pass 1 là vòng decode→scale→encode **không mux, không audio**, cờ `PASS1` + option `stats` (tên file thống kê) của wrapper libx264 — không cần FFI thủ công; pass 2 cờ `PASS2`. Progress gộp hai pass theo trọng số đo được; huỷ được giữa hai pass; dọn file thống kê.
- TS: `chooseRateMode()` dựa trên dung lượng dự đoán ở RF đã chọn (encode mẫu 3 đoạn sẵn có của `estimate_reencode`) × hệ số lệch của mẫu CRF (đo ở 4c.4; tạm 1.3 theo độ lệch của chế độ quality đã đo) so với ngân sách. Margin của 2-pass nâng lên ~0.97.
- **Nghiệm thu:** file WMV 3 giờ ở clip chuẩn ra đúng ngân sách ±2%, VMAF ≥ số đo CLI ở bảng trên.

### 4c.3 — Dialog tiền kiểm kiểu HandBrake
- **Tự động** (mặc định): RF theo độ phân giải, chế độ tự chọn theo 4c.2; hiện "Chất lượng: Chuẩn (RF 22)", khoảng dung lượng ước tính, ETA.
- **Thủ công** — một **thanh chất lượng** RF 18–28 (nhãn hai đầu "Nhỏ hơn" ↔ "Đẹp hơn", vạch ở mức mặc định), dung lượng ước tính + ETA cập nhật theo thanh (ngoại suy từ mẫu, gắn nhãn "dự kiến" tới khi bấm "Ước tính chính xác"). Kéo tới mức không vừa trần → báo ngay "mức này vượt trần — sẽ nén theo dung lượng" kèm gợi ý hạ độ phân giải / chia phần.
- **Nâng cao** (thu gọn, cho power user): độ phân giải, chế độ "Dung lượng mục tiêu" (thanh kích thước/bitrate hiện có), preset tốc độ (Nhanh = `veryfast` / Chuẩn = `fast` / Chậm = `medium`), bitrate audio.
- Thay chỉ báo bits/pixel bằng nhãn chất lượng theo RF; bits/pixel chỉ còn trong Nâng cao.

### 4c.4 — Hiệu chỉnh và dọn dẹp
- Đo độ lệch dự đoán dung lượng từ mẫu ở chế độ CRF của x264 (cùng phương pháp bảng "ngoại suy" của ADR-0017 § addendum 2026-10-04).
- Ngưỡng hạ độ phân giải tự động: ở bpp thấp (0.02–0.03), bản 720p phóng lên có hơn bản 1080p không — đặt lại `AUTO_MIN_BITS_PER_PIXEL`.
- `aq-mode=3` trên nội dung tối/nhiều nhiễu; chỉ đưa vào mặc định nếu lợi trên nhiều nội dung.
- Đo tốc độ trên một máy 4 nhân.
- Gỡ hằng số/hàm chỉ còn ý nghĩa với `h264_mf` (`ABR_FLOOR_BITS_PER_PIXEL`, `D_REENCODE_SOURCE_FRACTION`, `calibrateTargetBps` nếu không còn nơi dùng…) cùng test của chúng; ghi bài học vào [lessons](../lessons.md).

### Giai đoạn 4d — luồng xử lý và tài nguyên (đi kèm 4c)

Không thuộc quyết định của ADR này (encoder + giấy phép), ghi ở ADR-0017 vì là luồng xử lý của công cụ ingest:
- **4d.1 — Hàng đợi không khoá** và **4d.2 — Hold khi vẫn vượt trần:** [ADR-0017 § addendum 2026-10-10 (hold + hàng đợi)](./0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-10-10-kế-hoạch-hold-khi-vẫn-vượt-trần--hàng-đợi-không-khoá). 4d.1 không phụ thuộc x264, làm được trước 4c.1. 4d.2 cần 4d.1 (item `held` không được chặn worker) và dùng 2-pass của 4c.2 cho phương án "nén lại".
- **4d.3 — Quản lý tài nguyên CPU** (ưu tiên tiến trình, EcoQoS, chế độ Tự động/Nhẹ/Tối đa, tạm dừng, chặn ngủ/pin/ổ đĩa): [ADR-0017 § addendum 2026-10-10 (tài nguyên CPU)](./0017-grammers-cho-cong-cu-ingest-desktop.md#cập-nhật-sau-khi-accepted-2026-10-10-kế-hoạch-quản-lý-tài-nguyên-cpu-khi-re-encode--giai-đoạn-4d3). Cần 4c.1 (đa luồng) trước, vì điều tiết chỉ có nghĩa khi encode dùng được hết máy.

## Việc để ngỏ

- **Encoder GPU (phương án B)** làm tuỳ chọn "Nhanh" cho power user: cần cập nhật driver NVIDIA để đo NVENC, rồi mới quyết có bật feature `amf`/`nvcodec` của vcpkg (giữ được LGPL cho phần đó, nhưng build đã là GPL vì x264).
- **Trần bitrate đỉnh cho stream:** chế độ CRF với file ngắn có ngân sách rất rộng, VBV theo trần không giới hạn đỉnh thực tế. Có cần trần đỉnh riêng theo thông lượng tải MTProto (ADR-0006) không — chưa đo.
- **Nguồn bitrate thấp:** RF 20–22 có thể cho file **lớn hơn** nguồn khi nguồn đã nén mạnh. HandBrake không xử lý trường hợp này; tạm thời chỉ cảnh báo.
- **RF cho >1080p:** bảng HandBrake "Fast" dừng ở 1080p; tạm dùng 22.

## Cập nhật sau khi Accepted (2026-10-10, code slice 4c.1)

> Theo quy tắc ở [docs/adr/README.md](./README.md): không sửa nội dung Quyết định đã Accepted ở trên. Mục này chỉ ghi nhận điều phát sinh khi code 4c.1 — quyết định gốc **vẫn đứng vững**.

**Đã code (CHƯA nghiệm thu đủ theo tiêu chí của 4c.1 — xem cuối mục):**
- `reencode.rs` tìm encoder theo tên `libx264` (`VIDEO_ENCODER_NAME`); thiếu thì lỗi `ProcessError::EncoderMissing`, không lui về `h264_mf`. `preset` mặc định `fast` (chỉ nhận tên preset đã biết — giá trị đi thẳng vào AVOption), `profile=high`, `crf` + `maxrate` + `bufsize` qua `ReencodeOptions::crf` (`CrfRate`; `maxrate_bps = 0` = không đặt trần khi không biết thời lượng). Bỏ dictionary `preset=medium` từng bị `h264_mf` lờ.
- Đa luồng tường minh cho decoder lẫn encoder: `thread_count = 0` + `thread_type = FRAME | SLICE` (không dùng `set_threading` của `ffmpeg-next` vì kiểu `Type` của nó chỉ chọn một trong hai mà MPEG-4/WMV chỉ có slice).
- TS (`libs/core-ingest`): `defaultRf()` (22/21/20 theo chiều cao đầu ra), `planCrf()` (maxrate = ngân sách bitrate vừa trần, `bufsize` = 2×), `crfCeilingBytes()` (cận trên chắc chắn). Dialog tiền kiểm: Hạng D dưới trần mặc định `rateMode = 'crf'`; đặt tay kích thước/bitrate chuyển sang `'abr'`; file vượt trần vẫn 1-pass ABR + hiệu chỉnh mẫu như kế hoạch. Chế độ CRF tắt cảnh báo "dưới sàn ABR"/"nén vô nghĩa" (chỉ có nghĩa với `h264_mf`) và không hiệu chỉnh target theo mẫu.
- Lệnh Tauri `prepare_upload`/`estimate_reencode` nhận thêm `crf` (struct) và `preset`; gom ở một hàm `reencode_options_from()` để ước tính chạy đúng tham số sẽ dùng thật.
- `tools/encode-bench/` (dựng clip tham chiếu, ma trận encode, VMAF mean/hmean/p5/p1, bitrate-vs-độ-khó theo cửa sổ) — smoke test trên clip tổng hợp chạy được; **chưa chạy lại bảng của ADR bằng bộ này**.
- Ba ví dụ đo `h264_mf` cũ (`check_bitrate_control`, `check_mf_rate_control`, `check_quality_sampling`) ghim `find_by_name("h264_mf")` để vẫn đo đúng encoder đó; `check_h264_encoder` giờ khẳng định có `libx264` (thoát mã 1 nếu thiếu); thêm `check_x264_crf`, `check_estimate` nhận RF/maxrate.

**Phát sinh khi dựng FFmpeg có x264 — kế hoạch gốc "thêm `gpl,x264` vào lệnh vcpkg" KHÔNG chạy được trên vcpkg đang cài (2025-04-07):**
- Port `x264` cần `vcpkg-make` → tải gói MSYS2 `libtool-2.4.7-4`, mà `mirror.msys2.org` và mọi mirror vcpkg ghim đã **xoá** gói đó (HTTP 404 ở cả sáu mirror). Không sửa được bằng retry/proxy; cần vcpkg mới hơn (danh sách MSYS2 đã cập nhật). Cách đã dùng, không đụng bản đang chạy: checkout vcpkg riêng (`git clone --reference`), manifest ghim `builtin-baseline` + `overrides` ffmpeg `7.1.1#1` (ffmpeg-sys-next 7.1.3 chưa hỗ trợ ffmpeg 8/9). Manifest và hướng dẫn nằm ở `apps/tsmc-ingest-desktop/ffmpeg-vcpkg/`. Build ~19 phút trên máy 16 luồng.
- **Bộ DLL đi kèm là 8 file** như ADR dự đoán, cụ thể thêm `libx264-165.dll` (tên mang số phiên bản x264 — đổi x264 là đổi `build.rs`). `build.rs` đã cập nhật.
- Số `ffmpeg-sys-next`/`ffmpeg-next` giữ nguyên (7.1.3/7.1.0); `FFMPEG_DIR` phải trỏ vào cây cài mới và `PKG_CONFIG_PATH` của cây cũ phải bỏ, nếu không crate vẫn link bản `h264_mf`.

**Số đo đầu tiên trong app (máy dev Ryzen 7 8845HS, `reencode_with_options` thật, nguồn WMV VC-1 1080p thật, preset `fast`, đã bật đa luồng):**

| Phép đo | Kết quả |
|---|---|
| CRF 22 + VBV 1450 kbps, 40 s đầu | 8.27 MB (1654 kbps tổng gồm audio 160 kbps + overhead), **3.55×** thời gian thực |
| ABR 1450 kbps 1-pass, cùng đoạn | 8.49 MB (1698 kbps tổng), 3.87× |
| 3 mẫu 8 s của `estimate_reencode` (CRF 22 + VBV) | 3.35× / 3.28× / 2.45× |
| File ra | High@4.0 yuv420p, 1200 packet/40 s, dts tăng nghiêm ngặt, `ffmpeg -f null` giải mã không lỗi |

Khớp 4.0× của CLI (ADR § 4c.1 ghi 1 luồng = 0.5×, tự động = 4.0×) → đa luồng đã thật sự bật. Với CRF 22 ở nguồn này bitrate bị **trần VBV chặn** (1654 ≈ ABR 1698), tức file 1080p nặng chuyển động sẽ chạm trần — đúng thiết kế, nhưng nghĩa là "RF 22" chỉ còn là mức tối đa chứ không phải mức ra.

**Điều quan sát được, chưa giải quyết:**
- Muxer in `Encoder did not produce proper pts, making some up` một lần ở lượt CRF (không ở lượt ABR) và `Timestamps are unset in a packet for stream 1` (audio; mã audio không đổi trong slice này). File ra vẫn đúng như bảng trên; chưa biết gốc (khung giải mã không có pts khi `+genpts`?) — kiểm trước khi coi 4c.1 là xong.
- Ở chế độ `window` (chỉ dùng cho ước tính), timestamp video giữ theo nguồn nên `ffprobe` file mẫu báo "unspecified pixel format" do video nằm sau ~1800 s audio trong cùng file — hiện tượng đã biết của `estimate.rs`, không phải lỗi file thật (cùng nguồn nhưng `window` từ 0 s thì sạch).

**Chưa làm của tiêu chí nghiệm thu 4c.1 ("nén trọn hai file WMV Caribbean, ghi dung lượng so với nguồn, VMAF so với bản `h264_mf`, và user nhìn bằng mắt"):** chưa nén trọn file nào, chưa đo VMAF của đầu ra trong app, chưa có mắt người, chưa chạy luồng upload thật. Chi tiết checklist ở [pending-device-tests](../pending-device-tests.md).

### Nghiệm thu bằng mắt (2026-10-10, user)

User đã nén lại và upload lại file thật qua app rồi so bằng mắt thường: chất lượng sụt khoảng **1–2% (ước lượng chủ quan)**, **chấp nhận được**. Đây là kết luận cảm quan, không phải số đo — chưa có VMAF/p1 của bản ra, chưa ghi dung lượng và tốc độ trong app. Với mục đích của 4c.1 (hết hình "mờ vỡ" của `h264_mf`) thì coi là đạt; hai phần còn mở là cảnh báo muxer `Encoder did not produce proper pts` (chưa tìm nguồn) và số đo VMAF để đối chiếu bảng ở trên khi cần hiệu chỉnh ở 4c.4.
