//! Command đọc file cục bộ cho màn workspace ba vùng (A.3, docs/ux-design.md
//! § Phụ lục A) — kéo thả file/folder rồi probe bằng `ingest-ffmpeg` (native
//! FFI, không cần cài ffmpeg lên máy, xem doc comment
//! `ingest-ffmpeg/src/lib.rs`). KHÔNG đụng `AppState`/`IngestRpc` — probe
//! không liên quan MTProto, chạy được cả trước khi đăng nhập.

use crate::dto::{IngestRpcErrorDto, ProbeResultDto};

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "avi", "mov", "webm", "ts", "m4v", "wmv", "flv", "mpg", "mpeg", "m2ts"];

fn has_video_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| VIDEO_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
}

fn collect_media_files(path: &std::path::Path, out: &mut Vec<String>) -> std::io::Result<()> {
    if path.is_dir() {
        for entry in std::fs::read_dir(path)? {
            collect_media_files(&entry?.path(), out)?;
        }
    } else if has_video_extension(path) {
        out.push(path.to_string_lossy().into_owned());
    }
    Ok(())
}

/// Nhận danh sách đường dẫn vừa kéo thả (file HOẶC folder trộn lẫn) — mở rộng
/// mỗi folder thành các file video bên trong nó (đệ quy, khớp mockup A.5
/// "kéo nguyên folder vào... tự gom theo series/season"), giữ nguyên file lẻ
/// đã là video. Sắp xếp kết quả — thứ tự OS trả về lúc thả KHÔNG đáng tin
/// (một số trình quản lý file/webview trả ngẫu nhiên), trong khi tên file là
/// thứ user mong đợi thấy theo thứ tự tự nhiên (S01E01 trước S01E02).
#[tauri::command]
pub fn list_media_files(paths: Vec<String>) -> Result<Vec<String>, IngestRpcErrorDto> {
    let mut result = Vec::new();
    for raw in paths {
        collect_media_files(std::path::Path::new(&raw), &mut result).map_err(|e| IngestRpcErrorDto::other(e.to_string()))?;
    }
    result.sort();
    result.dedup();
    Ok(result)
}

/// Liệt kê TÊN FILE (không phải đường dẫn đầy đủ) trong một thư mục — dùng
/// để tìm phụ đề NGOÀI đặt cạnh video (quy ước Plex/Jellyfin/Kodi, xem
/// `matchSidecarSubtitles()` ở `@tsmc/core-ingest` — logic so khớp tên file
/// là THUẦN/TypeScript, command này chỉ làm I/O đọc thư mục, giống hệt ranh
/// giới `apps/tsmc-ingest/src/sidecar-subtitles.ts::findSidecarSubtitles()`
/// đã làm cho CLI). Trả rỗng nếu thư mục không đọc được (best-effort — thiếu
/// phụ đề ngoài không phải lỗi chặn cả pipeline upload).
#[tauri::command]
pub fn list_dir_entries(dir_path: String) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(dir_path) else {
        return Vec::new();
    };
    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect()
}

/// Probe MỘT file — lỗi trả về cho ĐÚNG FILE ĐÓ (không phải cho cả batch),
/// khớp nguyên tắc "Pipeline FFmpeg crash: file đó đánh dấu Lỗi, batch chạy
/// tiếp" (mockup A.5, bảng đường hỏng) — UI gọi lệnh này riêng cho từng file
/// trong hàng đợi, không gộp thành một lệnh nhận cả mảng khiến một file hỏng
/// chặn kết quả của những file lành.
#[tauri::command]
pub fn probe_media(path: String) -> Result<ProbeResultDto, IngestRpcErrorDto> {
    ingest_ffmpeg::probe(&path).map(ProbeResultDto::from).map_err(|e| IngestRpcErrorDto::other(e.to_string()))
}
