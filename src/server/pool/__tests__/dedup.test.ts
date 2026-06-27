import { describe, expect, it } from 'vitest';

import {
  DEFAULT_DEDUP_COSINE_THRESHOLD,
  DEFAULT_DIFFERENT_FACT_COSINE_THRESHOLD,
  resolveCollision,
} from '@/server/pool/dedup';
import type { NearestPoolMatch } from '@/server/db/queries/pool';

const T = DEFAULT_DEDUP_COSINE_THRESHOLD;
const DT = DEFAULT_DIFFERENT_FACT_COSINE_THRESHOLD;
const near = (over: Partial<NearestPoolMatch> & Pick<NearestPoolMatch, 'origin'>): NearestPoolMatch => ({
  id: 'existing-1',
  similarity: 0.99,
  factKey: null,
  ...over,
});

describe('resolveCollision — the collision matrix (Drift Risk 2)', () => {
  // Row 1: new machine vs existing machine → suppress the NEW one.
  it('machine vs machine → suppress incoming, survivor is the existing row', () => {
    const d = resolveCollision({ id: 'new-m', origin: 'machine' }, near({ id: 'old-m', origin: 'machine' }), T);
    expect(d).toEqual({ action: 'suppress_incoming', survivorId: 'old-m' });
  });

  // Row 2: new machine vs existing human → suppress the NEW (machine) one.
  it('machine vs human → suppress incoming (machine), human survives', () => {
    const d = resolveCollision({ id: 'new-m', origin: 'machine' }, near({ id: 'old-h', origin: 'human' }), T);
    expect(d).toEqual({ action: 'suppress_incoming', survivorId: 'old-h' });
  });

  // Row 3 (THE one that must not be backwards): new human vs existing machine →
  // keep the HUMAN, suppress the EXISTING machine row.
  it('human vs machine → suppress the EXISTING machine row, human survives', () => {
    const d = resolveCollision({ id: 'new-h', origin: 'human' }, near({ id: 'old-m', origin: 'machine' }), T);
    expect(d).toEqual({
      action: 'suppress_existing',
      existingId: 'old-m',
      existingOrigin: 'machine',
      survivorId: 'new-h',
    });
  });

  // Row 4: new human vs existing human → suppress the NEW one.
  it('human vs human → suppress incoming, survivor is the existing row', () => {
    const d = resolveCollision({ id: 'new-h', origin: 'human' }, near({ id: 'old-h', origin: 'human' }), T);
    expect(d).toEqual({ action: 'suppress_incoming', survivorId: 'old-h' });
  });

  it('never suppresses below the similarity threshold', () => {
    const d = resolveCollision(
      { id: 'new-h', origin: 'human' },
      near({ id: 'old-m', origin: 'machine', similarity: T - 0.01 }),
      T,
    );
    expect(d).toEqual({ action: 'none' });
  });

  it('does nothing when there is no neighbour', () => {
    expect(resolveCollision({ id: 'new-m', origin: 'machine' }, null, T)).toEqual({ action: 'none' });
  });

  it('suppresses exactly at the threshold (>= is a collision)', () => {
    const d = resolveCollision(
      { id: 'new-h', origin: 'human' },
      near({ id: 'old-m', origin: 'machine', similarity: T }),
      T,
    );
    expect(d.action).toBe('suppress_existing');
  });
});

describe('resolveCollision — fact_key-aware threshold (false-suppression fix)', () => {
  // The bug: distinct facts about one work ("In 'Paradise Lost,' …") embed above
  // the base 0.92 threshold and were suppressed. When both fact_keys are present
  // and DIFFER, only near-identical text (>= differentFactThreshold) may suppress.
  it('does NOT suppress different facts that merely share a work’s vocabulary', () => {
    const d = resolveCollision(
      { id: 'new-m', origin: 'machine', factKey: 'pl-mulciber-pandaemonium' },
      near({ id: 'old-m', origin: 'machine', similarity: 0.95, factKey: 'pl-satan-spear-simile' }),
      T,
      DT,
    );
    expect(d).toEqual({ action: 'none' });
  });

  it('STILL suppresses near-identical text even when the fact_keys differ', () => {
    // Two phrasings of the same speech that got slightly different fact_key strings
    // (observed: satan-reign-hell vs satan-reign-hell-speech) — near 1.0 similarity.
    const d = resolveCollision(
      { id: 'new-m', origin: 'machine', factKey: 'pl-satan-reign-hell' },
      near({ id: 'old-m', origin: 'machine', similarity: 0.999, factKey: 'pl-satan-reign-hell-speech' }),
      T,
      DT,
    );
    expect(d).toEqual({ action: 'suppress_incoming', survivorId: 'old-m' });
  });

  it('suppresses when fact_keys MATCH at the base threshold (same fact)', () => {
    const d = resolveCollision(
      { id: 'new-m', origin: 'machine', factKey: 'pl-satan-reign-hell' },
      near({ id: 'old-m', origin: 'machine', similarity: 0.94, factKey: 'pl-satan-reign-hell' }),
      T,
      DT,
    );
    expect(d).toEqual({ action: 'suppress_incoming', survivorId: 'old-m' });
  });

  it('falls back to the base threshold when one fact_key is absent', () => {
    // Human survivors carry no fact_key → the high bar must NOT apply.
    const d = resolveCollision(
      { id: 'new-m', origin: 'machine', factKey: 'pl-mulciber-pandaemonium' },
      near({ id: 'old-h', origin: 'human', similarity: 0.95, factKey: null }),
      T,
      DT,
    );
    expect(d).toEqual({ action: 'suppress_incoming', survivorId: 'old-h' });
  });
});
