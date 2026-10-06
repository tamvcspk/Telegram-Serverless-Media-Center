//! Verify `scan_keyframes()`/`split_at()` (Giai đoạn 4, ADR-0022). Chạy:
//! `cargo run --release --example check_split -p ingest-ffmpeg -- <input.mp4> <out_dir> <số_phần>`
//! Chọn điểm cắt THÔ ở đây (keyframe gần nhất mốc chia đều theo byte) chỉ để
//! kiểm cơ chế — thuật toán thật nằm ở TypeScript (`split-plan.ts`). Sau đó đối
//! chiếu bằng `ffprobe`: tổng thời lượng các phần ≈ nguồn, mỗi phần phát được.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: check_split <input.mp4> <out_dir> <parts>");
        std::process::exit(2);
    }
    let (input, out_dir) = (&args[1], &args[2]);
    let parts: usize = args[3].parse().expect("parts");
    let cancel = ingest_ffmpeg::CancelFlag::new();
    let scan = ingest_ffmpeg::scan_keyframes(input, &cancel).expect("scan");
    println!("duration {:.2}s, {} byte packet, {} keyframe sạch", scan.duration_sec, scan.total_packet_bytes, scan.keyframes.len());

    let mut cuts = Vec::new();
    for k in 1..parts {
        let ideal = scan.total_packet_bytes as f64 * k as f64 / parts as f64;
        let best = scan.keyframes.iter().min_by(|a, b| (a.byte_offset as f64 - ideal).abs().partial_cmp(&(b.byte_offset as f64 - ideal).abs()).unwrap()).expect("keyframe");
        println!("  cắt {k}: ideal byte {:.0} -> keyframe {:.3}s @ {} byte", ideal, best.time_sec, best.byte_offset);
        cuts.push(best.time_sec);
    }
    let on_progress = |p: ingest_ffmpeg::PipelineProgress| println!("  tick {:.1}/{:.1}s", p.elapsed_sec, p.duration_sec);
    let paths = ingest_ffmpeg::split_at(input, out_dir, "out", &cuts, scan.duration_sec, &on_progress, &cancel).expect("split");
    let mut total = 0.0;
    for p in &paths {
        let probe = ingest_ffmpeg::probe(p).expect("probe part");
        let size = std::fs::metadata(p).expect("stat").len();
        total += probe.duration_sec;
        println!("{p}: {:.3}s, {size} byte", probe.duration_sec);
    }
    println!("tổng thời lượng các phần {:.3}s (nguồn {:.3}s)", total, scan.duration_sec);
}
