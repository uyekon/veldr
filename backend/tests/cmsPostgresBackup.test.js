import { describe, expect, it } from 'vitest';
import { assertSafeUploadTarget } from '../scripts/cms-postgres-backup.js';

describe('PostgreSQL restore path safety', () => {
  it('rejects broad workspace targets and accepts an explicit attachment directory', () => {
    expect(() => assertSafeUploadTarget('/')).toThrow(/unsafe/);
    expect(() => assertSafeUploadTarget(process.cwd())).toThrow(/unsafe/);
    expect(() => assertSafeUploadTarget('..')).toThrow(/unsafe/);
    expect(assertSafeUploadTarget('/opt/veldr/restore-test/uploads/cms')).toBe('/opt/veldr/restore-test/uploads/cms');
  });
});
