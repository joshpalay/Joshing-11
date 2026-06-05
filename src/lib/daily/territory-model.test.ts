import { describe, expect, it } from 'vitest';

import {
  buildInitialFrequencyMap,
  buildSavePayload,
  getNearbyTerritories,
  normalizeDomainPreferenceFrequency,
  type TerritoryDomain,
} from './territory-model';

const domains: TerritoryDomain[] = [
  {
    domain: 'Macbeth',
    broadCategory: 'Literature',
    totalPoints: 120,
    tier: 'familiar',
    correctAnswerCount: 3,
  },
  {
    domain: 'Bach',
    broadCategory: 'Music',
    totalPoints: 600,
    tier: 'familiar',
    correctAnswerCount: 7,
  },
  {
    domain: 'Byzantine Coinage',
    broadCategory: null,
    totalPoints: 0,
    tier: 'establishing',
    correctAnswerCount: 0,
  },
];

describe('territory setup model', () => {
  it('migrates existing custom selected domains into sometimes and unselected domains into resting', () => {
    expect(
      buildInitialFrequencyMap({
        domains,
        savedFrequency: null,
        selectedDomains: ['Macbeth'],
        domainMode: 'custom',
      }),
    ).toEqual({
      Macbeth: 'sometimes',
      Bach: 'resting',
      'Byzantine Coinage': 'resting',
    });
  });

  it('keeps a saved three-zone frequency map when available', () => {
    expect(
      buildInitialFrequencyMap({
        domains,
        savedFrequency: { Macbeth: 'often', Bach: 'resting', Unknown: 'often' },
        selectedDomains: [],
        domainMode: 'random',
      }),
    ).toEqual({
      Macbeth: 'often',
      Bach: 'resting',
      'Byzantine Coinage': 'sometimes',
    });
  });

  it('builds the compatibility save payload from zone state', () => {
    expect(
      buildSavePayload({
        difficulty: 'adaptive',
        frequencyByDomain: { Macbeth: 'often', Bach: 'sometimes', 'Byzantine Coinage': 'resting' },
      }),
    ).toEqual({
      difficulty: 'adaptive',
      domainMode: 'custom',
      selectedDomains: ['Macbeth', 'Bach'],
      domainPreferenceFrequency: {
        Macbeth: 'often',
        Bach: 'sometimes',
        'Byzantine Coinage': 'resting',
      },
    });
  });

  it('sanitizes invalid frequency maps', () => {
    expect(
      normalizeDomainPreferenceFrequency(
        { Macbeth: 'often', Bach: 'daily', '': 'resting', Unknown: 'sometimes' },
        ['Macbeth', 'Bach'],
      ),
    ).toEqual({ Macbeth: 'often' });
  });

  it('suggests nearby territories without duplicating existing domains', () => {
    expect(
      getNearbyTerritories(['Macbeth', 'Counterpoint'], ['Macbeth', 'Hamlet', 'Counterpoint']).map(
        (item) => item.domain,
      ),
    ).toEqual([
      'King Lear',
      'Shakespearean Tragedy',
      'Fugue Technique',
      'Well-Tempered Clavier',
      'Baroque Organ Music',
    ]);
  });
});
