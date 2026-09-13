use std::env;
use std::fs;
use std::path::{Path, PathBuf};

/// 7 DLL runtime của FFmpeg cần để CHẠY (không phải build) `ingest-ffmpeg` —
/// đúng danh sách đã verify thật ở `tools/spike-09/README.md` (dynamic
/// triplet `x64-windows` của vcpkg, `spike09.exe` chạy sạch với ĐÚNG 7 file
/// này đặt cạnh exe, không cần thêm gì khác — vcpkg build ffmpeg không kéo
/// theo DLL codec ngoài như libx264 rời). Nếu bản `cargo tauri build` sau
/// này vẫn báo thiếu DLL, kiểm `$FFMPEG_DIR/bin` xem còn file phụ thuộc nào
/// khác không, đừng giả định danh sách này còn đúng mãi mãi.
const FFMPEG_RUNTIME_DLLS: &[&str] = &[
  "avcodec-61.dll",
  "avdevice-61.dll",
  "avfilter-10.dll",
  "avformat-61.dll",
  "avutil-59.dll",
  "swscale-8.dll",
  "swresample-5.dll",
];

fn main() {
  // PHẢI copy DLL TRƯỚC `tauri_build::build()` — phát hiện thật lúc code:
  // `tauri_build::build()` tự validate glob `bundle.resources` NGAY LÚC
  // BUILD (không chỉ lúc đóng gói thật) và panic thẳng nếu glob chưa khớp
  // file nào ("glob pattern ... path not found or didn't match any files"),
  // gặp ngay trên build sạch (`cargo clean` hoặc checkout mới) vì
  // `ffmpeg-runtime/` chưa tồn tại tới bước này nếu gọi sau.
  copy_ffmpeg_runtime_dlls();
  tauri_build::build();
}

/// Copy DLL từ `$FFMPEG_DIR/bin` vào `ffmpeg-runtime/` (gitignored, cùng cấp
/// `Cargo.toml` của crate này) để `tauri.conf.json::bundle.resources` tham
/// chiếu bằng path TƯƠNG ĐỐI ổn định — không hardcode `C:/vcpkg/...` (khác
/// nhau giữa máy dev/máy build khác) thẳng vào file cấu hình đóng gói.
/// `FFMPEG_DIR` đã là biến BẮT BUỘC để build được `ingest-ffmpeg` (phụ
/// thuộc gián tiếp `ffmpeg-sys-next`) — nếu thiếu, build đã panic ở đó
/// TRƯỚC KHI tới đây, nên ở đây chỉ cảnh báo phòng trường hợp thứ tự build
/// đổi khác đi trong tương lai, không panic thêm lần nữa.
///
/// Giữ NGUYÊN dynamic linking qua vcpkg (không đổi sang static triplet) —
/// người dùng chấp nhận nghĩa vụ LGPL của FFmpeg cho một dự án cá nhân
/// (ADR-0013 § Đ2, chưa ghi addendum chính thức) với điều kiện tương thích
/// dynamic-link ngay từ đầu, để đổi bản phân phối FFmpeg sau này (nếu thật
/// sự cần) không phải build lại từ một cấu hình static đã lỡ chọn.
fn copy_ffmpeg_runtime_dlls() {
  println!("cargo:rerun-if-env-changed=FFMPEG_DIR");

  let Ok(ffmpeg_dir) = env::var("FFMPEG_DIR") else {
    println!(
      "cargo:warning=FFMPEG_DIR không được set — bỏ qua copy DLL runtime FFmpeg. Bản build này (nếu build được) sẽ THIẾU DLL khi chạy .exe đã đóng gói."
    );
    return;
  };

  let src_dir = Path::new(&ffmpeg_dir).join("bin");
  let dest_dir = PathBuf::from("ffmpeg-runtime");
  if let Err(e) = fs::create_dir_all(&dest_dir) {
    println!("cargo:warning=không tạo được thư mục {}: {e}", dest_dir.display());
    return;
  }

  for dll in FFMPEG_RUNTIME_DLLS {
    let src = src_dir.join(dll);
    println!("cargo:rerun-if-changed={}", src.display());
    if let Err(e) = fs::copy(&src, dest_dir.join(dll)) {
      println!("cargo:warning=không copy được {} vào ffmpeg-runtime/: {e}", src.display());
    }
  }
}
