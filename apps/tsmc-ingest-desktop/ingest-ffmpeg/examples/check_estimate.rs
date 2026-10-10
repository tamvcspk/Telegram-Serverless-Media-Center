//! Verify "ước tính chính xác" THẬT (Giai đoạn 2) — chạy
//! `cargo run --release --example check_estimate -p ingest-ffmpeg -- <input>
//! [target_bps] [max_height] [rf] [maxrate_kbps] [two_pass]`. `rf` > 0 = chế độ CRF + trần
//! VBV (ADR-0023), bỏ qua `target_bps`; `two_pass` = `1` chạy mẫu 2 lượt (§ 4c.2). In từng đoạn thử (dung lượng, độ dài media thật,
//! thời gian tường), rồi so ngoại suy cả file với thực tế nếu muốn đối chiếu
//! (chạy `check_reencode_bitrate` cùng tham số để lấy dung lượng thật).

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: check_estimate <input> [target_bps] [max_height] [rf] [maxrate_kbps] [two_pass]");
        std::process::exit(2);
    }
    let input = &args[1];
    let rf: f32 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(0.0);
    let maxrate_bps: u64 = args.get(5).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0) * 1000;
    let options = ingest_ffmpeg::ReencodeOptions {
        target_video_bitrate_bps: args.get(2).and_then(|s| s.parse().ok()),
        crf: (rf > 0.0).then_some(ingest_ffmpeg::CrfRate { rf, maxrate_bps, bufsize_bits: maxrate_bps * 2 }),
        two_pass: args.get(6).is_some_and(|s| s == "1"),
        max_height: args.get(3).and_then(|s| s.parse().ok()),
        ..Default::default()
    };
    let probe = ingest_ffmpeg::probe(input).expect("probe");
    let work_dir = std::env::temp_dir().join("tsmc-check-estimate");
    std::fs::create_dir_all(&work_dir).expect("tạo thư mục tạm");

    let began = std::time::Instant::now();
    let samples = ingest_ffmpeg::estimate_reencode(input, &options, probe.duration_sec, &work_dir, &ingest_ffmpeg::CancelFlag::new()).expect("estimate_reencode");
    let _ = std::fs::remove_dir_all(&work_dir);

    let (mut bytes, mut media, mut wall) = (0u64, 0f64, 0f64);
    for (i, s) in samples.iter().enumerate() {
        println!("đoạn {i}: {} byte, media {:.2}s, tường {:.2}s ({:.2}x realtime)", s.out_bytes, s.media_sec, s.wall_sec, s.media_sec / s.wall_sec);
        bytes += s.out_bytes;
        media += s.media_sec;
        wall += s.wall_sec;
    }
    println!("ngoại suy cả file ({:.0}s): ~{:.0} byte, tốc độ {:.2}x, ETA ~{:.0}s (tổng thời gian ước tính {:.1}s)", probe.duration_sec, bytes as f64 / media * probe.duration_sec, media / wall, probe.duration_sec / (media / wall), began.elapsed().as_secs_f64());
}
