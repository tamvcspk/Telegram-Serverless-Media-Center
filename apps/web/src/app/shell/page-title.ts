import { signal } from '@angular/core';

/**
 * Ghi đè tiêu đề toolbar chung (`MainShell`) cho trang có tên chỉ biết được
 * sau khi dữ liệu resolve (vd Collection detail — tên bộ sưu tập) — 3 tab
 * tĩnh (Browse/Collections/Sources) dùng `data.title` khai ở app.routes.ts,
 * không cần signal này. Component con set giá trị lúc tên đã có, PHẢI reset
 * về `null` ở `DestroyRef.onDestroy()` để không rò rỉ sang trang kế tiếp
 * trước khi `NavigationEnd` của trang đó kịp cập nhật title mặc định.
 */
export const pageTitleOverride = signal<string | null>(null);
