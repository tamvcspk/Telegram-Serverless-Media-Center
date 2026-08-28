import { inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Router, type CanActivateFn } from '@angular/router';
import * as Comlink from 'comlink';
import { firstValueFrom } from 'rxjs';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { StateChannelCandidate, StateChannelChoice } from '@tsmc/shared-models';
import { StateChannelResolutionDialog } from '../sync/state-channel-resolution-dialog/state-channel-resolution-dialog';
import { currentUser } from './current-user';

// Cache cấp module — initSync() (ADR-0009 hydrate) KHÔNG an toàn gọi hai lần
// (đăng ký thêm leader-change listener, hydrate lại từ đầu, xem
// libs/core-sync/src/sync-engine.ts). Guard này chạy lại MỖI LẦN điều hướng
// tới 'home' (kể cả quay lại từ /player) — nếu không cache, lần quay lại
// thứ hai sẽ gọi initSync() chồng lần đầu. Promise cache theo đúng pattern
// bootstrap-một-lần, KHÔNG phải state cần reset (Core Worker sống hết vòng
// đời trang, singleton — xem worker-host/src/index.ts).
let syncReady: Promise<void> | null = null;

function ensureSync(client: ReturnType<typeof createCoreWorkerClient>, dialog: MatDialog): Promise<void> {
  syncReady ??= client
    .initSync(
      Comlink.proxy({
        chooseCandidate: async (candidates: StateChannelCandidate[]): Promise<StateChannelChoice> => {
          const ref = dialog.open(StateChannelResolutionDialog, { data: { candidates }, disableClose: true });
          const choice = await firstValueFrom(ref.afterClosed());
          // disableClose:true + dialog chỉ close(choice) qua nút thật — undefined
          // về lý thuyết không xảy ra, vẫn cần giá trị hợp lệ để không treo
          // resolveStateChannel() phía Core Worker mãi mãi.
          return choice ?? { kind: 'use', channelId: candidates[0].id };
        }
      })
    )
    .then(() => undefined);
  return syncReady;
}

/**
 * Gate cho route 'home' (F1.1, xem ui-conventions §6) — chỗ DUY NHẤT gọi
 * initSync() trong app, thay cho login.ts trước đây. Lý do gộp về một chỗ:
 * initSync() phải chạy đúng MỘT LẦN dù user vào 'home' bằng cách nào (đăng
 * nhập mới rồi điều hướng, hay tải lại trang khi session vẫn còn) — để rải
 * logic này ra cả login.ts lẫn guard sẽ dễ gọi trùng, đúng bug đang tránh.
 */
export const authGuard: CanActivateFn = async () => {
  const client = createCoreWorkerClient();
  // BẮT BUỘC inject() cả hai TRƯỚC await đầu tiên — Angular chỉ cho gọi
  // inject() trong lúc hàm guard còn chạy đồng bộ (injection context), gọi
  // sau một `await` (như MatDialog ở dòng cuối bản trước) ném NG0203, guard
  // reject âm thầm → điều hướng sang 'home' đứng lại không rõ lỗi (bug thật
  // gặp lúc submit xong bước 1).
  const router = inject(Router);
  const dialog = inject(MatDialog);

  let session;
  try {
    session = await client.restoreSession();
  } catch {
    // Session cũ lỗi (chết, hết hạn) → coi như chưa đăng nhập, không phải
    // lỗi cần chặn hẳn điều hướng — cùng cách xử lý với login.ts trước đây.
    session = null;
  }

  if (!session) {
    return router.parseUrl('/login');
  }

  currentUser.set(session);
  await ensureSync(client, dialog);
  return true;
};
