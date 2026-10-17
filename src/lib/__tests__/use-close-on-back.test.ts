import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bindCloseOnBack } from '../use-close-on-back';

// QA 2026-10-17 S3: phone Back with the "Not for me" sheet open left the round.
// A fake window with a real-enough history stack: pushState adds an entry,
// back() pops one and fires popstate (async in browsers; a timer here).

function fakeWindow() {
  const entries: unknown[] = [{ __NA: true, tree: 'round' }];
  let index = 0;
  const listeners = new Set<() => void>();
  const win = {
    history: {
      get state() {
        return entries[index];
      },
      pushState(state: unknown) {
        entries.splice(index + 1);
        entries.push(state);
        index += 1;
      },
      back() {
        setTimeout(() => {
          if (index === 0) return;
          index -= 1;
          listeners.forEach((fn) => fn());
        }, 0);
      },
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  };
  return { win: win as never, depth: () => index, entries };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('bindCloseOnBack', () => {
  it('Back closes the sheet and leaves the page where it was', async () => {
    const { win, depth } = fakeWindow();
    const onClose = vi.fn();
    const cleanup = bindCloseOnBack(win, onClose);
    expect(depth()).toBe(1);
    (win as { history: History }).history.back();
    await vi.runAllTimersAsync();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(depth()).toBe(0);

    cleanup(); // the sheet unmounts after onClose
    await vi.runAllTimersAsync();
    expect(depth()).toBe(0); // no second step back off the page
  });

  it('closing another way removes the extra entry without calling onClose', async () => {
    const { win, depth } = fakeWindow();
    const onClose = vi.fn();
    const cleanup = bindCloseOnBack(win, onClose);

    cleanup();
    await vi.runAllTimersAsync();
    expect(depth()).toBe(0);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the router state on the extra entry', () => {
    const { win, entries } = fakeWindow();
    bindCloseOnBack(win, vi.fn());
    expect(entries[1]).toMatchObject({ __NA: true, tree: 'round' });
  });

  it('survives a dev double-mount without stacking or losing the entry', async () => {
    const { win, depth } = fakeWindow();
    const onClose = vi.fn();
    bindCloseOnBack(win, onClose)(); // mount + immediate cleanup
    const cleanup = bindCloseOnBack(win, onClose); // remount in the same tick
    await vi.runAllTimersAsync();
    expect(depth()).toBe(1);
    (win as { history: History }).history.back();
    await vi.runAllTimersAsync();
    expect(onClose).toHaveBeenCalledTimes(1);
    cleanup();
    await vi.runAllTimersAsync();
    expect(depth()).toBe(0);
  });
});
