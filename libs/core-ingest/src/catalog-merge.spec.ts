import { describe, expect, it } from 'vitest';
import { assertChannelWritable, buildCatalogEnvelope, mergeCatalogItems, NotChannelOwnerError, parseExistingCatalogItems } from './catalog-merge';

describe('assertChannelWritable', () => {
  it('isOwn=false → ném NotChannelOwnerError', () => {
    expect(() => assertChannelWritable({ isOwn: false })).toThrow(NotChannelOwnerError);
  });

  it('isOwn=true → không throw', () => {
    expect(() => assertChannelWritable({ isOwn: true })).not.toThrow();
  });
});

describe('parseExistingCatalogItems', () => {
  it('parse đúng mảng items hợp lệ', () => {
    const raw = JSON.stringify({ spec: 'tsmc-catalog/1', generatedAt: '2026-08-29T00:00:00Z', items: [{ msgId: 1, title: 'Inception' }] });
    expect(parseExistingCatalogItems(raw)).toEqual([{ msgId: 1, title: 'Inception' }]);
  });

  it('JSON hỏng → trả mảng rỗng, không throw', () => {
    expect(parseExistingCatalogItems('{not json')).toEqual([]);
  });

  it('items không phải mảng → trả mảng rỗng', () => {
    expect(parseExistingCatalogItems(JSON.stringify({ spec: 'tsmc-catalog/1' }))).toEqual([]);
  });

  it('item sai kiểu bị loại riêng, không làm hỏng cả mảng', () => {
    const raw = JSON.stringify({ items: [{ msgId: 1, title: 'OK' }, { msgId: 'not-a-number' }] });
    expect(parseExistingCatalogItems(raw)).toEqual([{ msgId: 1, title: 'OK' }]);
  });
});

describe('mergeCatalogItems', () => {
  it('gộp item mới vào item cũ, không trùng msgId', () => {
    const merged = mergeCatalogItems([{ msgId: 1, title: 'A' }], [{ msgId: 2, title: 'B' }]);
    expect(merged).toEqual([{ msgId: 1, title: 'A' }, { msgId: 2, title: 'B' }]);
  });

  it('trùng msgId → item MỚI thắng', () => {
    const merged = mergeCatalogItems([{ msgId: 1, title: 'Cũ' }], [{ msgId: 1, title: 'Mới' }]);
    expect(merged).toEqual([{ msgId: 1, title: 'Mới' }]);
  });
});

describe('buildCatalogEnvelope', () => {
  it('đóng gói đúng envelope tsmc-catalog/1, sanitize item qua schema', () => {
    const envelope = buildCatalogEnvelope({ id: '1', title: 'Kho Cá Nhân' }, [{ msgId: 1, title: 'Inception' }]);
    expect(envelope.spec).toBe('tsmc-catalog/1');
    expect(envelope.channel).toEqual({ id: '1', title: 'Kho Cá Nhân' });
    expect(envelope.items).toEqual([{ msgId: 1, title: 'Inception' }]);
    expect(typeof envelope.generatedAt).toBe('string');
  });

  it('item sai kiểu (msgId thiếu) bị loại khỏi envelope cuối', () => {
    const envelope = buildCatalogEnvelope({ id: '1', title: 'X' }, [{ msgId: undefined } as never]);
    expect(envelope.items).toEqual([]);
  });
});
