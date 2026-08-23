import { describe, expect, it } from 'vitest';
import { LIB_NAME } from './index';

describe('@tsmc/core-download', () => {
  it('compiles and runs under plain Node (no Angular runtime)', () => {
    expect(LIB_NAME).toBe('@tsmc/core-download');
  });
});
