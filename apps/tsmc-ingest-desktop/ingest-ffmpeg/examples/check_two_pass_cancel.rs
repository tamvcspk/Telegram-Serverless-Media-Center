//! Verify huỷ 2-pass (ADR-0023 § 4c.2): huỷ giữa pass 1 và giữa pass 2 đều trả `Cancelled`, dọn sạch
//! file thống kê x264 (`<out>.x264stats`, `.mbtree`), và tiến trình gộp hai pass đi tăng đơn điệu.
//!
//! Chạy: `cargo run --release --example check_two_pass_cancel -p ingest-ffmpeg -- <input> <out_dir>`
//! (cần FFMPEG_DIR trỏ tới FFmpeg có x264 và thư mục `bin` của nó trong PATH).

use std::sync::{Arc, Mutex};
use std::time::Instant;

fn leftovers(out_dir: &str) -> Vec<String> {
    std::fs::read_dir(out_dir)
        .expect("read_dir")
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.contains("x264stats"))
        .collect()
}

fn run_cancelled(input: &str, out_dir: &str, label: &str, cancel_when: impl Fn(&ingest_ffmpeg::PipelineProgress, f64) -> bool + Send + Sync + 'static) {
    let out = format!("{out_dir}/{label}.mp4");
    let cancel = ingest_ffmpeg::CancelFlag::new();
    let cancel_in_sink = cancel.clone();
    let began = Instant::now();
    let seen: Arc<Mutex<Vec<f64>>> = Arc::new(Mutex::new(Vec::new()));
    let seen_in_sink = Arc::clone(&seen);
    let sink = move |p: ingest_ffmpeg::PipelineProgress| {
        seen_in_sink.lock().unwrap().push(p.elapsed_sec);
        if cancel_when(&p, began.elapsed().as_secs_f64()) {
            cancel_in_sink.cancel();
        }
    };
    let options = ingest_ffmpeg::ReencodeOptions { target_video_bitrate_bps: Some(1_450_000), two_pass: true, window: Some((0.0, 120.0)), ..Default::default() };
    let result = ingest_ffmpeg::reencode_with_options(input, &out, &options, 120.0, &sink, &cancel);
    let ticks = seen.lock().unwrap().clone();
    let monotonic = ticks.windows(2).all(|w| w[1] >= w[0] - 1e-6);
    println!(
        "{label:>14}: kết quả = {} · {} tick, đơn điệu = {monotonic} · file thống kê còn lại = {:?}",
        match &result {
            Err(ingest_ffmpeg::ProcessError::Cancelled) => "Cancelled (đúng)".to_string(),
            other => format!("SAI: {other:?}"),
        },
        ticks.len(),
        leftovers(out_dir)
    );
    let _ = std::fs::remove_file(&out);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 3 {
        eprintln!("usage: check_two_pass_cancel <input> <out_dir>");
        std::process::exit(2);
    }
    let (input, out_dir) = (args[1].clone(), args[2].clone());
    // Pass 1: huỷ ngay khi đã qua 2 giây (chưa có byte đầu ra nào).
    run_cancelled(&input, &out_dir, "huy-pass-1", |p, wall| p.bytes_written == 0 && wall > 2.0);
    // Pass 2: huỷ khi file đầu ra đã có byte (pass 1 xong).
    run_cancelled(&input, &out_dir, "huy-pass-2", |p, _| p.bytes_written > 0);
}
