export type CatchUpSubmitParsedError = {
  code: string;
  message: string;
  refresh_required?: boolean;
  next_action?: string;
  redirect_to?: string;
  request_id?: string;
};

export function parseCatchUpAnswerErrorBody(raw: unknown): CatchUpSubmitParsedError {
  if (!raw || typeof raw !== 'object') {
    return {
      code: 'parse_failed',
      message: 'We could not read the server response. Check your connection and try again.',
      refresh_required: true,
      next_action: 'retry',
    };
  }

  const data = raw as Record<string, unknown>;
  const code =
    typeof data.code === 'string'
      ? data.code
      : typeof data.error === 'string'
        ? data.error
        : 'unknown';
  const mapped = nextActionForCode(code);

  return {
    code,
    message:
      typeof data.message === 'string' && data.message.trim()
        ? data.message.trim()
        : fallbackMessageForCode(code),
    refresh_required: data.refresh_required === true,
    next_action: typeof data.next_action === 'string' ? data.next_action : mapped.next_action,
    redirect_to: typeof data.redirect_to === 'string' ? data.redirect_to : mapped.redirect_to,
    request_id: typeof data.request_id === 'string' ? data.request_id : undefined,
  };
}

export function catchUpErrorResponse(
  status: number,
  code: string,
  message?: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json(
    {
      error: code,
      code,
      message: message ?? fallbackMessageForCode(code),
      ...nextActionForCode(code),
      ...extra,
    },
    { status },
  );
}

export function userFacingCatchUpSubmitMessage(parsed: CatchUpSubmitParsedError): string {
  switch (parsed.code) {
    case 'unauthorized':
      return 'Your session ended - sign in again to pick up where you left off.';
    case 'forbidden':
    case 'forbidden_assignment':
      return 'That question is not yours to answer. We updated your list.';
    case 'not_found':
    case 'assignment_not_found':
      return "That question moved on. Here's what is still open.";
    case 'catch_up_window_closed':
      return "The extra window for this one has closed. Here's what is still open.";
    case 'catch_up_not_eligible':
    case 'invalid_state':
      return "This one is not in catch-up anymore. Here's what still is.";
    case 'validation':
      return parsed.message;
    case 'parse_failed':
      return parsed.message;
    case 'network':
      return 'We could not reach the server. Check your connection and try again.';
    default:
      return parsed.refresh_required
        ? 'We could not confirm that. Checking what is still available...'
        : parsed.message;
  }
}

function fallbackMessageForCode(code: string): string {
  switch (code) {
    case 'unauthorized':
      return 'Your session ended. Sign in again to continue.';
    case 'forbidden':
    case 'forbidden_assignment':
      return 'You do not have access to this question.';
    case 'not_found':
    case 'assignment_not_found':
      return 'That question is no longer available.';
    case 'catch_up_window_closed':
      return 'The extra time to answer this one has passed.';
    case 'catch_up_not_eligible':
    case 'invalid_state':
      return 'This question cannot be answered in catch-up right now.';
    case 'validation':
      return 'Something was off with that answer. Try again.';
    case 'network':
      return 'We could not reach the server. Check your connection and try again.';
    default:
      return 'We could not save that. Try again in a moment.';
  }
}

function nextActionForCode(code: string): { next_action?: string; redirect_to?: string } {
  switch (code) {
    case 'unauthorized':
      return { next_action: 'sign_in', redirect_to: '/login' };
    case 'catch_up_window_closed':
    case 'catch_up_not_eligible':
    case 'assignment_not_found':
    case 'forbidden_assignment':
    case 'invalid_state':
      return { next_action: 'refetch_missed' };
    default:
      return {};
  }
}
