# Thiết kế UX — 7 màn hình cốt lõi

> Tài liệu tham khảo thiết kế giao diện, viết theo góc nhìn hành trình người dùng (User Journey) và mockup ASCII cho từng màn hình. Đây **không phải** một ADR — không có quyết định ràng buộc nào ở đây, chỉ là bản vẽ UX cần đối chiếu với các bất biến kiến trúc trước khi implement.
>
> **Trạng thái so với code hiện tại:** phần lớn các màn hình dưới đây **chưa được xây** (xem [CLAUDE.md](../CLAUDE.md) để biết slice nào đã chạy thật). Auth (Màn hình 1) đã khớp mockup: banner cảnh báo bắt buộc + `MatStepper` 2-3 bước, kiểm chứng thật trên staging (2026-08-27, xem addendum [ADR-0016](./adr/0016-angular-material-va-cdk.md#cập-nhật-sau-khi-accepted-2026-08-27-slice-ui-login)). Browse (Dashboard rút gọn — chưa có sidenav/toolbar) và Player đã có bản chạy thật nhưng ở mức tối giản hơn mockup; Collections, Settings, Metadata Editor chưa có UI. Tài liệu này là đích thiết kế, không phải mô tả hiện trạng.
>
> Hai điểm trong bản vẽ gốc **vi phạm bất biến ADR** đã được sửa trực tiếp trong tài liệu này — xem ghi chú "**[Đã sửa]**" ở Màn hình 1 và Màn hình 3.

## User Journey

### Giai đoạn 1: Onboarding — Vượt rào cản kỹ thuật đầu vào

> *Vì không có backend giữ hộ phiên đăng nhập, hệ thống đòi hỏi nỗ lực thiết lập ban đầu từ người dùng để làm chủ dữ liệu của chính họ.*

0. **[Đã sửa] Cảnh báo bắt buộc trước khi nhập bất kỳ thông tin nào:** Theo [ADR-0011 §5](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md), app phải nói rõ — bằng ngôn ngữ thường, **trước** ô nhập đầu tiên — rằng đây là tài khoản Telegram thật, chỉ nên dùng bản tự deploy hoặc bản chính thức, và tải quá nhiều có thể khiến Telegram tạm hạn chế tài khoản. ADR nói thẳng: "che giấu điều này để onboarding mượt hơn là đánh đổi sai." Bản vẽ gốc bỏ qua cảnh báo này — đã bổ sung vào mockup Màn hình 1 bên dưới.
1. **Tiếp cận (Màn hình 1 — Auth):** Người dùng (User) truy cập ứng dụng lần đầu, đọc cảnh báo ở bước 0, rồi màn hình hiển thị `MatStepper` yêu cầu nhập `API_ID` và `API_HASH`.
2. **Hành động:** User bấm vào link hướng dẫn, mở `my.telegram.org` ở tab mới, tạo ứng dụng và copy 2 đoạn mã dán vào form. Sau đó nhập số điện thoại.
3. **Hệ thống xử lý:** Core Worker (nhờ thư viện GramJS) bắt tay với máy chủ Telegram, trả về mã OTP. User nhập OTP và đăng nhập thành công (nếu tài khoản bật xác thực 2 lớp, có thêm một bước nhập mật khẩu — xem ghi chú dưới mockup). Mọi thông tin xác thực giờ đây nằm an toàn trong IndexedDB của trình duyệt, mã hoá theo mô hình ở [ADR-0011 §1](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md).

### Giai đoạn 2: Nạp liệu — Bơm máu cho hệ thống

> *Ứng dụng lúc này là một chiếc vỏ rỗng. User cần kết nối các kênh Telegram làm kho dữ liệu.*

1. **Khám phá (Màn hình 4 — Source Management):** User chuyển sang trang Quản lý Nguồn, bấm nút FAB "Thêm Nguồn" và dán username của một hội nhóm chia sẻ phim công khai (ví dụ: `KhoPhim4K`). **Tuyệt đối không dùng id thô** vì `access_hash` khác nhau giữa các tài khoản ([ADR-0014 §1](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
2. **Hệ thống xử lý:** Thay vì quét toàn bộ lịch sử tin nhắn cực kỳ chậm chạp, hệ thống phát hiện kênh này có ghim sẵn file `catalog.v1.json`.
3. **Phản hồi UI:** Thanh `MatProgressBar` chạy rất nhanh. Hàng ngàn metadata phim được ghi lô (batch insert) vào bảng `media` của IndexedDB và nạp thẳng vào RAM cho bộ máy MiniSearch.

### Giai đoạn 3: Tìm kiếm — Trải nghiệm Zero-Latency

> *Lúc này, User quay lại trang chủ để bắt đầu chọn phim.*

1. **Khám phá (Màn hình 2 — Dashboard):** Giao diện hiển thị một danh sách ảo (virtual list) mượt mà bằng `cdkVirtualFor`, không giật lag dù có hàng chục ngàn item.
2. **Hành động:** User muốn xem phim Hành động, liền gõ "hanh dong" vào thanh `MatInput`.
3. **Hệ thống xử lý:** Indexer của MiniSearch (đã chuẩn hoá tiếng Việt không dấu) chạy ngầm trong Core Worker trả về kết quả dưới 50ms. Danh sách lập tức lọc ra các phim tương ứng mà không tốn một request mạng nào.

### Giai đoạn 4: Tiêu thụ — Ranh giới của Web và Giao thức

> *Thử thách thực sự nằm ở quá trình streaming.*

1. **Khởi động (Màn hình 5 — Player):** User bấm vào phim *Dune*. Ngay lập tức, một popup `MatDialog` hiện lên cảnh báo phim này có định dạng HEVC (hạng `compat: partial` được định nghĩa trong catalog), trình duyệt web có thể không hỗ trợ. User bấm "Vẫn thử phát".
2. **Trải nghiệm (Tua Video):** Phim phát bình thường. User kéo thanh seek để tua đến phút 45. Service Worker lập tức chặn luồng HTTP Range, gửi lệnh báo Core Worker huỷ các chunk tải cũ và mở cửa sổ tải mới tại mốc 45 phút.
3. **Edge Case (Chạm ngưỡng giới hạn):** Do user tua liên tục quá nhiều lần, kết nối MTProto bị Telegram báo lỗi `FLOOD_WAIT`. Thay vì đen màn hình, góc dưới UI xuất hiện một `MatSnackBar` hiển thị rõ: *"Telegram đang giới hạn tốc độ, thử lại sau 45 giây..."*. User hiểu vấn đề và chờ đợi. (Với `FLOOD_WAIT` trên 60 giây, [ADR-0006 §4](./adr/0006-download-pipeline-dc-pool-flood-wait.md) yêu cầu dừng hẳn pipeline và thông báo rõ, không chỉ chờ ngầm.)

### Giai đoạn 5: Cá nhân hoá — Tổ chức không gian riêng tư

> *Dữ liệu cá nhân phải được bảo vệ và đồng bộ chặt chẽ.*

1. **Hành động (Màn hình 3 — Collections):** Xem xong, user vào mục Bộ sưu tập, tạo mới nhóm "Marvel Cinematic Universe" và kéo thả (`cdkDrag`) các phim vào danh sách.
2. **Hệ thống xử lý:** Việc này được lưu dưới dạng tham chiếu ID (State riêng tư). Core Worker sẽ âm thầm append event log này lên một kênh Telegram riêng tư ẩn của user để đồng bộ trạng thái, không bao giờ đẩy lên kênh cộng đồng ([ADR-0014 §2](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
3. **[Đã sửa] Edge Case (hai nguyên nhân chết link khác nhau, không phải một):** [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) phân biệt rõ ba trạng thái tồn tại của một phim ngoài `OK` — gộp chúng lại là lỗi thiết kế dẫn tới mất dữ liệu thật:
   - **Mất quyền truy cập (`NO_ACCESS`)** — user bị kick khỏi kênh cộng đồng, phim **vẫn còn tồn tại**. UI phải cho lối quay lại: nút "Tham gia lại", không phải nút xoá.
   - **Đã bị xoá (`DELETED`)** — admin kênh xoá hẳn file. Lúc này mới đúng là cho nút "Gỡ khỏi bộ sưu tập".
   - (`STALE_REF` — `file_reference` hết hạn — không có UI, tự làm mới ngầm, không phải một trạng thái người dùng cần thấy.)

   Bản vẽ gốc gộp "mất quyền" và "đã xoá" thành một dòng UI dùng chung nút "Gỡ bỏ" — nếu implement như vậy, user bị kick tạm thời sẽ tự tay xoá khỏi bộ sưu tập một phim **vẫn còn sống**, đúng lỗi ADR-0007 cảnh báo trước bằng tên. Mockup Màn hình 3 bên dưới đã tách thành hai dòng riêng.

## Thiết kế Giao diện (UI) cốt lõi

### Giai đoạn 6: Quản trị — Cứu cánh Local-First

> *Vì không có Admin can thiệp từ xa, user nắm toàn quyền sinh sát dữ liệu hệ thống.*

1. **Hành động (Màn hình 6 — Settings & Debug):** Thấy máy báo dung lượng lưu trữ tăng cao, user vào Cài đặt mở `MatExpansionPanel` phần "Quản lý Lưu trữ", bấm nút giải phóng 2GB Cache Chunk video ([ADR-0007, mục "Hạn mức lưu trữ"](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md)).
2. **Tinh chỉnh:** User muốn phim tải nhanh hơn nữa, quyết định kéo `MatSlider` "Số kết nối song song" từ 4 lên ngưỡng tối đa 8. User đọc dòng chữ đỏ cảnh báo rủi ro `FLOOD_WAIT` nhưng vẫn chấp nhận rủi ro để đổi lấy tốc độ cao hơn (đúng trần mặc định 4 / trần nâng cấp 8 mà [ADR-0006 §3](./adr/0006-download-pipeline-dc-pool-flood-wait.md) quy định).

### Màn hình 1: Onboarding & Đăng nhập (Auth) — [Đã sửa]

Rào cản kỹ thuật ở bước này là cực kỳ lớn vì người dùng phải tự cấp `API_ID`. Đừng nhồi nhét tất cả vào một form dài thòng, hãy dùng **`MatStepper`** để chia nhỏ luồng nhận thức. Trước khi vào bước 1, **bắt buộc** hiển thị cảnh báo rủi ro tài khoản thật ([ADR-0011 §5](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)) — không được giấu để onboarding "mượt" hơn.

* **Component sử dụng:** `MatCard` (vùng trung tâm), banner cảnh báo (`mat-error`/inline warning, hiện trước stepper), `MatStepper` (tuyến tính 2 bước — cộng thêm một bước 2FA có điều kiện nếu tài khoản bật xác thực 2 lớp), `MatFormField` (appearance="outline"), `MatButton` (raised).
* **Phản biện UX:** Không được để user nhập sai bước 1 rồi kẹt ở bước 2. Bắt buộc validate định dạng `API_ID` (số) và `API_HASH` (chuỗi hexa) ngay tại form trước khi cho qua bước OTP. Cảnh báo rủi ro tài khoản không được là dòng chữ mờ nhạt dễ lướt qua — đây là điều kiện tiên quyết theo ADR, không phải tuỳ chọn thẩm mỹ.

```text
┌─────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░ MatCard (Centered) ░░░░░░░░░░░░░░░░░░░░░░░ │
│                                                             │
│  🎬 TSMC - Serverless Media Center                          │
│                                                             │
│  ⚠️ Đây là tài khoản Telegram THẬT của bạn. Chỉ dùng bản tự │
│     deploy hoặc bản chính thức tsmc-staging.web.app. Tải    │
│     quá nhiều phim liên tục có thể khiến Telegram tạm hạn   │
│     chế tài khoản (FLOOD_WAIT). [ADR-0011]                  │
│                                                             │
│  (1) Nhập API Key ───────── (2) Xác thực Telegram           │
│  [MatStepper Header]                                        │
│                                                             │
│  Hệ thống chạy 100% cục bộ. Lấy key tại my.telegram.org.    │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ API_ID (chỉ số)                                       │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │ API_HASH (chuỗi hexa 32 ký tự)                        │  │
│  └───────────────────────────────────────────────────────┘  │
│                                                             │
│  [ NÚT NEXT: TIẾP TỤC ] (MatButton raised color="primary")  │
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
└─────────────────────────────────────────────────────────────┘
```

---

### Màn hình 2: Khám phá & Trang chủ (Dashboard)

Đây là nơi user dành nhiều thời gian nhất. Để tránh sập trình duyệt khi load 20.000 phim, chúng ta **tuyệt đối không dùng `MatGridList`** lúc này, mà bắt buộc dùng **`cdkVirtualScrollViewport`** với danh sách 1 chiều chỉ chứa chữ.

* **Component sử dụng:** `MatSidenav` (bố cục chính), `MatToolbar` (chứa input tìm kiếm), `MatButtonToggleGroup` (bộ lọc nguồn), `cdkVirtualFor` (render danh sách).
* **Phản biện UX:** Việc không có ảnh Thumbnail (Poster) ở phiên bản đầu tiên sẽ làm UI trông "kém hấp dẫn", nhưng đó là đánh đổi sống còn. Nếu cố tải ảnh qua MTProto ngay lúc duyệt, hệ thống sẽ dính `FLOOD_WAIT` ngay lập tức. Tính năng vượt trội ở đây là tìm kiếm MiniSearch tức thời, hãy làm nổi bật thanh tìm kiếm.
* **Ghi chú đối chiếu:** bộ lọc "Tất cả / Cá nhân / Cộng đồng" giả định trường phân loại kênh cá nhân-cộng đồng trên mỗi nguồn — đúng theo bảng store `sources` ở [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md), nhưng field này **chưa có** trong model `SourceRef` hiện tại của code; đây là việc cần làm ở tầng dữ liệu trước khi UI này khớp được, không phải lỗi của bản vẽ.

```text
┌─────────────────────────────────────────────────────────────┐
│ ≡ [MatToolbar]   [ 🔍 MatInput: Tìm tên phim, diễn viên... ]│
├─────────┬───────────────────────────────────────────────────┤
│[Sidenav]│ [MatButtonToggleGroup]                            │
│ 🏠 Home │ [ 🌐 Tất cả ] [ 🔒 Cá nhân ] [ 📢 Cộng đồng ]      │
│ 📚 BST  │ ───────────────────────────────────────────────── │
│ 📂 Nguồn│ [cdkVirtualScrollViewport] (Chỉ render item nhìn  │
│ ⚙️ Cài  │ thấy trên màn hình)                               │
│    đặt  │                                                   │
│         │ ▶ Dune: Part Two (2024) [MatChip: Sci-Fi]         │
│         │   Nguồn: Phim 4K | 🕒 2h 46m   [MatIcon: add]     │
│         │ ───────────────────────────────────────────────── │
│         │ ▶ Inception (2010) [MatChip: Action]              │
│         │   Nguồn: Kho Cá nhân | 🕒 2h 28m [MatIcon: add]   │
└─────────┴───────────────────────────────────────────────────┘
```

---

### Màn hình 3: Quản lý Bộ sưu tập (Collections) — [Đã sửa]

Bộ sưu tập lưu danh sách tham chiếu ID dưới dạng state riêng tư. Tính năng cốt lõi ở đây là khả năng sắp xếp (Reorder) trực quan.

* **Component sử dụng:** `@angular/cdk/drag-drop` (`cdkDropList`, `cdkDrag`), `MatList`, `MatIcon` (làm drag handle `drag_indicator`).
* **Phản biện UX:** Phim có thể chết link vì **hai lý do khác nhau**, và [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) yêu cầu UI phân biệt rõ, không được gộp:
  - **Mất quyền truy cập** (`NO_ACCESS` — bị kick khỏi kênh): dòng mờ (`opacity: 0.5`), text "Bạn không còn quyền truy cập nguồn này", hành động là **"Tham gia lại"** — phim có thể vẫn còn, xoá khỏi bộ sưu tập ở bước này là mất dữ liệu oan.
  - **Đã bị xoá** (`DELETED` — admin xoá file thật): dòng mờ, text "Nguồn chia sẻ đã xoá tệp tin này", hành động là **"Gỡ khỏi bộ sưu tập"** — phim thật sự không còn, gỡ là đúng.

  Cả hai đều tắt khả năng kéo-thả (`cdkDragDisabled`) vì reorder một item chết không có ý nghĩa. Đừng che giấu lỗi mạng bằng cách hiện một trạng thái "lỗi chung chung".

```text
┌─────────────────────────────────────────────────────────────┐
│ 📚 BỘ SƯU TẬP: 🦸‍♂️ MARVEL CINEMATIC UNIVERSE                  │
│                                                             │
│ [MatList] + [cdkDropList]                                   │
│ ⣿ (cdkDragHandle) Iron Man (2008)              [🗑 MatIcon] │
│ ─────────────────────────────────────────────────────────── │
│ ⣿ (cdkDragHandle) The Avengers (2012)          [🗑 MatIcon] │
│ ─────────────────────────────────────────────────────────── │
│ ⚠️ (Mất quyền truy cập) Captain America                     │
│    Bạn không còn quyền truy cập nguồn này   [ Tham gia lại ]│
│    (mờ, cdkDragDisabled)                                    │
│ ─────────────────────────────────────────────────────────── │
│ 🚫 (Đã bị xoá) Thor: Ragnarok                                │
│    Nguồn chia sẻ đã xoá tệp tin này        [ Gỡ khỏi BST ]  │
│    (mờ, cdkDragDisabled)                                    │
└─────────────────────────────────────────────────────────────┘
```

---

### Màn hình 4: Quản lý Nguồn (Source Management)

Nơi thêm kho phim. Hệ thống phải phân biệt rõ tốc độ index từ nguồn xài `catalog.json` và nguồn quét lịch sử thô.

* **Component sử dụng:** `MatDialog` (popup thêm nguồn), `MatCard`, `MatProgressBar` (thể hiện tiến trình quét channel).
* **Phản biện UX:** Quá trình quét một kênh Telegram thô mất rất nhiều thời gian. Không được block UI bằng cái Spinner tròn quay vô tận. Phải dùng `MatProgressBar` kết hợp hiển thị số liệu cụ thể (ví dụ: "Đang nạp 1500/5000 tin nhắn") để user không có cảm giác máy bị treo.

```text
┌─────────────────────────────────────────────────────────────┐
│ [ NÚT FAB: + THÊM NGUỒN ] (Góc phải dưới màn hình)          │
│                                                             │
│ [MatCard] 🔒 Kho Phim Gia Đình (Admin)                      │
│ Trạng thái: Sẵn sàng (Đã nạp 150 phim)                      │
│ [ NÚT STROKED: ⚙️ Metadata ] [ NÚT WARN: ❌ Xoá ]           │
│                                                             │
│ [MatCard] 📢 Hội Phim 4K (Cộng đồng)                        │
│ Trạng thái: Đang index từ catalog.v1.json...                │
│ [MatProgressBar mode="determinate" value="70"]              │
│                                                             │
│ [MatCard] 📢 Anime Sub Việt                                 │
│ ⚠️ Fallback: Quét lịch sử (Chậm, cẩn thận FLOOD_WAIT)       │
└─────────────────────────────────────────────────────────────┘
```

---

### Màn hình 5: Trình phát (Player) & Cảnh báo Tương thích

Bản thân Player là một thẻ `<video>` HTML5 nguyên bản nối với Service Worker. Angular Material can thiệp vào các lớp phủ (Overlay) cảnh báo và lỗi mạng.

* **Component sử dụng:** `MatSnackBar` (hiển thị lỗi FLOOD_WAIT không block UI), `MatDialog` (cảnh báo tương thích trước khi phát).
* **Phản biện UX:** Nếu catalog báo file này là `unplayable` (vd: MKV) hoặc `partial` (vd: HEVC/AV1), trình duyệt có thể đen ngòm. Việc dùng `MatDialog` để chặn ngay từ đầu, nói thẳng sự thật ("Trình duyệt web không gánh nổi định dạng này, mời mở app gốc") là một UX xuất sắc hơn việc để user nhìn màn hình đen và tưởng app bị lỗi.

```text
┌─────────────────────────────────────────────────────────────┐
│ [ HTML5 VIDEO PLAYER ]                                      │
│                                                             │
│  [MatDialog Overlay] ⚠️ CẢNH BÁO TƯƠNG THÍCH                │
│  Phim này dùng mã hoá HEVC/AV1. Trình duyệt của bạn có      │
│  thể sẽ chỉ nghe được tiếng hoặc đen màn hình.              │
│  [ NÚT: MỞ TRÊN TELEGRAM ]   [ NÚT: VẪN THỬ PHÁT TRÊN WEB ] │
│                                                             │
│                                                             │
│ [MatSnackBar Overlay (Dưới cùng)]                           │
│ ⏳ Telegram giới hạn tốc độ. Đang chờ 45 giây... [Đóng]     │
└─────────────────────────────────────────────────────────────┘
```

---

### Màn hình 6: Cài đặt (Settings) & Debug

Đây là hệ thống Local-First, không có Admin server để cứu dữ liệu hỏng. Màn hình cài đặt là cứu cánh cuối cùng.

* **Component sử dụng:** `MatExpansionPanel` (gom nhóm cấu hình), `MatSlider` (chỉnh luồng tải), `MatSlideToggle` (bật tắt log).
* **Phản biện UX:** Ở đây ta trao cho user quyền chỉnh số kết nối song song (AIMD) để tải nhanh hơn. Đừng giấu đi rủi ro. Việc dùng `MatSlider` trượt từ 4 lên 8 phải đi kèm một dòng text màu đỏ gắt (`mat-error` hoặc `mat-warn`) báo rõ nguy cơ bay màu tài khoản Telegram. Phải minh bạch — trần 4/8 này đến thẳng từ [ADR-0006 §3](./adr/0006-download-pipeline-dc-pool-flood-wait.md), không phải số tuỳ chọn.

```text
┌─────────────────────────────────────────────────────────────┐
│ ⚙️ CÀI ĐẶT HỆ THỐNG                                         │
│                                                             │
│ [MatExpansionPanel] QUẢN LÝ LƯU TRỮ                         │
│ Dung lượng Cache đang chiếm: 1.2 GB                         │
│ [ NÚT FLAT WARN: Xoá bộ nhớ đệm (An toàn) ]                 │
│                                                             │
│ [MatExpansionPanel] MẠNG & BĂNG THÔNG                       │
│ Số kết nối tải song song: 4                                 │
│ [MatSlider min="2" max="8" step="1"]                        │
│ ⚠️ Cảnh báo: Tăng quá cao sẽ dẫn đến FLOOD_WAIT, có nguy cơ │
│ bị Telegram giới hạn tài khoản cá nhân.                     │
│                                                             │
│ [MatExpansionPanel] CHẨN ĐOÁN (DEBUG ROUTE)                 │
│ [MatSlideToggle] Bật log chẩn đoán luồng Core Worker        │
└─────────────────────────────────────────────────────────────┘
```

### Màn hình 7: Quản lý Metadata (Ingest & Editor)

Theo kiến trúc, **metadata toàn cục không bao giờ được ghi vào kênh state** cá nhân. Do đó, người dùng thông thường **chỉ có thể đọc** metadata từ kênh cộng đồng. Họ chỉ được cấp quyền **chỉnh sửa (write)** khi nguồn đó là "Kho Cá Nhân" (Private Vault) do chính họ làm Admin ([ADR-0014 §4](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).

```text
┌─────────────────────────────────────────────────────────────┐
│ ⚙️ QUẢN LÝ METADATA - 🔒 Kho Phim Gia Đình                  │
│ (Mọi thay đổi sẽ được ghi vào file catalog.v1.json)         │
│                                                             │
│ CHỈNH SỬA THÔNG TIN PHIM:                                   │
│ [ Tiêu đề:   ] [ Dune: Part Two....................... ]    │
│ [ Tiêu đề gốc] [ Dune: Part Two....................... ]    │
│ [ Năm:       ] [ 2024 ]  [ Thể loại: ] [ Sci-Fi, Adv.. ]    │
│ [ Đạo diễn:  ] [ Denis Villeneuve..................... ]    │
│                                                             │
│ PHÂN HẠNG TƯƠNG THÍCH TRÌNH DUYỆT (Compat):                 │
│ 🔘 Full (MP4/H.264) - Phát bình thường                      │
│ ⚪ Partial (HEVC/AV1) - Hiện cảnh báo trên Web              │
│ ⚪ Unplayable (MKV) - Yêu cầu mở bằng app Telegram          │
│                                                             │
│ NGUỒN CẤP METADATA:                                         │
│ ⚪ Thủ công (Manual)  🔘 Tự động từ Tên File (Filename)     │
│                                                             │
│ [ 💾 LƯU THAY ĐỔI & CẬP NHẬT CATALOG LÊN KÊNH ]             │
└─────────────────────────────────────────────────────────────┘
```

* **Ghi đè `catalog.json`:** Khi bấm "Lưu thay đổi", Core Worker sẽ thu thập toàn bộ metadata trong Kho Cá Nhân, đóng gói thành định dạng chuẩn `tsmc-catalog/1` và ghim (pin) file `catalog.json` đè lên **kênh media** tương ứng — không bao giờ lên kênh state ([ADR-0014 §3](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
* **Hạng tương thích (`compat`):** UX buộc người dùng (với tư cách Admin kho cá nhân) phải gán nhãn khả năng phát (`full`, `partial`, `unplayable`) để player cảnh báo chính xác cho người xem.
* **Bảo mật dữ liệu (Sanitize):** Bất kỳ dữ liệu đầu vào nào (đặc biệt nếu load lại từ kênh) cũng phải được validate qua schema (Valibot) và kẹp độ dài để chống XSS, vì hệ thống coi mọi thứ lấy từ Telegram là nội dung không tin cậy ([ADR-0011 §3](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)).
