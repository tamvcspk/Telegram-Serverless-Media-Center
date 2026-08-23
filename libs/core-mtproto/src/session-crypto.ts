// Mã hoá chuỗi session MTProto tại nghỉ — ADR-0011. Key sinh bằng WebCrypto,
// `extractable: false`: một lỗ hổng XSS trong trang đang chạy có thể lợi
// dụng session, nhưng không thể lấy key ra để dùng ở nơi khác.
const AES_GCM = 'AES-GCM';
const IV_LENGTH_BYTES = 12;

export async function generateSessionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: AES_GCM, length: 256 }, false, ['encrypt', 'decrypt']);
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
