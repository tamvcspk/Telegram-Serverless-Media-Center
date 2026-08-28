// SPIKE-06, bước 2/2 — GHI CATALOG.JSON LÊN KÊNH MEDIA (thật).
//
// ⚠️ Cũng chạy trong terminal của chính bạn. Đọc session cục bộ (đã đăng
// nhập bằng login.mjs), không hỏi lại OTP.
//
//   node test.mjs [--keep]
//
// LƯU Ý: dùng "node test.mjs ..." trực tiếp, KHÔNG dùng "npm run test -- ...".
// Trên PowerShell (và một số shell khác), npm tự nuốt mất mọi --flag đứng sau
// dấu -- khi chạy qua "npm run".
//
// Việc script làm — mô phỏng ĐÚNG chuỗi thao tác của publishCatalogDocument()
// (libs/core-mtproto/src/gateway-index.ts), nhưng KHÔNG import code đó: nếu
// spike hỏng, biết chắc là hành vi giao thức/tài khoản chứ không phải bug ở
// pipeline thật (cùng lý do tách như SPIKE-02/SPIKE-04).
//
//   1. Tự TẠO một kênh test MỚI (channels.CreateChannel) — không đụng tới bất
//      kỳ kênh có sẵn nào của bạn, kể cả kênh media thật đang chứa phim thật.
//      Đây là điểm an toàn cốt lõi của spike này.
//   2. sendFile catalog.v1.json phiên bản A → pinMessage.
//   3. Đọc lại (GetFullChannel → pinnedMsgId → getMessages → downloadMedia →
//      JSON.parse) — xác nhận đúng nội dung A, giả lập getPinnedCatalogDocument().
//   4. sendFile catalog.v1.json phiên bản B (giả lập "sửa metadata rồi Lưu
//      lại") → pinMessage → deleteMessages(A) — đúng thứ tự publishCatalogDocument().
//   5. Đọc lại lần hai — xác nhận pin đã CHUYỂN sang B, và A đã bị xoá thật
//      (getMessages(A) trả rỗng).
//   6. Mặc định XOÁ LUÔN kênh test (channels.DeleteChannel) để không để lại
//      rác trong tài khoản — dùng --keep nếu muốn tự vào Telegram xem lại
//      kênh trước khi xoá tay.
//
// Kết quả ghi ra docs/spikes/spike-06-result.local.json (đã gitignore) —
// CHỈ chứa số liệu tổng hợp (đạt/không đạt từng bước, thời gian), KHÔNG chứa
// session, KHÔNG chứa số điện thoại, KHÔNG chứa id kênh thật của bạn (kênh
// test bị xoá ngay sau khi chạy trừ khi dùng --keep). An toàn để dán vào chat
// cho Claude đọc và viết lại phần Kết quả ở docs/spikes/README.md.

import { Api, TelegramClient, client as gramjsClientNs } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SESSION_FILE = path.join(ROOT, '.session.local');
const OUT_FILE = path.join(ROOT, '../../docs/spikes/spike-06-result.local.json');

const keepChannel = process.argv.includes('--keep');

if (!fs.existsSync(SESSION_FILE)) {
  console.error(`Chưa có session. Chạy "npm run login" trước (file mong đợi tại ${SESSION_FILE}).`);
  process.exit(1);
}

const apiId = Number(process.env.TSMC_API_ID);
const apiHash = process.env.TSMC_API_HASH;
if (!apiId || !apiHash) {
  console.error('Thiếu TSMC_API_ID / TSMC_API_HASH trong biến môi trường (giống lúc login).');
  process.exit(1);
}

const sessionStr = fs.readFileSync(SESSION_FILE, 'utf8').trim();
const client = new TelegramClient(new StringSession(sessionStr), apiId, apiHash, { connectionRetries: 5 });
await client.connect();
console.log('Đã kết nối bằng session có sẵn.\n');

function nowIso() {
  return new Date().toISOString();
}

function makeCatalogJson(version, items) {
  return JSON.stringify({
    spec: 'tsmc-catalog/1',
    generatedAt: nowIso(),
    channel: { title: `SPIKE-06 test — phiên bản ${version}` },
    items
  });
}

async function readPinnedCatalog(channel) {
  const full = await client.invoke(new Api.channels.GetFullChannel({ channel }));
  const pinnedMsgId = full.fullChat instanceof Api.ChannelFull ? full.fullChat.pinnedMsgId : undefined;
  if (!pinnedMsgId) {
    return null;
  }
  const [message] = await client.getMessages(channel, { ids: [pinnedMsgId] });
  if (!message?.media) {
    return { msgId: pinnedMsgId, content: null, note: 'pinnedMsgId có giá trị nhưng getMessages không trả về media — có thể đã bị xoá.' };
  }
  const buffer = await client.downloadMedia(message);
  return { msgId: pinnedMsgId, content: typeof buffer === 'string' ? buffer : new TextDecoder().decode(buffer) };
}

async function publishCatalog(channel, json, previousMsgId) {
  const bytes = new TextEncoder().encode(json);
  const t0 = Date.now();
  const message = await client.sendFile(channel, {
    file: new gramjsClientNs.uploads.CustomFile('catalog.v1.json', bytes.length, '', bytes),
    forceDocument: true
  });
  const afterSendFile = Date.now();
  await client.pinMessage(channel, message.id, { notify: false });
  const afterPin = Date.now();
  if (previousMsgId) {
    await client.deleteMessages(channel, [previousMsgId], { revoke: true });
  }
  const afterDelete = Date.now();
  return {
    msgId: message.id,
    sendFileMs: afterSendFile - t0,
    pinMessageMs: afterPin - afterSendFile,
    deleteMessagesMs: previousMsgId ? afterDelete - afterPin : null
  };
}

const report = { testedAt: nowIso(), steps: [], passed: true };

function record(step, ok, detail) {
  report.steps.push({ step, ok, detail });
  if (!ok) {
    report.passed = false;
  }
  console.log(`${ok ? '✅' : '❌'} ${step}${detail ? ' — ' + detail : ''}`);
}

let channel;
try {
  console.log('— Bước 1: tạo kênh test mới —');
  const created = await client.invoke(
    new Api.channels.CreateChannel({
      title: 'TSMC SPIKE-06 test (an toàn để xoá)',
      about: 'Kênh test tự sinh bởi tools/spike-06/test.mjs — kiểm chứng publishCatalogDocument(). An toàn để xoá thủ công nếu script không tự xoá được.',
      broadcast: true,
      megagroup: false
    })
  );
  channel = created.chats?.find((c) => c instanceof Api.Channel);
  if (!channel) {
    throw new Error('channels.CreateChannel không trả về channel nào trong Updates.chats');
  }
  record('Tạo kênh test', true, `id=${channel.id}, creator=${channel.creator === true}`);

  console.log('\n— Bước 2: publish catalog A, đọc lại xác nhận —');
  const versionA = makeCatalogJson('A', [{ msgId: 1, title: 'Phim Test A', year: 2020 }]);
  const publishA = await publishCatalog(channel, versionA);
  record('sendFile + pinMessage catalog A', true, `msgId=${publishA.msgId}, sendFile=${publishA.sendFileMs}ms, pin=${publishA.pinMessageMs}ms`);

  const readBackA = await readPinnedCatalog(channel);
  const matchesA = readBackA?.msgId === publishA.msgId && readBackA?.content === versionA;
  record('Đọc lại đúng nội dung A', matchesA, matchesA ? undefined : `readBack=${JSON.stringify(readBackA)}`);

  console.log('\n— Bước 3: publish catalog B (giả lập sửa + Lưu), xoá A, đọc lại xác nhận —');
  const versionB = makeCatalogJson('B', [{ msgId: 1, title: 'Phim Test A (đã sửa)', year: 2021 }]);
  const publishB = await publishCatalog(channel, versionB, publishA.msgId);
  record(
    'sendFile + pinMessage catalog B + deleteMessages(A)',
    true,
    `msgId=${publishB.msgId}, sendFile=${publishB.sendFileMs}ms, pin=${publishB.pinMessageMs}ms, delete=${publishB.deleteMessagesMs}ms`
  );

  const readBackB = await readPinnedCatalog(channel);
  const matchesB = readBackB?.msgId === publishB.msgId && readBackB?.content === versionB;
  record('Đọc lại đúng nội dung B (pin đã chuyển)', matchesB, matchesB ? undefined : `readBack=${JSON.stringify(readBackB)}`);

  const [deletedCheck] = await client.getMessages(channel, { ids: [publishA.msgId] });
  const aReallyGone = !deletedCheck || deletedCheck.className === 'MessageEmpty' || !deletedCheck.media;
  record('Message A đã bị xoá thật (không phải chỉ unpin)', aReallyGone, aReallyGone ? undefined : `getMessages(A) vẫn còn media`);
} catch (err) {
  record('Ngoại lệ chưa xử lý', false, err?.errorMessage || err?.message || String(err));
} finally {
  if (channel) {
    if (keepChannel) {
      console.log(`\n--keep: KHÔNG tự xoá kênh test. Tự vào Telegram xoá kênh id=${channel.id} khi xong.`);
    } else {
      try {
        await client.invoke(new Api.channels.DeleteChannel({ channel }));
        console.log('\nĐã tự xoá kênh test.');
      } catch (err) {
        console.error(`\n⚠️ KHÔNG tự xoá được kênh test (id=${channel.id}) — tự vào Telegram xoá tay. Lỗi: ${err?.errorMessage || err?.message}`);
      }
    }
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(report, null, 2));
  console.log(`\nKết quả đã ghi ra ${OUT_FILE}`);
  console.log(report.passed ? '\n=== TẤT CẢ BƯỚC ĐẠT ===' : '\n=== CÓ BƯỚC KHÔNG ĐẠT — xem chi tiết ở trên/trong file kết quả ===');
  await client.disconnect();
  process.exit(report.passed ? 0 : 1);
}
