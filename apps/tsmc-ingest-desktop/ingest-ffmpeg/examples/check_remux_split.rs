//! Tái hiện đúng đường của app: `remux()` (stream-copy) rồi `scan_keyframes()` + `split_at()` trên bản remux.
//! Chạy: `cargo run --release --example check_remux_split -p ingest-ffmpeg -- <input> <out_dir> <số_phần>`
//! Lỗi thật 2026-10-07 (Tokyo Hot n1313.mp4): "non monotonically increasing dts to muxer in stream 1: -18 >= -18".

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: check_remux_split <input> <out_dir> <parts>");
        std::process::exit(2);
    }
    let (input, out_dir) = (&args[1], &args[2]);
    let parts: usize = args[3].parse().expect("parts");
    let cancel = ingest_ffmpeg::CancelFlag::new();
    let duration = ingest_ffmpeg::probe(input).expect("probe").duration_sec;
    let remuxed = format!("{out_dir}/remuxed.mp4");
    let noop = |_: ingest_ffmpeg::PipelineProgress| {};
    ingest_ffmpeg::remux(input, &remuxed, false, duration, &noop, &cancel).expect("remux");
    let scan = ingest_ffmpeg::scan_keyframes(&remuxed, &cancel).expect("scan");
    let mut cuts = Vec::new();
    for k in 1..parts {
        let ideal = scan.total_packet_bytes as f64 * k as f64 / parts as f64;
        let best = scan.keyframes.iter().min_by(|a, b| (a.byte_offset as f64 - ideal).abs().partial_cmp(&(b.byte_offset as f64 - ideal).abs()).unwrap()).expect("keyframe");
        cuts.push(best.time_sec);
    }
    match ingest_ffmpeg::split_at(&remuxed, out_dir, "rs", &cuts, scan.duration_sec, &noop, &cancel) {
        Ok(paths) => println!("OK {} phần", paths.len()),
        Err(e) => println!("LỖI split_at: {e}"),
    }
}
