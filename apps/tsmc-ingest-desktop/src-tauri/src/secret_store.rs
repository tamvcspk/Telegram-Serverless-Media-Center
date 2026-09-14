//! Lưu bí mật nhỏ (`credentials.json`, `tmdb_api_key.json`) ưu tiên qua OS
//! keyring (Windows Credential Manager — feature `windows-native` là backend
//! DUY NHẤT bật, khớp thực tế app này hiện chỉ build/verify trên Windows, xem
//! README.md), **fallback về file JSON plaintext ở app-data nếu keyring
//! không dùng được** — quyết định user 2026-09-14 (ưu tiên bảo mật hơn
//! plaintext cũ, nhưng không được để app "không lưu được gì" chỉ vì máy
//! không có Credential Manager khả dụng, vd chạy trong môi trường hạn chế).
//!
//! Đây là module DUY NHẤT gọi crate `keyring` trong app này — `commands.rs`
//! (credentials đăng nhập) và `tmdb.rs` (TMDB API key) chỉ gọi qua các hàm
//! dưới, không tự dựng `keyring::Entry` rời rạc (cùng tinh thần
//! "TelegramGateway"/`ingest-rpc.ts` — một cổng vào cho một mối quan tâm).
//!
//! **Không có bước di trú (migration) ép buộc:** nếu máy ĐANG có sẵn file
//! plaintext cũ (bản trước slice này) và keyring giờ hoạt động, lần GHI kế
//! tiếp (`save_json()`) tự chuyển sang keyring VÀ xoá file plaintext cũ —
//! không cần user làm gì thêm, không cần code di trú một lần chạy riêng. Lần
//! ĐỌC (`load_json()`) luôn thử keyring TRƯỚC, rơi về file nếu không thấy —
//! bao phủ cả trường hợp chưa từng ghi qua keyring (cài lần đầu, hoặc keyring
//! không khả dụng).
//!
//! **Vì sao KHÔNG bọc lỗi keyring ra ngoài:** mọi lỗi từ `keyring::Error`
//! (không tìm thấy entry, backend không khả dụng, quyền truy cập bị từ chối)
//! đều coi là "keyring không dùng được lúc này" — rơi thẳng về đường file,
//! không phải điều kiện chặn luồng (best-effort, cùng triết lý
//! `save_credentials()`/`tmdb_save_key()` trước khi có module này: lỗi lưu
//! chỉ mất tiện nghi lần sau, không được phép chặn đăng nhập/tra cứu).

use keyring::Entry;
use rand::RngCore;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::path::Path;

/// Cùng namespace với `identifier` ở `tauri.conf.json` — Windows Credential
/// Manager nhóm các entry bằng `service`, "account" (tham số `key` của các
/// hàm dưới) phân biệt `credentials`/`tmdb_api_key` trong CÙNG service.
const SERVICE: &str = "com.tsmc.ingestdesktop";

fn entry(key: &str) -> Option<Entry> {
    Entry::new(SERVICE, key).ok()
}

/// Ghi `value` (serialize JSON, cùng format file cũ) — thử keyring trước; nếu
/// thành công, DỌN LUÔN file plaintext cũ ở `path` nếu còn sót lại (không để
/// hai bản sao của cùng một bí mật tồn tại song song). Thất bại (backend
/// không khả dụng, lỗi quyền...) → rơi về ghi file `path` y như trước khi có
/// module này.
pub fn save_json<T: Serialize>(key: &str, path: &Path, value: &T) {
    let Ok(bytes) = serde_json::to_vec(value) else { return };
    let Ok(text) = String::from_utf8(bytes.clone()) else { return };

    if let Some(e) = entry(key) {
        if e.set_password(&text).is_ok() {
            let _ = std::fs::remove_file(path);
            return;
        }
    }
    let _ = std::fs::write(path, bytes);
}

/// Đọc lại — thử keyring trước, rơi về file `path` nếu không thấy/lỗi. `None`
/// nếu KHÔNG có ở cả hai nơi (chưa từng lưu, hoặc file hỏng/thiếu) — coi như
/// chưa có gì, không phải lỗi cần báo (best-effort, giữ nguyên hành vi cũ).
pub fn load_json<T: DeserializeOwned>(key: &str, path: &Path) -> Option<T> {
    let raw: Vec<u8> = match entry(key).and_then(|e| e.get_password().ok()) {
        Some(text) => text.into_bytes(),
        None => std::fs::read(path).ok()?,
    };
    serde_json::from_slice(&raw).ok()
}

/// Xoá cả hai nơi có thể chứa bí mật — dùng cho nút "Xoá key" (màn Cài đặt).
/// Best-effort ở cả hai bước, không throw nếu một trong hai (hoặc cả hai)
/// không tồn tại.
pub fn delete(key: &str, path: &Path) {
    if let Some(e) = entry(key) {
        let _ = e.delete_credential();
    }
    let _ = std::fs::remove_file(path);
}

#[derive(Serialize, Deserialize)]
struct RawKey {
    /// `Vec<u8>` serialize thành mảng số JSON (`[1,2,3,...]`) qua serde mặc
    /// định — KHÔNG cần thêm dependency base64 chỉ để mã hoá một field.
    bytes: Vec<u8>,
}

/// Đọc key mã hoá `session.sqlite3` đã lưu (ADR-0021), hoặc SINH MỚI
/// `len` byte ngẫu nhiên bằng CSPRNG (`rand::rngs::OsRng`) nếu chưa có — lưu
/// lại NGAY qua `save_json()` (keyring ưu tiên, fallback file, cùng cơ chế
/// `credentials.json`/`tmdb_api_key.json`) để lần gọi sau đọc lại ĐÚNG key
/// này. Khác `save_json()`/`load_json()` ở trên (những hàm đó cần giá trị
/// SẴN CÓ để ghi) — hàm này tự sinh nếu chưa từng có, vì key mã hoá session
/// không tồn tại trước lần chạy đầu tiên (không giống credential người dùng
/// tự nhập).
///
/// **Độ dài SAI (file hỏng, hoặc đổi `len` giữa các bản sau này) coi như
/// CHƯA CÓ** — sinh key MỚI thay vì dùng key cũ méo mó. Hệ quả: nếu từng có
/// `session.sqlite3` mã hoá bằng key CŨ, đổi `len` sẽ khiến session đó không
/// mở lại được (không phải mất dữ liệu — DB vẫn còn nguyên, chỉ không đọc
/// được nếu không có key cũ) — KHÔNG đổi `len` sau khi đã phát hành trừ khi
/// chấp nhận đánh đổi này.
pub fn load_or_generate_key(key: &str, path: &Path, len: usize) -> Vec<u8> {
    if let Some(existing) = load_json::<RawKey>(key, path) {
        if existing.bytes.len() == len {
            return existing.bytes;
        }
    }
    let mut raw = vec![0u8; len];
    rand::rngs::OsRng.fill_bytes(&mut raw);
    save_json(key, path, &RawKey { bytes: raw.clone() });
    raw
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Debug, Serialize, Deserialize, PartialEq)]
    struct Sample {
        value: String,
    }

    /// Roundtrip THẬT qua Windows Credential Manager (không giả lập) — an
    /// toàn để tự chạy (không đụng MTProto/tài khoản Telegram, chỉ là một
    /// entry Credential Manager cục bộ, tự dọn bằng `delete()` ở cuối test dù
    /// pass hay fail nhờ đứng trước assert). `#[ignore]` vì phụ thuộc backend
    /// OS thật (CI không có Credential Manager khả dụng thì bỏ qua) — chạy
    /// tay bằng `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn keyring_roundtrip_writes_and_reads_back_without_touching_fallback_file() {
        let key = "test_secret_store_roundtrip";
        let dir = std::env::temp_dir();
        let path = dir.join("tsmc-secret-store-test.json");
        delete(key, &path); // dọn tàn dư lần chạy trước, nếu có

        save_json(key, &path, &Sample { value: "hello".into() });
        assert!(!path.exists(), "keyring dùng được thì KHÔNG được để lại file fallback");

        let loaded: Option<Sample> = load_json(key, &path);
        assert_eq!(loaded, Some(Sample { value: "hello".into() }));

        delete(key, &path);
        assert_eq!(load_json::<Sample>(key, &path), None);
    }

    /// Cùng an toàn để tự chạy — key mã hoá `session.sqlite3` (ADR-0021),
    /// KHÔNG đụng MTProto/tài khoản Telegram, chỉ là entry Credential
    /// Manager cục bộ. Xác nhận: sinh MỘT LẦN, gọi lại đọc ĐÚNG key cũ
    /// (không sinh mới mỗi lần), đúng độ dài yêu cầu, và không lộ ra file
    /// plaintext khi keyring dùng được.
    #[test]
    #[ignore]
    fn load_or_generate_key_is_stable_across_calls() {
        let key = "test_session_encryption_key";
        let dir = std::env::temp_dir();
        let path = dir.join("tsmc-secret-store-key-test.json");
        delete(key, &path);

        let first = load_or_generate_key(key, &path, 32);
        assert_eq!(first.len(), 32);
        assert!(!path.exists(), "keyring dùng được thì KHÔNG được để lại file fallback");

        let second = load_or_generate_key(key, &path, 32);
        assert_eq!(first, second, "gọi lại phải trả ĐÚNG key cũ, không sinh key mới");

        delete(key, &path);
    }
}
