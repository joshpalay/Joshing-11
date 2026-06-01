import { describe, expect, it, vi } from 'vitest';

describe('consolidateProfileDomainVisibility', () => {
  it('deletes colliding visibility aliases and inserts one target row with the most restrictive visibility', async () => {
    process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
    const { consolidateProfileDomainVisibility } = await import('@/server/mastery/ceremony');
    const existingRows = [{ visibility: 'public' as const }, { visibility: 'private' as const }];
    const selectWhere = vi.fn(async () => existingRows);
    const deleteWhere = vi.fn(async () => undefined);
    const insertValues = vi.fn(async () => undefined);
    const fixedDate = new Date('2026-05-12T00:00:00.000Z');
    const tx = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({ where: selectWhere })),
      })),
      delete: vi.fn(() => ({ where: deleteWhere })),
      insert: vi.fn(() => ({ values: insertValues })),
    };

    await consolidateProfileDomainVisibility(tx as never, {
      userId: 'user-1',
      sourceDomains: ['Joyce Ulysses', 'Ulysses - Structure'],
      target: 'Ulysses',
      updatedAt: fixedDate,
    });

    expect(selectWhere).toHaveBeenCalledTimes(1);
    expect(deleteWhere).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledWith({
      userId: 'user-1',
      canonicalSubcategory: 'Ulysses',
      domain: 'Ulysses',
      visibility: 'private',
      isVisible: false,
      updatedAt: fixedDate,
    });
  });
});
