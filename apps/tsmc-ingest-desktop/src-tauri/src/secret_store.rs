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
use serde::{Serialize, de::DeserializeOwned};
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
}
