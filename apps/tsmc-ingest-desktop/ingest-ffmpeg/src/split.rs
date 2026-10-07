//! Chia file thành nhiều phần stream-copy tại keyframe — Giai đoạn 4 của kế
//! hoạch chuẩn hoá dung lượng (ADR-0017 § addendum 2026-09-19, ADR-0022).
//!
//! Hai bước, cả hai CHỈ đọc/ghi packet (không decode/encode frame nào — không
//! chạm đường code đã segfault ở ADR-0013 § addendum 2026-09-03):
//! 1. [`scan_keyframes`] — liệt kê các keyframe an toàn để cắt (thời điểm +
//!    offset byte tích luỹ). KHÔNG chọn điểm cắt: thuật toán chọn (chia đều,
//!    ưu tiên chuyển cảnh/im lặng) là hàm thuần ở TypeScript
//!    (`libs/core-ingest/src/split-plan.ts`) — ADR-0017 điều kiện bắt buộc #4,
//!    crate này không chứa luật nghiệp vụ.
//! 2. [`split_at`] — thực thi cắt tại đúng các thời điểm keyframe đã chọn.
//!
//! Đầu vào kỳ vọng là MP4 đã remux (`remux()`): một video + một audio,
//! interleave theo thời gian — nên offset byte tích luỹ theo thứ tự đọc là xấp
//! xỉ rất sát dung lượng từng phần sau khi cắt (không chính xác tuyệt đối:
//! moov mỗi phần thêm vài chục KB, nên tầng gọi chừa margin 1-3% rồi kiểm lại
//! dung lượng thật sau khi cắt).

use std::time::Instant;

use ffmpeg_next::{self as ffmpeg, codec, encoder, format, media::Type as MediaType, util::dictionary::Owned as Dictionary, Rational};

use crate::ensure_init;
use crate::progress::{maybe_tick, CancelFlag, PipelineProgressSink};
use crate::ProcessError;

/// Một keyframe có thể làm điểm cắt.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct KeyframeCandidate {
    /// Thời điểm trình chiếu (pts) của keyframe, giây.
    pub time_sec: f64,
    /// Tổng byte của MỌI packet đứng TRƯỚC keyframe này theo thứ tự đọc file —
    /// dung lượng xấp xỉ của phần nằm trước điểm cắt.
    pub byte_offset: u64,
}

#[derive(Debug, Clone)]
pub struct SplitScan {
    pub duration_sec: f64,
    /// Tổng byte payload của mọi packet video/audio (không gồm moov/header).
    pub total_packet_bytes: u64,
    /// Keyframe đã lọc: chỉ giữ keyframe "sạch" — không có packet nào đứng sau
    /// nó (theo thứ tự giải mã) mà pts nhỏ hơn pts của nó (open-GOP: frame B
    /// dẫn đầu tham chiếu ngược sang GOP trước, cắt ở đây làm hỏng chúng).
    pub keyframes: Vec<KeyframeCandidate>,
}

fn secs(ts: i64, tb: Rational) -> f64 {
    ts as f64 * f64::from(tb)
}

/// Quét toàn bộ packet (đọc tuần tự, không decode — nhanh gần tốc độ đọc đĩa).
pub fn scan_keyframes(input_path: &str, cancel: &CancelFlag) -> Result<SplitScan, ProcessError> {
    ensure_init();
    let mut ictx = format::input(input_path)?;
    let video_index = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let video_tb = ictx.stream(video_index).unwrap().time_base();
    let audio_index = ictx.streams().best(MediaType::Audio).map(|s| s.index());

    let mut cumulative: u64 = 0;
    let mut keyframes: Vec<KeyframeCandidate> = Vec::new();
    // pts của keyframe gần nhất đang "mở" (chưa gặp keyframe kế) và cờ hỏng.
    let mut open_pts: Option<i64> = None;
    let mut open_dirty = false;
    let mut pending: Option<KeyframeCandidate> = None;
    let mut max_end_sec = 0f64;

    let close_pending = |pending: &mut Option<KeyframeCandidate>, dirty: bool, keyframes: &mut Vec<KeyframeCandidate>| {
        if let Some(candidate) = pending.take() {
            if !dirty {
                keyframes.push(candidate);
            }
        }
    };

    for (stream, packet) in ictx.packets() {
        if cancel.is_cancelled() {
            return Err(ProcessError::Cancelled);
        }
        let index = stream.index();
        if index == video_index {
            let Some(pts) = packet.pts().or_else(|| packet.dts()) else {
                cumulative += packet.size() as u64;
                continue;
            };
            if packet.is_key() {
                close_pending(&mut pending, open_dirty, &mut keyframes);
                open_pts = Some(pts);
                open_dirty = false;
                pending = Some(KeyframeCandidate { time_sec: secs(pts, video_tb), byte_offset: cumulative });
            } else if let Some(kf_pts) = open_pts {
                if pts < kf_pts {
                    open_dirty = true;
                }
            }
            let end = secs(pts + packet.duration().max(0), video_tb);
            if end > max_end_sec {
                max_end_sec = end;
            }
        } else if Some(index) != audio_index {
            continue;
        }
        cumulative += packet.size() as u64;
    }
    close_pending(&mut pending, open_dirty, &mut keyframes);

    let duration_sec = if ictx.duration() > 0 { ictx.duration() as f64 / f64::from(ffmpeg::ffi::AV_TIME_BASE) } else { max_end_sec };
    Ok(SplitScan { duration_sec, total_packet_bytes: cumulative, keyframes })
}

/// Muxer MP4 từ chối dts không tăng nghiêm ngặt trong một luồng ("Application provided invalid, non monotonically
/// increasing dts", `AVERROR(EINVAL)`). Nguồn thật có thể mang hai packet audio đầu CÙNG dts (Tokyo Hot n1313.mp4:
/// mẫu đầu có thời lượng 0 → `remux()` ghi `-18, -18`, remux không bị chặn vì dts đầu = 0 bị muxer coi là "chưa đặt"),
/// nhưng khi cắt mốc dịch đi và dts khác 0 thì bị chặn. CLI `ffmpeg` tự đẩy dts lên `last + 1` (`bump_dts`); API
/// native không tự làm — làm tay ở đây và giữ `pts ≥ dts`.
fn monotonic_dts(packet: &mut ffmpeg::Packet, last: &mut Option<i64>) {
    if let Some(dts) = packet.dts() {
        let fixed = match *last {
            Some(prev) if dts <= prev => prev + 1,
            _ => dts,
        };
        if fixed != dts {
            packet.set_dts(Some(fixed));
            if packet.pts().is_some_and(|pts| pts < fixed) {
                packet.set_pts(Some(fixed));
            }
        }
        *last = Some(fixed);
    }
}

/// Cắt `input_path` thành `cut_times_sec.len() + 1` file stream-copy trong
/// `out_dir`, tên `{stem}.part{i}of{N}.mp4` (i từ 1). `cut_times_sec` PHẢI là
/// `time_sec` lấy từ [`scan_keyframes`] (so khớp keyframe theo thời điểm với
/// dung sai 1 µs), tăng dần, mỗi phần tử > 0 — sai thì trả `Err` thay vì cắt
/// bừa. Trả về đường dẫn các phần theo thứ tự; dung lượng/thời lượng từng
/// phần để tầng gọi tự `probe()` + `metadata()` lại (số thật, không ước lượng).
///
/// Mốc thời gian: mỗi phần trừ `T0` = pts keyframe đầu phần (cùng một giá trị
/// cho video và audio nên không lệch tiếng/hình); muxer MP4 tự bù dts âm của
/// B-frame bằng edit list. Video chia theo thứ tự packet (đổi phần tại
/// keyframe), audio chia theo timestamp (`pts >= cut`).
pub fn split_at(
    input_path: &str,
    out_dir: &str,
    stem: &str,
    cut_times_sec: &[f64],
    duration_sec: f64,
    progress: PipelineProgressSink<'_>,
    cancel: &CancelFlag,
) -> Result<Vec<String>, ProcessError> {
    ensure_init();
    if cut_times_sec.is_empty() || cut_times_sec.windows(2).any(|w| w[1] <= w[0]) || cut_times_sec[0] <= 0.0 {
        return Err(ProcessError::Ffmpeg(ffmpeg::Error::InvalidData));
    }
    let part_count = cut_times_sec.len() + 1;
    // `starts[k]` = thời điểm bắt đầu phần k (phần 0 bắt đầu tại 0).
    let mut starts: Vec<f64> = Vec::with_capacity(part_count);
    starts.push(0.0);
    starts.extend_from_slice(cut_times_sec);

    let mut in_opts = Dictionary::new();
    in_opts.set("fflags", "+genpts");
    let mut ictx = format::input_with_dictionary(input_path, in_opts)?;
    let video_in = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let audio_in = ictx.streams().best(MediaType::Audio).map(|s| s.index());
    let video_tb = ictx.stream(video_in).unwrap().time_base();
    let audio_tb = audio_in.map(|i| ictx.stream(i).unwrap().time_base());

    let mut paths = Vec::with_capacity(part_count);
    let mut outputs: Vec<format::context::Output> = Vec::with_capacity(part_count);
    let mut video_out_tbs = Vec::with_capacity(part_count);
    let mut audio_out_tbs = Vec::with_capacity(part_count);
    for k in 0..part_count {
        let path = format!("{out_dir}/{stem}.part{}of{part_count}.mp4", k + 1);
        let mut octx = format::output(&path)?;
        {
            let ist = ictx.stream(video_in).unwrap();
            let mut ost = octx.add_stream(encoder::find(codec::Id::None))?;
            ost.set_parameters(ist.parameters());
            unsafe {
                (*ost.parameters().as_mut_ptr()).codec_tag = 0;
            }
        }
        if let Some(ai) = audio_in {
            let ist = ictx.stream(ai).unwrap();
            let mut ost = octx.add_stream(encoder::find(codec::Id::None))?;
            ost.set_parameters(ist.parameters());
            unsafe {
                (*ost.parameters().as_mut_ptr()).codec_tag = 0;
            }
        }
        octx.set_metadata(ictx.metadata().to_owned());
        let mut opts = Dictionary::new();
        opts.set("movflags", "faststart");
        octx.write_header_with(opts)?;
        // Time base đầu ra do muxer chốt SAU write_header.
        video_out_tbs.push(octx.stream(0).unwrap().time_base());
        audio_out_tbs.push(audio_in.map(|_| octx.stream(1).unwrap().time_base()));
        paths.push(path);
        outputs.push(octx);
    }

    let mut current_part = 0usize;
    // dts cuối đã ghi của từng (phần, luồng) — xem `monotonic_dts()`.
    let mut last_dts: Vec<[Option<i64>; 2]> = vec![[None; 2]; part_count];
    // Khoá đổi phần video: chỉ keyframe có pts_sec >= start của phần kế.
    let mut last_emit = Instant::now();
    for (stream, mut packet) in ictx.packets() {
        if cancel.is_cancelled() {
            return Err(ProcessError::Cancelled);
        }
        let index = stream.index();
        if index == video_in {
            let Some(pts) = packet.pts().or_else(|| packet.dts()) else {
                continue;
            };
            let pts_sec = secs(pts, video_tb);
            if packet.is_key() && current_part + 1 < part_count && pts_sec >= starts[current_part + 1] - 1e-6 {
                current_part += 1;
            }
            maybe_tick(&mut last_emit, pts_sec, duration_sec, &paths[current_part], progress);
            let t0 = starts[current_part];
            let shift = (t0 / f64::from(video_tb)).round() as i64;
            let out_tb = video_out_tbs[current_part];
            if let Some(p) = packet.pts() {
                packet.set_pts(Some(p - shift));
            }
            if let Some(d) = packet.dts() {
                packet.set_dts(Some(d - shift));
            }
            packet.rescale_ts(video_tb, out_tb);
            monotonic_dts(&mut packet, &mut last_dts[current_part][0]);
            packet.set_position(-1);
            packet.set_stream(0);
            packet.write_interleaved(&mut outputs[current_part])?;
        } else if Some(index) == audio_in {
            let tb = audio_tb.unwrap();
            let Some(pts) = packet.pts().or_else(|| packet.dts()) else {
                continue;
            };
            let pts_sec = secs(pts, tb);
            // Phần audio = phần cuối có start <= pts_sec (audio chia theo timestamp).
            let part = starts.iter().rposition(|s| pts_sec >= *s - 1e-6).unwrap_or(0);
            let shift = (starts[part] / f64::from(tb)).round() as i64;
            let out_tb = audio_out_tbs[part].unwrap();
            if let Some(p) = packet.pts() {
                packet.set_pts(Some(p - shift));
            }
            if let Some(d) = packet.dts() {
                packet.set_dts(Some(d - shift));
            }
            packet.rescale_ts(tb, out_tb);
            monotonic_dts(&mut packet, &mut last_dts[part][1]);
            packet.set_position(-1);
            packet.set_stream(1);
            packet.write_interleaved(&mut outputs[part])?;
        }
    }

    // Không đủ keyframe để tới phần cuối = cut_times_sec không khớp keyframe
    // nào (sai nguồn) — báo lỗi thay vì trả file rỗng.
    if current_part + 1 != part_count {
        return Err(ProcessError::Ffmpeg(ffmpeg::Error::InvalidData));
    }
    for octx in &mut outputs {
        octx.write_trailer()?;
    }
    Ok(paths)
}
