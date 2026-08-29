import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const GRADIENTS: readonly string[] = [
  'linear-gradient(135deg, #6a3093, #a044ff)',
  'linear-gradient(135deg, #1f4037, #56ab2f)',
  'linear-gradient(135deg, #c31432, #240b36)',
  'linear-gradient(135deg, #2193b0, #6dd5ed)',
  'linear-gradient(135deg, #cc2b5e, #753a88)',
  'linear-gradient(135deg, #536976, #292e49)',
  'linear-gradient(135deg, #ee0979, #ff6a00)',
  'linear-gradient(135deg, #16222a, #3a6073)'
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * Placeholder poster dùng chung — lần đầu tạo `app/shared/` trong repo (rule-
 * of-three ở ui-conventions §1: Browse card, Collections tile, Collection
 * detail item cùng cần). Chưa có pipeline tải ảnh thật (`MediaRecord.poster`
 * chỉ là `{msgId}` trong catalog, không ai fetch/cache blob), nên tile là
 * gradient + chữ cái đầu — màu suy từ hash của `label` để ổn định qua các
 * lần render (không random mỗi lượt CD) mà không cần lưu state riêng.
 */
@Component({
  selector: 'app-poster-tile',
  templateUrl: './poster-tile.html',
  styleUrl: './poster-tile.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class PosterTile {
  readonly label = input.required<string>();

  protected readonly initial = computed(() => this.label().trim().charAt(0).toUpperCase() || '?');
  protected readonly gradient = computed(() => GRADIENTS[hashString(this.label()) % GRADIENTS.length]);
}
