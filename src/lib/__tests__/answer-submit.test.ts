import { describe, expect, it, vi } from 'vitest';

import {
  ANSWER_MAX_ATTEMPTS,
  ANSWER_RETRY_EXHAUSTED_MESSAGE,
  AnswerSubmitError,
  submitAnswerWithRetry,
} from '../answer-submit';

type Body = { isCorrect: boolean };

const isBody = (b: unknown): b is Body =>
  b != null && typeof b === 'object' && 'isCorrect' in b;

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const noDelay = () => Promise.resolve();

describe('submitAnswerWithRetry', () => {
  it('returns the parsed body on first success without retrying', async () => {
    const onRetry = vi.fn();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { isCorrect: true }));

    const result = await submitAnswerWithRetry<Body>('/api/x', {
      body: { submitted_answer: 'a' },
      isSuccessBody: isBody,
      onRetry,
      fetchImpl,
      delayImpl: noDelay,
    });

    expect(result).toEqual({ isCorrect: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it('retries a transient 503 grader_unavailable then succeeds', async () => {
    const onRetry = vi.fn();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { error: 'grader_unavailable' }))
      .mockResolvedValueOnce(jsonResponse(200, { isCorrect: false }));

    const result = await submitAnswerWithRetry<Body>('/api/x', {
      body: {},
      isSuccessBody: isBody,
      onRetry,
      fetchImpl,
      delayImpl: noDelay,
    });

    expect(result).toEqual({ isCorrect: false });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith({ attempt: 2, maxAttempts: ANSWER_MAX_ATTEMPTS });
  });

  it('retries network failures', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, { isCorrect: true }));

    const result = await submitAnswerWithRetry<Body>('/api/x', {
      body: {},
      isSuccessBody: isBody,
      fetchImpl,
      delayImpl: noDelay,
    });

    expect(result).toEqual({ isCorrect: true });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('escalates to the "try again later" message after exhausting retries', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'grader_unavailable' }));

    const error = await submitAnswerWithRetry<Body>('/api/x', {
      body: {},
      isSuccessBody: isBody,
      fetchImpl,
      delayImpl: noDelay,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AnswerSubmitError);
    expect(error.exhausted).toBe(true);
    expect(error.message).toBe(ANSWER_RETRY_EXHAUSTED_MESSAGE);
    expect(fetchImpl).toHaveBeenCalledTimes(ANSWER_MAX_ATTEMPTS);
  });

  it('does not retry a deterministic 4xx and surfaces the server message', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: 'invalid_state', message: 'Already closed.' }));

    const error = await submitAnswerWithRetry<Body>('/api/x', {
      body: {},
      isSuccessBody: isBody,
      resolveErrorMessage: (b) => (b as { message?: string } | null)?.message,
      fetchImpl,
      delayImpl: noDelay,
    }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AnswerSubmitError);
    expect(error.exhausted).toBe(false);
    expect(error.message).toBe('Already closed.');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('propagates an AbortError without retrying', async () => {
    const abort = new DOMException('Aborted', 'AbortError');
    const fetchImpl = vi.fn().mockRejectedValue(abort);

    const error = await submitAnswerWithRetry<Body>('/api/x', {
      body: {},
      isSuccessBody: isBody,
      fetchImpl,
      delayImpl: noDelay,
    }).catch((caught) => caught);

    expect(error).toBe(abort);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
