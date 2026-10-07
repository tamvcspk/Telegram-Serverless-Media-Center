/** `"420 MB"`/`"1.2 GB"` — chỉ hai bậc (MB/GB, decimal 1000-based, khớp
 * `PreflightDialog::gb()` đã dùng `1_000_000_000`) — không cần KB/TB cho kích
 * thước file video thật tế. */
export function formatBytesShort(bytes: number): string {
  if (bytes >= 1_000_000_000) {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  }
  return `${Math.round(bytes / 1_000_000)} MB`;
}
