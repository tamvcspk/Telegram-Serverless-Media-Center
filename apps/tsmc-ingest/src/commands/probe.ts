// `tsmc-ingest probe <files...>` — dry run: chỉ ffprobe + phân hạng, không
// đăng nhập, không tốn byte upload nào (ADR-0013 mục 3, áp cho CLI thay vì
// trình duyệt: "chặn trước một lần upload vô ích").
import { classifyCompatRank } from '@tsmc/core-ingest';
import { checkFfprobeAvailable, probeFile } from '../ffprobe';

export async function runProbe(files: string[]): Promise<void> {
  if (files.length === 0) {
    console.error('Dùng: tsmc-ingest probe <file...>');
    process.exitCode = 1;
    return;
  }

  if (!(await checkFfprobeAvailable())) {
    console.error('Không tìm thấy ffprobe trên PATH. Cài ffmpeg (đi kèm ffprobe): winget install ffmpeg / brew install ffmpeg / apt install ffmpeg.');
    process.exitCode = 1;
    return;
  }

  for (const file of files) {
    try {
      const probe = await probeFile(file);
      const { rank, reasons } = classifyCompatRank(probe);
      console.log(`\n${file}`);
      console.log(`  Container: ${probe.container} | Video: ${probe.video?.codec ?? '(không có)'} ${probe.video ? `${probe.video.width}x${probe.video.height}` : ''} | Audio: ${probe.audio.map((a) => a.codec).join(', ') || '(không có)'}`);
      console.log(`  Hạng: ${rank}`);
      for (const reason of reasons) {
        console.log(`    - ${reason}`);
      }
    } catch (err) {
      console.error(`  Lỗi probe "${file}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
