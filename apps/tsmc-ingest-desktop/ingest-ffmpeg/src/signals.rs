//! Tín hiệu quanh điểm cắt ứng viên — Giai đoạn 4b (ADR-0017 § addendum
//! 2026-09-19 quyết định #5, ADR-0022): "chấm điểm chuyển cảnh cộng bonus im
//! lặng, CHỈ phân tích cửa sổ quanh vị trí cắt, không quét cả phim".
//!
//! Trả SỐ ĐO THÔ (độ lệch luma giữa frame ngay trước và frame tại keyframe;
//! mức RMS audio quanh keyframe, dBFS) — việc quy số đo thành "chuyển cảnh"/"im
//! lặng" (ngưỡng) là luật nghiệp vụ ở TypeScript (`applySignals()` trong
//! `libs/core-ingest/src/split-plan.ts`, ADR-0017 điều kiện bắt buộc #4).
//!
//! Mỗi ứng viên chỉ giải mã ~2.5 s video + 0.6 s audio quanh nó (seek tới
//! keyframe trước đó), nên phân tích vài chục ứng viên tốn vài giây chứ không
//! phải đọc cả phim.

use ffmpeg_next::{self as ffmpeg, channel_layout::ChannelLayout, codec, format, format::Pixel, frame, media::Type as MediaType, software::resampling, software::scaling};

use crate::ensure_init;
use crate::progress::CancelFlag;
use crate::ProcessError;

/// Số đo thô quanh một ứng viên. `None` = không đo được (keyframe đầu file không
/// có frame trước; không có audio; cửa sổ không có mẫu).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct CutSignal {
    pub time_sec: f64,
    /// Độ lệch tuyệt đối trung bình của luma (thu nhỏ 64×36) giữa frame ngay
    /// trước và frame tại keyframe, chuẩn hoá về 0..1 (255 → 1).
    pub scene_diff: Option<f64>,
    /// RMS của audio (mono) trong cửa sổ ±`AUDIO_HALF_WINDOW_SEC` quanh keyframe, dBFS.
    pub audio_rms_db: Option<f64>,
}

const SEEK_BACK_SEC: f64 = 2.5;
const AUDIO_HALF_WINDOW_SEC: f64 = 0.3;
const THUMB_W: u32 = 64;
const THUMB_H: u32 = 36;

fn seek_to(ictx: &mut format::context::Input, secs: f64) {
    let target = (secs.max(0.0) * f64::from(ffmpeg::ffi::AV_TIME_BASE)) as i64;
    let _ = ictx.seek(target, ..target);
}

fn mean_abs_diff(a: &frame::Video, b: &frame::Video) -> f64 {
    let (sa, sb) = (a.stride(0), b.stride(0));
    let (da, db) = (a.data(0), b.data(0));
    let mut sum = 0u64;
    for row in 0..THUMB_H as usize {
        for col in 0..THUMB_W as usize {
            sum += (i32::from(da[row * sa + col]) - i32::from(db[row * sb + col])).unsigned_abs() as u64;
        }
    }
    sum as f64 / (f64::from(THUMB_W * THUMB_H) * 255.0)
}

pub fn analyze_cut_signals(input_path: &str, times_sec: &[f64], cancel: &CancelFlag) -> Result<Vec<CutSignal>, ProcessError> {
    ensure_init();
    let mut ictx = format::input(input_path)?;
    let video_index = ictx.streams().best(MediaType::Video).ok_or(ffmpeg::Error::StreamNotFound)?.index();
    let audio_index = ictx.streams().best(MediaType::Audio).map(|s| s.index());
    let video_tb = f64::from(ictx.stream(video_index).unwrap().time_base());
    let audio_tb = audio_index.map(|i| f64::from(ictx.stream(i).unwrap().time_base()));

    let mut vdec = codec::context::Context::from_parameters(ictx.stream(video_index).unwrap().parameters())?.decoder().video()?;
    let mut adec = match audio_index {
        Some(i) => Some(codec::context::Context::from_parameters(ictx.stream(i).unwrap().parameters())?.decoder().audio()?),
        None => None,
    };
    let mut scaler = scaling::Context::get(vdec.format(), vdec.width(), vdec.height(), Pixel::GRAY8, THUMB_W, THUMB_H, scaling::Flags::AREA)?;
    let mut resampler: Option<resampling::Context> = None;

    let mut out = Vec::with_capacity(times_sec.len());
    for &t in times_sec {
        if cancel.is_cancelled() {
            return Err(ProcessError::Cancelled);
        }
        seek_to(&mut ictx, t - SEEK_BACK_SEC);
        vdec.flush();
        if let Some(a) = adec.as_mut() {
            a.flush();
        }

        let mut prev: Option<frame::Video> = None;
        let mut cur: Option<frame::Video> = None;
        let mut video_done = false;
        let mut audio_done = adec.is_none();
        let (mut sq_sum, mut sq_n) = (0f64, 0u64);

        for (stream, packet) in ictx.packets() {
            let index = stream.index();
            if index == video_index && !video_done {
                if vdec.send_packet(&packet).is_err() {
                    continue;
                }
                let mut decoded = frame::Video::empty();
                while vdec.receive_frame(&mut decoded).is_ok() {
                    let Some(ts) = decoded.timestamp() else { continue };
                    let frame_t = ts as f64 * video_tb;
                    let mut small = frame::Video::empty();
                    if scaler.run(&decoded, &mut small).is_err() {
                        continue;
                    }
                    if frame_t < t - 1e-3 {
                        prev = Some(small);
                    } else {
                        cur = Some(small);
                        video_done = true;
                        break;
                    }
                }
            } else if Some(index) == audio_index && !audio_done {
                let adec = adec.as_mut().unwrap();
                if adec.send_packet(&packet).is_err() {
                    continue;
                }
                let mut decoded = frame::Audio::empty();
                while adec.receive_frame(&mut decoded).is_ok() {
                    let Some(ts) = decoded.timestamp() else { continue };
                    let frame_t = ts as f64 * audio_tb.unwrap();
                    let rate = decoded.rate();
                    if rate == 0 {
                        continue;
                    }
                    if frame_t > t + AUDIO_HALF_WINDOW_SEC {
                        audio_done = true;
                        break;
                    }
                    if frame_t + decoded.samples() as f64 / f64::from(rate) < t - AUDIO_HALF_WINDOW_SEC {
                        continue;
                    }
                    if decoded.channel_layout().is_empty() {
                        decoded.set_channel_layout(ChannelLayout::default(i32::from(decoded.channels())));
                    }
                    let rs = match resampler.as_mut() {
                        Some(r) => r,
                        None => resampler.insert(resampling::Context::get(decoded.format(), decoded.channel_layout(), rate, ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Packed), ChannelLayout::MONO, rate)?),
                    };
                    let mut mono = frame::Audio::empty();
                    if rs.run(&decoded, &mut mono).is_err() {
                        continue;
                    }
                    for (i, s) in mono.plane::<f32>(0).iter().enumerate() {
                        let st = frame_t + i as f64 / f64::from(rate);
                        if (st - t).abs() <= AUDIO_HALF_WINDOW_SEC {
                            sq_sum += f64::from(*s) * f64::from(*s);
                            sq_n += 1;
                        }
                    }
                }
            }
            if video_done && audio_done {
                break;
            }
            // Packet video đã vượt xa cửa sổ mà vẫn chưa xong → dừng, đừng đọc tiếp cả phim.
            if index == video_index {
                if let Some(pts) = packet.pts().or_else(|| packet.dts()) {
                    if pts as f64 * video_tb > t + 3.0 {
                        break;
                    }
                }
            }
        }

        let scene_diff = match (&prev, &cur) {
            (Some(p), Some(c)) => Some(mean_abs_diff(p, c)),
            _ => None,
        };
        let audio_rms_db = (sq_n > 0).then(|| 20.0 * (sq_sum / sq_n as f64).sqrt().max(1e-6).log10());
        out.push(CutSignal { time_sec: t, scene_diff, audio_rms_db });
    }
    Ok(out)
}
