//! "Ước tính chính xác" cho bước tiền kiểm (Giai đoạn 2, ADR-0017 § addendum
//! 2026-09-19): encode thử vài đoạn ngắn bằng ĐÚNG tham số sẽ dùng thật, đo
//! dung lượng đầu ra và tốc độ — cần vì actual/target dao động 0.3x-3x tuỳ nội
//! dung và `h264_mf` có mức sàn theo nội dung (SPIKE-11). Crate này chỉ ĐO và
//! trả số thô; ngoại suy ra dung lượng/ETA cả file là việc của TS
//! (`estimateFromSamples()`, điều kiện bắt buộc #4).

use std::path::Path;
use std::time::Instant;

use crate::progress::{CancelFlag, PipelineProgress};
use crate::reencode::{reencode_with_options, ReencodeOptions};
use crate::{probe, ProcessError};

/// Độ dài mỗi đoạn thử (giây).
const SAMPLE_LEN_SEC: f64 = 8.0;
/// Vị trí các đoạn thử theo tỉ lệ thời lượng — tránh đầu/cuối (logo, credit
/// thường nhẹ hơn nội dung chính).
const SAMPLE_POSITIONS: [f64; 3] = [0.2, 0.5, 0.8];

#[derive(Debug, Clone, Copy)]
pub struct EstimateSample {
    pub out_bytes: u64,
    /// Độ dài media THẬT của đoạn đầu ra (đọc lại bằng `probe`) — có thể dài
    /// hơn `SAMPLE_LEN_SEC` một chút vì seek lùi về keyframe.
    pub media_sec: f64,
    pub wall_sec: f64,
}

/// Điểm bắt đầu các đoạn thử cho video dài `duration_sec`. Video ngắn tới mức
/// ba đoạn chồng nhau (< 3 đoạn + khoảng cách) chỉ thử MỘT đoạn từ đầu.
fn sample_starts(duration_sec: f64) -> Vec<f64> {
    if duration_sec.is_nan() || duration_sec <= SAMPLE_LEN_SEC * 4.0 {
        return vec![0.0];
    }
    SAMPLE_POSITIONS.iter().map(|p| (duration_sec * p).min(duration_sec - SAMPLE_LEN_SEC).max(0.0)).collect()
}

/// Timestamp đầu ra KHÔNG được rebase về 0 (pts giữ nguyên theo nguồn) nên
/// `probe().duration_sec` là điểm KẾT THÚC trên timeline gốc (≈ `start` + 8s),
/// không phải độ dài đoạn — phát hiện thật 2026-10-02: đoạn 3 báo 4252s thay vì
/// 8s, ước tính dung lượng nhỏ đi hàng trăm lần. Trừ `start` để ra độ dài thật;
/// kết quả không hợp lệ (≤ 0, NaN) → rơi về `SAMPLE_LEN_SEC`.
fn sample_media_sec(end_sec: f64, start: f64) -> f64 {
    let len = end_sec - start;
    if len.is_finite() && len > 0.0 { len } else { SAMPLE_LEN_SEC }
}

/// `options.window` bị ghi đè cho từng đoạn. File tạm ghi vào `work_dir` (tầng
/// gọi tạo + dọn thư mục này) và được xoá ngay sau khi đo.
pub fn estimate_reencode(input_path: &str, options: &ReencodeOptions, duration_sec: f64, work_dir: &Path, cancel: &CancelFlag) -> Result<Vec<EstimateSample>, ProcessError> {
    let noop = |_: PipelineProgress| {};
    let mut samples = Vec::new();
    for (i, start) in sample_starts(duration_sec).into_iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(ProcessError::Cancelled);
        }
        let out_path = work_dir.join(format!("estimate-{i}.mp4"));
        let out_str = out_path.to_string_lossy().into_owned();
        let sample_options = ReencodeOptions { window: Some((start, SAMPLE_LEN_SEC)), ..options.clone() };

        let began = Instant::now();
        let result = reencode_with_options(input_path, &out_str, &sample_options, SAMPLE_LEN_SEC, &noop, cancel);
        let wall_sec = began.elapsed().as_secs_f64();
        let measured = result.and_then(|()| {
            let out_bytes = std::fs::metadata(&out_path).map(|m| m.len()).map_err(|_| ProcessError::Ffmpeg(ffmpeg_next::Error::Unknown))?;
            let end_sec = probe(&out_str).map(|p| p.duration_sec).unwrap_or(start + SAMPLE_LEN_SEC);
            Ok(EstimateSample { out_bytes, media_sec: sample_media_sec(end_sec, start), wall_sec })
        });
        let _ = std::fs::remove_file(&out_path);
        samples.push(measured?);
    }
    Ok(samples)
}

#[cfg(test)]
mod tests {
    use super::{sample_media_sec, sample_starts};

    #[test]
    fn media_sec_subtracts_window_start() {
        assert!((sample_media_sec(1069.04, 1061.2) - 7.84).abs() < 1e-9);
        assert!((sample_media_sec(8.1, 0.0) - 8.1).abs() < 1e-9);
    }

    #[test]
    fn media_sec_invalid_falls_back_to_sample_len() {
        assert_eq!(sample_media_sec(0.0, 1061.0), 8.0);
        assert_eq!(sample_media_sec(f64::NAN, 0.0), 8.0);
    }

    #[test]
    fn short_video_single_sample_from_start() {
        assert_eq!(sample_starts(20.0), vec![0.0]);
    }

    #[test]
    fn long_video_three_samples_inside_bounds() {
        let starts = sample_starts(3600.0);
        assert_eq!(starts.len(), 3);
        assert!((starts[0] - 720.0).abs() < 1e-9);
        assert!((starts[1] - 1800.0).abs() < 1e-9);
        assert!((starts[2] - 2880.0).abs() < 1e-9);
    }

    #[test]
    fn last_sample_never_overruns_end() {
        let starts = sample_starts(40.0);
        assert!(starts.iter().all(|s| s + 8.0 <= 40.0));
    }
}
