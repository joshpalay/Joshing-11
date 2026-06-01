import { describe, expect, it } from 'vitest';
import { ceremonyModeFromAnsweringCount } from '@/lib/ceremony/mode';

describe('ceremonyModeFromAnsweringCount (F3.2)', () => {
  it('classifies 0 or 1 active answering players as solo', () => {
    expect(ceremonyModeFromAnsweringCount(0)).toBe('solo');
    expect(ceremonyModeFromAnsweringCount(1)).toBe('solo');
  });

  it('classifies 2 as duo', () => {
    expect(ceremonyModeFromAnsweringCount(2)).toBe('duo');
  });

  it('classifies 3 or more as group', () => {
    expect(ceremonyModeFromAnsweringCount(3)).toBe('group');
    expect(ceremonyModeFromAnsweringCount(10)).toBe('group');
  });
});
