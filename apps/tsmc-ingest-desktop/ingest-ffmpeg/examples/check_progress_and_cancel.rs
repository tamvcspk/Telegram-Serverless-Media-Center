//! Verify progress tick + cancel THẬT của remux()/reencode_to_mp4() — chạy
//! `cargo run --release --example check_progress_and_cancel -p ingest-ffmpeg
//! -- <input> <out.mp4> <cancel_after_ms|0> [remux|reencode]`.
//! `cancel_after_ms=0` = không huỷ (chạy hết, in mọi tick — soát cadence
//! throttle ~250ms và số liệu có hợp lý); `>0` = spawn thread gọi cancel()
//! sau N ms, verify hàm trả `Err(ProcessError::Cancelled)` nhanh, KHÔNG
//! treo/segfault. Mặc định chạy `reencode_to_mp4` (Hạng D, nơi cần progress
//! thật nhất — remux() nhanh tới mức progress gần như nhảy thẳng 0→100%).

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("usage: check_progress_and_cancel <input> <out.mp4> <cancel_after_ms|0> [remux|reencode]");
        std::process::exit(2);
    }
    let (input, out, cancel_after_ms) = (&args[1], &args[2], args[3].parse::<u64>().expect("cancel_after_ms phải là số"));
    let mode = args.get(4).map(String::as_str).unwrap_or("reencode");

    let probe = ingest_ffmpeg::probe(input).expect("probe");
    let cancel = ingest_ffmpeg::CancelFlag::new();
    if cancel_after_ms > 0 {
        let c = cancel.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(cancel_after_ms));
            println!(">>> gọi cancel() sau {cancel_after_ms}ms");
            c.cancel();
        });
    }

    let start = std::time::Instant::now();
    let on_progress = move |p: ingest_ffmpeg::PipelineProgress| {
        println!("t={:.1}s  elapsed={:.1}/{:.1}s  bytes_written={}", start.elapsed().as_secs_f64(), p.elapsed_sec, p.duration_sec, p.bytes_written);
    };

    let result = match mode {
        "remux" => ingest_ffmpeg::remux(input, out, true, probe.duration_sec, &on_progress, &cancel),
        "reencode" => ingest_ffmpeg::reencode_to_mp4(input, out, None, probe.duration_sec, &on_progress, &cancel),
        other => {
            eprintln!("mode không hợp lệ: {other} (chỉ 'remux' hoặc 'reencode')");
            std::process::exit(2);
        }
    };
    println!("result = {result:?}");
    println!("wall time = {:.1}s", start.elapsed().as_secs_f64());
}
