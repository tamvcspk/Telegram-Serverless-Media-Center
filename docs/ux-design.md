# Thiết kế UX — 7 màn hình cốt lõi (Mobile-First)

> Tài liệu tham khảo thiết kế giao diện, viết theo góc nhìn hành trình người dùng (User Journey) và mockup ASCII theo tỷ lệ màn hình điện thoại cho từng màn hình. Đây **không phải** một ADR — không có quyết định ràng buộc nào ở đây, chỉ là bản vẽ UX cần đối chiếu với các bất biến kiến trúc trước khi implement.
>
> **Trạng thái so với code hiện tại:** phần lớn các màn hình dưới đây **chưa được xây** (xem [CLAUDE.md](../CLAUDE.md) để biết slice nào đã chạy thật). Auth (F1.1) đã khớp Màn hình 1 (Vertical `MatStepper`, full-bleed, khoá Bước 2 tới khi định dạng hợp lệ) trên staging (2026-08-27). Khung routing/layout skeleton cũng đã dựng theo ui-conventions §6: route `login` (full-bleed), route `home` + `MainShell` (Bottom Nav tự ghép, gate bằng `authGuard`) bọc Browse/Collections/Sources, route `player` immersive không đổi. Browse chạy thật trong tab Home và khớp layout Màn hình 2 (2026-08-27): thanh tìm kiếm + chip lọc nguồn cố định trên cùng (không cuộn theo danh sách — đạt bằng flex layout lấp đầy `.content` của `MainShell`, không phải `position: sticky`), chip lọc cuộn ngang thay vì xuống dòng; vẫn thiếu icon ⚙️ vào Settings (chưa có route/UI đích, xem dưới) và bộ lọc Tất cả/Cá nhân/Cộng đồng (field phân loại chưa có ở tầng dữ liệu, xem "Ghi chú đối chiếu" ở Màn hình 2). Collections khớp layout Màn hình 3 (2026-08-27): CRUD đầy đủ (tạo/đổi tên/xoá bộ sưu tập, thêm/gỡ/kéo-thả sắp xếp lại phim) qua `MatList`-style rows + `cdkDropList`/`cdkDrag`, FAB nổi đúng trên Bottom Nav (custom property `--tsmc-bottom-nav-height` ở `main-shell.scss`, tránh đúng cạm bẫy đã ghi trong mockup); kéo-thả lưu thật nhờ op `collection.reorder` mới thêm (xem `libs/shared-models/src/sync-events.ts`, `libs/core-sync/src/reducer.ts`) — không phải UI-only. Entry point "thêm vào bộ sưu tập" duy nhất hiện có nằm ở mỗi row của Browse (menu chọn/bỏ chọn nguồn có sẵn) — **chưa có** lối tạo bộ sưu tập MỚI ngay từ Browse (phải qua tab BST trước). **Chưa làm**: phân biệt trạng thái chết link "mất quyền truy cập" vs "nguồn đã xoá tệp tin" (cần bắt lỗi tầng MTProto, xem "Phản biện UX" ở Màn hình 3 — quyết định hoãn có chủ đích, không phải thiếu sót); xoá cả bộ sưu tập dùng `confirm()` gốc trình duyệt thay vì `MatBottomSheet`/dialog xác nhận 2 lần như Màn hình 7. Sources khớp layout Màn hình 4 (2026-08-27): thẻ nguồn thật (`sources/sources.ts`) hiện tier (catalog/delta/full)/số phim/lỗi quét gần nhất, FAB mở `AddSourceSheet` (`MatBottomSheet` thật — dán username/link hoặc chọn từ danh sách chat đã tham gia, chặn ID thô ngay tại form theo ADR-0014 §1, đúng yêu cầu "Validate tại form, không chỉ ở prose" bên dưới). **Khác mockup một điểm có chủ đích:** `scanSource()` là một lượt bounded, không báo tiến trình theo số — lúc quét chỉ có `MatProgressBar` indeterminate, KHÔNG có "Đang nạp 1500/5000 tin nhắn" (cần job nền có tiến trình thật, ngoài phạm vi slice này). `ChannelIndex` (công cụ debug F2) đã xoá hẳn — phần "chẩn đoán 500 tin" của nó không thuộc màn hình nào trong 7 màn và bị bỏ theo cùng quyết định. `SyncStatus` + nút đăng xuất rút gọn (thiếu bước flush outbox và xác nhận 2 lần của Màn hình 7) vẫn tạm host cuối trang `home/sources` — xem comment đầu `sources/sources.ts`; Settings, Metadata Editor chưa có route/UI.
>
> **Redesign kiểu Netflix (2026-08-28):** Màn hình 2 đổi từ list sang **lưới card** (CDK virtual scroll virtualize THEO HÀNG, không theo từng phim — xem "Ghi chú đối chiếu" ở Màn hình 2 dưới), tap card mở `MatBottomSheet` chi tiết (`ItemDetailSheet`) thay vì thao tác rời rạc trên từng row/hành động trực tiếp. Màn hình 3 tách thành 2 tầng: danh sách bộ sưu tập dạng tile (`home/collections`) → chi tiết một bộ sưu tập (`home/collections/:id`, route con MỚI, vẫn dưới Bottom Nav). Màn hình 4 đổi `AddSourceSheet` từ toggle-mở-rộng-tại-chỗ sang 3 "bước" điều hướng bên trong cùng một sheet (menu chọn → nhập thủ công/chọn từ chat, có mũi tên quay lại). Cả 3 màn đều dùng poster PLACEHOLDER (gradient + chữ cái đầu, component `apps/web/src/app/shared/poster-tile/`) — `MediaRecord.poster` vẫn chỉ là `{msgId}`, chưa có pipeline tải ảnh thật.
>
> Hai điểm **vi phạm bất biến ADR** đã được sửa trực tiếp trong tài liệu này, giữ nguyên qua bản mobile-first — xem ghi chú "**[Đã sửa]**" ở Màn hình 1 và Màn hình 3.
>
> **Ngoài 7 màn hình của app xem, tài liệu này còn [Phụ lục A](#phụ-lục-a-công-cụ-ingest-desktop-gui-tauri)** — bản vẽ cho công cụ ingest desktop (GUI Tauri) dành cho người **đăng** nội dung. Phụ lục đó là desktop, không mobile-first, và ba nguyên tắc chuyển đổi ngay dưới đây **không áp dụng** cho nó.

## Nguyên tắc chuyển đổi Mobile-First

Bản vẽ trước dùng bố cục desktop (Sidenav, Dialog giữa màn hình, Stepper ngang). Ba nguyên tắc chuyển đổi cốt lõi cho cả 7 màn hình:

- **Loại bỏ `MatSidenav`.** Thay bằng **Bottom Navigation Bar** cho 3 tab chính (Home/BST/Nguồn). Settings **không** nằm trong bottom nav (xem lý do ở Màn hình 7) — vào qua icon ⚙️ trên `MatToolbar` chung của `MainShell` (đã chạy thật 2026-08-28, xem `apps/web/src/app/shell/main-shell.ts`), hiện diện ở cả 3 tab thay vì chỉ riêng Dashboard như bản vẽ trước.
- **Thay `MatDialog` (popup giữa màn hình) bằng `MatBottomSheet`** (bảng trượt từ dưới lên) cho mọi hành động cần xác nhận hoặc nhập liệu ngắn — dễ thao tác một tay bằng ngón cái hơn popup giữa màn hình trên thiết bị cầm tay.
- **Tối ưu chiều dọc:** Stepper ngang → **Vertical `MatStepper`** (Màn hình 1); bộ lọc chip → **cuộn ngang** (`MatChipListbox` trong container `overflow-x`) thay vì xuống dòng, tiết kiệm chiều cao màn hình vốn đã hạn chế trên điện thoại.

**"Bottom Navigation Bar" không phải một component Material có sẵn.** Đã kiểm tra thật (`ls node_modules/@angular/material`): Angular Material có `bottom-sheet` nhưng **không có** `bottom-nav`/bottom-navigation nào cả (khác Flutter/Ionic). Phải tự ghép từ `MatTabNav`+`MatTabLink` (restyle theo chiều dọc, mỗi tab là `routerLink`) hoặc đơn giản hơn: một hàng `button`/`a routerLink` + `MatIconButton` tự CSS `position:fixed;bottom:0`. Đừng đi tìm `MatBottomNavModule` — không tồn tại. Xem thêm [ui-conventions §6](../.claude/skills/ui-conventions/SKILL.md).

**Không có một layout component chung cho cả 7 màn hình** — Auth (full-bleed, không chrome) khác Dashboard/Collections/Sources (khung Bottom Nav) khác Player (full-screen immersive, không nav) khác Metadata Editor/Settings (sub-page có header `<` quay lại, một số có sticky bottom bar). Quy ước layout route/component tương ứng nằm ở [`.claude/skills/ui-conventions/SKILL.md` §6](../.claude/skills/ui-conventions/SKILL.md) — đọc trước khi dựng route cho bất kỳ màn nào dưới đây, đừng bọc tất cả trong một `AppShell` duy nhất.

## User Journey

### Giai đoạn 1: Onboarding — Vượt rào cản kỹ thuật đầu vào

> *Vì không có backend giữ hộ phiên đăng nhập, hệ thống đòi hỏi nỗ lực thiết lập ban đầu từ người dùng để làm chủ dữ liệu của chính họ.*

0. **[Đã sửa] Cảnh báo bắt buộc trước khi nhập bất kỳ thông tin nào:** Theo [ADR-0011 §5](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md), app phải nói rõ — bằng ngôn ngữ thường, **trước** ô nhập đầu tiên — rằng đây là tài khoản Telegram thật, chỉ nên dùng bản tự deploy hoặc bản chính thức, và tải quá nhiều có thể khiến Telegram tạm hạn chế tài khoản. ADR nói thẳng: "che giấu điều này để onboarding mượt hơn là đánh đổi sai." Bắt buộc giữ nguyên qua bản mobile-first — banner nằm ngay dưới tiêu đề app, trước `MatStepper`, không cuộn khuất.
1. **Tiếp cận (Màn hình 1 — Auth):** Người dùng (User) truy cập ứng dụng lần đầu, đọc cảnh báo ở bước 0, rồi cuộn xuống một **Vertical `MatStepper`** yêu cầu nhập `API_ID` và `API_HASH`. Bước 2 (Xác thực) hiển thị ở trạng thái khoá (mờ, icon ⚪) cho tới khi định dạng bước 1 hợp lệ.
2. **Hành động:** User bấm vào link hướng dẫn, mở `my.telegram.org` ở tab mới, tạo ứng dụng và copy 2 đoạn mã dán vào form. Sau đó nhập số điện thoại.
3. **Hệ thống xử lý:** Core Worker (nhờ thư viện GramJS) bắt tay với máy chủ Telegram, trả về mã OTP. User nhập OTP và đăng nhập thành công (nếu tài khoản bật xác thực 2 lớp, có thêm một bước 2FA — xem ghi chú dưới mockup). Mọi thông tin xác thực giờ đây nằm an toàn trong IndexedDB của trình duyệt, mã hoá theo mô hình ở [ADR-0011 §1](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md).

### Giai đoạn 2: Nạp liệu — Bơm máu cho hệ thống

> *Ứng dụng lúc này là một chiếc vỏ rỗng. User cần kết nối các kênh Telegram làm kho dữ liệu.*

1. **Khám phá (Màn hình 4 — Nguồn):** User chạm tab "Nguồn" ở Bottom Nav, bấm FAB "+" — một **`MatBottomSheet`** trượt lên từ dưới cho User dán username của một hội nhóm chia sẻ phim công khai (ví dụ: `KhoPhim4K`). **Tuyệt đối không dùng id thô** vì `access_hash` khác nhau giữa các tài khoản ([ADR-0014 §1](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
2. **Hệ thống xử lý:** Thay vì quét toàn bộ lịch sử tin nhắn cực kỳ chậm chạp, hệ thống phát hiện kênh này có ghim sẵn file `catalog.v1.json`.
3. **Phản hồi UI:** `MatBottomSheet` đóng lại, card nguồn mới xuất hiện với `MatProgressBar` chạy rất nhanh ngay dưới card. Hàng ngàn metadata phim được ghi lô (batch insert) vào bảng `media` của IndexedDB và nạp thẳng vào RAM cho bộ máy MiniSearch.

### Giai đoạn 3: Tìm kiếm — Trải nghiệm Zero-Latency

> *Lúc này, User quay lại trang chủ để bắt đầu chọn phim.*

1. **Khám phá (Màn hình 2 — Dashboard):** Giao diện hiển thị một danh sách ảo (virtual list) toàn màn hình bằng `cdkVirtualFor`, không giật lag dù có hàng chục ngàn item, cuộn dọc bằng ngón tay tự nhiên như app gốc.
2. **Hành động:** User muốn xem phim Hành động, liền gõ "hanh dong" vào ô tìm kiếm sticky ở trên cùng.
3. **Hệ thống xử lý:** Indexer của MiniSearch (đã chuẩn hoá tiếng Việt không dấu) chạy ngầm trong Core Worker trả về kết quả dưới 50ms — đặc biệt toả sáng trên mobile vì không tốn độ trễ mạng như tìm kiếm server-side. Danh sách lập tức lọc ra các phim tương ứng.

### Giai đoạn 4: Tiêu thụ — Ranh giới của Web và Giao thức

> *Thử thách thực sự nằm ở quá trình streaming.*

1. **Khởi động (Màn hình 5 — Player):** User bấm vào phim *Dune*. Player mở toàn màn hình (bottom nav ẩn hoàn toàn — không nav chrome nào trong lúc phát), ngay lập tức một **`MatBottomSheet`** trượt lên cảnh báo phim này có định dạng HEVC (hạng `compat: partial` được định nghĩa trong catalog), trình duyệt web có thể không hỗ trợ. User bấm "Vẫn thử phát".
2. **Trải nghiệm (Tua Video):** Phim phát bình thường. User kéo thanh seek để tua đến phút 45. Service Worker lập tức chặn luồng HTTP Range, gửi lệnh báo Core Worker huỷ các chunk tải cũ và mở cửa sổ tải mới tại mốc 45 phút.
3. **Edge Case (Chạm ngưỡng giới hạn):** Do user tua liên tục quá nhiều lần, kết nối MTProto bị Telegram báo lỗi `FLOOD_WAIT`. Thay vì đen màn hình, cạnh **trên** màn hình (tránh đè lên control phát ở dưới) xuất hiện một `MatSnackBar` hiển thị rõ: *"Telegram đang giới hạn tốc độ, thử lại sau 45 giây..."*. User hiểu vấn đề và chờ đợi. (Với `FLOOD_WAIT` trên 60 giây, [ADR-0006 §4](./adr/0006-download-pipeline-dc-pool-flood-wait.md) yêu cầu dừng hẳn pipeline và thông báo rõ, không chỉ chờ ngầm.)

### Giai đoạn 5: Cá nhân hoá — Tổ chức không gian riêng tư

> *Dữ liệu cá nhân phải được bảo vệ và đồng bộ chặt chẽ.*

1. **Hành động (Màn hình 3 — Collections):** Xem xong, user chạm tab "BST" ở Bottom Nav, bấm FAB tạo mới nhóm "Marvel Cinematic Universe" và kéo thả (`cdkDrag`, tay cầm icon lớn bên phải để dễ chạm bằng ngón cái) các phim vào danh sách.
2. **Hệ thống xử lý:** Việc này được lưu dưới dạng tham chiếu ID (State riêng tư). Core Worker sẽ âm thầm append event log này lên một kênh Telegram riêng tư ẩn của user để đồng bộ trạng thái, không bao giờ đẩy lên kênh cộng đồng ([ADR-0014 §2](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
3. **[Đã sửa] Edge Case (hai nguyên nhân chết link khác nhau, không phải một):** [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) phân biệt rõ ba trạng thái tồn tại của một phim ngoài `OK` — gộp chúng lại là lỗi thiết kế dẫn tới mất dữ liệu thật. Bắt buộc giữ nguyên qua bản mobile-first (mockup card ở Màn hình 3 bên dưới KHÔNG được gộp về một nút "Gỡ" chung):
   - **Mất quyền truy cập (`NO_ACCESS`)** — user bị kick khỏi kênh cộng đồng, phim **vẫn còn tồn tại**. UI phải cho lối quay lại: nút "Tham gia lại", không phải nút xoá.
   - **Đã bị xoá (`DELETED`)** — admin kênh xoá hẳn file. Lúc này mới đúng là cho nút "Gỡ khỏi bộ sưu tập".
   - (`STALE_REF` — `file_reference` hết hạn — không có UI, tự làm mới ngầm, không phải một trạng thái người dùng cần thấy.)

### Giai đoạn 6: Quản trị — Cứu cánh Local-First

> *Vì không có Admin can thiệp từ xa, user nắm toàn quyền sinh sát dữ liệu hệ thống — kể cả quyền rời khỏi hệ thống.*

1. **Hành động (Màn hình 7 — Cài đặt, Tài khoản & Debug):** Thấy máy báo dung lượng lưu trữ tăng cao, user vào Cài đặt (qua menu/góc màn hình Dashboard, **không** phải một tab Bottom Nav — xem lý do dưới mockup Màn hình 7) mở khối "Quản lý Lưu trữ", bấm nút giải phóng 2GB Cache Chunk video ([ADR-0007, mục "Hạn mức lưu trữ"](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md)).
2. **Tinh chỉnh:** User muốn phim tải nhanh hơn nữa, quyết định kéo `MatSlider` "Số kết nối song song" từ 4 lên ngưỡng tối đa 8. User đọc dòng chữ đỏ cảnh báo rủi ro `FLOOD_WAIT` nhưng vẫn chấp nhận rủi ro để đổi lấy tốc độ cao hơn (đúng trần mặc định 4 / trần nâng cấp 8 mà [ADR-0006 §3](./adr/0006-download-pipeline-dc-pool-flood-wait.md) quy định).
3. **Đăng xuất (mới):** User muốn đổi tài khoản test, chạm nút "Đăng xuất khỏi app" màu đỏ ở khối Tài khoản trên cùng. Vì rào cản đăng nhập lại (nhập lại `API_ID`/`API_HASH`/OTP) rất lớn, hệ thống **bắt buộc** xác nhận lần 2 qua `MatBottomSheet` trước khi thực thi — xem luồng chi tiết ở Màn hình 7.

## Bản vẽ giao diện (Mobile-First)

### Màn hình 1: Onboarding & Đăng nhập (Auth) — [Đã sửa]

Trên điện thoại, Stepper ngang hoặc form dài bị ép lại rất khó nhìn — dùng **Vertical `MatStepper`**, cuộn dọc toàn màn hình, **không có Bottom Navigation Bar** (chưa có gì để điều hướng tới khi chưa đăng nhập). Rào cản kỹ thuật ở bước này cực kỳ lớn vì user phải tự cấp `API_ID`; cảnh báo rủi ro tài khoản thật ([ADR-0011 §5](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)) bắt buộc nằm **trước** cả bước 1, không được giấu để onboarding "mượt" hơn.

* **Component sử dụng:** banner cảnh báo (inline warning, hiện trước stepper — không phải `mat-error`, vì đây không phải lỗi form), `MatStepper [orientation]="vertical"` (bước 1 + bước 2, cộng thêm một bước 2FA có điều kiện nếu tài khoản bật xác thực 2 lớp), `MatFormField` (appearance="outline", `width:100%`), `MatButton` (raised).
* **Phản biện UX:** Không được để user nhập sai bước 1 rồi kẹt ở bước 2. Bước 2 hiển thị ở trạng thái khoá (icon ⚪, nhãn mờ) ngay từ đầu — không ẩn hẳn (ẩn hẳn khiến user không biết còn bước nào phía sau) — chỉ mở khi định dạng `API_ID` (số) và `API_HASH` (chuỗi hexa) hợp lệ tại form. Cảnh báo rủi ro tài khoản không được là dòng chữ mờ nhạt dễ lướt qua — đây là điều kiện tiên quyết theo ADR, không phải tuỳ chọn thẩm mỹ.

```text
┌───────────────────────────┐
│ 🎬 TSMC Media Center      │
│ ───────────────────────── │
│ ⚠️ Đây là tài khoản        │
│ Telegram THẬT của bạn.    │
│ Chỉ dùng bản tự deploy    │
│ hoặc tsmc-staging.web.app │
│ [ADR-0011]                │
│ ───────────────────────── │
│ [Vertical MatStepper]     │
│                           │
│ 🔵 BƯỚC 1: API CREDENTIAL │
│ Nhập key từ my.telegram   │
│ ┌───────────────────────┐ │
│ │ API_ID                │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ API_HASH               │ │
│ └───────────────────────┘ │
│ [ NÚT: TIẾP TỤC ]         │
│                           │
│ ⚪ BƯỚC 2: XÁC THỰC       │
│ (Bị khoá, sẽ mở sau B1)   │
└───────────────────────────┘
```

### Màn hình 2: Trang chủ (Dashboard) — Trải nghiệm Vuốt

Để tránh sập trình duyệt khi load 20.000 phim, dùng **`cdkVirtualScrollViewport`** toàn màn hình — **tuyệt đối không dùng `MatGridList`**. Bản vẽ trước là list; nay là **lưới card kiểu Netflix** (2026-08-28, đã chạy thật) — vẫn đúng luật cấm `MatGridList` vì kỹ thuật dùng là CSS Grid thường + `cdkVirtualFor` virtualize THEO HÀNG (mỗi phần tử ảo là một hàng N card, không phải một card), xem `apps/web/src/app/browse/browse.ts`.

* **Component sử dụng:** `MatToolbar` chung của `MainShell` (tiêu đề trang + icon ⚙️ mở Settings, KHÔNG còn nằm trong thanh tìm kiếm của riêng Browse như bản vẽ trước — xem Màn hình 7), thanh tìm kiếm `MatFormField`/`MatInput` cố định trên cùng của Browse, `MatChipListbox` cuộn ngang cho bộ lọc nguồn (Tất cả/Cá nhân/Cộng đồng) thay vì `MatButtonToggleGroup` xuống dòng, `cdkVirtualFor` (virtualize theo hàng, mỗi hàng render N `app-media-card`), `MatBottomSheet` chi tiết phim (`ItemDetailSheet`, mở khi tap card — thay hành động rời rạc trên từng row của bản list cũ), Bottom Navigation Bar (Home/BST/Nguồn — tự ghép, xem nguyên tắc mobile-first phía trên).
* **Phản biện UX:** Việc không có ảnh Thumbnail (Poster) thật vẫn là đánh đổi sống còn — tải ảnh qua MTProto ngay lúc duyệt sẽ dính `FLOOD_WAIT` ngay lập tức. Card lưới vì vậy dùng poster PLACEHOLDER (gradient + chữ cái đầu, `app/shared/poster-tile/`, màu suy từ hash tên phim để ổn định qua các lần render) — KHÔNG phải ảnh thật, và KHÔNG phải dấu hiệu pipeline ảnh đã có. Tính năng vượt trội ở đây vẫn là tìm kiếm MiniSearch tức thời.
* **Ghi chú đối chiếu:** bộ lọc "Tất cả / Cá nhân / Cộng đồng" giả định trường phân loại kênh cá nhân-cộng đồng trên mỗi nguồn — đúng theo bảng store `sources` ở [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md), nhưng field này **chưa có** trong model `SourceRef` hiện tại của code; đây là việc cần làm ở tầng dữ liệu trước khi UI này khớp được, không phải lỗi của bản vẽ.

```text
┌───────────────────────────┐
│ Trang chủ              ⚙️ │ ← MatToolbar chung (MainShell)
│ ───────────────────────── │
│ 🔍 [ Tìm phim... ]        │
│ [Cuộn ngang: MatChip]     │
│ (Tất cả) (Cá nhân) (Cộng..│
│ ───────────────────────── │
│ [cdkVirtualFor: lưới 2-3  │
│  cột, mỗi phần tử ảo = 1  │
│  hàng]                    │
│  ┌────┐ ┌────┐ ┌────┐     │
│  │ D  │ │ I  │ │ O  │     │ ← poster placeholder (gradient + chữ cái đầu)
│  └────┘ └────┘ └────┘     │
│  Dune…  Incep…  Oppen…    │
│  2024   2010    2023      │
│                           │
│ [ BOTTOM NAVIGATION BAR ] │
│ 🏠 Home  📚 BST  📂 Nguồn │
└───────────────────────────┘
   ↓ tap 1 card
┌───────────────────────────┐
│ [ MatBottomSheet ]        │
│  ┌────┐  Dune: Part Two   │
│  │ D  │  2024 · phim lẻ   │
│  └────┘  [Khoa học viễn…] │
│ [ Phát ] [ Sửa metadata ] │
│ Bộ sưu tập:               │
│  ☑ Vũ trụ Marvel          │
│  ☐ Xem sau                │
└───────────────────────────┘
```

### Màn hình 3: Quản lý Bộ sưu tập (Collections) — [Đã sửa]

Bộ sưu tập lưu danh sách tham chiếu ID dưới dạng state riêng tư. Nút thêm mới chuyển thành **FAB** (Floating Action Button) góc phải dưới; kéo thả (`cdkDrag`) dùng icon tay cầm lớn bên phải để dễ thao tác bằng ngón cái.

**Tách 2 tầng (2026-08-28, đã chạy thật, khác bản vẽ trước "tất cả trên một trang"):** `home/collections` chỉ còn danh sách TILE (tên + số lượng phim, `app/shared/poster-tile/` — cùng poster placeholder với Màn hình 2) — tap một tile điều hướng sang route con MỚI `home/collections/:id` (`CollectionDetail`, VẪN dưới Bottom Nav, không phải sub-page kiểu Màn hình 6/7) mới thật sự hiện lưới item + kéo-thả của bộ sưu tập đó. Tiêu đề toolbar ở trang chi tiết là TÊN bộ sưu tập, ghi đè động qua `pageTitleOverride` (`shell/page-title.ts`) ngay khi resolve xong tên — không phải tiêu đề tĩnh "Bộ sưu tập" nhìn thấy thoáng qua lúc điều hướng.

* **Component sử dụng:** lưới tile (`app/shared/poster-tile/`) ở trang danh sách; ở trang chi tiết: CSS Grid thường (KHÔNG virtualize — `cdkDrag` không tương thích `cdkVirtualFor`, số phim/BST nhỏ) + `@angular/cdk/drag-drop` (`cdkDropList[cdkDropListOrientation="mixed"]` cho lưới 2D, `cdkDrag`), FAB (`mat-fab` hoặc `mat-mini-fab`, chỉ ở trang danh sách), Bottom Navigation Bar (tự ghép, hiện ở cả hai tầng).
* **Phản biện UX:** Phim có thể chết link vì **hai lý do khác nhau**, và [ADR-0007](./adr/0007-luu-tru-cuc-bo-indexeddb-dexie.md) yêu cầu UI phân biệt rõ, không được gộp về một nút "Gỡ" chung (xem [Đã sửa] ở Giai đoạn 5 phía trên):
  - **Mất quyền truy cập** (`NO_ACCESS` — bị kick khỏi kênh): dòng mờ (`opacity: 0.5`), text "Bạn đã mất quyền truy cập", hành động là **"Tham gia lại"** — phim có thể vẫn còn, xoá khỏi bộ sưu tập ở bước này là mất dữ liệu oan.
  - **Đã bị xoá** (`DELETED` — admin xoá file thật): dòng mờ, text "Nguồn chia sẻ đã xoá tệp tin này", hành động là **"Gỡ khỏi bộ sưu tập"** — phim thật sự không còn, gỡ là đúng.

  Cả hai đều tắt khả năng kéo-thả (`cdkDragDisabled`) vì reorder một item chết không có ý nghĩa.
* **Cạm bẫy cần tránh khi implement (2 điểm):**
  1. **FAB phải nổi CAO HƠN Bottom Nav**, không phải `position:fixed;bottom:16px` theo nghĩa đen — nav bar chiếm ~56-64px dưới cùng, FAB đặt sát đáy màn hình sẽ bị nav che nửa dưới. `bottom` của FAB = chiều cao nav + khoảng đệm (vd `calc(56px + 16px)`), cộng thêm safe-area-inset-bottom cho điện thoại có thanh cử chỉ.
  2. **Icon tay cầm kéo-thả (⣿) và dấu "+" trên FAB không được dùng `<mat-icon>drag_indicator</mat-icon>`/`<mat-icon>add</mat-icon>`** — dự án không nhúng font ligature Material Symbols (bất biến #8), sẽ vỡ y hệt bug đã gặp ở `MatStepper` ([ADR-0016 addendum](./adr/0016-angular-material-va-cdk.md#cập-nhật-sau-khi-accepted-2026-08-27-slice-ui-login)). Dùng SVG inline.

```text
┌───────────────────────────┐
│ Bộ sưu tập              ⚙️│ ← MatToolbar chung (MainShell)
│ ───────────────────────── │
│  ┌────┐    ┌────┐         │
│  │ V  │    │ X  │         │
│  └────┘    └────┘         │
│  Vũ trụ    Xem sau        │
│  Marvel (8) (3)           │
│                           │
│                       (+) │ ← FAB (Tạo BST mới)
│ [ BOTTOM NAVIGATION BAR ] │
│ 🏠 Home  📚 BST  📂 Nguồn │
└───────────────────────────┘
   ↓ tap "Vũ trụ Marvel"      home/collections/:id
┌───────────────────────────┐
│ [<] Vũ trụ Marvel       ⚙️│ ← [<] back về home/collections (data.backTo), tiêu đề = tên BST (pageTitleOverride)
│ ───────────────────────── │
│  ┌────┐ ┌────┐            │
│  │ I  │ │ A  │            │
│  └────┘ └────┘            │
│  Iron    The              │
│  Man     Avengers         │
│  [⣿ kéo] [⣿ kéo]          │ ← cdkDropListOrientation="mixed"
│                           │
│ [ BOTTOM NAVIGATION BAR ] │ ← vẫn hiện, không phải sub-page
│ 🏠 Home  📚 BST  📂 Nguồn │
└───────────────────────────┘
```

**Chưa làm ở slice này (giữ nguyên từ bản vẽ trước):** phân biệt "mất quyền truy cập" (`NO_ACCESS`, nút "Tham gia lại") vs "đã bị xoá" (`DELETED`, nút "Gỡ khỏi bộ sưu tập") — cần bắt lỗi tầng MTProto, hoãn có chủ đích (xem CLAUDE.md). Trang chi tiết hiện tại gỡ item bằng một nút chung duy nhất.

### Màn hình 4: Quản lý Nguồn (Sources)

Nơi thêm kho phim. Hệ thống phải phân biệt rõ tốc độ index từ nguồn xài `catalog.json` và nguồn quét lịch sử thô. Thêm nguồn mới dùng **`MatBottomSheet`** thay vì popup giữa màn hình.

**Sheet nhiều "bước" điều hướng (2026-08-28, đã chạy thật, khác bản vẽ trước — một ô nhập + nút toggle-mở-rộng-tại-chỗ):** `AddSourceSheet` nay là 3 "màn" bên trong CÙNG MỘT sheet (`step` signal, không phải route/sheet riêng): menu 2 lựa chọn ("Nhập username/link thủ công" / "Chọn từ danh sách chat của tôi") → mỗi lựa chọn dẫn tới một màn con có header mũi tên quay lại (cùng SVG chevron dùng ở Màn hình 6/7). `MatBottomSheet` không có stack điều hướng built-in nên đây là cách giữ cảm giác "trang sau" mà không mất back-stack.

* **Component sử dụng:** `MatBottomSheet` 3 bước (nhập link/username hoặc chọn từ `listMemberChannels()`), `MatCard`, `MatProgressBar` (ngay dưới mỗi card, thể hiện tiến trình quét), FAB (nổi cao hơn Bottom Nav — xem cạm bẫy ở Màn hình 3), Bottom Navigation Bar (tự ghép).
* **Phản biện UX:** Quá trình quét một kênh Telegram thô mất rất nhiều thời gian. Không được block UI bằng cái Spinner tròn quay vô tận. Phải dùng `MatProgressBar` kết hợp hiển thị số liệu cụ thể (ví dụ: "Đang nạp 1500/5000 tin nhắn") để user không có cảm giác máy bị treo. **Chưa làm** — `scanSource()` hiện là một lượt bounded, không báo tiến trình theo số, chỉ có `MatProgressBar` indeterminate (xem CLAUDE.md).
* **Validate tại form, không chỉ ở prose:** ô nhập username/link (màn "manual" của sheet) tự chặn nếu user dán một chuỗi toàn số (id thô) — chỉ chấp nhận username (`@tên` hoặc link `t.me/tên`), đã có validation thật trong `add-source-sheet.ts`. [ADR-0014 §1](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md) cấm dùng id thô vì `access_hash` khác nhau theo tài khoản.

```text
┌───────────────────────────┐
│ Nguồn phát của bạn      ⚙️│ ← MatToolbar chung (MainShell)
│ ───────────────────────── │
│ Kho Phim Gia Đình         │
│ Trạng thái: 150 phim      │
│ ───────────────────────── │
│ Hội Phim 4K               │
│ Đang nạp catalog.json...  │
│ [MatProgressBar: ▓▓▓░░]   │
│                           │
│                       (+) │ ← Mở AddSourceSheet
│ [ BOTTOM NAVIGATION BAR ] │
│ 🏠 Home  📚 BST  📂 Nguồn │
└───────────────────────────┘
   ↓ (+)
┌───────────────────────────┐
│ [ MatBottomSheet: menu ]  │
│ Thêm nguồn mới            │
│ [ Nhập username/link ]    │
│ [ Chọn từ chat của tôi ]  │
│ [ Huỷ ]                   │
└───────────────────────────┘
   ↓ chọn 1 trong 2 — mỗi màn con có mũi tên quay lại về menu
┌───────────────────────────┐        ┌───────────────────────────┐
│ [ < ] Nhập username/link  │        │ [ < ] Chat của tôi        │
│ ┌───────────────────────┐ │        │ [ Kho Phim Gia Đình ]     │
│ │ @ten_kenh hoặc t.me/..│ │        │ [ Hội Phim 4K (kênh) ]    │
│ └───────────────────────┘ │        │ [ Nhóm bạn bè (nhóm) ]    │
│ [ Thêm nguồn ]            │        └───────────────────────────┘
└───────────────────────────┘
```

### Màn hình 5: Trình phát (Player) & Cảnh báo Tương thích

Bản thân Player là một thẻ `<video>` HTML5 nguyên bản nối với Service Worker, phát **toàn màn hình** — không Bottom Nav, không toolbar, không chrome nào che khuất video.

* **Component sử dụng:** `MatBottomSheet` (cảnh báo tương thích trước khi phát — trượt lên từ dưới thay vì `MatDialog` giữa màn hình, không che khuất toàn bộ video), `MatSnackBar` (lỗi `FLOOD_WAIT`, nổi ở **cạnh trên** để không đè lên control phát ở dưới).
* **Phản biện UX:** Nếu catalog báo file này là `unplayable` (vd: MKV) hoặc `partial` (vd: HEVC/AV1), trình duyệt có thể đen ngòm. Dùng `MatBottomSheet` chặn ngay từ đầu, nói thẳng sự thật ("Trình duyệt web không gánh nổi định dạng này, mời mở app gốc") là một UX xuất sắc hơn việc để user nhìn màn hình đen và tưởng app bị lỗi — và trên mobile, bottom sheet còn giữ được ngữ cảnh video phía sau (mờ đi) thay vì che kín như dialog giữa màn hình.
* **[Đã chạy thật, 2026-08-28]** `apps/web/src/app/player/compat-warning-sheet/compat-warning-sheet.ts` — `player.ts` tra `getMediaItem(sourceId, msgId)` TRƯỚC khi gắn `src`; `compat` là `'partial'`/`'unplayable'` mới mở sheet (chặn bằng `disableClose: true`, đúng 2 nút như mockup), `undefined` (tuyệt đại đa số item — chưa ai gán nhãn qua Ingest Editor, Màn hình 6 vẫn chưa route) hoặc `'full'` thì qua thẳng, không nagging. "Mở trên Telegram" dựng link từ `SourceRef.ref` (`buildTelegramDeepLink()`, xử lý cả 3 dạng ref đang có trong repo: `@username`, `t.me/username`, `https://t.me/c/<id>`) — ẩn nút này nếu nguồn đã bị gỡ (không có `ref` để dựng link). `MatSnackBar` FLOOD_WAIT: `stream-bridge.ts` (sống xuyên suốt trang, ADR-0004 §3) phát tín hiệu qua `player/flood-wait-notice.ts` khi `fetchChunk()` reject với lỗi tên `FloodWaitTooLongError` (`.name`/`.message` sống sót qua Comlink dù `.seconds` riêng thì không, xem comment trong `stream-bridge.ts`) — `player.ts` chỉ snackbar cho tín hiệu MỚI phát sinh sau lúc mở màn (tránh snackbar "ma" từ lần phát trước còn sót lại trong signal cấp module).

```text
┌───────────────────────────┐
│ [ HTML5 VIDEO PLAYER ]    │
│ ▶ ⏸  00:30:15 / 02:46:00  │
│                           │
│ [MatSnackBar - Cạnh trên] │
│ ⏳ Telegram chặn băng     │
│ thông. Đợi 45 giây...     │
│                           │
│ [MatBottomSheet trượt lên]│
│ ⚠️ CẢNH BÁO TƯƠNG THÍCH   │
│ Phim dùng mã hoá AV1, có  │
│ thể chỉ nghe được tiếng.  │
│ [ NÚT: MỞ TRÊN TELEGRAM ] │
│ [ NÚT: VẪN THỬ PHÁT ]     │
└───────────────────────────┘
```

### Màn hình 6: Quản lý Metadata (Ingest Editor)

Theo kiến trúc, **metadata toàn cục không bao giờ được ghi vào kênh state** cá nhân. Người dùng thông thường **chỉ có thể đọc** metadata từ kênh cộng đồng; chỉ được cấp quyền **chỉnh sửa (write)** khi nguồn đó là "Kho Cá Nhân" (Private Vault) do chính họ làm Admin ([ADR-0014 §4](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)). Form dài trên mobile dùng header có nút quay lại (`<`) thay Bottom Nav, và **Sticky Bottom Bar** chứa nút Lưu để không phải cuộn lên đầu form mới lưu được.

* **Component sử dụng:** Header `<` (quay lại, không Bottom Nav — đây là sub-page, không phải tab chính), `MatFormField` full-width, `MatRadioGroup` (phân hạng compat), Sticky Bottom Bar (`position: sticky; bottom: 0`) chứa nút Lưu.
* **Ghi đè `catalog.json`:** Khi bấm "Lưu", Core Worker thu thập toàn bộ metadata trong Kho Cá Nhân, đóng gói thành định dạng chuẩn `tsmc-catalog/1` và ghim (pin) file `catalog.json` đè lên **kênh media** tương ứng — không bao giờ lên kênh state ([ADR-0014 §3](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md)).
* **Hạng tương thích (`compat`):** UX buộc người dùng (với tư cách Admin kho cá nhân) phải gán nhãn khả năng phát (`full`, `partial`, `unplayable`) để player cảnh báo chính xác cho người xem (xem Màn hình 5).
* **Bảo mật dữ liệu (Sanitize):** Bất kỳ dữ liệu đầu vào nào (đặc biệt nếu load lại từ kênh) cũng phải được validate qua schema (Valibot) và kẹp độ dài để chống XSS — hệ thống coi mọi thứ lấy từ Telegram là nội dung không tin cậy ([ADR-0011 §3](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)).
* **[Đã chạy thật, 2026-08-28]** Route `/metadata/:sourceId/:msgId` (`apps/web/src/app/metadata-editor/`), vào qua icon ✏️ mới thêm trên mỗi row của Browse — icon hiện ở MỌI row (không lọc trước theo quyền ghi ở Browse, cần một bước kiểm tra hàng loạt chưa đáng làm cho một nút ít dùng), màn tự kiểm `checkSourceWritable()` NGAY khi mở và chặn rõ ràng nếu không phải chủ kênh. "Lưu" gọi RPC `saveMediaMetadata()` — publish xong tự re-scan/reindex ngay (dùng lại `scanSourceAndReindex()` đã có), Browse phản ánh đúng ngay không cần bấm "Quét" lại thủ công. Chi tiết kỹ thuật đầy đủ (đường ghi, ranh giới quyền, rủi ro chưa kiểm chứng traffic thật) ở addendum 2026-08-28 của [ADR-0014](./adr/0014-mo-hinh-kenh-media-dung-chung-state-rieng-tu.md).

```text
┌───────────────────────────┐
│ [ < ] ⚙️ SỬA METADATA      │
│ ───────────────────────── │
│ ┌───────────────────────┐ │
│ │ Tiêu đề (Dune 2)      │ │
│ └───────────────────────┘ │
│ ┌───────────────────────┐ │
│ │ Năm (2024)            │ │
│ └───────────────────────┘ │
│ Khả năng phát Web (Compat)│
│ 🔘 Full (MP4/H.264)       │
│ ⚪ Partial (HEVC/AV1)     │
│ ⚪ Unplayable (MKV)       │
│                           │
│ [ STICKY BOTTOM BAR ]     │
│ [ 💾 LƯU CATALOG.JSON ]   │
└───────────────────────────┘
```

### Màn hình 7: Cài đặt, Tài khoản & Debug

Trên mobile, Cài đặt **không** nên chiếm một tab dưới Bottom Nav — chỉ có 3 nhóm hành động cốt lõi (Home/BST/Nguồn) xứng đáng một tab cố định, Cài đặt là hành động ít tần suất hơn nên nằm trong menu/góc màn hình Dashboard, dùng header `<` quay lại giống Màn hình 6 (sub-page, không Bottom Nav). Cuộn dọc toàn màn hình, chia khối bằng `MatDivider`. Khối "Tài khoản kết nối" nằm trên cùng.

* **Component sử dụng:** `MatListItem` (avatar + tên + số điện thoại), nút Đăng xuất (`mat-stroked-button color="warn"`), `MatExpansionPanel` hoặc khối phẳng cho từng nhóm (Lưu trữ/Mạng/Chẩn đoán), `MatSlider` (song song tải), `MatSlideToggle` (log debug), `MatBottomSheet` (xác nhận đăng xuất).
* **Phản biện UX (Mạng & băng thông):** Trao cho user quyền chỉnh số kết nối song song để tải nhanh hơn, nhưng đừng giấu rủi ro — dòng text màu đỏ gắt (`mat-error`) báo rõ nguy cơ. Trần 4/8 đến thẳng từ [ADR-0006 §3](./adr/0006-download-pipeline-dc-pool-flood-wait.md), không phải số tuỳ chọn.
* **Phản biện UX (Đăng xuất) — quan trọng nhất màn này:** Vì không có backend giữ hộ phiên, và rào cản đăng nhập lại (nhập lại `API_ID`/`API_HASH`/OTP, xem Màn hình 1) rất lớn, **tuyệt đối không cho phép đăng xuất ngay khi bấm nút.** Bắt buộc `MatBottomSheet` xác nhận lần 2, ghi rõ hậu quả bằng ngôn ngữ thường (không thuật ngữ kỹ thuật) — đây là hàng rào chống thao tác nhầm trên màn cảm ứng, không phải bước rườm rà.
* **Nguy cơ mất dữ liệu thật nếu bỏ qua outbox — phải kiểm tra TRƯỚC khi xoá IndexedDB:** mutation (đổi bộ sưu tập, tiến độ xem…) ghi optimistic cục bộ trước, chỉ thật sự lên kênh state Telegram (nguồn sự thật, ADR-0009) sau khi `forceFlush()` outbox thành công — và flush có thể fail giữa chừng vì `FLOOD_WAIT` (xem `libs/core-sync/src/outbox.spec.ts`). Nếu luồng đăng xuất xoá IndexedDB khi outbox còn event chưa gửi, thay đổi đó **mất vĩnh viễn**. `sync-status.ts` đã có sẵn `countOutbox()`/`forceFlush()` — luồng logout ở Màn hình 7 BẮT BUỘC gọi flush trước khi xoá, xem bước 3 trong Logout Journey bên dưới.
* **[Đã chạy thật, 2026-08-28]** `apps/web/src/app/settings/logout-confirm-sheet/logout-confirm-sheet.ts` có try/catch đầy đủ quanh `client.logout()`, chuyển sang trạng thái lỗi rõ ràng (nút Thử lại/Huỷ) thay vì để promise reject rơi vào im lặng — đúng bước 4 Logout Journey bên dưới.
* **Chi tiết kỹ thuật (Đăng xuất) — [Đã chạy thật, 2026-08-28]:** Không gọi API backend (không có) — UI gọi RPC `client.logout()` xuống Core Worker (`libs/worker-host/src/core-worker.ts`), tự làm ĐỦ bốn bước đúng thứ tự trong MỘT RPC, dừng ngay ở bước lỗi (không rơi xuống bước sau): (1) `syncEngine.forceFlush()` — lỗi (FLOOD_WAIT/mất mạng) ném ngay, chưa đụng gì; (2) dừng timer nền; (3) `auth.LogOut` qua GramJS **trước** khi xoá session cục bộ (`libs/core-mtproto/src/gateway.ts` — xoá local trước sẽ để lại session sống trong danh sách thiết bị mà app không còn cách thu hồi, ADR-0011) — lỗi thì KHÔNG xoá gì cả; (4) chỉ khi (3) thành công mới `wipeAllData()` (`libs/core-storage`) dọn toàn bộ IndexedDB (session, sync state/meta, outbox, media, index meta, publisher trust, search index). Cache chunk video (`tsmc-chunks-v1`, Cache Storage của `sw/sw.ts`) KHÔNG bị xoá lúc đăng xuất — dọn riêng qua nút "Xoá bộ nhớ đệm chunk" ở khối Lưu trữ, vẫn còn ích nếu đăng nhập lại đúng tài khoản.

```text
┌───────────────────────────┐
│ [ < ] ⚙️ CÀI ĐẶT HỆ THỐNG  │
│ ───────────────────────── │
│ 👤 TÀI KHOẢN KẾT NỐI      │
│ [ 🧑‍💻 ] Daniel Vo            │
│         +84 9xx xxx xxx   │
│                           │
│ [ NÚT STROKED WARN:       │
│   🚪 Đăng xuất khỏi app ] │
│ ⚠️ Khuyến cáo: Bạn sẽ phải│
│ nhập lại API_ID để vào lại│
│ ───────────────────────── │
│ 💾 QUẢN LÝ LƯU TRỮ        │
│ Bộ nhớ đệm (Cache): 1.2GB │
│ [ Xoá bộ nhớ đệm chunk ]  │
│ ───────────────────────── │
│ 🌐 MẠNG & BĂNG THÔNG      │
│ Luồng tải song song       │
│ [MatSlider: 4]            │
│ ⚠️ Tăng cao dễ dính       │
│ FLOOD_WAIT từ Telegram.   │
│ ───────────────────────── │
│ 🐛 CHẨN ĐOÁN (DEBUG)      │
│ [Toggle] Bật Log Worker   │
└───────────────────────────┘
```

**Luồng hành vi khi bấm Đăng xuất (Logout Journey) — có nhánh outbox + nhánh lỗi:**

1. User chạm vào nút "Đăng xuất khỏi app".
2. UI đọc `pendingOutboxCount()` (đã có sẵn ở `sync-status.ts`). Nội dung `MatBottomSheet` xác nhận **khác nhau tuỳ có event chưa đồng bộ hay không**:
   - **Không có gì chờ đồng bộ:** *"Toàn bộ phim trong kho cache cục bộ sẽ bị xoá. Dữ liệu trên Telegram vẫn an toàn. Bạn có chắc chắn muốn thoát?"* — 2 nút **[ Huỷ ]** / **[ Xác nhận thoát ]**.
   - **Còn N event chưa đồng bộ:** *"Bạn có N thay đổi chưa kịp lưu lên Telegram (vd: sắp xếp bộ sưu tập). Đăng xuất ngay sẽ MẤT các thay đổi này."* — 2 nút **[ Huỷ ]** / **[ Đồng bộ rồi thoát ]** (KHÔNG có lựa chọn "thoát luôn, bỏ qua đồng bộ" ở bước này — chặn mất dữ liệu bằng thiết kế, không chỉ bằng cảnh báo).
   Nút thoát luôn dùng `color="warn"`, nút Huỷ là hành động mặc định/nổi bật hơn về mặt thị giác (giảm khả năng chạm nhầm — ngón cái quen chạm vào nút bên phải/nổi bật trước).
3. Nếu xác nhận và còn outbox: gọi `forceFlush()` trước. Sheet chuyển sang trạng thái đang xử lý (progress indicator, không đóng được).
   - Flush **thành công** → tiếp tục bước 4.
   - Flush **thất bại** (mất mạng, `FLOOD_WAIT`) → sheet hiện lỗi rõ ràng (*"Không thể đồng bộ lúc này: [lý do]. Thử lại hoặc Huỷ."*) — **không** tự động xoá dữ liệu, không tự động thoát; user chọn Thử lại hoặc Huỷ, quay về màn Cài đặt nguyên trạng.
4. Core Worker gọi `auth.LogOut` qua GramJS.
   - **Thành công** → xoá session cục bộ → dọn toàn bộ IndexedDB (media cache, chunk cache, collections…) → đóng kết nối MTProto → điều hướng user về lại Màn hình 1 (Onboarding).
   - **Thất bại** (mất mạng, lỗi Telegram) → sheet hiện lỗi tương tự bước 3, **không** xoá bất kỳ dữ liệu cục bộ nào cho tới khi `auth.LogOut` xác nhận thành công — tránh trạng thái nửa vời (đã mất session cục bộ nhưng server vẫn còn phiên sống, hoặc ngược lại).

**[Đã chạy thật, 2026-08-28]** Toàn bộ 4 bước — `logout-confirm-sheet.ts` đọc `pendingOutboxCount()` từ `liveQuery` (`countOutbox()`) trước khi mở, chọn đúng nội dung sheet theo hai nhánh trên; bấm nút gọi MỘT RPC `client.logout()` duy nhất (xem "Chi tiết kỹ thuật (Đăng xuất)" phía trên) — không có RPC rời cho từng bước, vì §Bước 3/4 vốn phải nguyên tử (không thể flush xong rồi mới quyết định có gọi `auth.LogOut` hay không ở một round-trip riêng).

## Phụ lục A: Công cụ ingest desktop (GUI Tauri)

> **Trạng thái: bản vẽ, chưa có một dòng code nào.** Nguồn gốc: brainstorm 2026-09-05, sau khi [SPIKE-09](./spikes/README.md#spike-09) đóng 🟢 và user quyết định hướng GUI Tauri (quyết định này ADR-0013 để ngỏ từ 2026-08-29 — xem [ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md)).
>
> **Không thuộc 7 màn hình mobile-first ở trên.** Khác đối tượng (người **đăng** nội dung, không phải người xem), khác thiết bị (desktop), khác ngôn ngữ thiết kế (dày đặc, bàn phím trước, bảng thay vì card). Ba nguyên tắc chuyển đổi mobile-first ở đầu tài liệu **không áp dụng** cho phụ lục này.
>
> **Kiến trúc runtime CHƯA quyết** — đặc biệt tầng MTProto, đang bị gate bởi [SPIKE-10](./spikes/README.md#spike-10). Phụ lục này cố ý chỉ mô tả **chức năng, giao diện và hành trình người dùng**, không mô tả tiến trình/thư viện nào chạy cái gì. Nếu spike cho kết quả buộc phải đổi thiết kế (ví dụ tầng MTProto được chọn không báo được tiến trình hoặc không huỷ được giữa chừng, tiêu chí M5), thì mục A.2 nguyên tắc 4 và mockup A.3 phải sửa lại — **ghi rõ ở đây khi điều đó xảy ra**, đừng để mockup mô tả một thứ không dựng được.
>
> **Không vi phạm [ADR-0001](./adr/0001-kien-truc-client-heavy-khong-backend.md):** công cụ này nằm phía **tác giả nội dung**, ngoài đường chạy của người xem — cùng vị trí với `tsmc-ingest` CLI và `@tsmc_bot`. Người xem vẫn không cài gì.

### A.1 Phạm vi chức năng

**Định vị:** công cụ của người đăng nội dung. Nó không phát phim, không phải bản desktop của app xem.

Sáu năng lực dưới đây là **lý do GUI đáng làm** — chúng không phải "CLI nhưng có nút bấm", mà là những thứ một CLI one-shot về nguyên tắc không làm được:

1. **Hàng đợi bền qua lần chạy.** Batch 20 file đóng app giữa chừng thì mở lại chạy tiếp. Gap "retry/rollback khi `FLOOD_WAIT` rơi giữa chuỗi 3 RPC của `publishCatalogDocument()`" (đang nằm ở [roadmap](./roadmap.md), chưa ai làm) chỉ giải được đàng hoàng khi có chỗ giữ trạng thái bền — CLI one-shot không có chỗ đó.
2. **`FLOOD_WAIT` nhìn thấy được.** CLI hiện tại đứng im, không ai biết còn bao lâu. GUI đếm ngược, tự chạy tiếp, ghi log.
3. **Sửa metadata theo lô kiểu bảng tính.** Nỗi đau "gõ tay metadata cho nhiều tập" đã xác nhận là thật (ADR-0013, 2026-08-29 — chính user gặp phải). `inheritMetadata()` chỉ chữa được một nửa vì vẫn tuần tự từng file; công cụ đúng là **chọn nhiều dòng, gõ một lần, điền xuống cả season**.
4. **Đối soát catalog ↔ kênh.** Đọc `catalog.v1.json` đã ghim + quét message thật trong kênh để tìm: file đã upload nhưng thiếu trong catalog (đúng ca "admin up bằng app Telegram gốc" đã xảy ra thật), item trỏ tới message đã xoá, item thiếu `compat`/`subs`/poster.
5. **Poster thật.** [roadmap](./roadmap.md) ghi `MediaRecord.poster` mới chỉ là `{msgId}` placeholder, chưa có pipeline ảnh. Chỗ đúng để chọn/cắt/upload poster là công cụ desktop của admin, không phải app xem (tải ảnh hàng loạt lúc duyệt dễ dính `FLOOD_WAIT`).
6. **Chống trùng.** Quét folder rồi đối chiếu catalog để biết file nào đã có, hỏi bỏ qua hay thay thế.

**Cố ý KHÔNG làm** (giữ phạm vi, và giữ bất biến): không phát phim; **không đụng tới kênh state riêng tư** (bất biến #5 — công cụ ingest không có việc gì ở đó); không transcode farm; không thay `@tsmc_bot` ở phần hậu kiểm file do admin **khác** đăng bằng app Telegram gốc.

**Hai ràng buộc dùng chung, không thương lượng:**

- **Bảng phân hạng A/B/C/D là của [ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md).** UI không được có nhãn/ngưỡng riêng lệch khỏi bảng đó.
- **Logic thuần dùng lại `libs/core-ingest`** (phân hạng, `inheritMetadata`, `mergeCatalogItems`, sidecar subs) — không viết lại ở tầng UI, và (theo ràng buộc đã ghi ở [SPIKE-10](./spikes/README.md#spike-10)) không port sang ngôn ngữ khác dù kiến trúc runtime chọn nhánh nào.

### A.2 Bốn nguyên tắc UX

1. **Hiện giá trước khi làm.** Thanh dưới cùng luôn nói sẽ tốn bao nhiêu: số byte, thời gian remux/upload ước tính, và cảnh báo Hạng D **bằng số phút cụ thể**, không phải chữ "đắt". Đây là bản GUI của đúng nguyên tắc CLI đã có: remux là mặc định, re-encode video **luôn phải hỏi**.
2. **Phân hạng là màu, hiện ngay khi thả file — trước một byte upload nào.** 🟢A / 🟡B / 🟠C / 🔴D.
3. **Bảng, không phải form từng file.** `inheritMetadata()` lùi xuống làm **giá trị gợi ý sẵn** trong ô, không còn là một câu hỏi tuần tự chặn luồng.
4. **Tiến trình phải nói đang ở stage nào.** Pipeline có 6 bước chênh nhau hàng chục lần về thời gian (`probe → remux → thumb → subs → upload → publish`) — một thanh phần trăm tổng là nói dối. `FLOOD_WAIT` hiện thành **hàng riêng có đồng hồ đếm ngược**, không phải một dòng log lướt qua.

### A.3 Màn hình chính — workspace ba vùng

Không phải wizard nhiều bước: người dùng cần thấy hàng đợi, bảng metadata và chi phí **cùng lúc**.

```text
┌────────────────────────────────────────────────────────────────────┐
│ Kênh: @tsmc_mediacenter ▾    catalog: 5 item · ghim OK      ⚙ 👤   │
├──────────────┬─────────────────────────────────────────────────────┤
│ HÀNG ĐỢI     │ BẢNG METADATA (chọn nhiều dòng, gõ 1 lần, điền xuống)│
│              │                                                     │
│ ▸ S01E01 🟠C │  ☑ Tên file        Title        Season Ep  Năm  🚦   │
│   S01E02 🟠C │  ☑ S01E01.mkv      The Big B…    1     1  2007  🟠C  │
│   S01E03 🟢A │  ☑ S01E02.mkv      The Big B…    1     2  2007  🟠C  │
│   trailer 🔴D│  ☑ S01E03.mp4      The Big B…    1     3  2007  🟢A  │
│              │  ☐ trailer.avi     —             —     —   —    🔴D  │
│ + Thả file   │                                                     │
│   hoặc folder│  [Điền xuống ▼] [Đánh số tập tự động] [Xoá khỏi hàng]│
├──────────────┴─────────────────────────────────────────────────────┤
│ TRƯỚC KHI CHẠY:  3 file · 12.4 GB · remux ~4 phút · upload ~28 phút │
│ ⚠ trailer.avi Hạng D — cần RE-ENCODE ~21 phút. Bỏ chọn hoặc xác nhận│
│                                        [Xem lại]  [Bắt đầu upload] │
└────────────────────────────────────────────────────────────────────┘
```

Khi đang chạy, vùng bảng đổi sang chế độ theo dõi: mỗi dòng hiện **stage hiện tại** (không phải phần trăm tổng), và `FLOOD_WAIT` chiếm một hàng riêng có đếm ngược.

**Vẫn dùng Angular Material + CDK** ([ADR-0016](./adr/0016-angular-material-va-cdk.md)) để dùng lại theme và component đã có, nhưng ở density compact — và **CDK Virtual Scroll vẫn bắt buộc** cho bảng nếu hàng đợi có thể dài (thả nguyên một season nhiều chục tập).

### A.4 Các màn còn lại

| Màn | Nội dung | Ràng buộc bắt buộc |
|---|---|---|
| Đăng nhập | `API_ID`/`API_HASH` → số điện thoại → OTP → 2FA | Giữ **nguyên** cảnh báo bắt buộc của [ADR-0011 §5](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md) trước ô nhập đầu tiên — desktop app không được nhẹ tay hơn web |
| Chọn kênh | Danh sách kênh **ghi được**, kèm tình trạng catalog đã ghim | Chặn id thô ngay tại form (bất biến #10 — `access_hash` khác nhau theo tài khoản); không bao giờ ghi vào kênh của người khác (bất biến #5) |
| Trình quản lý catalog | Bảng toàn bộ item đang có, đối soát với message thật trong kênh, sửa/xoá/re-publish | Mọi dữ liệu đọc từ Telegram là **không tin cậy** — validate schema + kẹp độ dài như Màn hình 6 ([ADR-0011 §3](./adr/0011-bao-mat-session-va-noi-dung-khong-tin-cay.md)) |
| Nhật ký | Log kỹ thuật, copy được | Chỗ để dán khi báo lỗi; không log session/token |

### A.5 User journey

**Lần đầu (một lần duy nhất):** cài → đọc cảnh báo tài khoản thật → dán `API_ID`/`API_HASH` → số điện thoại → OTP (+2FA) → chọn kênh ghi được → app tự kiểm: quyền đăng ✓, catalog đã ghim ✓ (chưa có thì đề nghị tạo) → sẵn sàng. **Không có bước cài `ffmpeg`** — đây là điểm khác biệt chính so với `tsmc-ingest` CLI, vốn bắt admin tự cài `ffmpeg`/`ffprobe` lên PATH.

**Đường hạnh phúc (thả cả một season):**

1. Kéo nguyên folder vào → app parse tên file, **tự gom theo series/season**, hiện bảng kèm hạng màu.
2. Admin gõ Title một lần → điền xuống → kiểm tra số tập tự động.
3. Thanh dưới báo giá (byte, phút remux, phút upload, cảnh báo Hạng D).
4. Bấm Bắt đầu → theo dõi theo stage; remux file kế tiếp **chạy song song** với upload file trước (CLI hiện tại tuần tự — đây là chỗ tiết kiệm thời gian thật, nhưng **phụ thuộc kết quả SPIKE-10**, xem A.6).
5. Xong: publish catalog **đúng một lần cho cả batch** — giữ nguyên hành vi CLI, giảm cửa sổ `FLOOD_WAIT` giữa chuỗi 3 RPC.
6. Hiện tóm tắt + link mở kênh trên Telegram và mở app web để tự kiểm chứng.

**Các đường hỏng — đây mới là phần GUI phải làm tốt hơn CLI:**

| Tình huống | Hành vi thiết kế |
|---|---|
| `FLOOD_WAIT` | Hàng đợi tạm dừng, **đếm ngược hiện rõ**, tự chạy tiếp. Không né bằng đổi DC ([ADR-0006](./adr/0006-download-pipeline-dc-pool-flood-wait.md)) |
| Pipeline FFmpeg crash | File đó đánh dấu `Lỗi`, **batch chạy tiếp**, log giữ nguyên stderr + mã thoát đã giải nghĩa (bài học `0xC0000005` vs `0xC0000135` của [SPIKE-09](./spikes/README.md#spike-09)) |
| Đóng app giữa batch | Mở lại: "Còn N file dở dang — chạy tiếp?" |
| File Hạng D | Không bao giờ tự chạy; hiện phút ước tính, **mặc định bỏ chọn** |
| File đã có trong catalog | Đánh dấu trùng, mặc định bỏ qua, cho chọn "thay thế" |
| Mất mạng giữa upload | Nối lại thay vì up lại từ đầu — **khả thi hay không phụ thuộc SPIKE-10 (M5/M6)**, xem A.6 |
| Remux xong vượt trần kích thước | Chặn **trước** khi upload kèm gợi ý (giảm bitrate audio, cắt tập) — thà biết sớm còn hơn hỏng ở part cuối sau 40 phút. Trần thật (2 GB hay 4 GB Premium) do SPIKE-10 tiêu chí M7 xác định |

### A.6 Ghi chú đối chiếu và câu hỏi còn mở

**Ba chi tiết trong thiết kế trên đang chờ [SPIKE-10](./spikes/README.md#spike-10), không được coi là đã chốt:**

- **Tiến trình + huỷ giữa chừng** (nguyên tắc UX 4, mockup A.3, bảng đường hỏng) — phụ thuộc tiêu chí M5. Nếu tầng MTProto được chọn không báo được tiến trình dưới 2s/lần hoặc không huỷ được trong 3s, phải thiết kế lại phần theo dõi tiến trình.
- **Nối lại upload sau khi mất mạng** — phụ thuộc M5/M6. Có thư viện hỗ trợ, có thư viện không; chưa đo.
- **Remux song song với upload** (bước 4 đường hạnh phúc) — chỉ an toàn nếu `FLOOD_WAIT` được xử lý ở một chỗ tập trung; chưa đo.

**Trùng vai với Màn hình 6 (Ingest Editor web).** "Trình quản lý catalog" ở A.4 làm đúng việc mà Màn hình 6 đang làm, nhưng đầy đủ hơn (đối soát, sửa hàng loạt). Nếu công cụ desktop chạy thật và tốt hơn hẳn, nên cân nhắc **thu hẹp Màn hình 6** về đúng "sửa nhanh một item" thay vì cố làm trình quản lý đầy đủ — quyết định này để dành cho lúc GUI chạy thật, không quyết trước.

**Ba câu hỏi sản phẩm còn treo** (ghi ở đây để không trôi mất; quyết trong ADR sau spike, xem "Plan sau spike" của SPIKE-10):

- Số phận `tsmc-ingest` CLI: giữ song song làm đường headless/batch, hay khai tử sau khi GUI đạt parity?
- Tra metadata online (TMDB/OMDb): về kiến trúc **được phép** (nằm phía admin, ngoài đường chạy người xem — bất biến #8 nói về app web), và nó giết nỗi đau gõ tay triệt để hơn "điền xuống". Đổi lại: gửi tên phim trong kho của admin sang bên thứ ba + thêm một API key. Nếu làm thì **opt-in, mặc định tắt**.
- `@tsmc_bot` ([ADR-0013](./adr/0013-bot-dong-hanh-va-pipeline-ingest.md) mục 2) có còn cần không khi GUI làm được `/publish` và `/check`? Phần còn giá trị riêng của bot: hậu kiểm file do admin **khác** đăng bằng app Telegram gốc.
