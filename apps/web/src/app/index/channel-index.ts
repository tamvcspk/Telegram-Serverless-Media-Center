import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { countMediaBySource, getIndexMeta, getSyncState, liveQuery, type IndexMetaRecord } from '@tsmc/core-storage';
import { createCoreWorkerClient } from '@tsmc/worker-host';
import type { SourceRef } from '@tsmc/shared-models';
import { from } from 'rxjs';

interface SourceRow {
  source: SourceRef;
  meta: IndexMetaRecord;
  itemCount: number;
}

// Khớp cấu trúc ChannelDiagnosticMessage (core-mtproto/gateway-index.ts) —
// định nghĩa lại tại đây thay vì import, vì apps/web KHÔNG được import
// core-mtproto trực tiếp (CLAUDE.md bất biến #4, chỉ qua worker-host).
interface DiagnosticMessage {
  msgId: number;
  publisherId: string;
  mediaKind: 'document' | 'photo' | 'other' | 'none';
  mimeType?: string;
  fileName?: string;
  hasVideoAttrNoFilename: boolean;
  size?: number;
}

interface DiagnosticsSummary {
  scanned: number;
  mediaKind: Record<'document' | 'photo' | 'other' | 'none', number>;
  documentsWithFilename: number;
  documentsWithoutFilename: number;
  hasVideoAttrNoFilename: number;
  mimeTypes: readonly (readonly [string, number])[];
  publisherCount: number;
}

function summarizeDiagnostics(messages: readonly DiagnosticMessage[]): DiagnosticsSummary {
  const mediaKind = { document: 0, photo: 0, other: 0, none: 0 };
  let documentsWithFilename = 0;
  let documentsWithoutFilename = 0;
  let hasVideoAttrNoFilename = 0;
  const mimeTypes = new Map<string, number>();
  const publishers = new Set<string>();

  for (const m of messages) {
    mediaKind[m.mediaKind]++;
    publishers.add(m.publisherId);
    if (m.mediaKind === 'document') {
      if (m.fileName) {
        documentsWithFilename++;
      } else {
        documentsWithoutFilename++;
      }
      if (m.hasVideoAttrNoFilename) {
        hasVideoAttrNoFilename++;
      }
      if (m.mimeType) {
        mimeTypes.set(m.mimeType, (mimeTypes.get(m.mimeType) ?? 0) + 1);
      }
    }
  }

  return {
    scanned: messages.length,
    mediaKind,
    documentsWithFilename,
    documentsWithoutFilename,
    hasVideoAttrNoFilename,
    mimeTypes: [...mimeTypes.entries()].sort((a, b) => b[1] - a[1]),
    publisherCount: publishers.size
  };
}

/**
 * Màn hình xác minh tối thiểu cho slice Index (F2, ADR-0010) — mirror
 * sync-status.ts: đọc thẳng IndexedDB qua liveQuery (đường đọc, ADR-0007),
 * RPC chỉ để trigger scan. `needsFullScanConfirmation` chỉ tồn tại trong kết
 * quả RPC (không lưu Dexie) nên giữ ở signal cục bộ, mất khi rời trang —
 * chấp nhận được cho màn hình xác minh, không phải UI thật.
 */
@Component({
  selector: 'app-channel-index',
  imports: [DatePipe, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './channel-index.html',
  styleUrl: './channel-index.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ChannelIndex {
  private readonly client = createCoreWorkerClient();

  readonly rows = toSignal(
    from(
      liveQuery(async (): Promise<SourceRow[]> => {
        const state = await getSyncState();
        const sources = Object.values(state.sources).filter((s) => !s.removed);
        return Promise.all(
          sources.map(async (source) => ({
            source,
            meta: await getIndexMeta(source.id),
            itemCount: await countMediaBySource(source.id)
          }))
        );
      })
    ),
    { initialValue: [] as SourceRow[] }
  );

  readonly addingSource = signal(false);
  readonly scanningIds = signal<ReadonlySet<string>>(new Set());
  readonly needsFullScanIds = signal<ReadonlySet<string>>(new Set());
  readonly actionError = signal<string | null>(null);

  // Chẩn đoán (không lọc gì cả — xem summarizeDiagnostics) để trả lời "kênh
  // này thật ra có gì" trước khi chỉnh filter thật của scanSource(). Kết
  // quả chỉ giữ trong bộ nhớ tab (không lưu Dexie) — công cụ debug tạm thời.
  readonly diagnosingIds = signal<ReadonlySet<string>>(new Set());
  readonly diagnostics = signal<ReadonlyMap<string, DiagnosticsSummary>>(new Map());

  // "Chọn từ danh sách" — thay cho việc bắt user tự gõ/dán username/invite
  // link (nguồn lỗi resolve thật đã gặp: sai định dạng +HASH, link t.me/c/
  // nội bộ...). Chọn thẳng từ listMemberChannels() cho MỌI channel/nhóm đã
  // tham gia (không riêng kênh có quyền admin), lưu ref dạng t.me/c/<id> —
  // đã có sẵn resolve path (resolveIndexChannel qua dialog CỦA CHÍNH tài
  // khoản này, không phải chia sẻ id thô cho người khác — CLAUDE.md #10).
  readonly showPicker = signal(false);
  readonly loadingMemberChannels = signal(false);
  readonly memberChannels = signal<readonly { id: string; title: string; isBroadcast: boolean }[]>([]);

  async onAddSource(event: Event, refInput: HTMLInputElement): Promise<void> {
    event.preventDefault();
    const ref = refInput.value.trim();
    if (!ref) {
      return;
    }
    this.addingSource.set(true);
    this.actionError.set(null);
    try {
      await this.client.addSource(crypto.randomUUID(), ref);
      refInput.value = '';
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.addingSource.set(false);
    }
  }

  async onTogglePicker(): Promise<void> {
    const next = !this.showPicker();
    this.showPicker.set(next);
    if (!next || this.memberChannels().length > 0) {
      return;
    }
    this.loadingMemberChannels.set(true);
    this.actionError.set(null);
    try {
      this.memberChannels.set(await this.client.listMemberChannels());
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.loadingMemberChannels.set(false);
    }
  }

  sourceLabel(source: SourceRef): string {
    const title = source.patch?.['title'];
    return typeof title === 'string' && title.length > 0 ? title : source.ref;
  }

  async onPickChannel(channel: { id: string; title: string }): Promise<void> {
    this.addingSource.set(true);
    this.actionError.set(null);
    try {
      const sourceId = crypto.randomUUID();
      await this.client.addSource(sourceId, `https://t.me/c/${channel.id}`);
      await this.client.configureSource(sourceId, { title: channel.title });
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.addingSource.set(false);
    }
  }

  async onDiagnose(sourceId: string, ref: string): Promise<void> {
    this.diagnosingIds.update((prev) => new Set(prev).add(sourceId));
    this.actionError.set(null);
    try {
      const messages = (await this.client.diagnoseChannel(ref, 500)) as DiagnosticMessage[];
      this.diagnostics.update((prev) => new Map(prev).set(sourceId, summarizeDiagnostics(messages)));
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.diagnosingIds.update((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  }

  async onScan(sourceId: string, ref: string, opts?: { tier: 'full' }): Promise<void> {
    this.scanningIds.update((prev) => new Set(prev).add(sourceId));
    this.actionError.set(null);
    try {
      const result = await this.client.scanSource(sourceId, ref, opts);
      this.needsFullScanIds.update((prev) => {
        const next = new Set(prev);
        if (result.needsFullScanConfirmation) {
          next.add(sourceId);
        } else {
          next.delete(sourceId);
        }
        return next;
      });
      if (result.error) {
        this.actionError.set(result.error);
      }
    } catch (err) {
      this.actionError.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.scanningIds.update((prev) => {
        const next = new Set(prev);
        next.delete(sourceId);
        return next;
      });
    }
  }
}
