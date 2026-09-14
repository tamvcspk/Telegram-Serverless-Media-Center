//! Tra cứu metadata TMDB (The Movie Database) tại bước Draft — ADR-0019.
//! KHÔNG thuộc `IngestRpc` (không phải RPC MTProto) — cùng tiền lệ
//! `cancel_upload`/`get_current_task` (`upload.rs`): command điều khiển
//! phía client, đăng ký thẳng ở `lib.rs`, không qua trait dùng chung.
//!
//! API key TMDB v3 auth (`api_key` query param), lưu ở app-data
//! (`tmdb_api_key.json`) — CÙNG mô hình `credentials.json` (`commands.rs`),
//! KHÔNG phải `localStorage` (ADR-0011: localStorage tách theo origin
//! webview, khác nhau giữa `cargo tauri dev`/bản release — đã là bug thật
//! ở màn Đăng nhập).
//!
//! Verify bằng API key TMDB thật — ĐẠT 2026-09-13 (xem
//! [docs/changelog.md](../../../docs/changelog.md#2026-09-13--gui-ingest-desktop-verify-tmdb-pr3-bằng-api-key-thật--đạt)),
//! field name response khớp giả định ban đầu. Phân biệt lỗi "key sai" (HTTP
//! 401, `TmdbErrorDto::InvalidKey`) khỏi lỗi mạng khác thêm 2026-09-14 (xem
//! `fetch_tmdb()`).

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::dto::{TmdbErrorDto, TmdbKindDto, TmdbSearchResultDto};

const TMDB_API_BASE: &str = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w92";

fn tmdb_key_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tmdb_api_key.json"))
}

#[derive(serde::Serialize, Deserialize)]
struct TmdbKeyFile {
    api_key: String,
}

/// Đọc nhanh có key hay chưa — KHÔNG trả key ra ngoài, chỉ để Angular quyết
/// định hiện dialog "Nhập TMDB API Key" hay gọi thẳng `tmdb_search` (ADR-0019
/// mục 2: đây là cách "opt-in, mặc định tắt" mà không cần màn Settings).
#[tauri::command]
pub fn tmdb_has_key(app: AppHandle) -> bool {
    tmdb_key_path(&app).map(|p| p.exists()).unwrap_or(false)
}

/// Ghi API key — best-effort, giống `save_credentials`: lỗi ghi không chặn
/// luồng, chỉ mất tiện nghi lần sau (Angular tự retry gọi `tmdb_search`
/// ngay sau khi lưu, không dựa vào giá trị trả về của hàm này).
#[tauri::command]
pub fn tmdb_save_key(app: AppHandle, api_key: String) {
    let Ok(path) = tmdb_key_path(&app) else { return };
    if let Ok(bytes) = serde_json::to_vec_pretty(&TmdbKeyFile { api_key }) {
        let _ = std::fs::write(path, bytes);
    }
}

/// Xoá key đã lưu (màn Cài đặt, nút "Xoá key") — best-effort, không phải lỗi
/// nếu file không tồn tại (đã xoá từ trước, hoặc chưa từng lưu). Trước khi có
/// màn này, cách duy nhất để "xoá key sai" là admin tự tay xoá file ở
/// app-data (xem `describeTmdbError()` phía Angular) — giờ có nút thật.
#[tauri::command]
pub fn tmdb_delete_key(app: AppHandle) {
    if let Ok(path) = tmdb_key_path(&app) {
        let _ = std::fs::remove_file(path);
    }
}

fn load_key(app: &AppHandle) -> Option<String> {
    let path = tmdb_key_path(app).ok()?;
    let bytes = std::fs::read(path).ok()?;
    let file: TmdbKeyFile = serde_json::from_slice(&bytes).ok()?;
    Some(file.api_key)
}

#[derive(Deserialize)]
struct TmdbMovieResult {
    id: i64,
    title: Option<String>,
    release_date: Option<String>,
    poster_path: Option<String>,
}

#[derive(Deserialize)]
struct TmdbTvResult {
    id: i64,
    name: Option<String>,
    first_air_date: Option<String>,
    poster_path: Option<String>,
}

#[derive(Deserialize)]
struct TmdbSearchResponse<T> {
    results: Vec<T>,
}

fn year_from_date(date: &Option<String>) -> Option<i32> {
    date.as_ref().and_then(|d| d.get(0..4)).and_then(|y| y.parse().ok())
}

fn poster_url(path: &Option<String>) -> Option<String> {
    path.as_ref().map(|p| format!("{TMDB_IMAGE_BASE}{p}"))
}

/// TMDB trả `401 Unauthorized` đúng lúc key sai/hết hạn (tài liệu TMDB v3
/// công khai, `status_code: 7 "Invalid API key"`) — kiểm status TRƯỚC khi
/// gọi `error_for_status()` để tách riêng nhánh này thành `InvalidKey`, thay
/// vì rơi chung vào `Network` như mọi lỗi HTTP khác (429 rate limit, 5xx
/// TMDB sập...) hay lỗi mạng thật (DNS/timeout/connection refused, không có
/// response nào để đọc status).
async fn fetch_tmdb<T: serde::de::DeserializeOwned>(url: &str, api_key: &str, query: &str) -> Result<TmdbSearchResponse<T>, TmdbErrorDto> {
    let response = reqwest::Client::new()
        .get(url)
        .query(&[("api_key", api_key), ("query", query)])
        .send()
        .await
        .map_err(|e| TmdbErrorDto::Network(e.to_string()))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(TmdbErrorDto::InvalidKey);
    }
    let response = response.error_for_status().map_err(|e| TmdbErrorDto::Network(e.to_string()))?;
    response.json::<TmdbSearchResponse<T>>().await.map_err(|e| TmdbErrorDto::Other(e.to_string()))
}

/// `kind`: `Episode` → `search/tv`, `Movie` → `search/movie` (ADR-0019 mục
/// 3, tầng gọi tự quyết theo `item.metadata.kind` — không tự suy luận ở
/// đây). Đọc key MỖI LẦN gọi từ file (không cache ở `AppState`) — tần suất
/// gọi thấp (bấm tay từng dòng), đơn giản hơn quản lý vòng đời cache.
#[tauri::command]
pub async fn tmdb_search(app: AppHandle, query: String, kind: TmdbKindDto) -> Result<Vec<TmdbSearchResultDto>, TmdbErrorDto> {
    let api_key = load_key(&app).ok_or(TmdbErrorDto::NoApiKey)?;

    match kind {
        TmdbKindDto::Episode => {
            let resp = fetch_tmdb::<TmdbTvResult>(&format!("{TMDB_API_BASE}/search/tv"), &api_key, &query).await?;
            Ok(resp
                .results
                .into_iter()
                .map(|r| TmdbSearchResultDto { id: r.id, title: r.name.unwrap_or_default(), year: year_from_date(&r.first_air_date), poster_url: poster_url(&r.poster_path) })
                .collect())
        }
        TmdbKindDto::Movie => {
            let resp = fetch_tmdb::<TmdbMovieResult>(&format!("{TMDB_API_BASE}/search/movie"), &api_key, &query).await?;
            Ok(resp
                .results
                .into_iter()
                .map(|r| TmdbSearchResultDto { id: r.id, title: r.title.unwrap_or_default(), year: year_from_date(&r.release_date), poster_url: poster_url(&r.poster_path) })
                .collect())
        }
    }
}
