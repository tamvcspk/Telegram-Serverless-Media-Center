// Chẩn đoán tối thiểu — quét box top-level của MP4/ISOBMFF trong một cửa sổ
// byte đầu file, để phân biệt "thiếu +faststart (moov ở cuối file)" với các
// nguyên nhân khác gây `MEDIA_ERR_SRC_NOT_SUPPORTED` (SPIKE-01 đã ghi nhận
// rủi ro không +faststart). CHỈ dùng khi debug (`?debug=1`), không chạy
// trong luồng phát bình thường.
export function describeTopLevelBoxes(buffer: ArrayBuffer, maxBoxes = 12): string {
  const view = new DataView(buffer);
  const parts: string[] = [];
  let offset = 0;

  for (let i = 0; i < maxBoxes && offset + 8 <= buffer.byteLength; i++) {
    const size = view.getUint32(offset, false);
    const type = String.fromCharCode(view.getUint8(offset + 4), view.getUint8(offset + 5), view.getUint8(offset + 6), view.getUint8(offset + 7));
    const printable = /^[\x20-\x7e]{4}$/.test(type) ? type : `?${size.toString(16)}`;
    parts.push(`${printable}(${size})`);

    if (size < 8) {
      // size=0 (box chạy tới hết file) hoặc size=1 (64-bit size mở rộng,
      // không đọc thêm trong bản chẩn đoán tối thiểu này) — dừng, không tính
      // được offset box kế tiếp.
      break;
    }
    offset += size;
  }

  return parts.join(' ');
}
