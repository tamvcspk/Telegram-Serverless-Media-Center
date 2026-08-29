import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import type { MediaRecord } from '@tsmc/core-storage';
import { PosterTile } from '../../shared/poster-tile/poster-tile';

/**
 * Card lưới kiểu Netflix cho một phim (Màn hình 2) — chỉ hiển thị, không còn
 * nút hành động riêng (thêm-vào-BST/sửa-metadata đã dời vào `ItemDetailSheet`
 * mở khi `open` phát ra, xem browse.ts `onCardOpen`) vì card giờ quá nhỏ để
 * chứa icon-button mà vẫn chạm đủ lớn cho ngón tay.
 *
 * Chiều cao mỗi phần tử (poster/title/meta/badge) trong `media-card.scss` là
 * SỐ CỐ ĐỊNH (không phải auto) — `cdk-virtual-scroll-viewport[itemSize]` ở
 * browse.ts cần chiều cao 1 hàng grid biết trước, không đổi theo nội dung.
 * `.trust-badge` vì vậy luôn render (không `@if`), chỉ ẩn bằng `visibility`
 * khi không có trust cần cảnh báo — xoá khỏi DOM sẽ làm card đó lùn hơn card
 * khác cùng hàng, phá vỡ giả định chiều cao cố định.
 */
@Component({
  selector: 'app-media-card',
  imports: [PosterTile],
  templateUrl: './media-card.html',
  styleUrl: './media-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MediaCard {
  readonly row = input.required<MediaRecord>();
  readonly open = output<void>();
}
