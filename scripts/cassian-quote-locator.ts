/** Offline experiment preparation only; never repairs or approves a frozen model response. */
import { quoteKey } from './cassian-evidence-v3';

export type QuoteLocation =
  | { status: 'unique'; start: number; end: number; quote: string }
  | { status: 'missing' | 'ambiguous' | 'invalid'; matches: number };

/** Find actual UTF-16 offsets in one identified field/source. Matching is not entailment. */
export function locateQuote(text: string, quote: string): QuoteLocation {
  const needle = quoteKey(quote);
  if (!needle) return { status: 'invalid', matches: 0 };
  const normalized: string[] = [];
  const offsets: { start: number; end: number }[] = [];
  let spaceStart: number | undefined;
  let spaceEnd = 0;
  // NFC can change code-unit length. Map complete graphemes, including surrogate pairs.
  const segments = new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text);
  for (const { segment, index } of segments) {
    const end = index + segment.length;
    if (/^\s+$/u.test(segment)) {
      spaceStart ??= index;
      spaceEnd = end;
      continue;
    }
    if (spaceStart !== undefined && normalized.length) {
      normalized.push(' ');
      offsets.push({ start: spaceStart, end: spaceEnd });
    }
    spaceStart = undefined;
    const key = segment.normalize('NFC').replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
    for (let n = 0; n < key.length; n++) {
      normalized.push(key[n]);
      offsets.push({ start: index, end });
    }
  }
  const haystack = normalized.join('');
  const matches: { start: number; end: number; quote: string }[] = [];
  const seen = new Set<string>();
  for (let at = haystack.indexOf(needle); at >= 0; at = haystack.indexOf(needle, at + 1)) {
    const start = offsets[at].start, end = offsets[at + needle.length - 1].end;
    const actual = text.slice(start, end);
    // Reject matches inside a grapheme/surrogate pair and preserve all words/numbers/negation.
    const identity = `${start}:${end}`;
    if (quoteKey(actual) === needle && !seen.has(identity)) {
      seen.add(identity);
      matches.push({ start, end, quote: actual });
    }
  }
  if (!matches.length) return { status: 'missing', matches: 0 };
  if (matches.length !== 1) return { status: 'ambiguous', matches: matches.length };
  return { status: 'unique', ...matches[0] };
}
