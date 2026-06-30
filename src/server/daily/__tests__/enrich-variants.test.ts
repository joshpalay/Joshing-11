import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// enrich-variants.ts only depends on @/lib/llm (no DB). Mock it to drive the
// single batched enrichment call deterministically and exercise the fail-open
// contract.
const llmMock = vi.hoisted(() => ({
  loggedMessagesCreate: vi.fn(),
  getAnthropicClient: vi.fn(() => ({}) as unknown),
}));

vi.mock('@/lib/llm', () => ({
  INSTRUCTION_SCOPING_QUALIFIER: '',
  INSTRUCTION_USER_INPUT_GUIDANCE: '',
  extractTextContent: (content: unknown) => String((content as { text: string }).text),
  parseJsonObject: (raw: string) => {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  },
  wrapUserInput: (_tag: string, body: string) => body,
  getAnthropicClient: llmMock.getAnthropicClient,
  loggedMessagesCreate: llmMock.loggedMessagesCreate,
}));

const { enrichAcceptableVariants, parseEnrichResponse, mergeVariants } = await import(
  '@/server/daily/enrich-variants'
);

function item(answer: string) {
  return { questionText: 'q', answer, explainer: 'e' };
}

function response(json: object) {
  return { content: { text: JSON.stringify(json) }, stop_reason: 'end_turn' };
}

beforeEach(() => {
  llmMock.getAnthropicClient.mockReturnValue({});
  llmMock.loggedMessagesCreate.mockReset();
  delete process.env.ENRICH_VARIANTS_ENABLED;
});

afterEach(() => {
  delete process.env.ENRICH_VARIANTS_ENABLED;
  vi.restoreAllMocks();
});

describe('parseEnrichResponse', () => {
  const items = [item('removes Data arm'), item('gluteus maximus')];

  it('maps additional answers by index', () => {
    const out = parseEnrichResponse(
      JSON.stringify({ variants: { '0': ['switches Data off', 'powers Data down'] } }),
      items.length,
      items,
    );
    expect(out.get(0)).toEqual(['switches Data off', 'powers Data down']);
    expect(out.has(1)).toBe(false);
  });

  it('drops out-of-range indices and non-array values', () => {
    const out = parseEnrichResponse(
      JSON.stringify({ variants: { '5': ['x'], '0': 'not-an-array' } }),
      items.length,
      items,
    );
    expect(out.size).toBe(0);
  });

  it('dedups case-insensitively against the stored answer', () => {
    const out = parseEnrichResponse(
      JSON.stringify({ variants: { '0': ['Removes Data Arm', 'switches Data off'] } }),
      items.length,
      items,
    );
    // The stored answer re-stated is dropped; only the genuinely-new answer stays.
    expect(out.get(0)).toEqual(['switches Data off']);
  });

  it('drops over-long entries and caps the count at four', () => {
    const long = 'a'.repeat(200);
    const out = parseEnrichResponse(
      JSON.stringify({ variants: { '0': [long, 'a1', 'a2', 'a3', 'a4', 'a5'] } }),
      items.length,
      items,
    );
    expect(out.get(0)).toEqual(['a1', 'a2', 'a3', 'a4']);
  });

  it('returns an empty map on malformed JSON or a non-object variants field', () => {
    expect(parseEnrichResponse('not json', items.length, items).size).toBe(0);
    expect(
      parseEnrichResponse(JSON.stringify({ variants: ['nope'] }), items.length, items).size,
    ).toBe(0);
  });
});

describe('mergeVariants', () => {
  it('unions lists, trims, and dedups case-insensitively preserving order', () => {
    expect(mergeVariants(['Gold', ' the hoard '], ['gold', 'Nibelung gold'])).toEqual([
      'Gold',
      'the hoard',
      'Nibelung gold',
    ]);
  });

  it('tolerates undefined lists and drops empties', () => {
    expect(mergeVariants(undefined, ['a', '', '  '], undefined)).toEqual(['a']);
  });
});

describe('enrichAcceptableVariants (fail-open contract)', () => {
  it('returns an empty map when no client is configured', async () => {
    llmMock.getAnthropicClient.mockReturnValue(null);
    const out = await enrichAcceptableVariants([item('x')]);
    expect(out.size).toBe(0);
    expect(llmMock.loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it('returns an empty map when disabled via env', async () => {
    process.env.ENRICH_VARIANTS_ENABLED = 'false';
    const out = await enrichAcceptableVariants([item('x')]);
    expect(out.size).toBe(0);
    expect(llmMock.loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it('returns an empty map for an empty batch without calling the model', async () => {
    const out = await enrichAcceptableVariants([]);
    expect(out.size).toBe(0);
    expect(llmMock.loggedMessagesCreate).not.toHaveBeenCalled();
  });

  it('parses the model verdict on the happy path', async () => {
    llmMock.loggedMessagesCreate.mockResolvedValue(
      response({ variants: { '0': ['switches Data off'] } }),
    );
    const out = await enrichAcceptableVariants([item('removes Data arm')]);
    expect(out.get(0)).toEqual(['switches Data off']);
  });

  it('fails open to an empty map when the model call throws', async () => {
    llmMock.loggedMessagesCreate.mockRejectedValue(new Error('boom'));
    const out = await enrichAcceptableVariants([item('x')]);
    expect(out.size).toBe(0);
  });
});
