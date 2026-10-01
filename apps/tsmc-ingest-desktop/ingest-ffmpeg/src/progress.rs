//! Tiến trình + huỷ CỤC BỘ cho remux()/reencode_to_mp4() — KHÔNG dùng lại
//! ingest_rpc_trait::{CancelFlag, ProgressSink} dù hình dạng gần giống hệt,
//! cố ý giữ crate này không phụ thuộc ingest-rpc-trait (crate đó khai "hợp
//! đồng RPC MTProto", ingest-ffmpeg không đụng MTProto/async) — xem doc
//! comment lib.rs. Trùng lặp ~15 dòng có chủ đích, cùng tinh thần đã áp dụng
//! ở remux.rs/reencode.rs (audio encoder setup lặp lại giữa hai file).

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Clone, Default)]
pub struct CancelFlag(Arc<AtomicBool>);

impl CancelFlag {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}

/// Một tick tiến trình THÔ — không có %/speed/ETA (suy luận đó là luật
/// nghiệp vụ, để tầng gọi tự tính, cùng tinh thần probe() không tự phân
/// hạng A/B/C/D).
#[derive(Debug, Clone, Copy)]
pub struct PipelineProgress {
    pub elapsed_sec: f64,
    pub duration_sec: f64,
    pub bytes_written: u64,
}

pub type PipelineProgressSink<'a> = &'a (dyn Fn(PipelineProgress) + Send + Sync);

const TICK_THROTTLE: Duration = Duration::from_millis(250);

/// Gọi ở MỖI packet/frame (rẻ — chỉ so `Instant`), nhưng chỉ thật sự bắn
/// callback + `stat()` file output khi đã qua throttle window — tránh gọi
/// progress() hàng nghìn lần/giây như `decoder.receive_frame()` có thể sinh
/// ra. Khác `upload_video()` gốc (KHÔNG throttle, dựa vào cỡ part 512 KiB tự
/// giới hạn tần suất) — granularity per-frame ở đây cao hơn hẳn, cần throttle
/// tường minh (gap thật của pattern gốc, không phải sao chép mù).
pub(crate) fn maybe_tick(last_emit: &mut Instant, elapsed_sec: f64, duration_sec: f64, output_path: &str, progress: PipelineProgressSink<'_>) {
    let now = Instant::now();
    if now.duration_since(*last_emit) < TICK_THROTTLE {
        return;
    }
    *last_emit = now;
    let bytes_written = std::fs::metadata(output_path).map(|m| m.len()).unwrap_or(0);
    progress(PipelineProgress { elapsed_sec, duration_sec, bytes_written });
}
