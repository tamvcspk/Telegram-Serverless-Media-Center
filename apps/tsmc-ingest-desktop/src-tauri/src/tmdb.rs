//! Tra cứu metadata TMDB (The Movie Database) tại bước Draft — ADR-0019.
//! KHÔNG thuộc `IngestRpc` (không phải RPC MTProto) — cùng tiền lệ
//! `cancel_upload`/`get_current_task` (`upload.rs`): command điều khiển
//! phía client, đăng ký thẳng ở `lib.rs`, không qua trait dùng chung.
//!
//! API key TMDB v3 auth (`api_key` query param) — lưu qua `secret_store`
//! (2026-09-14: ưu tiên OS keyring, fallback file `tmdb_api_key.json` ở
//! app-data), CÙNG mô hình `credentials.json` (`commands.rs`), KHÔNG phải
//! `localStorage` (ADR-0011: localStorage tách theo origin webview, khác
//! nhau giữa `cargo tauri dev`/bản release — đã là bug thật ở màn Đăng nhập).
//!
//! Verify bằng API key TMDB thật — ĐẠT 2026-09-13 (xem
//! [docs/changelog.md](../../../docs/changelog.md#2026-09-13--gui-ingest-desktop-verify-tmdb-pr3-bằng-api-key-thật--đạt)),
//! field name response khớp giả định ban đầu. Phân biệt lỗi "key sai" (HTTP
//! 401, `TmdbErrorDto::InvalidKey`) khỏi lỗi mạng khác thêm 2026-09-14 (xem
//! `fetch_tmdb()`).

use serde::Deserialize;
use tauri::{AppHandle, Manager};

use crate::dto::{TmdbDetailsDto, TmdbErrorDto, TmdbKindDto, TmdbSearchResultDto};
use crate::secret_store;

const TMDB_API_BASE: &str = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE: &str = "https://image.tmdb.org/t/p/w92";
/// Cỡ ảnh dùng cho poster THẬT lưu vào kênh (`upload_tmdb_poster`,
/// `upload.rs`) — lớn hơn hẳn `TMDB_IMAGE_BASE` (chỉ dùng cho thumbnail nhỏ
/// trong dialog tìm kiếm). `w500` là cỡ chuẩn TMDB khuyến nghị cho poster
/// hiển thị đầy đủ (tài liệu TMDB v3 công khai), không phải `original` (nặng
/// không cần thiết cho một poster hiển thị trong lưới Browse).
pub const TMDB_IMAGE_BASE_LARGE: &str = "https://image.tmdb.org/t/p/w500";
/// Số diễn viên tối đa lấy vào `cast` — `credits.cast` TMDB trả sẵn theo
/// đúng thứ tự billing (`order` tăng dần), cắt thẳng theo vị trí, không cần
/// tự sắp lại.
const MAX_CAST: usize = 10;

/// "account" trong `secret_store` (namespace riêng với `"credentials"` ở
/// `commands.rs`, cùng `SERVICE` OS keyring) — cũng là tên file FALLBACK nếu
/// keyring không dùng được.
const TMDB_KEY_ACCOUNT: &str = "tmdb_api_key";

/// Đường dẫn file FALLBACK — xem doc comment `credentials_path()`
/// (`commands.rs`) và `secret_store.rs`.
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
/// mục 2: đây là cách "opt-in, mặc định tắt" mà không cần màn Settings —
/// riêng, màn Cài đặt 2026-09-14 thêm LỐI VÀO THỨ HAI, không đổi luồng này).
#[tauri::command]
pub fn tmdb_has_key(app: AppHandle) -> bool {
    load_key(&app).is_some()
}

/// Ghi API key — best-effort, giống `save_credentials`: lỗi ghi không chặn
/// luồng, chỉ mất tiện nghi lần sau (Angular tự retry gọi `tmdb_search`
/// ngay sau khi lưu, không dựa vào giá trị trả về của hàm này). Ưu tiên OS
/// keyring, fallback file — xem `secret_store.rs`.
#[tauri::command]
pub fn tmdb_save_key(app: AppHandle, api_key: String) {
    let Ok(path) = tmdb_key_path(&app) else { return };
    secret_store::save_json(TMDB_KEY_ACCOUNT, &path, &TmdbKeyFile { api_key });
}

/// Xoá key đã lưu (màn Cài đặt, nút "Xoá key") — best-effort, không phải lỗi
/// nếu không có gì để xoá (đã xoá từ trước, hoặc chưa từng lưu). Trước khi có
/// màn này, cách duy nhất để "xoá key sai" là admin tự tay xoá file ở
/// app-data (xem `describeTmdbError()` phía Angular) — giờ có nút thật. Xoá
/// CẢ hai nơi có thể chứa key (keyring lẫn file cũ) — xem `secret_store::delete()`.
#[tauri::command]
pub fn tmdb_delete_key(app: AppHandle) {
    if let Ok(path) = tmdb_key_path(&app) {
        secret_store::delete(TMDB_KEY_ACCOUNT, &path);
    }
}

fn load_key(app: &AppHandle) -> Option<String> {
    let path = tmdb_key_path(app).ok()?;
    let file: TmdbKeyFile = secret_store::load_json(TMDB_KEY_ACCOUNT, &path)?;
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
                .map(|r| TmdbSearchResultDto { id: r.id, title: r.name.unwrap_or_default(), year: year_from_date(&r.first_air_date), poster_url: poster_url(&r.poster_path), poster_path: r.poster_path })
                .collect())
        }
        TmdbKindDto::Movie => {
            let resp = fetch_tmdb::<TmdbMovieResult>(&format!("{TMDB_API_BASE}/search/movie"), &api_key, &query).await?;
            Ok(resp
                .results
                .into_iter()
                .map(|r| TmdbSearchResultDto { id: r.id, title: r.title.unwrap_or_default(), year: year_from_date(&r.release_date), poster_url: poster_url(&r.poster_path), poster_path: r.poster_path })
                .collect())
        }
    }
}

#[derive(Deserialize)]
struct TmdbGenre {
    name: String,
}

#[derive(Deserialize)]
struct TmdbCastMember {
    name: String,
}

#[derive(Deserialize)]
struct TmdbCrewMember {
    name: String,
    job: String,
}

#[derive(Deserialize, Default)]
struct TmdbCredits {
    #[serde(default)]
    cast: Vec<TmdbCastMember>,
    #[serde(default)]
    crew: Vec<TmdbCrewMember>,
}

#[derive(Deserialize)]
struct TmdbCreatedBy {
    name: String,
}

#[derive(Deserialize)]
struct TmdbMovieDetails {
    #[serde(default)]
    genres: Vec<TmdbGenre>,
    credits: Option<TmdbCredits>,
}

#[derive(Deserialize)]
struct TmdbTvDetails {
    #[serde(default)]
    genres: Vec<TmdbGenre>,
    credits: Option<TmdbCredits>,
    #[serde(default)]
    created_by: Vec<TmdbCreatedBy>,
}

/// Đọc chi tiết MỘT object (`/movie/{id}` hay `/tv/{id}`) kèm
/// `append_to_response=credits` — MỘT lệnh gọi HTTP duy nhất trả về CẢ
/// `genres` (tên đầy đủ, khỏi cần cache riêng bảng id→tên) LẪN `credits`
/// (cast/crew), thay vì hai lệnh gọi rời (`/genre/movie/list` +
/// `/{id}/credits`) như cân nhắc ban đầu — tài liệu TMDB v3 công khai xác
/// nhận `append_to_response` áp dụng được cho `credits` ở cả hai endpoint
/// `movie`/`tv`. Khác `fetch_tmdb()` (dùng cho `search/*`, có tham số
/// `query` và trả object bọc trong `{ results: [...] }`) — endpoint details
/// trả THẲNG object, không bọc.
async fn fetch_tmdb_details<T: serde::de::DeserializeOwned>(url: &str, api_key: &str) -> Result<T, TmdbErrorDto> {
    let response = reqwest::Client::new()
        .get(url)
        .query(&[("api_key", api_key), ("append_to_response", "credits")])
        .send()
        .await
        .map_err(|e| TmdbErrorDto::Network(e.to_string()))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(TmdbErrorDto::InvalidKey);
    }
    let response = response.error_for_status().map_err(|e| TmdbErrorDto::Network(e.to_string()))?;
    response.json::<T>().await.map_err(|e| TmdbErrorDto::Other(e.to_string()))
}

/// TMDB nâng cao (genres/cast/director) — nút "Tra TMDB" gọi tiếp SAU khi
/// admin đã chọn một kết quả `tmdb_search()` (cần `id` thật của lựa chọn đó,
/// không suy luận lại từ tên). Không có "credits" riêng cho việc gọi API —
/// gộp cả genres/cast/director vào một lần gọi `fetch_tmdb_details()` (xem
/// doc comment ở đó).
#[tauri::command]
pub async fn tmdb_details(app: AppHandle, id: i64, kind: TmdbKindDto) -> Result<TmdbDetailsDto, TmdbErrorDto> {
    let api_key = load_key(&app).ok_or(TmdbErrorDto::NoApiKey)?;

    match kind {
        TmdbKindDto::Movie => {
            let details: TmdbMovieDetails = fetch_tmdb_details(&format!("{TMDB_API_BASE}/movie/{id}"), &api_key).await?;
            let credits = details.credits.unwrap_or_default();
            Ok(TmdbDetailsDto {
                genres: details.genres.into_iter().map(|g| g.name).collect(),
                cast: credits.cast.into_iter().take(MAX_CAST).map(|c| c.name).collect(),
                director: credits.crew.into_iter().find(|c| c.job == "Director").map(|c| c.name),
            })
        }
        // TMDB không có "director" một người cho cả series — `created_by`
        // (chỉ có ở `/tv/{id}`, KHÔNG có trong `credits`) là tương đương gần
        // nhất. Lấy người ĐẦU TIÊN nếu có nhiều hơn một đồng sáng tác (quyết
        // định brainstorm 2026-09-17 — field `director` trong catalog schema
        // là `string` đơn, không phải mảng).
        TmdbKindDto::Episode => {
            let details: TmdbTvDetails = fetch_tmdb_details(&format!("{TMDB_API_BASE}/tv/{id}"), &api_key).await?;
            let cast = details.credits.map(|c| c.cast.into_iter().take(MAX_CAST).map(|m| m.name).collect()).unwrap_or_default();
            Ok(TmdbDetailsDto {
                genres: details.genres.into_iter().map(|g| g.name).collect(),
                cast,
                director: details.created_by.into_iter().next().map(|c| c.name),
            })
        }
    }
}

#[derive(Deserialize)]
struct TmdbGenreListResponse {
    genres: Vec<TmdbGenre>,
}

/// Danh sách thể loại CHUẨN của TMDB (`/genre/movie/list`/`/genre/tv/list`,
/// ~19/~16 mục, gần như không đổi) — dùng cho picker chip ở dialog "Sửa
/// nâng cao" (bên cạnh nhập tay tự do, brainstorm 2026-09-18: "Picker và
/// nhập tay"). KHÔNG cache phía Rust — payload nhỏ, gọi lại mỗi lần mở
/// dialog đơn giản hơn quản lý vòng đời cache, cùng tinh thần
/// `tmdb_search()` (không cache).
#[tauri::command]
pub async fn tmdb_genre_list(app: AppHandle, kind: TmdbKindDto) -> Result<Vec<String>, TmdbErrorDto> {
    let api_key = load_key(&app).ok_or(TmdbErrorDto::NoApiKey)?;
    let url = match kind {
        TmdbKindDto::Movie => format!("{TMDB_API_BASE}/genre/movie/list"),
        TmdbKindDto::Episode => format!("{TMDB_API_BASE}/genre/tv/list"),
    };
    let response = reqwest::Client::new().get(&url).query(&[("api_key", &api_key)]).send().await.map_err(|e| TmdbErrorDto::Network(e.to_string()))?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED {
        return Err(TmdbErrorDto::InvalidKey);
    }
    let response = response.error_for_status().map_err(|e| TmdbErrorDto::Network(e.to_string()))?;
    let parsed: TmdbGenreListResponse = response.json().await.map_err(|e| TmdbErrorDto::Other(e.to_string()))?;
    Ok(parsed.genres.into_iter().map(|g| g.name).collect())
}
