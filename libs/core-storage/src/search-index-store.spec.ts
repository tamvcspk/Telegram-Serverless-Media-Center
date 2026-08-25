import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { getSearchIndexBlob, putSearchIndexBlob } from './search-index-store';

describe('@tsmc/core-storage search index store', () => {
  it('getSearchIndexBlob(): undefined khi chưa từng lưu', async () => {
    expect(await getSearchIndexBlob()).toBeUndefined();
  });

  it('putSearchIndexBlob() rồi getSearchIndexBlob(): trả đúng chuỗi vừa lưu, lần lưu sau ghi đè lần trước', async () => {
    await putSearchIndexBlob('{"a":1}');
    expect(await getSearchIndexBlob()).toBe('{"a":1}');

    await putSearchIndexBlob('{"a":2}');
    expect(await getSearchIndexBlob()).toBe('{"a":2}');
  });
});
