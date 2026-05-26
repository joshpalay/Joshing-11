import { readFileSync } from 'node:fs';
import path from 'node:path';

import { getAnthropicClient, HAIKU_MODEL, loggedMessagesCreate, ANTHROPIC_MODEL, extractTextContent } from '@/lib/llm';

import type { PlayerLog } from './player';

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

function pickReviewScreenshots(logs: PlayerLog[], limit = 6): string[] {
  const files: string[] = [];
  for (const log of logs) {
    for (const event of log.events) {
      if (event.kind === 'screenshot') files.push(event.file);
      if (files.length >= limit) return files;
    }
  }
  return files;
}

function imageBlock(filePath: string): { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } } {
  const data = readFileSync(filePath).toString('base64');
  return { type: 'image', source: { type: 'base64', media_type: 'image/png', data } };
}

export async function reviewSession(params: {
  logs: PlayerLog[];
  runId: string;
}): Promise<ReviewResult> {
  const client = getAnthropicClient();
  if (!client) return fallbackReview('no_anthropic_client');

  const screenshots = pickReviewScreenshots(params.logs);
  const transcript = params.logs.map((log) => ({
    player: log.displayName,
    events: log.events.map((e) => {
      if (e.kind === 'screenshot') return { kind: e.kind, note: e.note, file: path.basename(e.file) };
      return e;
    }),
  }));

  const userContent: Array<{ type: 'text'; text: string } | ReturnType<typeof imageBlock>> = [
    {
      type: 'text',
      text:
        'You are reviewing a multi-player playthrough of "Joshing", a small trivia game. ' +
        'Several test players just played a 3-question game. Look at the transcript and screenshots below, then ' +
        'return JSON only with this shape: ' +
        '{"summary": "<one paragraph>", "observations": [<short strings>], "bugs": [<short strings>], "uxNotes": [<short strings>]}. ' +
        'Be specific. Even on a clean run, you must surface at least one UX observation worth investigating. ' +
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
