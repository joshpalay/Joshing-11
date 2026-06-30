import { describe, expect, it } from 'vitest';

import { prefilterQuestion } from '@/server/llm/batch-verify';

describe('prefilterQuestion', () => {
  // ── Personal questions ─────────────────────────────────────────────────────
  it('skips personal questions regardless of text content', () => {
    expect(prefilterQuestion({ questionText: 'What is my favourite colour?', questionType: 'personal' })).toBe('skip');
  });

  it('skips personal even when question text looks factual', () => {
    expect(prefilterQuestion({ questionText: 'What city were you born in?', questionType: 'personal' })).toBe('skip');
  });

  // ── Stable canonical facts ─────────────────────────────────────────────────
  it('marks a plain historical fact as stable', () => {
    expect(prefilterQuestion({ questionText: 'What composer wrote the Brandenburg Concertos?' })).toBe('stable');
  });

  it('marks a scientific constant question as stable', () => {
    expect(prefilterQuestion({ questionText: 'What is the speed of light in a vacuum?' })).toBe('stable');
  });

  it('treats undefined questionType as factual (default stable)', () => {
    expect(prefilterQuestion({ questionText: 'Who invented the telephone?' })).toBe('stable');
  });

  it('treats null questionType as factual (default stable)', () => {
    expect(prefilterQuestion({ questionText: 'Who invented the telephone?', questionType: null })).toBe('stable');
  });

  // ── Volatile patterns ──────────────────────────────────────────────────────
  it('flags "currently" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'Who is currently the prime minister of the UK?' })).toBe('volatile');
  });

  it('flags "right now" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'Who holds the 100m world record right now?' })).toBe('volatile');
  });

  it('flags "latest" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'What is the latest iPhone model?' })).toBe('volatile');
  });

  it('flags "most recent" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'What is the most recently released James Bond film?' })).toBe('volatile');
  });

  it('flags "at present" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'At present, which country has the largest GDP?' })).toBe('volatile');
  });

  it('flags "world record" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'What is the world record for the 400m hurdles?' })).toBe('volatile');
  });

  it('flags "all-time high" as volatile', () => {
    expect(prefilterQuestion({ questionText: 'Which athlete holds the all-time high jump record?' })).toBe('volatile');
  });

  it('flags "who is the current X" phrasing as volatile', () => {
    expect(prefilterQuestion({ questionText: 'Who is the current CEO of Apple?' })).toBe('volatile');
  });

  // ── Past-year anchor overrides volatile patterns ──────────────────────────
  it('marks a world record question anchored to a past year as stable', () => {
    expect(prefilterQuestion({ questionText: 'Who set the 100m world record in 1988?' })).toBe('stable');
  });

  it('marks a "first" question anchored to a past year as stable', () => {
    expect(prefilterQuestion({ questionText: 'What was the first country to legalise same-sex marriage, in 2001?' })).toBe('stable');
  });

  it('marks a 19th-century question as stable', () => {
    expect(prefilterQuestion({ questionText: 'During the 19th century, which country built the most railway miles?' })).toBe('stable');
  });

  it('marks a question with a four-digit year as stable', () => {
    expect(prefilterQuestion({ questionText: 'In 1969, what was the name of the first moon-landing mission?' })).toBe('stable');
  });

  // ── Non-volatile superlative without year anchor ──────────────────────────
  it('does not flag a question with "first" but no year as volatile', () => {
    // "first" alone is NOT in the volatile list — only temporal/superlative combos are
    expect(prefilterQuestion({ questionText: 'Who was the first person to climb Everest?' })).toBe('stable');
  });

  it('does not flag "newest" when anchored to a past year', () => {
    expect(prefilterQuestion({ questionText: 'What was the newest iPhone model released in 2020?' })).toBe('stable');
  });
});
