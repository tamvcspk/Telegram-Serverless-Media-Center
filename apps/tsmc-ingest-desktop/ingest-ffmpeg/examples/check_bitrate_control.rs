//! SPIKE-11 (docs/spikes/README.md) — kiểm tra THẬT (không suy đoán) encoder
//! H264 thật của app này (`h264_mf`, xác nhận bằng `check_h264_encoder`
//! example) có tôn trọng `set_bit_rate()` hay bỏ qua thầm lặng giống hệt case
//! đã phát hiện với option `preset` (AVOption riêng của `libx264`, `h264_mf`
//! không hiểu — xem doc comment đầu `reencode.rs`). Khác `preset`,
//! `set_bit_rate()` gán THẲNG field `AVCodecContext.bit_rate` (không qua
//! AVOption dictionary nào) — về lý thuyết mọi encoder hỗ trợ rate control
//! đều đọc field này, nhưng đây là suy đoán chưa đo, đúng tinh thần "phải đo
//! trước khi tin" của kỷ luật spike ở project này (đã từng sai một lần với
//! `preset`).
//!
//! Đây là điều kiện tiên quyết trước khi code Option C (docs/roadmap.md §
//! Ingest, "chuẩn hoá dung lượng vượt trần upload") — nếu `bit_rate` cũng bị
//! bỏ qua, công thức `target_video_bitrate = (target_size_bytes*8/
//! duration_sec) - audio_bitrate - overhead_mux` sẽ vô nghĩa vì encoder thật
//! không đọc số đó.
//!
//! **Phương pháp:** encode CÙNG một nội dung tổng hợp (gradient chéo di
//! chuyển theo frame — đủ chi tiết không gian/thời gian để buộc encoder phải
//! thật sự làm việc, không quá ngẫu nhiên tới mức không nén được ở MỌI mức
//! bitrate) ở ba mức `bit_rate` yêu cầu cách xa nhau (200 kbps / 1500 kbps /
//! 8000 kbps, chênh 40x giữa thấp nhất/cao nhất), rồi CỘNG DỒN byte thật của
//! mọi packet trả về từ `receive_packet()` — không mux ra file, không cần
//! `ffprobe` đọc lại, số byte packet thật LÀ số đo trực tiếp không qua trung
//! gian nào. Nếu `h264_mf` tôn trọng field này, kích thước output phải tăng
//! đơn điệu theo bitrate yêu cầu và xấp xỉ cùng bậc độ lớn với target; nếu bỏ
//! qua, cả ba mức sẽ ra kích thước gần như nhau (encoder dùng một mức chất
//! lượng/bitrate mặc định ẩn nào đó, không phải số vừa set).
//!
//! Chạy: `cargo run --release --example check_bitrate_control -p ingest-ffmpeg`
//! (cần `FFMPEG_DIR` như build bình thường — xem README build của app này).

use ffmpeg_next::{self as ffmpeg, codec, encoder, format::Pixel, frame};

const WIDTH: u32 = 640;
const HEIGHT: u32 = 360;
const FPS: i32 = 25;
const DURATION_SEC: i64 = 5;
const NUM_FRAMES: i64 = FPS as i64 * DURATION_SEC;

/// Xorshift64 tối giản — chỉ cần sinh nhiễu tất định (không cần chất lượng
/// ngẫu nhiên mật mã), tránh thêm dependency `rand` cho một example dùng một
/// lần rồi bỏ.
struct Xorshift64(u64);

impl Xorshift64 {
    fn next_u8(&mut self) -> u8 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        (self.0 & 0xff) as u8
    }
}

/// **Hai nội dung tổng hợp đã thử TRƯỚC bản này, cả hai đều KHÔNG kết luận
/// được** (xem "Phạm vi bằng chứng" trong SPIKE-11 — giữ lại làm bài học,
/// không xoá):
/// 1. Gradient chéo mượt (`row+col+frame_idx*3`) — MID/HIGH ra kích thước
///    gần như TRÙNG byte-cho-byte bất kể target chênh 5.3x. Không phân biệt
///    được "encoder bỏ qua bit_rate" với "nội dung quá mượt nên đã gần
///    lossless ngay ở QP thấp, không còn chỗ dùng thêm bit dù được phép".
/// 2. Nhiễu ngẫu nhiên thuần mỗi pixel (`Xorshift64`, hàm `next_u8()` vẫn giữ
///    lại bên dưới dù không dùng nữa — có thể cần lại nếu content plasma vẫn
///    mơ hồ) — kích thước CÓ tăng theo target (3.7MB→4.69MB→7.19MB) nhưng
///    actual luôn vượt xa target (29.8x/5.0x/1.4x) vì nhiễu thuần gần như
///    không nén được ở bất kỳ mức lượng tử nào — không đại diện cho nội dung
///    video thật (luôn có cấu trúc nén được), nên tỉ lệ actual/target đo được
///    không dùng ước tính công thức Option C được.
///
/// **Bản dùng thật (plasma nhiều tần số không gian, có chuyển động thời
/// gian)** — tổng vài sóng sin/cos biên độ vừa phải, mô phỏng độ phức tạp
/// kiểu nội dung video thật (không mượt tuyệt đối như gradient, không entropy
/// tối đa như nhiễu thuần) — cùng kiểu test pattern "plasma" quen thuộc khi
/// stress-test codec. Nếu `bit_rate` được tôn trọng, actual/target phải hội
/// tụ dần về gần 1 khi target tăng (encoder còn "chỗ" để dùng thêm bit cải
/// thiện chất lượng, không bị trần cứng); nếu bị bỏ qua, ba mức vẫn ra kích
/// thước gần bằng nhau như case gradient.
fn fill_plasma_frame(vframe: &mut frame::Video, frame_idx: i64) {
    let width = vframe.width() as usize;
    let height = vframe.height() as usize;
    let stride_y = vframe.stride(0);
    let t = frame_idx as f64;
    {
        let data = vframe.data_mut(0);
        for row in 0..height {
            let y = row as f64;
            for col in 0..width {
                let x = col as f64;
                let v = 128.0
                    + 40.0 * (x / 14.0 + t * 0.35).sin()
                    + 35.0 * (y / 19.0 - t * 0.22).sin()
                    + 25.0 * ((x + y) / 9.0 + t * 0.5).sin()
                    + 20.0 * (x * 0.11 - y * 0.13 + t * 0.7).cos();
                data[row * stride_y + col] = v.clamp(0.0, 255.0) as u8;
            }
        }
    }
    let chroma_w = width.div_ceil(2);
    let chroma_h = height.div_ceil(2);
    for plane in 1..3 {
        let stride = vframe.stride(plane);
        let data = vframe.data_mut(plane);
        for row in 0..chroma_h {
            for col in 0..chroma_w {
                data[row * stride + col] = 128;
            }
        }
    }
}

#[allow(dead_code)]
fn fill_noise_frame(vframe: &mut frame::Video, rng: &mut Xorshift64) {
    let width = vframe.width() as usize;
    let height = vframe.height() as usize;
    let stride_y = vframe.stride(0);
    {
        let data = vframe.data_mut(0);
        for row in 0..height {
            for col in 0..width {
                data[row * stride_y + col] = rng.next_u8();
            }
        }
    }
    let chroma_w = width.div_ceil(2);
    let chroma_h = height.div_ceil(2);
    for plane in 1..3 {
        let stride = vframe.stride(plane);
        let data = vframe.data_mut(plane);
        for row in 0..chroma_h {
            for col in 0..chroma_w {
                data[row * stride + col] = 128;
            }
        }
    }
}

/// Encode `NUM_FRAMES` frame tổng hợp ở đúng `bit_rate` yêu cầu, trả về tổng
/// byte packet THẬT — không mux ra container nào (đo trực tiếp elementary
/// stream, không qua trung gian file/ffprobe).
fn encode_pass(bit_rate: usize) -> Result<usize, ffmpeg::Error> {
    // Đo ĐÚNG `h264_mf` (không phải "encoder H264 nào đó": build có x264 sẽ trả libx264 — ADR-0023).
    let h264 = encoder::find_by_name("h264_mf").ok_or(ffmpeg::Error::EncoderNotFound)?;
    let mut enc_ctx = codec::context::Context::new_with_codec(h264).encoder().video()?;
    enc_ctx.set_width(WIDTH);
    enc_ctx.set_height(HEIGHT);
    enc_ctx.set_format(Pixel::YUV420P);
    enc_ctx.set_time_base((1, FPS));
    enc_ctx.set_frame_rate(Some((FPS, 1)));
    enc_ctx.set_gop(FPS as u32 * 2);
    enc_ctx.set_bit_rate(bit_rate);
    let mut video_encoder = enc_ctx.open()?;

    let mut total_bytes = 0usize;
    let mut packet = ffmpeg::Packet::empty();
    for frame_idx in 0..NUM_FRAMES {
        let mut vframe = frame::Video::new(Pixel::YUV420P, WIDTH, HEIGHT);
        fill_plasma_frame(&mut vframe, frame_idx);
        vframe.set_pts(Some(frame_idx));
        video_encoder.send_frame(&vframe)?;
        while video_encoder.receive_packet(&mut packet).is_ok() {
            total_bytes += packet.data().map(|d| d.len()).unwrap_or(0);
        }
    }
    video_encoder.send_eof()?;
    while video_encoder.receive_packet(&mut packet).is_ok() {
        total_bytes += packet.data().map(|d| d.len()).unwrap_or(0);
    }
    Ok(total_bytes)
}

fn report(label: &str, target_bit_rate: usize, actual_bytes: usize) {
    let actual_kbps = (actual_bytes as f64 * 8.0 / 1000.0) / DURATION_SEC as f64;
    let target_kbps = target_bit_rate as f64 / 1000.0;
    println!(
        "{label}: target={target_kbps:.0} kbps  actual_bytes={actual_bytes}  actual≈{actual_kbps:.0} kbps  (actual/target={:.2})",
        actual_kbps / target_kbps
    );
}

fn main() {
    ffmpeg::init().expect("ffmpeg::init");
    ffmpeg::log::set_level(ffmpeg::log::Level::Warning);

    match encoder::find_by_name("h264_mf") {
        Some(c) => println!("H264 encoder đang dùng: name={:?} description={:?}", c.name(), c.description()),
        None => {
            println!("KHÔNG tìm thấy encoder H264 nào — dừng, không đo được gì.");
            return;
        }
    }

    const LOW: usize = 200_000;
    const MID: usize = 1_500_000;
    const HIGH: usize = 8_000_000;

    let low_bytes = encode_pass(LOW).expect("encode pass LOW");
    let mid_bytes = encode_pass(MID).expect("encode pass MID");
    let high_bytes = encode_pass(HIGH).expect("encode pass HIGH");

    println!("\n--- Kết quả ({NUM_FRAMES} frame, {WIDTH}x{HEIGHT}@{FPS}fps, {DURATION_SEC}s) ---");
    report("LOW ", LOW, low_bytes);
    report("MID ", MID, mid_bytes);
    report("HIGH", HIGH, high_bytes);

    let ratio_mid_low = mid_bytes as f64 / low_bytes.max(1) as f64;
    let ratio_high_low = high_bytes as f64 / low_bytes.max(1) as f64;
    println!("\nTỉ lệ kích thước thật: MID/LOW={ratio_mid_low:.2}x  HIGH/LOW={ratio_high_low:.2}x (target chênh nhau MID/LOW=7.5x, HIGH/LOW=40x)");

    // Tín hiệu không phụ thuộc nội dung: nếu bit_rate được tôn trọng, kích
    // thước phải tăng đơn điệu THẬT (không phải trùng byte-cho-byte như case
    // gradient) và tỉ lệ actual/target phải HỘI TỤ dần về gần 1 khi target
    // tăng (nghĩa là ở target thấp actual vượt xa target vì content không
    // nén nổi mức đó — không sao, đó là giới hạn vật lý — nhưng khi target
    // đủ cao actual phải bám sát nó, không tiếp tục vượt xa mãi hoặc đứng
    // yên). Không dùng một ngưỡng tỉ lệ cố định (đã sai với case nhiễu thuần
    // ở trên — content đó không đại diện, actual luôn vượt target dù bit_rate
    // vẫn có hiệu lực thật).
    let monotonic = high_bytes > mid_bytes && mid_bytes > low_bytes;
    let low_over = (low_bytes as f64 * 8.0 / DURATION_SEC as f64 / 1000.0) / (LOW as f64 / 1000.0);
    let high_over = (high_bytes as f64 * 8.0 / DURATION_SEC as f64 / 1000.0) / (HIGH as f64 / 1000.0);
    let converging = high_over < low_over;
    println!("actual/target: LOW={low_over:.2}x  HIGH={high_over:.2}x — {}", if converging { "HỘI TỤ về 1 khi target tăng" } else { "KHÔNG hội tụ" });

    if monotonic && converging {
        println!("\n=> KẾT LUẬN: set_bit_rate() ĐƯỢC TÔN TRỌNG THẬT — kích thước tăng đơn điệu theo target VÀ actual/target hội tụ dần về 1 khi target đủ cao (không bị trần cứng ẩn). An toàn để dùng công thức target_video_bitrate cho Option C, với lưu ý content thật (không phải plasma tổng hợp) sẽ bám target sát hơn nữa vì có nhiều cấu trúc nén được hơn.");
    } else {
        println!("\n=> KẾT LUẬN: set_bit_rate() CÓ DẤU HIỆU BỊ BỎ QUA hoặc bị trần cứng ẩn chặn — kích thước không tăng đơn điệu, hoặc actual/target không hội tụ về 1 khi target tăng. KHÔNG an toàn để tin công thức target_video_bitrate cho Option C nếu chưa điều tra thêm (vd rate control mode khác, hoặc cần AVOption riêng của h264_mf thay vì field chung).");
    }
}
