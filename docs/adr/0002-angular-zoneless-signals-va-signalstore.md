# ADR-0002: Angular zoneless + Signals + NgRx SignalStore

- **Trạng thái:** Accepted
- **Ngày:** 2026-08-23
- **Liên quan:** [ADR-0004](./0004-mo-hinh-da-luong.md), [ADR-0007](./0007-luu-tru-cuc-bo-indexeddb-dexie.md)

## Bối cảnh

PRD chốt Angular. Câu hỏi còn lại là **cấu hình runtime** và **mô hình quản lý state** — hai thứ này ảnh hưởng trực tiếp tới trải nghiệm khi có một Worker bơm hàng trăm sự kiện tiến trình mỗi giây (progress index, buffer playback, tốc độ tải).

Đặc thù workload của TSMC:
- Rất nhiều cập nhật tần suất cao đến từ **ngoài Angular** (Worker `postMessage`) — thứ mà zone.js không patch được một cách hữu ích.
- Danh sách phim có thể lên tới hàng chục nghìn item → cần virtual scroll và tránh re-render diện rộng.
- State đọc chủ yếu là *dẫn xuất* từ IndexedDB, không phải nguồn sự thật trong bộ nhớ.

## Các phương án

| | Zone.js + NgRx Store (Redux) | Zoneless + Signals + service thuần | **Zoneless + Signals + NgRx SignalStore** |
|---|---|---|---|
| Cập nhật từ Worker | Phải `ngZone.run()` thủ công, dễ quên → UI đứng im | OK | OK |
| Chi phí change detection | Toàn cây, tốn với list lớn | Chỉ node phụ thuộc signal | Chỉ node phụ thuộc signal |
| Cấu trúc khi state phình to | Rõ ràng nhưng rất nhiều boilerplate | Dễ thành mớ service phụ thuộc vòng | Có khuôn (state/computed/methods), ít boilerplate |
| DevTools / truy vết | Tốt nhất | Yếu | Khá (`withDevtools`) |

## Quyết định

- **Angular với `provideZonelessChangeDetection()`**, standalone components, `ChangeDetectionStrategy.OnPush` mặc định toàn bộ.
- **State cục bộ theo feature bằng `@ngrx/signals` SignalStore**; RxJS chỉ dùng cho *dòng sự kiện* (progress, playback ticks) rồi `toSignal()` vào view.
- **Không** đưa danh mục phim vào store. Store chỉ giữ *truy vấn* (filter, workspace context, sort) và *ID kết quả*; dữ liệu phim đọc từ IndexedDB qua resource-style signal. Đây là điểm quan trọng nhất của ADR này: giữ 30k object phim trong Redux/SignalStore sẽ ngốn RAM và biến mọi filter thành một lần copy toàn bộ mảng.
- Template dùng control flow mới (`@if` / `@for` với `track` bắt buộc) và `@defer` cho các khối nặng (player, trang cài đặt).

## Hệ quả

**Tích cực**
- Cập nhật từ Worker chỉ cần `signal.set()` — không cần biết gì về zone.
- Không có `NgZone` nghĩa là không có bug "UI không update vì callback nằm ngoài zone", vốn là loại bug tốn nhiều giờ debug nhất trong app nhiều worker.

**Tiêu cực / phải chấp nhận**
- Thư viện bên thứ ba còn phụ thuộc zone.js sẽ không tự trigger CD → phải tự bọc. Cần rào: **mọi lib UI đưa vào dự án phải zoneless-safe**, ghi vào checklist review.
- SignalStore là API còn trẻ hơn NgRx Store cổ điển; đội quen Redux sẽ mất thời gian đầu.
- Không dùng zone.js đồng nghĩa `ngOnDestroy`-based async không còn được "bao bọc" — mọi subscription phải dùng `takeUntilDestroyed()`.

## Ghi chú thực thi

- Cầu nối Worker → UI đi qua **Comlink**, bọc trong một service Angular duy nhất (`CoreClient`), không cho component nào tự `postMessage`.
- Progress tần suất cao phải được **throttle ở phía Worker** (ví dụ 10 Hz), không throttle ở UI — tiết kiệm cả chi phí serialize.
