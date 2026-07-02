import { describe, expect, it, vi } from 'vitest';

// buildTasteSection is pure, but draft-candidates.ts transitively imports the
// generation module and db queries — stub those seams so import is side-effect
// free (same pattern as the craft route tests).
vi.mock('@/lib/llm', () => ({
  ANTHROPIC_MODEL: 'test-model',
  extractTextContent: vi.fn(),
  getAnthropicClient: vi.fn(() => null),
  loggedMessagesCreate: vi.fn(),
}));
vi.mock('@/server/daily/generate-questions', () => ({
  SYSTEM_PROMPT: '',
  buildUserPrompt: vi.fn(() => ''),
  findAnswerLeaks: vi.fn(),
  findFactualFailures: vi.fn(),
  findQualityFailures: vi.fn(),
  parseQuestions: vi.fn(),
}));
vi.mock('@/server/db/queries/retrieval-demand', () => ({ getDomainPoolAvoidLists: vi.fn() }));
vi.mock('@/server/db/queries/crafter-demand', () => ({
  getAuthoredQuestionEntriesForDomain: vi.fn(),
}));
vi.mock('@/server/db/queries/crafter-decisions', () => ({ getRecentDraftDecisions: vi.fn() }));

import { buildTasteSection } from '@/server/crafter/draft-candidates';

describe('buildTasteSection', () => {
  it('returns an empty string when the ledger is empty (prompt unchanged)', () => {
    expect(buildTasteSection({ kept: [], killed: [] })).toBe('');
  });

  it('renders kept exemplars with human corrections called out', () => {
    const section = buildTasteSection({
      kept: [
        { questionText: 'Q1?', answer: 'A1', editedAnswer: null },
        { questionText: 'Q2?', answer: 'A2', editedAnswer: 'A2 corrected' },
      ],
      killed: [],
    });
    expect(section).toContain('KEPT (draft in this spirit');
    expect(section).toContain('- Q1? → A1');
    expect(section).toContain('- Q2? → A2 [the human corrected the answer to: A2 corrected]');
    expect(section).not.toContain('KILLED');
  });

  it('renders killed anti-exemplars', () => {
    const section = buildTasteSection({
      kept: [],
      killed: [{ questionText: 'Bad Q?', answer: 'Bad A', editedAnswer: null }],
    });
    expect(section).toContain('KILLED (the human rejected these');
    expect(section).toContain('- Bad Q? → Bad A');
    expect(section).not.toContain('KEPT');
  });

  it('an unchanged editedAnswer equal to the answer is not called out as a correction', () => {
    const section = buildTasteSection({
      kept: [{ questionText: 'Q?', answer: 'A', editedAnswer: 'A' }],
      killed: [],
    });
    expect(section).toContain('- Q? → A');
    expect(section).not.toContain('corrected');
  });
});
