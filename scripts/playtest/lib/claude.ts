import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getAnthropicClient, HAIKU_MODEL, loggedMessagesCreate, ANTHROPIC_MODEL, extractTextContent } from '@/lib/llm';

import type { ScenarioLog } from './scenario-context';

export type ReviewResult = {
  ok: boolean;
  summary: string;
  observations: string[];
  bugs: string[];
  uxNotes: string[];
};

function fallbackReview(reason: string): ReviewResult {
  return {
    ok: false,
    summary: `LLM review skipped: ${reason}`,
    observations: [],
    bugs: [],
    uxNotes: [],
  };
}

function parseReview(text: string): ReviewResult {
  const trimmed = text.trim();
  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) return fallbackReview('no_json');
  try {
    const parsed = JSON.parse(match[0]) as Partial<ReviewResult>;
    return {
      ok: true,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      observations: Array.isArray(parsed.observations) ? parsed.observations.filter((x): x is string => typeof x === 'string') : [],
      bugs: Array.isArray(parsed.bugs) ? parsed.bugs.filter((x): x is string => typeof x === 'string') : [],
      uxNotes: Array.isArray(parsed.uxNotes) ? parsed.uxNotes.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return fallbackReview('invalid_json');
  }
}

function pickReviewScreenshots(logs: ScenarioLog[], perScenarioLimit = 2, totalLimit = 12): string[] {
  const files: string[] = [];
  for (const log of logs) {
    let perScenario = 0;
    for (const event of log.events) {
      if (event.kind !== 'screenshot') continue;
      files.push(event.file);
      perScenario += 1;
      if (perScenario >= perScenarioLimit) break;
      if (files.length >= totalLimit) return files;
    }
    if (files.length >= totalLimit) return files;
  }
  return files;
}

function imageBlock(filePath: string): { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } } {
  const data = readFileSync(filePath).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
}

export async function reviewSession(params: {
  logs: ScenarioLog[];
  runId: string;
}): Promise<ReviewResult> {
  const client = getAnthropicClient();
  if (!client) return fallbackReview('no_anthropic_client');

  const screenshots = pickReviewScreenshots(params.logs);
  const transcript = params.logs.map((log) => ({
    scenario: log.scenarioId,
    displayName: log.displayName,
    status: log.status,
    durationMs: log.durationMs,
    assertions: log.assertions.map((a) =>
      a.kind === 'assert_pass' ? { pass: a.label } : { fail: a.label, message: a.message },
    ),
    events: log.events.map((e) => {
      if (e.kind === 'screenshot') return { kind: e.kind, note: e.note, file: path.basename(e.file) };
      return e;
    }),
  }));

  const userContent: Array<{ type: 'text'; text: string } | ReturnType<typeof imageBlock>> = [
    {
      type: 'text',
      text:
        'You are reviewing an automated regression run of "Joshing", a multi-player trivia app. ' +
        'Several scenarios just executed (each a distinct user flow). For EACH scenario, look at the assertions, transcript events, and screenshots. ' +
        'Return JSON only: ' +
        '{"summary": "<one paragraph across all scenarios>", "observations": [<short strings>], "bugs": [<short strings>], "uxNotes": [<short strings>]}. ' +
        'Surface at least one UX observation worth investigating even on a clean run. Be specific — name the scenario when a bug or note is scenario-specific. ' +
        `Transcript: ${JSON.stringify(transcript)}`,
    },
    ...screenshots.map(imageBlock),
  ];

  try {
    const response = await loggedMessagesCreate(client, 'playtest-review', {
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      temperature: 0.4,
      system: [
        {
          type: 'text',
          text:
            'You are a careful QA reviewer. You only return strict JSON. ' +
            'You distinguish "bug" (functionally wrong) from "uxNote" (works but feels off).',
        },
      ],
      messages: [{ role: 'user', content: userContent }],
    });
    const text = extractTextContent(response.content);
    return parseReview(text);
  } catch (error) {
    return fallbackReview(error instanceof Error ? error.message : 'unknown');
  }
}

export async function quickWrongAnswer(canonical: string): Promise<string> {
  const client = getAnthropicClient();
  if (!client) return `not-${canonical.toLowerCase()}`;
  try {
    const response = await loggedMessagesCreate(client, 'playtest-wrong-answer', {
      model: HAIKU_MODEL,
      max_tokens: 30,
      temperature: 0.6,
      system: [{ type: 'text', text: 'Return one short, plausibly-wrong trivia answer in the same category. No prose, just the answer.' }],
      messages: [{ role: 'user', content: `Canonical correct answer: ${canonical}. Give a plausible wrong answer in the same category.` }],
    });
    const text = extractTextContent(response.content).trim();
    return text || `not-${canonical.toLowerCase()}`;
  } catch {
    return `not-${canonical.toLowerCase()}`;
  }
}
