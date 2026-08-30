// Mã hoá chuỗi session MTProto tại nghỉ — ADR-0011. Key sinh bằng WebCrypto,
// `extractable: false`: một lỗ hổng XSS trong trang đang chạy có thể lợi
// dụng session, nhưng không thể lấy key ra để dùng ở nơi khác.
const AES_GCM = 'AES-GCM';
const IV_LENGTH_BYTES = 12;

/**
 * `extractable: false` mặc định (bảo vệ khỏi XSS đọc trộm key trong cùng
 * trang — đúng cho trình duyệt, nơi IndexedDB giữ nguyên object CryptoKey
 * qua structured clone giữa các lần tải trang). CLI (tsmc-ingest) không có
 * cơ chế tương đương — mỗi lần chạy là một tiến trình Node MỚI, phải tự
 * export/import key bytes để ghi ra file cục bộ, nên cần `extractable: true`
 * ở đó. Mối đe doạ cũng khác: một tiến trình Node cục bộ đã đọc được file
 * key thì đằng nào cũng đọc được ciphertext cùng chỗ — extractable không
 * mở thêm bề mặt tấn công thật nào trong ngữ cảnh CLI.
 */
export async function generateSessionKey(extractable = false): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, extractable, ['encrypt', 'decrypt']);
}

export async function encryptSessionString(
  key: CryptoKey,
  plaintext: string
): Promise<{ iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const ciphertext = await crypto.subtle.encrypt({ name: AES_GCM, iv }, key, new TextEncoder().encode(plaintext));
  return { iv, ciphertext };
}

export async function decryptSessionString(
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  ciphertext: ArrayBuffer
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt({ name: AES_GCM, iv }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}
