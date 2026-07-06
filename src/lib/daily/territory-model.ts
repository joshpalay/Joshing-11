export type TerritoryFrequency = 'often' | 'sometimes' | 'blue_moon' | 'resting';

export type TerritoryDomain = {
  domain: string;
  broadCategory: string | null;
  totalPoints: number;
  tier: 'establishing' | 'familiar' | 'solid' | 'mastery';
  correctAnswerCount: number;
};

export type DomainPreferenceFrequency = Record<string, TerritoryFrequency>;

export const TERRITORY_FREQUENCIES = ['often', 'sometimes', 'blue_moon', 'resting'] as const;

// Player-facing labels for each frequency tier. Single source of truth shared by
// the Territory Setup zones and the "New territory" reveal card so the wording
// stays consistent. The enum values are internal; only these strings are shown.
export const TERRITORY_FREQUENCY_LABEL: Record<TerritoryFrequency, string> = {
  often: 'Often',
  sometimes: 'Sometimes',
  blue_moon: 'Blue Moon',
  resting: 'Never',
};

// The one-line description shown under each frequency label. Single source of
// truth for the Territory Setup zones (`ZONES` in TerritorySetupClient) and the
// knowledge peaks detail sheet's frequency block, so the wording stays identical
// across every surface that lets a player set rotation.
export const TERRITORY_FREQUENCY_COPY: Record<TerritoryFrequency, string> = {
  often: 'These show up most in your rounds.',
  sometimes: 'These stay in rotation, but less often.',
  blue_moon: 'Still on your map, but only surface every so often.',
  resting: 'These are part of your map, but won’t be asked for now.',
};

export function isTerritoryFrequency(value: unknown): value is TerritoryFrequency {
  return value === 'often' || value === 'sometimes' || value === 'blue_moon' || value === 'resting';
}

function normalizeDomainKey(domain: string): string {
  return domain.trim().toLocaleLowerCase('en-US');
}

export function normalizeDomainPreferenceFrequency(
  value: unknown,
  allowedDomains?: readonly string[],
): DomainPreferenceFrequency {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = allowedDomains ? new Set(allowedDomains.map(normalizeDomainKey)) : null;
  const result: DomainPreferenceFrequency = {};
  for (const [domain, frequency] of Object.entries(value as Record<string, unknown>)) {
    const trimmed = domain.trim();
    if (!trimmed || !isTerritoryFrequency(frequency)) continue;
    if (allowed && !allowed.has(normalizeDomainKey(trimmed))) continue;
    result[trimmed] = frequency;
  }
  return result;
}

export function buildInitialFrequencyMap({
  domains,
  savedFrequency,
  selectedDomains,
  domainMode,
}: {
  domains: readonly TerritoryDomain[];
  savedFrequency?: DomainPreferenceFrequency | null;
  selectedDomains: readonly string[];
  domainMode: 'random' | 'custom';
}): DomainPreferenceFrequency {
  const domainNames = domains.map((domain) => domain.domain);
  const normalizedSaved = normalizeDomainPreferenceFrequency(savedFrequency, domainNames);
  const selected = new Set(selectedDomains.map(normalizeDomainKey));
  const result: DomainPreferenceFrequency = {};

  for (const domain of domains) {
    const saved = normalizedSaved[domain.domain];
    if (saved) {
      result[domain.domain] = saved;
    } else if (domainMode === 'custom') {
      result[domain.domain] = selected.has(normalizeDomainKey(domain.domain))
        ? 'sometimes'
        : 'resting';
    } else {
      result[domain.domain] = 'sometimes';
    }
  }

  return result;
}

export function buildSavePayload({
  difficulty,
  frequencyByDomain,
}: {
  difficulty: string;
  frequencyByDomain: DomainPreferenceFrequency;
}) {
  const selectedDomains = Object.entries(frequencyByDomain)
    .filter(([, frequency]) => frequency !== 'resting')
    .map(([domain]) => domain);

  return {
    difficulty,
    domainMode: selectedDomains.length > 0 ? ('custom' as const) : ('random' as const),
    selectedDomains,
    domainPreferenceFrequency: frequencyByDomain,
  };
}

export type NearbyTerritory = {
  domain: string;
  broadCategory: string | null;
  reason: string;
};

const ADJACENT_TERRITORY_RULES: Array<{
  match: RegExp;
  suggestions: NearbyTerritory[];
}> = [
  {
    match: /\bmacbeth\b/i,
    suggestions: [
      { domain: 'Hamlet', broadCategory: 'Literature', reason: 'Near Macbeth' },
      { domain: 'King Lear', broadCategory: 'Literature', reason: 'Near Macbeth' },
      { domain: 'Shakespearean Tragedy', broadCategory: 'Literature', reason: 'Near Macbeth' },
    ],
  },
  {
    match: /\b(joyce|james joyce|ulysses|mrs\.? dalloway)\b/i,
    suggestions: [
      { domain: 'Virginia Woolf', broadCategory: 'Literature', reason: 'Near modernist fiction' },
      { domain: 'Bloomsbury Group', broadCategory: 'Literature', reason: 'Near modernist fiction' },
      {
        domain: 'To the Lighthouse',
        broadCategory: 'Literature',
        reason: 'Near modernist fiction',
      },
    ],
  },
  {
    match: /\b(bach|counterpoint)\b/i,
    suggestions: [
      { domain: 'Fugue Technique', broadCategory: 'Music', reason: 'Near Bach and counterpoint' },
      {
        domain: 'Well-Tempered Clavier',
        broadCategory: 'Music',
        reason: 'Near Bach and counterpoint',
      },
      {
        domain: 'Baroque Organ Music',
        broadCategory: 'Music',
        reason: 'Near Bach and counterpoint',
      },
    ],
  },
];

export function getNearbyTerritories(
  domains: readonly string[],
  existingDomains: readonly string[] = domains,
): NearbyTerritory[] {
  const existing = new Set(existingDomains.map(normalizeDomainKey));
  const result = new Map<string, NearbyTerritory>();

  for (const domain of domains) {
    for (const rule of ADJACENT_TERRITORY_RULES) {
      if (!rule.match.test(domain)) continue;
      for (const suggestion of rule.suggestions) {
        const key = normalizeDomainKey(suggestion.domain);
        if (existing.has(key) || result.has(key)) continue;
        result.set(key, suggestion);
      }
    }
  }

  return [...result.values()].slice(0, 6);
}
