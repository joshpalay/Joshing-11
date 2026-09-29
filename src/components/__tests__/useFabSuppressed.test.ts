import { describe, expect, it } from 'vitest';

import { shouldSuppressFab } from '@/components/useFabSuppressed';

function el(tagName: string, { type, inChrome = false, editable = false } = {} as {
  type?: string;
  inChrome?: boolean;
  editable?: boolean;
}) {
  return {
    tagName,
    isContentEditable: editable,
    getAttribute: (name: string) => (name === 'type' ? (type ?? null) : null),
    closest: (selector: string) => (selector === '[data-app-chrome]' && inChrome ? {} : null),
  };
}

function doc({ hideFab = false, active = null as ReturnType<typeof el> | null } = {}) {
  return {
    querySelector: (selector: string) => (selector === '[data-hide-fab]' && hideFab ? {} : null),
    activeElement: active,
  };
}

describe('shouldSuppressFab (QA 2026-09-27, N26)', () => {
  it('shows the button on a plain page', () => {
    expect(shouldSuppressFab(doc({ active: el('BUTTON') }))).toBe(false);
    expect(shouldSuppressFab(doc())).toBe(false);
  });

  it('steps aside while a confirm panel marked data-hide-fab is open', () => {
    expect(shouldSuppressFab(doc({ hideFab: true }))).toBe(true);
  });

  it('steps aside while a text field has focus', () => {
    expect(shouldSuppressFab(doc({ active: el('INPUT', { type: 'text' }) }))).toBe(true);
    expect(shouldSuppressFab(doc({ active: el('INPUT') }))).toBe(true);
    expect(shouldSuppressFab(doc({ active: el('TEXTAREA') }))).toBe(true);
    expect(shouldSuppressFab(doc({ active: el('DIV', { editable: true }) }))).toBe(true);
  });

  it('ignores checkboxes and fields inside the app chrome', () => {
    expect(shouldSuppressFab(doc({ active: el('INPUT', { type: 'checkbox' }) }))).toBe(false);
    expect(shouldSuppressFab(doc({ active: el('INPUT', { inChrome: true }) }))).toBe(false);
  });
});
