//! Rút phụ đề TEXT ra `.srt` — port trực tiếp từ `tools/spike-09/src/main.rs::
//! extract_subtitles()` (đã verify thật ở SPIKE-09). CHỈ dùng cho track
//! subtitle dạng TEXT (subrip/ass/mov_text...) — track dạng ẢNH (PGS/DVD
//! subtitle) không đi qua hàm này (tầng gọi lọc trước, xem
//! `apps/tsmc-ingest/src/ffmpeg.ts::IMAGE_SUBTITLE_CODECS` — cùng danh sách
//! đó, lặp lại có chủ đích ở phía TypeScript của app này vì hai app tách
//! runtime hoàn toàn, ADR-0017).

use std::fs::File;
use std::io::Write;

use ffmpeg_next::{self as ffmpeg, codec, format, media::Type as MediaType, Rational};

use crate::ensure_init;

/// `explicit_index`: `Some(i)` rút ĐÚNG track subtitle tại stream index `i`
/// (khớp `-map 0:{index}` — dùng khi cần rút riêng từng track lúc file có
/// NHIỀU track phụ đề). `None` lấy track "best" (dùng khi chỉ có 1 track).
pub fn extract_subtitles(input_path: &str, output_path: &str, explicit_index: Option<usize>) -> Result<usize, ffmpeg::Error> {
    ensure_init();
    let mut ictx = format::input(input_path)?;

    let sub_index = match explicit_index {
        Some(idx) => {
            let stream = ictx.stream(idx).ok_or(ffmpeg::Error::StreamNotFound)?;
            if stream.parameters().medium() != MediaType::Subtitle {
                return Err(ffmpeg::Error::StreamNotFound);
            }
            idx
        }
        None => match ictx.streams().best(MediaType::Subtitle) {
            Some(s) => s.index(),
            None => {
                File::create(output_path).ok();
                return Ok(0);
            }
        }
    };
    let time_base = ictx.stream(sub_index).unwrap().time_base();
    let params = ictx.stream(sub_index).unwrap().parameters();
    let ctx = codec::context::Context::from_parameters(params)?;
    let mut decoder = ctx.decoder().subtitle()?;

    let mut file = File::create(output_path).expect("create srt output");
    let mut n = 0usize;

    for (stream, packet) in ictx.packets() {
        if stream.index() != sub_index {
            continue;
        }
        let mut sub = ffmpeg::Subtitle::new();
        if decoder.decode(&packet, &mut sub).unwrap_or(false) {
            let mut text = String::new();
            for rect in sub.rects() {
                match rect {
                    ffmpeg::codec::subtitle::Rect::Text(t) => text.push_str(t.get()),
                    // Bất ngờ: decoder subrip của bin ffmpeg này trả về dạng
                    // Rect::Ass, không phải Rect::Text như đọc doc
                    // AVSubtitleType gợi ý - .get() trả nguyên dòng ASS
                    // Dialogue (8 trường Layer,Style,Name,MarginL,MarginR,
                    // MarginV,Effect rồi mới tới Text) chứ không phải text
                    // thuần. Phải tách bỏ 8 trường đầu + gỡ tag override
                    // {\...} + đổi \N/\n thành xuống dòng thật.
                    ffmpeg::codec::subtitle::Rect::Ass(a) => text.push_str(&clean_ass_text(a.get())),
                    _ => {}
                }
            }
            if text.trim().is_empty() {
                continue;
            }
            let pts = packet.pts().unwrap_or(0);
            let start_ms = rescale_to_ms(pts, time_base);
            let dur_ms = (packet.duration() as f64 * f64::from(time_base) * 1000.0) as i64;
            let end_ms = start_ms + dur_ms.max(1000);

            n += 1;
            writeln!(file, "{n}").ok();
            writeln!(file, "{} --> {}", fmt_srt_ts(start_ms), fmt_srt_ts(end_ms)).ok();
            writeln!(file, "{}", text.trim()).ok();
            writeln!(file).ok();
        }
    }

    Ok(n)
}

fn clean_ass_text(raw: &str) -> String {
    let after_fields = match raw.splitn(9, ',').last() {
        Some(t) if raw.matches(',').count() >= 8 => t,
        _ => raw
    };
    let mut out = String::with_capacity(after_fields.len());
    let mut chars = after_fields.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '{' {
            while let Some(&next) = chars.peek() {
                chars.next();
                if next == '}' {
                    break;
                }
            }
        } else if c == '\\' && matches!(chars.peek(), Some('N') | Some('n')) {
            chars.next();
            out.push('\n');
        } else {
            out.push(c);
        }
    }
    out
}

fn rescale_to_ms(pts: i64, tb: Rational) -> i64 {
    (pts as f64 * f64::from(tb) * 1000.0) as i64
}

fn fmt_srt_ts(ms: i64) -> String {
    let ms = ms.max(0);
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1000;
    let msec = ms % 1000;
    format!("{h:02}:{m:02}:{s:02},{msec:03}")
}
