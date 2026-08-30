// `tsmc-ingest upload --channel <ref> <files...>` — pipeline đầy đủ ADR-0013
// mục 1: probe → phân hạng A/B/C/D → (remux/re-encode) → rút phụ đề → sinh
// thumbnail → prompt metadata (kế thừa từ tập trước cùng series, ADR-0013 §
// Cập nhật 2026-08-29) → upload → gộp catalog → publish ĐÚNG MỘT LẦN sau khi
// xong cả batch (không phải mỗi file một lần — giảm cửa sổ FLOOD_WAIT giữa
// chuỗi 3 RPC của publishCatalogDocument() so với Ingest Editor web).
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import {
  assertChannelWritable,
  buildCatalogEnvelope,
  classifyCompatRank,
  deriveCompat,
  inheritMetadata,
  mergeCatalogItems,
  parseExistingCatalogItems,
  seedMetadataFromFilename,
  type IngestGateway
} from '@tsmc/core-ingest';
import type { CatalogItemV1 } from '@tsmc/shared-models';
import { checkFfmpegAvailable, extractSubtitles, generateThumbnail, reencodeToMp4, remuxToMp4, type ExtractedSubtitle } from '../ffmpeg';
import { checkFfprobeAvailable, probeFile } from '../ffprobe';
import { confirm, prompt } from '../prompt';

type CatalogSubtitleRef = NonNullable<CatalogItemV1['subs']>[number];

export interface UploadOptions {
  channelRef: string;
  files: string[];
  /** Bỏ qua MỌI xác nhận/prompt (Hạng D re-encode, kế thừa metadata, sửa Title/Năm) — dùng cho batch không tương tác. */
  assumeYes: boolean;
}

function stripExt(filePath: string): string {
  return basename(filePath, extname(filePath));
}

async function resolveMetadataForFile(fileName: string, previousItem: CatalogItemV1 | undefined, assumeYes: boolean): Promise<CatalogItemV1> {
  let base: CatalogItemV1;

  if (previousItem) {
    const useInherit = assumeYes || (await confirm(`Kế thừa metadata từ "${previousItem.title ?? previousItem.series?.name ?? '(chưa đặt tên)'}" cho "${fileName}"?`, true));
    base = useInherit ? inheritMetadata(0, fileName, previousItem) : seedMetadataFromFilename(0, fileName);
  } else {
    base = seedMetadataFromFilename(0, fileName);
  }

  if (assumeYes) {
    return base;
  }

  const title = await prompt(`  Title [${base.title ?? ''}]: `);
  const yearRaw = await prompt(`  Năm [${base.year ?? ''}]: `);
  const finalTitle = title.length > 0 ? title : base.title;
  return {
    ...base,
    title: finalTitle,
    // Đồng bộ series.name theo Title CUỐI CÙNG (sau khi admin sửa đè) — nếu
    // không, series.name giữ nguyên giá trị seed từ tên file (nhiều khi chỉ
    // là "S01E02.mp4" trần trụi, không mang tên phim) trong khi title đã
    // được sửa đúng, tạo ra hai field lệch nhau trong cùng một item. Phát
    // hiện thật (2026-08-30, chạy tài khoản thật): item đầu tiên của series
    // (seed từ file tên "S01E01.mp4", không có gì để trích tên phim) khiến
    // cả title lẫn series.name ban đầu đều là chuỗi filename; admin gõ Title
    // đúng qua prompt này nhưng series.name không theo, để lại
    // `series.name: "S01E01.mp4"` trong catalog.json thật.
    series: base.series && finalTitle !== undefined ? { ...base.series, name: finalTitle } : base.series,
    year: yearRaw.length > 0 ? Number(yearRaw) : base.year,
    metaSource: 'manual'
  };
}

export async function runUpload(gateway: IngestGateway, opts: UploadOptions): Promise<void> {
  if (opts.files.length === 0) {
    console.error('Dùng: tsmc-ingest upload --channel <ref> <file...>');
    process.exitCode = 1;
    return;
  }

  if (!(await checkFfprobeAvailable()) || !(await checkFfmpegAvailable())) {
    console.error(
      'Cần ffmpeg + ffprobe trên PATH cho lệnh upload (ADR-0013: CLI luôn chuẩn hoá +faststart, kể cả Hạng A — không có nhánh nào bỏ qua bước này). Cài: winget install ffmpeg / brew install ffmpeg / apt install ffmpeg.'
    );
    process.exitCode = 1;
    return;
  }

  const channel = await gateway.resolveIndexChannel(opts.channelRef);
  if (!channel) {
    console.error(`Không tìm thấy kênh "${opts.channelRef}".`);
    process.exitCode = 1;
    return;
  }
  assertChannelWritable(channel);

  const existingDoc = await gateway.getPinnedCatalogDocument(channel.id);
  const existingItems = existingDoc ? parseExistingCatalogItems(existingDoc.raw) : [];

  const newItems: CatalogItemV1[] = [];
  let previousItem: CatalogItemV1 | undefined;
  const tmpDir = await mkdtemp(join(tmpdir(), 'tsmc-ingest-'));

  try {
    for (const filePath of opts.files) {
      console.log(`\n=== ${basename(filePath)} ===`);
      const probe = await probeFile(filePath);
      const { rank, reasons } = classifyCompatRank(probe);
      console.log(`Hạng: ${rank}`);
      for (const reason of reasons) {
        console.log(`  - ${reason}`);
      }

      if (rank === 'D') {
        const estimateMin = Math.max(1, Math.ceil(probe.durationSec / 60));
        const proceed = opts.assumeYes || (await confirm(`Cần re-encode video (đắt — không phải remux). Nội dung ~${estimateMin} phút. Tiếp tục?`, false));
        if (!proceed) {
          console.log('Bỏ qua file này (không upload).');
          continue;
        }
      }

      const remuxedPath = join(tmpDir, `${stripExt(filePath)}.mp4`);
      const onProgress = (line: string) => process.stdout.write(`\r  ${line}`);
      if (rank === 'D') {
        await reencodeToMp4(filePath, remuxedPath, onProgress);
      } else {
        await remuxToMp4(filePath, remuxedPath, { reencodeAudioToAac: rank === 'C' }, onProgress);
      }
      process.stdout.write('\n');

      // ffprobe lại file ĐÃ xử lý — compat ghi vào catalog phải phản ánh
      // codec THẬT SỰ đã upload, không phải codec gốc trước remux/re-encode.
      const finalProbe = await probeFile(remuxedPath);
      const compat = deriveCompat(finalProbe.video, finalProbe.audio);

      let subtitles: ExtractedSubtitle[] = [];
      if (rank === 'C' && probe.subtitles.length > 0) {
        subtitles = await extractSubtitles(filePath, probe.subtitles, join(tmpDir, stripExt(filePath)));
      }

      const thumbnailPath = join(tmpDir, `${stripExt(filePath)}.jpg`);
      await generateThumbnail(remuxedPath, finalProbe.durationSec, thumbnailPath);

      const fileName = `${stripExt(filePath)}.mp4`;
      const metadata = await resolveMetadataForFile(fileName, previousItem, opts.assumeYes);

      const uploaded = await gateway.uploadVideoDocument(channel.id, {
        filePath: remuxedPath,
        fileName,
        video: {
          w: finalProbe.video?.width ?? 0,
          h: finalProbe.video?.height ?? 0,
          durationSec: Math.round(finalProbe.durationSec)
        },
        thumbnailPath,
        caption: metadata.title
      });

      // Chỉ upload phụ đề TEXT (.srt) — phụ đề ảnh (.sup, PGS) không có track
      // nào trong <video> để gắn vào (trình duyệt không tự render .sup), nên
      // v1 vẫn chỉ để lại cục bộ cho admin tự xử lý, giống hành vi cũ.
      const subsRefs: CatalogSubtitleRef[] = [];
      for (const sub of subtitles) {
        if (sub.isImageBased) {
          console.log(`Phụ đề ảnh (${sub.path}) — CHƯA upload, cần convert tay hoặc công cụ khác trước khi đăng.`);
          continue;
        }
        const subUploaded = await gateway.uploadSubtitleDocument(channel.id, {
          filePath: sub.path,
          fileName: basename(sub.path)
        });
        subsRefs.push({ lang: sub.lang ?? 'und', msgId: subUploaded.msgId });
      }

      const finalItem: CatalogItemV1 = {
        ...metadata,
        msgId: uploaded.msgId,
        compat,
        ...(subsRefs.length > 0 ? { subs: subsRefs } : {})
      };
      newItems.push(finalItem);
      previousItem = finalItem;
      console.log(`Đã upload — msgId ${uploaded.msgId}, compat "${compat}"${subsRefs.length > 0 ? `, ${subsRefs.length} phụ đề` : ''}.`);
    }
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  if (newItems.length === 0) {
    console.log('\nKhông có item nào upload thành công — không publish catalog.');
    return;
  }

  const merged = mergeCatalogItems(existingItems, newItems);
  const envelope = buildCatalogEnvelope({ id: channel.id, title: channel.title }, merged);
  const result = await gateway.publishCatalogDocument(channel.id, JSON.stringify(envelope), existingDoc?.msgId);
  console.log(`\nĐã publish catalog.json (msgId ${result.msgId}) — ${merged.length} item, ${newItems.length} item mới.`);
}
