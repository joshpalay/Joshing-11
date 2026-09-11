// R8 (2026-09-11) — per-defect split of the quality gate's drop counter.
//
// The aggregate `quality` row records that ~31% of candidates were dropped but
// not WHICH rule fired, so a prompt change targeting one defect (R1's
// GENERIC_AT_TIER, R2's DEFINITION_SUPPLIED) could not be distinguished from the
// gate merely going quiet. These tests pin the parsing and tallying that turns
// the gate's existing reason prefixes into per-defect counters — no schema
// change, since GateDropStat.gate is a plain text column.

import { describe, expect, it } from 'vitest';

import {
  QUALITY_DEFECTS,
  parseQualityDefect,
  qualityDefectGate,
  tallyQualityDefects,
} from '@/server/db/queries/gate-drop-stats';

describe('parseQualityDefect', () => {
  it('reads the defect name off the gate\'s reason prefix', () => {
    expect(parseQualityDefect('OFF_DOMAIN: question is about Joyce, filed under Woolf')).toBe(
      'OFF_DOMAIN',
    );
    expect(parseQualityDefect('DEFINITION_SUPPLIED: the setup fully describes the answer')).toBe(
      'DEFINITION_SUPPLIED',
    );
  });

  it('tolerates leading whitespace and lowercase', () => {
    expect(parseQualityDefect('  generic_at_tier: roster question')).toBe('GENERIC_AT_TIER');
  });

  it('returns null for an unrecognised or missing prefix', () => {
    expect(parseQualityDefect('this question is bad')).toBeNull();
    expect(parseQualityDefect('NOT_A_DEFECT: something')).toBeNull();
    expect(parseQualityDefect('')).toBeNull();
  });
});

describe('tallyQualityDefects', () => {
  it('counts each defect and carries the batch size as the denominator', () => {
    const entries = tallyQualityDefects(
      {
        0: 'GENERIC_AT_TIER: roster question at accessible',
        2: 'DEFINITION_SUPPLIED: stem names the answer',
        5: 'GENERIC_AT_TIER: title lead',
      },
      9,
    );
    const byGate = Object.fromEntries(entries.map((e) => [e.gate, e]));
    expect(byGate['quality:GENERIC_AT_TIER'].dropped).toBe(2);
    expect(byGate['quality:DEFINITION_SUPPLIED'].dropped).toBe(1);
    expect(byGate['quality:GENERIC_AT_TIER'].considered).toBe(9);
  });

  it('emits every known defect, so one that never fires reads as a measured zero', () => {
    const entries = tallyQualityDefects({ 0: 'FALSE_PREMISE: bad count' }, 3);
    expect(entries).toHaveLength(QUALITY_DEFECTS.length);
    const byGate = Object.fromEntries(entries.map((e) => [e.gate, e]));
    for (const defect of QUALITY_DEFECTS) {
      expect(byGate[qualityDefectGate(defect)]).toBeDefined();
    }
    expect(byGate['quality:MULTI_PART'].dropped).toBe(0);
    // A zero-drop defect still carries the denominator — that is what separates
    // "checked, never fired" from "not measured".
    expect(byGate['quality:MULTI_PART'].considered).toBe(3);
  });

  it('ignores reasons the model emitted without a recognised prefix', () => {
    const entries = tallyQualityDefects({ 0: 'just not very good', 1: 'MULTI_PART: two asks' }, 2);
    const byGate = Object.fromEntries(entries.map((e) => [e.gate, e]));
    expect(byGate['quality:MULTI_PART'].dropped).toBe(1);
    expect(entries.reduce((sum, e) => sum + e.dropped, 0)).toBe(1);
  });

  it('namespaces defect counters under the parent gate', () => {
    expect(qualityDefectGate('OFF_DOMAIN')).toBe('quality:OFF_DOMAIN');
  });
});
