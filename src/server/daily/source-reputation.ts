import { sourceHost } from '@/server/daily/generate-questions';

// B3 Phase 2 — source reputation + corroboration (PRD-D-5 §5.3 trust layer, §7).
//
// The defense against AI-contaminated / circular web content: a fresh question
// is only allowed into the pool when its answer is backed by independent,
// editorially-accountable sources. This module is pure (no DB, no LLM) so the
// trust rules are unit-testable in isolation.

export type SourceTier = 'reputable' | 'neutral' | 'denied';

// Editorially-accountable reference / primary / institutional domains. This is a
// SEED (spec §7) — deliberately small and expanded empirically. Most authority
// is carried by the TLD heuristics below (.edu/.gov/.mil/.ac.*), so the list
// only needs the high-value non-institutional references.
const ALLOW_SEED = [
  'wikipedia.org',
  'britannica.com',
  'merriam-webster.com',
  'oed.com',
  'oxfordreference.com',
  'encyclopedia.com',
  'bbc.com',
  'bbc.co.uk',
  'nationalgeographic.com',
  'smithsonianmag.com',
  'nature.com',
  'science.org',
  'scientificamerican.com',
  'jstor.org',
  'poetryfoundation.org',
  'metmuseum.org',
  'moma.org',
  'tate.org.uk',
  'britishmuseum.org',
  'guggenheim.org',
  'pbs.org',
  'npr.org',
  'reuters.com',
  'apnews.com',
  'nytimes.com',
  'theguardian.com',
];

// Content farms, open-UGC, forums, Q&A mills, social, and known AI-content
// mills. Pages here NEVER count toward corroboration and are stripped from the
// stored provenance — they're the circular/contaminated-source risk (DR2).
const DENY_SEED = [
  'reddit.com',
  'quora.com',
  'answers.com',
  'answers.yahoo.com',
  'ehow.com',
  'wikihow.com',
  'pinterest.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'tumblr.com',
  'medium.com',
  'blogspot.com',
  'wordpress.com',
  'fandom.com',
  'wikia.com',
  'coursehero.com',
  'chegg.com',
  'studocu.com',
  'scribd.com',
  'slideshare.net',
  'brainly.com',
  'enotes.com',
];

// Academic / governmental / military TLDs (and their country-coded forms) are
// treated as reputable without needing an explicit allow-list entry.
const REPUTABLE_TLD_PATTERNS: RegExp[] = [
  /\.edu$/,
  /\.edu\.[a-z]{2}$/,
  /\.gov$/,
  /\.gov\.[a-z]{2}$/,
  /\.mil$/,
  /\.mil\.[a-z]{2}$/,
  /\.ac\.[a-z]{2}$/,
];

export type ReputationLists = {
  allow: ReadonlySet<string>;
  deny: ReadonlySet<string>;
};

function parseHostListEnv(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase().replace(/^www\./, ''))
    .filter(Boolean);
}

// Built-in seeds merged with comma-separated env overrides
// (RETRIEVAL_SOURCE_ALLOW / RETRIEVAL_SOURCE_DENY). Deny wins ties: a host on
// both lists is treated as denied.
export function getReputationLists(): ReputationLists {
  const allow = new Set<string>([...ALLOW_SEED, ...parseHostListEnv('RETRIEVAL_SOURCE_ALLOW')]);
  const deny = new Set<string>([...DENY_SEED, ...parseHostListEnv('RETRIEVAL_SOURCE_DENY')]);
  return { allow, deny };
}

// True when `host` equals `listed` or is a subdomain of it
// (e.g. "plato.stanford.edu" matches "stanford.edu").
function hostMatches(host: string, listed: string): boolean {
  return host === listed || host.endsWith(`.${listed}`);
}

function inList(host: string, list: ReadonlySet<string>): boolean {
  if (list.has(host)) return true;
  for (const listed of list) {
    if (hostMatches(host, listed)) return true;
  }
  return false;
}

export function classifyHost(host: string, lists: ReputationLists): SourceTier {
  // Deny wins — a junk source is never rescued by also matching an allow rule.
  if (inList(host, lists.deny)) return 'denied';
  if (inList(host, lists.allow)) return 'reputable';
  if (REPUTABLE_TLD_PATTERNS.some((re) => re.test(host))) return 'reputable';
  return 'neutral';
}

export function classifySource(url: string, lists: ReputationLists): SourceTier {
  const host = sourceHost(url);
  if (!host) return 'denied';
  return classifyHost(host, lists);
}

export type CorroborationAssessment = {
  corroborated: boolean;
  // Non-denied refs, reordered reputable-first (stable within tier) — what we
  // persist as provenance. Denied sources are stripped.
  orderedRefs: string[];
  distinctReputableHosts: number;
  distinctNonDeniedHosts: number;
  deniedRefs: string[];
};

// The corroboration gate (DR2/DR3). A question is corroborated when it has at
// least `minTotal` independent (distinct-host) non-denied sources AND at least
// `minReputable` of those are editorially-accountable. Denied sources never
// count and are stripped from provenance. Mirrors collapse to one host, so two
// copies of the same page can't fake independence.
//
// `minReputable` defaults to 1 (≥2 independent sources with ≥1 authoritative
// anchor) rather than requiring BOTH to be allow-listed — the strict reading
// would tank yield on the thin domains B3 exists to refill. Set
// RETRIEVAL_MIN_REPUTABLE_SOURCES equal to RETRIEVAL_MIN_CORROBORATING_SOURCES
// for the strict "all reputable" interpretation.
export function assessCorroboration(
  refs: readonly string[],
  opts: { minTotal: number; minReputable: number; lists: ReputationLists },
): CorroborationAssessment {
  const reputableHosts = new Set<string>();
  const nonDeniedHosts = new Set<string>();
  const reputableRefs: string[] = [];
  const neutralRefs: string[] = [];
  const deniedRefs: string[] = [];

  for (const ref of refs) {
    const host = sourceHost(ref);
    if (!host) {
      deniedRefs.push(ref);
      continue;
    }
    const tier = classifyHost(host, opts.lists);
    if (tier === 'denied') {
      deniedRefs.push(ref);
      continue;
    }
    nonDeniedHosts.add(host);
    if (tier === 'reputable') {
      reputableHosts.add(host);
      reputableRefs.push(ref);
    } else {
      neutralRefs.push(ref);
    }
  }

  const corroborated =
    nonDeniedHosts.size >= opts.minTotal && reputableHosts.size >= opts.minReputable;

  return {
    corroborated,
    orderedRefs: [...reputableRefs, ...neutralRefs],
    distinctReputableHosts: reputableHosts.size,
    distinctNonDeniedHosts: nonDeniedHosts.size,
    deniedRefs,
  };
}
