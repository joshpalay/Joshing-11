'use client';

import { useEffect, useMemo, useReducer, useRef } from 'react';

export type QuestionFormValues = {
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  creatorNote?: string | null;
  verified: boolean;
  llmSuggestedAnswer?: string | null;
  critiqueIterations: number;
  sendToFriendIds: string[];
  shareToFeed?: boolean;
};

type CritiqueResult =
  | { ok: true }
  | { ok: false; issues: string[]; reformulations: string[] };

type CritiqueResponse = CritiqueResult & {
  limitReached: boolean;
  remaining: number | null;
};

type SuggestionResponse = {
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string;
};

type FriendOption = { id: string; displayName: string };

type Stage = 'WRITING' | 'CRITIQUING' | 'CRITIQUED' | 'ANSWERING' | 'REVIEWING' | 'SUBMITTING' | 'DONE';

type Props = {
  mode?: 'create' | 'edit';
  initialValues?: Partial<QuestionFormValues>;
  initialSpecificMode?: boolean;
  onSubmit: (values: QuestionFormValues) => Promise<void>;
  submitLabel?: string;
  loadingLabel?: string;
  onCancel?: () => void;
};

type State = {
  stage: Stage;
  questionText: string;
  lastCritiquedText: string | null;
  llmSuggestedAnswer: string | null;
  userAnswer: string;
  alternateText: string;
  explanation: string;
  creatorNote: string;
  critiqueResult: CritiqueResult | null;
  critiqueIterations: number;
  remainingCritiquesToday: number | null;
  limitReachedThisSession: boolean;
  error: string | null;
  suggestionError: string | null;
  suggesting: boolean;
  specificMode: boolean;
  shareToFeed: boolean;
  friends: FriendOption[];
  friendsLoading: boolean;
  sendToFriendIds: string[];
};

type Action =
  | { type: 'RESET'; state: State }
  | { type: 'FIELD'; field: 'questionText' | 'userAnswer' | 'alternateText' | 'explanation' | 'creatorNote'; value: string }
  | { type: 'ERROR'; value: string | null }
  | { type: 'START_CRITIQUE'; text: string }
  | { type: 'CRITIQUE_RESULT'; response: CritiqueResponse }
  | { type: 'USE_REFORMULATION'; text: string }
  | { type: 'KEEP_VERSION' }
  | { type: 'EDIT_RECHECK' }
  | { type: 'ANSWERING' }
  | { type: 'START_SUGGESTION' }
  | { type: 'SUGGESTION_RESULT'; questionText: string; suggestion: SuggestionResponse }
  | { type: 'SUGGESTION_ERROR'; questionText?: string; value: string | null }
  | { type: 'REVIEW' }
  | { type: 'BACK_TO_EDIT' }
  | { type: 'SUBMITTING' }
  | { type: 'DONE' }
  | { type: 'SPECIFIC_MODE'; value: boolean }
  | { type: 'SHARE_TO_FEED'; value: boolean }
  | { type: 'FRIENDS_LOADING'; value: boolean }
  | { type: 'FRIENDS_LOADED'; friends: FriendOption[] }
  | { type: 'TOGGLE_FRIEND'; id: string };

function initialState(initialValues?: Partial<QuestionFormValues>, initialSpecificMode = false): State {
  return {
    stage: 'WRITING',
    questionText: initialValues?.text ?? '',
    lastCritiquedText: null,
    llmSuggestedAnswer: initialValues?.llmSuggestedAnswer ?? null,
    userAnswer: initialValues?.correctAnswer ?? '',
    alternateText: (initialValues?.alternateAnswers ?? []).join(', '),
    explanation: initialValues?.explanation ?? '',
    creatorNote: initialValues?.creatorNote ?? '',
    critiqueResult: null,
    critiqueIterations: initialValues?.critiqueIterations ?? 0,
    remainingCritiquesToday: null,
    limitReachedThisSession: false,
    error: null,
    suggestionError: null,
    suggesting: false,
    specificMode: initialSpecificMode,
    shareToFeed: initialValues?.shareToFeed ?? false,
    friends: [],
    friendsLoading: false,
    sendToFriendIds: initialValues?.sendToFriendIds ?? [],
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'RESET': return action.state;
    case 'FIELD': return { ...state, [action.field]: action.value, error: null };
    case 'ERROR': return { ...state, error: action.value };
    case 'START_CRITIQUE': return { ...state, stage: 'CRITIQUING', lastCritiquedText: action.text, error: null };
    case 'CRITIQUE_RESULT': {
      if (action.response.limitReached) {
        return { ...state, stage: 'ANSWERING', limitReachedThisSession: true, remainingCritiquesToday: 0, critiqueResult: { ok: true } };
      }
      const nextIterations = action.response.remaining === null ? state.critiqueIterations : state.critiqueIterations + 1;
      if (action.response.ok) {
        return { ...state, stage: 'ANSWERING', remainingCritiquesToday: action.response.remaining, critiqueIterations: nextIterations, critiqueResult: { ok: true } };
      }
      return { ...state, stage: 'CRITIQUED', remainingCritiquesToday: action.response.remaining, critiqueIterations: nextIterations, critiqueResult: action.response };
    }
    case 'USE_REFORMULATION': return { ...state, questionText: action.text, lastCritiquedText: action.text, stage: 'ANSWERING' };
    case 'KEEP_VERSION': return { ...state, stage: 'ANSWERING' };
    case 'EDIT_RECHECK': return { ...state, stage: 'WRITING', critiqueResult: null };
    case 'ANSWERING': return { ...state, stage: 'ANSWERING' };
    case 'START_SUGGESTION': return { ...state, suggesting: true, suggestionError: null };
    case 'SUGGESTION_RESULT': {
      if (state.questionText.trim() !== action.questionText) {
        return { ...state, suggesting: false };
      }
      return {
        ...state,
        suggesting: false,
        suggestionError: null,
        userAnswer: action.suggestion.correctAnswer,
        llmSuggestedAnswer: action.suggestion.correctAnswer,
        explanation: state.explanation.trim() ? state.explanation : action.suggestion.explanation,
        alternateText: state.alternateText.trim() || action.suggestion.alternateAnswers.length === 0 ? state.alternateText : action.suggestion.alternateAnswers.join(', '),
      };
    }
    case 'SUGGESTION_ERROR': {
      if (action.questionText && state.questionText.trim() !== action.questionText) {
        return { ...state, suggesting: false };
      }
      return { ...state, suggesting: false, suggestionError: action.value };
    }
    case 'REVIEW': return { ...state, stage: 'REVIEWING', error: null };
    case 'BACK_TO_EDIT': return { ...state, stage: 'ANSWERING' };
    case 'SUBMITTING': return { ...state, stage: 'SUBMITTING', error: null };
    case 'DONE': return { ...state, stage: 'DONE' };
    case 'SPECIFIC_MODE': return { ...state, specificMode: action.value, shareToFeed: action.value ? false : state.shareToFeed, sendToFriendIds: [] };
    case 'SHARE_TO_FEED': return { ...state, shareToFeed: action.value, specificMode: action.value ? false : state.specificMode, sendToFriendIds: action.value ? [] : state.sendToFriendIds };
    case 'FRIENDS_LOADING': return { ...state, friendsLoading: action.value };
    case 'FRIENDS_LOADED': return { ...state, friends: action.friends, friendsLoading: false };
    case 'TOGGLE_FRIEND': {
      const selected = state.sendToFriendIds.includes(action.id);
      return { ...state, sendToFriendIds: selected ? state.sendToFriendIds.filter((id) => id !== action.id) : [...state.sendToFriendIds, action.id] };
    }
    default: return state;
  }
}

function alternateAnswersFrom(text: string): string[] {
  return text.split(',').map((answer) => answer.trim()).filter(Boolean).slice(0, 5);
}

function answersMatch(a: string, b: string | null): boolean {
  if (!b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function computedVerified(state: State): boolean {
  return !state.llmSuggestedAnswer || answersMatch(state.userAnswer, state.llmSuggestedAnswer);
}

function validate(state: State): string | null {
  const alternateAnswers = alternateAnswersFrom(state.alternateText);
  if (!state.questionText.trim()) return 'Question text is required.';
  if (state.questionText.trim().length > 300) return 'Question text must be 300 characters or fewer.';
  if (!state.userAnswer.trim()) return 'Correct answer is required.';
  if (state.userAnswer.trim().length > 200) return 'Correct answer must be 200 characters or fewer.';
  if (alternateAnswers.length > 5) return 'Use at most 5 alternate answers.';
  if (alternateAnswers.some((answer) => answer.length > 200)) return 'Alternate answers must be 200 characters or fewer.';
  if (state.explanation.length > 500) return 'Explanation must be 500 characters or fewer.';
  if (state.creatorNote.length > 200) return 'Creator note must be 200 characters or fewer.';
  if (state.sendToFriendIds.length > 20) return 'You can send to at most 20 friends at once.';
  return null;
}

function remainingCopy(state: State): string | null {
  const remaining = state.remainingCritiquesToday;
  if (state.limitReachedThisSession || remaining === null || remaining > 2) return null;
  if (remaining === 2) return '2 reviews left today';
  if (remaining === 1) return '1 review left today';
  return 'Last review for today';
}

export function QuestionForm({
  mode = 'create',
  initialValues,
  initialSpecificMode = false,
  onSubmit,
  submitLabel,
  loadingLabel = 'Saving...',
  onCancel,
}: Props) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(initialValues, initialSpecificMode));
  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSuggestionQuestionTextRef = useRef<string | null>(initialValues?.llmSuggestedAnswer ? (initialValues.text ?? '').trim() : null);

  useEffect(() => {
    lastSuggestionQuestionTextRef.current = initialValues?.llmSuggestedAnswer ? (initialValues.text ?? '').trim() : null;
    dispatch({ type: 'RESET', state: initialState(initialValues, initialSpecificMode) });
  }, [initialValues, initialSpecificMode]);

  useEffect(() => {
    if (initialSpecificMode) void loadFriends();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (state.stage === 'WRITING') questionRef.current?.focus();
  }, [state.stage]);

  const alternateAnswers = useMemo(() => alternateAnswersFrom(state.alternateText), [state.alternateText]);
  const showDestinations = mode === 'create';
  const verified = computedVerified(state);
  const submitDisabled = state.stage === 'SUBMITTING';
  const resolvedSubmitLabel = submitLabel ?? (mode === 'edit' ? 'Update question' : 'Save question');

  async function loadFriends() {
    if (state.friends.length > 0 || state.friendsLoading) return;
    dispatch({ type: 'FRIENDS_LOADING', value: true });
    try {
      const response = await fetch('/api/users', { cache: 'no-store', credentials: 'include' });
      const body = await response.json().catch(() => null) as FriendOption[] | null;
      dispatch({ type: 'FRIENDS_LOADED', friends: response.ok && Array.isArray(body) ? body : [] });
    } catch {
      dispatch({ type: 'FRIENDS_LOADED', friends: [] });
    }
  }

  function toggleSpecificMode(on: boolean) {
    dispatch({ type: 'SPECIFIC_MODE', value: on });
    if (on) void loadFriends();
  }

  function toggleShareToFeed(on: boolean) {
    dispatch({ type: 'SHARE_TO_FEED', value: on });
  }

  async function runCritique() {
    const questionText = state.questionText.trim();
    if (!questionText) return;
    if (mode === 'edit') {
      dispatch({ type: 'ANSWERING' });
      return;
    }
    if (state.limitReachedThisSession) {
      dispatch({ type: 'ANSWERING' });
      return;
    }
    if (questionText === state.lastCritiquedText && state.stage !== 'CRITIQUED') {
      dispatch({ type: 'ANSWERING' });
      return;
    }

    dispatch({ type: 'START_CRITIQUE', text: questionText });
    try {
      const response = await fetch('/api/questions/critique', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionText }),
      });
      const body = await response.json().catch(() => null) as CritiqueResponse | null;
      dispatch({ type: 'CRITIQUE_RESULT', response: body ?? { ok: true, limitReached: false, remaining: null } });
    } catch {
      dispatch({ type: 'CRITIQUE_RESULT', response: { ok: true, limitReached: false, remaining: null } });
    }
  }

  async function requestSuggestion() {
    if (state.stage === 'WRITING') {
      await runCritique();
      return;
    }
    const questionText = state.questionText.trim();
    if (!questionText) {
      dispatch({ type: 'SUGGESTION_ERROR', value: 'Write the question first.' });
      return;
    }
    lastSuggestionQuestionTextRef.current = questionText;
    dispatch({ type: 'START_SUGGESTION' });
    try {
      const response = await fetch('/api/questions/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionText }),
      });
      const body = await response.json().catch(() => null) as SuggestionResponse | null;
      if (!response.ok || !body?.correctAnswer) throw new Error('Suggestion unavailable');
      dispatch({ type: 'SUGGESTION_RESULT', questionText, suggestion: body });
    } catch {
      dispatch({ type: 'SUGGESTION_ERROR', questionText, value: 'Suggestion unavailable' });
    }
  }

  useEffect(() => {
    const questionText = state.questionText.trim();
    if (
      mode !== 'create'
      || state.stage !== 'ANSWERING'
      || !questionText
      || state.suggesting
      || lastSuggestionQuestionTextRef.current === questionText
    ) {
      return;
    }

    lastSuggestionQuestionTextRef.current = questionText;
    void requestSuggestion();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, state.stage, state.questionText, state.suggesting, state.llmSuggestedAnswer]);

  function review() {
    const validationError = validate(state);
    if (validationError) {
      dispatch({ type: 'ERROR', value: validationError });
      return;
    }
    dispatch({ type: 'REVIEW' });
  }

  async function finalSave() {
    const validationError = validate(state);
    if (validationError) {
      dispatch({ type: 'ERROR', value: validationError });
      return;
    }
    dispatch({ type: 'SUBMITTING' });
    try {
      await onSubmit({
        text: state.questionText.trim(),
        correctAnswer: state.userAnswer.trim(),
        alternateAnswers,
        explanation: state.explanation.trim() || null,
        creatorNote: state.creatorNote.trim() || null,
        verified,
        llmSuggestedAnswer: state.llmSuggestedAnswer,
        critiqueIterations: state.critiqueIterations,
        sendToFriendIds: state.specificMode ? state.sendToFriendIds : [],
        shareToFeed: state.shareToFeed,
      });
      dispatch({ type: 'DONE' });
    } catch (caught) {
      dispatch({ type: 'ERROR', value: caught instanceof Error ? caught.message : 'Could not save that question.' });
      dispatch({ type: 'ANSWERING' });
    }
  }

  const critique = state.critiqueResult;
  const counter = remainingCopy(state);
  const canShowAnswering = state.stage === 'ANSWERING' || state.stage === 'REVIEWING' || state.stage === 'SUBMITTING' || mode === 'edit';

  return (
    <div className="space-y-5">
      {state.error ? <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p> : null}
      {state.limitReachedThisSession ? (
        <p className="text-xs italic text-muted-foreground">5/5 question reviews used today. You can still save your question; AI review returns tomorrow.</p>
      ) : null}

      <div>
        <label htmlFor="question-text" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Question</label>
        <textarea
          ref={questionRef}
          id="question-text"
          value={state.questionText}
          onChange={(event) => dispatch({ type: 'FIELD', field: 'questionText', value: event.target.value.slice(0, 300) })}
          onBlur={() => { if (state.stage === 'WRITING') void runCritique(); }}
          rows={4}
          maxLength={300}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-primary"
          placeholder="What is the name of Alexander the Great's horse?"
          readOnly={state.stage === 'REVIEWING' || state.stage === 'SUBMITTING'}
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{state.stage === 'CRITIQUING' ? 'Reviewing your question...' : null}</span>
          <span>{state.questionText.length}/300</span>
        </div>
      </div>

      {state.stage === 'CRITIQUED' && critique && !critique.ok ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-medium">⚠ This question might be unclear:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {critique.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
          <p className="mt-3 font-medium">Try one of these instead:</p>
          <div className="mt-2 space-y-2">
            {critique.reformulations.map((text) => (
              <button key={text} type="button" onClick={() => dispatch({ type: 'USE_REFORMULATION', text })} className="block w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted">
                <span className="font-medium">Use this</span> {text}
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => dispatch({ type: 'KEEP_VERSION' })}>Keep my version anyway</button>
            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => dispatch({ type: 'EDIT_RECHECK' })}>Edit and recheck</button>
          </div>
        </div>
      ) : null}

      {!canShowAnswering ? (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void runCritique()} disabled={!state.questionText.trim() || state.stage === 'CRITIQUING'} className="btn-primary">
            {state.stage === 'CRITIQUING' ? 'Reviewing...' : 'Continue'}
          </button>
          {counter ? <span className="text-xs text-muted-foreground">{counter}</span> : null}
          {onCancel ? <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button> : null}
        </div>
      ) : null}

      {canShowAnswering ? (
        <>
          {state.stage !== 'REVIEWING' && state.stage !== 'SUBMITTING' && (counter || state.suggesting || state.suggestionError) ? (
            <div className="flex flex-wrap items-center gap-3">
              {state.suggesting ? <span className="text-sm text-muted-foreground">Suggesting answer...</span> : null}
              {counter ? <span className="text-xs text-muted-foreground">{counter}</span> : null}
              {state.suggestionError ? <span className="text-sm text-destructive">{state.suggestionError}</span> : null}
            </div>
          ) : null}

          <div>
            <label htmlFor="correct-answer" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Correct answer</label>
            <input
              id="correct-answer"
              value={state.userAnswer}
              onChange={(event) => dispatch({ type: 'FIELD', field: 'userAnswer', value: event.target.value.slice(0, 200) })}
              maxLength={200}
              required
              readOnly={state.stage === 'REVIEWING' || state.stage === 'SUBMITTING'}
              className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary"
              placeholder="Bucephalus"
            />
          </div>

          <div>
            <label htmlFor="alternate-answers" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Alternate answers</label>
            <input id="alternate-answers" value={state.alternateText} onChange={(event) => dispatch({ type: 'FIELD', field: 'alternateText', value: event.target.value })} readOnly={state.stage === 'REVIEWING' || state.stage === 'SUBMITTING'} className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary" placeholder="Accepted variations, separated by commas" />
            <p className="mt-1 text-xs text-muted-foreground">{alternateAnswers.length}/5 alternates</p>
          </div>

          <div>
            <label htmlFor="explanation" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Explanation</label>
            <textarea id="explanation" value={state.explanation} onChange={(event) => dispatch({ type: 'FIELD', field: 'explanation', value: event.target.value.slice(0, 500) })} rows={4} maxLength={500} readOnly={state.stage === 'REVIEWING' || state.stage === 'SUBMITTING'} className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary" placeholder="A short note that helps someone learn if they miss it." />
            <p className="mt-1 text-right text-xs text-muted-foreground">{state.explanation.length}/500</p>
          </div>

          <div className="rounded-md border bg-muted/30 p-3">
            <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">AI classification</p>
            <p className="mt-1 text-sm text-muted-foreground">Joshing will read the question and answer when you save, then use the LLM to choose the broad category, precise domain, and difficulty.</p>
          </div>

          {state.stage === 'REVIEWING' && state.llmSuggestedAnswer && !answersMatch(state.userAnswer, state.llmSuggestedAnswer) ? (
            <div className="rounded-md border bg-muted/40 p-3 text-sm">
              <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">LLM suggestion</p>
              <p className="mt-1 line-through decoration-amber-500">{state.llmSuggestedAnswer}</p>
            </div>
          ) : null}

          {state.stage === 'REVIEWING' || state.stage === 'SUBMITTING' ? (
            <>
              <div>
                <label htmlFor="creator-note" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Creator note</label>
                <textarea id="creator-note" value={state.creatorNote} onChange={(event) => dispatch({ type: 'FIELD', field: 'creatorNote', value: event.target.value.slice(0, 200) })} rows={3} maxLength={200} className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary" placeholder="Optional context for recipients" />
                <p className="mt-1 text-right text-xs text-muted-foreground">{state.creatorNote.length}/200</p>
              </div>
              <p className={verified ? 'text-sm text-emerald-700' : 'text-sm text-amber-700'}>
                {verified ? '✓ Verified — matches LLM suggestion' : "⚠ Unverified — your answer differs from the LLM's suggestion. Recipients will see this."}
              </p>
            </>
          ) : null}

          {showDestinations ? (
            <div className="rounded-md border bg-muted/40 p-4">
              <p className="mb-3 text-xs uppercase tracking-[0.1em] text-muted-foreground">Destinations</p>
              <label className="mb-2 flex cursor-default items-center gap-2 text-sm"><input type="checkbox" checked readOnly disabled className="rounded" /><span className="text-foreground">Save to bank</span></label>
              <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={state.shareToFeed} onChange={(event) => toggleShareToFeed(event.target.checked)} className="rounded" disabled={state.stage === 'SUBMITTING'} /><span className="text-foreground">Share with all friends</span></label>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={state.specificMode} onChange={(event) => toggleSpecificMode(event.target.checked)} className="rounded" disabled={state.stage === 'SUBMITTING'} /><span className="text-foreground">Send to specific friends only</span></label>
              {state.specificMode ? (
                <div className="mt-1">
                  {state.friendsLoading ? <p className="text-xs text-muted-foreground">Loading friends...</p> : state.friends.length === 0 ? <p className="text-xs text-muted-foreground">No friends found.</p> : (
                    <div className="flex flex-wrap gap-2">
                      {state.friends.map((friend) => {
                        const selected = state.sendToFriendIds.includes(friend.id);
                        return <button key={friend.id} type="button" onClick={() => dispatch({ type: 'TOGGLE_FRIEND', id: friend.id })} className={['rounded-full border px-3 py-1 text-sm transition', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'].join(' ')}>{friend.displayName}</button>;
                      })}
                    </div>
                  )}
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">{state.specificMode ? 'Sent directly to the friends you pick.' : state.shareToFeed ? "Your friends will see this in their feed (except friends who've marked this domain as Not my focus)." : 'Saved to your bank only.'}</p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3 pt-2">
            {state.stage === 'REVIEWING' || state.stage === 'SUBMITTING' ? (
              <>
                <button type="button" onClick={() => dispatch({ type: 'BACK_TO_EDIT' })} className="btn-ghost" disabled={submitDisabled}>Back to edit</button>
                <button type="button" disabled={submitDisabled} onClick={() => void finalSave()} className="btn-primary">{submitDisabled ? loadingLabel : resolvedSubmitLabel}</button>
              </>
            ) : (
              <button type="button" onClick={review} className="btn-primary">Review</button>
            )}
            {onCancel ? <button type="button" onClick={onCancel} className="btn-ghost" disabled={submitDisabled}>Cancel</button> : null}
          </div>
        </>
      ) : null}
    </div>
  );
}
