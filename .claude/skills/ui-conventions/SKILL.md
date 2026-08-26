---
name: ui-conventions
description: Convention cho code UI trong apps/web (Angular zoneless) — cấu trúc thư mục/file, khi nào dùng SignalStore vs signal() trần, ranh giới đọc/ghi dữ liệu, convention comment đầu file, và luật routing cho màn hình mới. Dùng khi tạo component/store mới trong apps/web, hoặc khi review code UI xem có đúng pattern đã thống nhất không.
---

# ui-conventions

Convention này đúc từ pattern đã tự hình thành qua 4 slice đã chạy thật (F1–F4: Auth, Sync, Index, Browse, Playback). Phần lớn là **ghi lại luật ngầm đã có trong code**, không phải luật mới áp đặt — khi có mâu thuẫn giữa skill này và code hiện tại, ưu tiên đọc lại code trước vì đây có thể là chỗ convention đã trôi.

Nền tảng bắt buộc đọc trước: [ADR-0002](../../../docs/adr/0002-angular-zoneless-signals-va-signalstore.md) (zoneless/signals/SignalStore), [ADR-0012](../../../docs/adr/0012-trien-khai-static-pwa-va-cau-truc-workspace.md) (ranh giới workspace), [ADR-0016](../../../docs/adr/0016-angular-material-va-cdk.md) (Material/CDK).

## 1. Cấu trúc thư mục & file

```
app/<feature>/
  <feature>.ts          # component — KHÔNG suffix .component
  <feature>.html
  <feature>.scss
  <feature>.store.ts    # chỉ khi thật sự cần SignalStore, xem mục 2
  <sub-widget>/          # dialog/con riêng của feature này
```

Ví dụ đã có: `browse/browse.ts` + `browse/browse.store.ts`; `sync/state-channel-resolution-dialog/` là sub-widget riêng của `sync/`.

- Không suffix `.component`/`.service` — khớp Angular 22 và đã nhất quán 100% trong code hiện tại.
- Selector `app-*`.
- **Chưa tạo `app/shared/`.** Đợi tới khi có ≥2 feature cần cùng một widget (banner cảnh báo, empty-state…) mới tách — rule-of-three, tránh trừu tượng hoá sớm.

## 2. State scope — 3 tầng

| Tầng | Chứa gì | Cơ chế | Ví dụ |
|---|---|---|---|
| **Nguồn sự thật** | Domain data (phim, sync state) | `liveQuery()` từ `@tsmc/core-storage` → `toSignal(from(...))`. Không bao giờ copy vào store. | `browse.ts` (`rows`), `player.ts` (`syncState`) |
| **Query/UI state của feature** | filter, sort, bước wizard, dialog mở/đóng — nhiều phần trong 1 feature cùng đọc/ghi | `@ngrx/signals` SignalStore, `providers: [XStore]` ở component | `BrowseStore` — chỉ giữ `sourceId/query/sort`, KHÔNG giữ mảng phim |
| **UI state cục bộ 1 component** | loading flag, hover, toggle không ai khác cần | `signal()` field trần trong class — **không** tạo store | `sync-status.ts` — `flushing`, `writingTest` là `signal()` trần |

**Luật chọn tầng 2 vs 3:** nếu không có component/child nào khác cần inject state đó → đừng tạo store. `sync-status.ts` là bằng chứng ngược lại cám dỗ "cứ có vài field thì tạo store cho gọn" — đây là chỗ dễ over-engineer nhất trong UI layer, cẩn thận khi review.

Ghi (mutation) dữ liệu **đã persist** luôn qua `createCoreWorkerClient()` (RPC vào Core Worker). `patchState()` chỉ dùng cho state tạm/UI — không bao giờ dùng để giả lập ghi domain data.

## 3. Component conventions

- `standalone` ngầm định + `changeDetection: OnPush` viết tường minh mọi lần, không dựa vào default.
- `imports: []` theo từng Material module (`MatChipsModule`, `MatFormFieldModule`…), không import gói tổng. CDK ưu tiên trước Material khi chỉ cần overlay/a11y/virtual-scroll thuần (ADR-0016 §Quyết định 3).
- **Trước khi dùng một component Material có icon mặc định** (`MatStepper`, và bất kỳ component nào khác sau này): kiểm tra nó có gọi `<mat-icon>ligature-name</mat-icon>` hay không — dự án không nhúng font Material Symbols/Icons (bất biến #8), ligature sẽ render ra CHỮ THÔ bị cắt cụt, không phải icon vỡ mà là icon KHÔNG CÓ FONT. Override qua cơ chế chính thức của component (vd `<ng-template matStepperIcon="done">` + SVG inline), không cố nhúng font. Phát hiện thật + chi tiết: [ADR-0016 addendum 2026-08-27](../../../docs/adr/0016-angular-material-va-cdk.md#cập-nhật-sau-khi-accepted-2026-08-27-slice-ui-login).
- **`MatStepper [linear]="true"` không hợp với việc lái `selectedIndex`/`completed` bằng binding qua signal** (không `stepControl`) — có race điều kiện thật (Angular set input của `<mat-stepper>` cha trước `<mat-step>` con trong cùng một lượt CD, gate đọc `completed` cũ). Dùng `stepControl` thật (Reactive Forms) nếu cần `linear`, hoặc tắt `linear` và tự chặn điều hướng ngược bằng `[editable]="false"` (không phụ thuộc `linear`). Chi tiết: ADR-0016 addendum ở trên.
- DI qua `inject()`, không dùng constructor param.
- Field visibility: `protected readonly` nếu template chạm tới, `private readonly` nếu chỉ nội bộ dùng — cả `browse.ts`, `player.ts`, `sync-status.ts` đều theo đúng mẫu này.
- Ưu tiên `toSignal`/`toObservable` hơn `.subscribe()` thủ công. Nếu bắt buộc subscribe tay → `takeUntilDestroyed()`.
- `@for` bắt buộc có `track`; `@defer` cho khối nặng (player, ffmpeg.wasm).

## 4. Comment đầu file — convention riêng của repo này

Quy tắc chung của dự án là mặc định không viết comment. Nhưng UI layer đã tự đóng đinh một convention khác, áp dụng nhất quán ở mọi file feature đã có: **mở đầu bằng JSDoc tiếng Việt** nêu slice (`F#.#`), ADR liên quan, và đúng MỘT lý do "tại sao" mà người đọc không tự suy ra được nếu chỉ đọc code (vd lý do một thứ tự gọi hàm bắt buộc, một race condition đã gặp thật). Đây không phải comment thừa — nó *là* phần WHY ở granularity file, phục vụ truy vết provenance khi nhiều slice chồng lên nhau. Giữ convention này, đừng xoá theo luật mặc định chung của dự án.

Không viết comment mô tả WHAT (code đã tự nói), không viết comment nhắc lại tên slice trong thân hàm — chỉ ở đầu file và ở đúng chỗ có quyết định non-obvious (xem ví dụ `PROGRESS_SAVE_INTERVAL_MS`, `SERVICE_WORKER_READY_TIMEOUT_MS` trong `player/player.ts`).

## 5. Ranh giới truy cập dữ liệu

- Đọc: `liveQuery` từ `@tsmc/core-storage`.
- Ghi/RPC: `createCoreWorkerClient()` từ `@tsmc/worker-host`.
- Không component/store nào import `core-mtproto`/`core-download` trực tiếp — `eslint-plugin-boundaries` chặn theo ADR-0012, nhưng đừng thử "tạm tắt rule" để lấy đường tắt; nếu cảm thấy cần import thẳng, đó là dấu hiệu logic đang thuộc về `worker-host`, không phải `apps/web`.

## 6. Routing cho màn hình mới

Hiện trạng: chỉ `/player/:sourceId/:msgId` (`app.routes.ts`) là route lazy thật. Sync/Browse/Index vẫn nhồi phẳng chung trong `login.html` case `'authenticated'` — di sản từ lúc chỉ có 1–2 slice, giờ không kham nổi thêm 4 màn hình mới trong `docs/ux-design.md` (Dashboard/Collections/Source Management/Settings).

**Luật cho màn hình mới:** mọi màn hình cấp cao mới lấy route thật + `loadComponent` lazy, đúng mẫu đã có ở F4:

```ts
{
  path: 'collections',
  loadComponent: () => import('./collections/collections').then((m) => m.Collections)
}
```

Bọc các route màn hình chính trong một `AppShell` (MatSidenav + MatToolbar, theo Màn hình 2 của `docs/ux-design.md`) làm layout route dùng chung, thay vì mỗi feature tự vẽ toolbar riêng.

Không bắt buộc dọn lại Sync/Browse/Index khỏi Login ngay lập tức — migrate sang route thật khi đụng tới màn đó, không phải điều kiện tiên quyết để bắt đầu màn mới.
