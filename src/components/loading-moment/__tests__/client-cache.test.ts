import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearCachedLoadingMomentPayload,
  readCachedLoadingMomentPayload,
} from "../client-cache";

const STORAGE_KEY = "joshing.loadingMoment.v1";

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    has: (k: string) => map.has(k),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("loading-moment client cache", () => {
  it("reads a stored payload, and clear() removes it (cross-user guard)", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { sessionStorage: storage });
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ generatedAt: 123, deepestTerritory: { subcategory: "Italian Renaissance" } }),
    );

    expect(readCachedLoadingMomentPayload()?.deepestTerritory?.subcategory).toBe(
      "Italian Renaissance",
    );

    clearCachedLoadingMomentPayload();
    expect(storage.has(STORAGE_KEY)).toBe(false);
    expect(readCachedLoadingMomentPayload()).toBeNull();
  });

  it("returns null when nothing is cached", () => {
    vi.stubGlobal("window", { sessionStorage: fakeStorage() });
    expect(readCachedLoadingMomentPayload()).toBeNull();
  });

  it("rejects a malformed or mistyped payload", () => {
    const storage = fakeStorage();
    vi.stubGlobal("window", { sessionStorage: storage });

    storage.setItem(STORAGE_KEY, "{ not json");
    expect(readCachedLoadingMomentPayload()).toBeNull();

    storage.setItem(STORAGE_KEY, JSON.stringify({ deepestTerritory: { subcategory: 123 } }));
    expect(readCachedLoadingMomentPayload()).toBeNull();
  });

  it("is SSR-safe (no window) — read returns null, clear is a no-op", () => {
    // No window stubbed → typeof window === "undefined".
    expect(readCachedLoadingMomentPayload()).toBeNull();
    expect(() => clearCachedLoadingMomentPayload()).not.toThrow();
  });
});
