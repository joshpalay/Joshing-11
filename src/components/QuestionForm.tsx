'use client';

import { Search, X } from 'lucide-react';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { MAX_ALTERNATE_ANSWERS } from '@/lib/questions-types';

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
  visibility?: 'public' | 'friends' | 'private';
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

type Stage = 'WRITING' | 'CRITIQUING' | 'CRITIQUED' | 'ANSWERING' | 'SUBMITTING' | 'DONE';

// Provenance of the current correct-answer value. 'author' = the author typed it
// themselves; 'suggestion' = they accepted Joshing's suggested answer verbatim.
// This gates "verified": only an author-supplied answer that independently agrees
// with the suggestion earns the badge — passively accepting the machine's guess
// never self-certifies (see isVerifiedAnswer).
type AnswerSource = 'author' | 'suggestion' | null;

type Props = {
  mode?: 'create' | 'edit';
  initialValues?: Partial<QuestionFormValues>;
  initialSpecificMode?: boolean;
  // When true (create-mode only), a prefilled question is carried all the way
  // through on its own: the form runs the review + answer suggestion and saves
  // without waiting for a manual Continue/Save click. Used by the home feed's
  // "what would you like to be asked?" prompt, where the reader has already
  // "written" the question. Falls back to the manual flow if the review surfaces
  // issues or the answer suggestion is unavailable.
  autoSubmit?: boolean;
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
  // Joshing's suggested supporting fields, held separately so they only apply
  // when the author actually adopts the suggestion (never auto-filled).
  suggestedAlternates: string[];
  suggestedExplanation: string;
  answerSource: AnswerSource;
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
  visibility: 'public' | 'friends' | 'private';
  friends: FriendOption[];
  friendsLoading: boolean;
  sendToFriendIds: string[];
  recentFriendIds: string[];
  friendSearch: string;
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
  | { type: 'USE_SUGGESTION' }
  | { type: 'SUGGESTION_ERROR'; questionText?: string; value: string | null }
  | { type: 'SUBMITTING' }
  | { type: 'DONE' }
  | { type: 'SPECIFIC_MODE'; value: boolean }
  | { type: 'SHARE_TO_FEED'; value: boolean }
  | { type: 'VISIBILITY'; value: 'public' | 'friends' | 'private' }
  | { type: 'FRIENDS_LOADING'; value: boolean }
  | { type: 'FRIENDS_LOADED'; friends: FriendOption[] }
  | { type: 'RECENTS_LOADED'; ids: string[] }
  | { type: 'FRIEND_SEARCH'; value: string }
  | { type: 'TOGGLE_FRIEND'; id: string };

function initialState(initialValues?: Partial<QuestionFormValues>, initialSpecificMode = false): State {
  return {
    stage: 'WRITING',
    questionText: initialValues?.text ?? '',
    lastCritiquedText: null,
    llmSuggestedAnswer: initialValues?.llmSuggestedAnswer ?? null,
    suggestedAlternates: [],
    suggestedExplanation: '',
    // In edit mode the stored answer is the author's own committed answer, so
    // treat it as author-supplied — this preserves the prior verified state when
    // re-opening a question. A fresh create starts with no answer and no source.
    answerSource: (initialValues?.correctAnswer ?? '').trim() ? 'author' : null,
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
    // Sharing with all friends is opt-in: default the broadcast off unless a
    // caller explicitly seeds it on (e.g. the "followers" create intent). The
    // author turns it on deliberately rather than having it pre-checked.
    shareToFeed: initialValues?.shareToFeed ?? false,
    visibility: initialValues?.visibility ?? 'public',
    friends: [],
    friendsLoading: false,
    sendToFriendIds: initialValues?.sendToFriendIds ?? [],
    recentFriendIds: [],
    friendSearch: '',
  };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'RESET': return action.state;
    case 'FIELD': {
      const next = { ...state, [action.field]: action.value, error: null };
      if (action.field === 'userAnswer') {
        // The author is typing their own answer — this is the independent signal
        // "verified" is meant to capture. Mark it author-sourced.
        next.answerSource = 'author';
        // If their own answer happens to match Joshing's independent suggestion
        // and they have no explanation yet, carry Joshing's over (it describes
        // this same answer). Never clobber an explanation already present.
        if (
          state.suggestedExplanation
          && !state.explanation.trim()
          && action.value.trim()
          && answersMatch(action.value, state.llmSuggestedAnswer)
        ) {
          next.explanation = state.suggestedExplanation;
        }
      }
      return next;
    }
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
      // Store the suggestion as an INDEPENDENT cross-check only. We deliberately do
      // NOT fill userAnswer/alternateText/explanation here: auto-filling the answer
      // made "verified" (author answer == suggestion) trivially true, so a
      // confidently-wrong guess self-certified and became broadcast-eligible. The
      // author supplies their own answer; the supporting fields apply only if they
      // adopt the suggestion (USE_SUGGESTION) or type a matching answer (FIELD).
      return {
        ...state,
        suggesting: false,
        suggestionError: null,
        llmSuggestedAnswer: action.suggestion.correctAnswer,
        suggestedAlternates: action.suggestion.alternateAnswers,
        suggestedExplanation: action.suggestion.explanation,
      };
    }
    case 'USE_SUGGESTION': {
      if (!state.llmSuggestedAnswer) return state;
      // The author adopted Joshing's suggested answer verbatim. Fill the supporting
      // fields (without clobbering anything they already typed), but mark the source
      // 'suggestion' so it does not count as independent verification.
      return {
        ...state,
        error: null,
        userAnswer: state.llmSuggestedAnswer,
        answerSource: 'suggestion',
        alternateText: state.alternateText.trim() ? state.alternateText : state.suggestedAlternates.join(', '),
        explanation: state.explanation.trim() ? state.explanation : state.suggestedExplanation,
      };
    }
    case 'SUGGESTION_ERROR': {
      if (action.questionText && state.questionText.trim() !== action.questionText) {
        return { ...state, suggesting: false };
      }
      return { ...state, suggesting: false, suggestionError: action.value };
    }
    case 'SUBMITTING': return { ...state, stage: 'SUBMITTING', error: null };
    case 'DONE': return { ...state, stage: 'DONE' };
    case 'SPECIFIC_MODE': return { ...state, specificMode: action.value, shareToFeed: action.value ? false : state.shareToFeed, sendToFriendIds: [], friendSearch: '' };
    case 'SHARE_TO_FEED': return { ...state, shareToFeed: action.value, specificMode: action.value ? false : state.specificMode, sendToFriendIds: action.value ? [] : state.sendToFriendIds };
    case 'VISIBILITY': {
      // A private question is author-only: broadcasting or direct-sending it
      // would create feed rows the render-time visibility filter then hides.
      // Clear those destinations when switching to private (mirrors how
      // SPECIFIC_MODE clears shareToFeed).
      if (action.value === 'private') {
        return { ...state, visibility: action.value, shareToFeed: false, specificMode: false, sendToFriendIds: [], friendSearch: '' };
      }
      return { ...state, visibility: action.value };
    }
    case 'FRIENDS_LOADING': return { ...state, friendsLoading: action.value };
    case 'FRIENDS_LOADED': return { ...state, friends: action.friends, friendsLoading: false };
    case 'RECENTS_LOADED': return { ...state, recentFriendIds: action.ids };
    case 'FRIEND_SEARCH': return { ...state, friendSearch: action.value };
    case 'TOGGLE_FRIEND': {
      const selected = state.sendToFriendIds.includes(action.id);
      return { ...state, sendToFriendIds: selected ? state.sendToFriendIds.filter((id) => id !== action.id) : [...state.sendToFriendIds, action.id] };
    }
    default: return state;
  }
}

function alternateAnswersFrom(text: string): string[] {
  return text.split(',').map((answer) => answer.trim()).filter(Boolean).slice(0, MAX_ALTERNATE_ANSWERS);
}

// Small inline loader shown while the LLM suggestion is being fetched, so the
// answer fields don't flash their placeholders (e.g. "Bucephalus") as if they
// were a real answer. Mirrors the animated dots in LoadingScreen and reuses the
// `triangle-loader-dot` class, which carries the reduced-motion guard.
function InlineLoading({ label = 'Loading' }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center gap-1 py-10 text-sm font-medium uppercase tracking-wider text-muted-foreground"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
    >
      <span>{label}</span>
      <span className="ml-0.5 inline-flex gap-0.5" aria-hidden="true">
        <span className="triangle-loader-dot inline-block" style={{ animation: 'loading-dot 1.2s ease-in-out 0s infinite' }}>.</span>
        <span className="triangle-loader-dot inline-block" style={{ animation: 'loading-dot 1.2s ease-in-out 0.2s infinite' }}>.</span>
        <span className="triangle-loader-dot inline-block" style={{ animation: 'loading-dot 1.2s ease-in-out 0.4s infinite' }}>.</span>
      </span>
    </div>
  );
}

function answersMatch(a: string, b: string | null): boolean {
  if (!b) return true;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// "Verified" means the answer is independently corroborated, NOT merely that the
// author didn't override the LLM. It is earned only when the author *typed their
// own* answer and it agrees with Joshing's independent suggestion. Passively
// accepting the suggestion (answerSource 'suggestion') is deference to the machine,
// not corroboration, so it stays unverified — this is what stops a confidently
// wrong auto-suggestion from self-certifying and becoming broadcast-eligible.
// With no suggestion to check against, we fall back to verified (unchanged
// behaviour for when the suggestion is unavailable, or edit mode without one).
export function isVerifiedAnswer(params: {
  suggestedAnswer: string | null;
  userAnswer: string;
  answerSource: AnswerSource;
}): boolean {
  if (!params.suggestedAnswer) return true;
  return params.answerSource === 'author' && answersMatch(params.userAnswer, params.suggestedAnswer);
}

function computedVerified(state: State): boolean {
  return isVerifiedAnswer({
    suggestedAnswer: state.llmSuggestedAnswer,
    userAnswer: state.userAnswer,
    answerSource: state.answerSource,
  });
}

function validate(state: State): string | null {
  const alternateAnswers = alternateAnswersFrom(state.alternateText);
  if (!state.questionText.trim()) return 'Question text is required.';
  if (state.questionText.trim().length > 300) return 'Question text must be 300 characters or fewer.';
  if (!state.userAnswer.trim()) return 'Correct answer is required.';
  if (state.userAnswer.trim().length > 200) return 'Correct answer must be 200 characters or fewer.';
  if (alternateAnswers.length > MAX_ALTERNATE_ANSWERS) return `Use at most ${MAX_ALTERNATE_ANSWERS} alternate answers.`;
  if (alternateAnswers.some((answer) => answer.length > 200)) return 'Alternate answers must be 200 characters or fewer.';
  if (state.explanation.length > 500) return 'Explanation must be 500 characters or fewer.';
  if (state.creatorNote.length > 200) return 'Between us text must be 200 characters or fewer.';
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

// D9 (PRD-D-5 §5.1): authored questions are public by default — reach is a
// reward, not a risk. The signpost states this plainly and positively; it is
// never a cautionary or blocking warning. Friends-only is the calm exception.
// `visibility` is the existing column the unified pool layer reads as `scope`
// (public → public, friends → friends_only); no new field is written.
export function scopeSignpost(visibility: 'public' | 'friends' | 'private'): string {
  switch (visibility) {
    case 'public':
      return 'Others can play this. Your friends will see it’s from you.';
    case 'friends':
      return 'Kept to friends only — only people who follow you will see it.';
    case 'private':
      return 'Only you can see this — it won’t be shared.';
  }
}

// A single critique reformulation option. The whole button is the "use this"
// affordance — the shared "Try one of these instead:" header already states the
// intent, so the per-option "Use this" label was redundant and is no longer
// rendered. The reformulation value still owns its own element node so it can
// never run together with surrounding text into a single run-on string (the
// "Use this Which American city…" artifact, B-COMPOSER-SUGGESTION-ARTIFACT-01).
export function ReformulationOption({ text, onUse }: { text: string; onUse: () => void }) {
  return (
    <button
      type="button"
      onClick={onUse}
      className="block w-full rounded-md border bg-background px-3 py-2 text-left text-sm hover:bg-muted"
    >
      <span className="block">{text}</span>
    </button>
  );
}

export function QuestionForm({
  mode = 'create',
  initialValues,
  initialSpecificMode = false,
  autoSubmit = false,
  onSubmit,
  submitLabel,
  loadingLabel = 'Saving...',
  onCancel,
}: Props) {
  const [state, dispatch] = useReducer(reducer, undefined, () => initialState(initialValues, initialSpecificMode));
  const questionRef = useRef<HTMLTextAreaElement | null>(null);
  const lastSuggestionQuestionTextRef = useRef<string | null>(initialValues?.llmSuggestedAnswer ? (initialValues.text ?? '').trim() : null);
  // autoSubmit drives the form through review → suggestion → save on its own.
  // These guards keep each leg firing exactly once: `started` kicks the review,
  // `submitted` fires the save once an answer exists. Reset on every new prefill.
  const autoSubmitStartedRef = useRef(false);
  const autoSubmittedRef = useRef(false);

  // PRD §16.12: first-time-author orientation panel. Shown on the first
  // create-mode mount for an account that has never authored a non-deleted
  // question. Dismissed by tap or naturally hidden once the user saves their
  // first question (the count becomes 1).
  const [orientationVisible, setOrientationVisible] = useState(false);
  useEffect(() => {
    if (mode !== 'create') return;
    let cancelled = false;
    void fetch('/api/me/has-authored-question', { cache: 'no-store', credentials: 'include' })
      .then((response) => response.ok ? response.json() : null)
      .then((body: { hasAuthored?: boolean } | null) => {
        if (cancelled) return;
        if (body && body.hasAuthored === false) setOrientationVisible(true);
      })
      .catch(() => { /* swallow — orientation is optional */ });
    return () => { cancelled = true };
  }, [mode]);

  useEffect(() => {
    lastSuggestionQuestionTextRef.current = initialValues?.llmSuggestedAnswer ? (initialValues.text ?? '').trim() : null;
    autoSubmitStartedRef.current = false;
    autoSubmittedRef.current = false;
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
  const friendsById = useMemo(() => {
    const map = new Map<string, FriendOption>();
    for (const friend of state.friends) map.set(friend.id, friend);
    return map;
  }, [state.friends]);
  const recents = useMemo(() => {
    const result: FriendOption[] = [];
    for (const id of state.recentFriendIds) {
      const friend = friendsById.get(id);
      if (friend) result.push(friend);
      if (result.length >= 3) break;
    }
    return result;
  }, [state.recentFriendIds, friendsById]);
  const filteredFriends = useMemo(() => {
    const query = state.friendSearch.trim().toLowerCase();
    if (!query) return state.friends;
    return state.friends.filter((friend) => friend.displayName.toLowerCase().includes(query));
  }, [state.friends, state.friendSearch]);
  const showDestinations = mode === 'create';
  const verified = computedVerified(state);
  const hasAnswer = state.userAnswer.trim().length > 0;
  const usedSuggestion = state.answerSource === 'suggestion';
  const submitDisabled = state.stage === 'SUBMITTING';
  const resolvedSubmitLabel = submitLabel ?? (mode === 'edit' ? 'Update question' : 'Save question');

  async function loadFriends() {
    if (state.friends.length > 0 || state.friendsLoading) return;
    dispatch({ type: 'FRIENDS_LOADING', value: true });
    try {
      const [friendsResponse, recentsResponse] = await Promise.all([
        fetch('/api/users', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/users/recent', { cache: 'no-store', credentials: 'include' }),
      ]);
      const friendsBody = await friendsResponse.json().catch(() => null) as FriendOption[] | null;
      dispatch({ type: 'FRIENDS_LOADED', friends: friendsResponse.ok && Array.isArray(friendsBody) ? friendsBody : [] });
      const recentsBody = await recentsResponse.json().catch(() => null) as FriendOption[] | null;
      const recentIds = recentsResponse.ok && Array.isArray(recentsBody) ? recentsBody.map((friend) => friend.id) : [];
      dispatch({ type: 'RECENTS_LOADED', ids: recentIds });
    } catch {
      dispatch({ type: 'FRIENDS_LOADED', friends: [] });
      dispatch({ type: 'RECENTS_LOADED', ids: [] });
    }
  }

  function toggleSpecificMode(on: boolean) {
    dispatch({ type: 'SPECIFIC_MODE', value: on });
    if (on) void loadFriends();
  }

  function toggleShareToFeed(on: boolean) {
    dispatch({ type: 'SHARE_TO_FEED', value: on });
  }

  function setVisibility(value: 'public' | 'friends' | 'private') {
    dispatch({ type: 'VISIBILITY', value });
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
        // An unverified question can never be broadcast — only direct-sent. Force
        // the broadcast flag off regardless of stale checkbox state (the toggle is
        // also disabled in the UI, and the server rejects unverified broadcasts).
        shareToFeed: verified ? state.shareToFeed : false,
        visibility: state.visibility,
      });
      dispatch({ type: 'DONE' });
    } catch (caught) {
      dispatch({ type: 'ERROR', value: caught instanceof Error ? caught.message : 'Could not save that question.' });
      dispatch({ type: 'ANSWERING' });
    }
  }

  // autoSubmit leg 1: kick the review once for the prefilled question. The
  // existing ANSWERING effect then auto-requests the answer suggestion. If the
  // review surfaces issues (CRITIQUED) we stop here and let the author decide —
  // we don't silently save a flagged question.
  useEffect(() => {
    if (!autoSubmit || mode !== 'create' || autoSubmitStartedRef.current) return;
    if (state.stage !== 'WRITING' || !state.questionText.trim()) return;
    autoSubmitStartedRef.current = true;
    void runCritique();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, mode, state.stage, state.questionText]);

  // autoSubmit leg 2: once we're answering and the suggested answer has landed,
  // save without a manual click. Since the suggestion no longer pre-fills the
  // answer field, adopt it explicitly here (the reader "wrote" the question but
  // did not supply an answer, so it saves as unverified — machine-sourced, not
  // author-corroborated). A failed suggestion (no suggested answer) leaves the
  // author in the normal manual flow rather than blocking.
  useEffect(() => {
    if (!autoSubmit || mode !== 'create' || autoSubmittedRef.current) return;
    if (state.stage !== 'ANSWERING' || state.suggesting) return;
    if (!state.userAnswer.trim()) {
      if (state.llmSuggestedAnswer) dispatch({ type: 'USE_SUGGESTION' });
      return;
    }
    autoSubmittedRef.current = true;
    void finalSave();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSubmit, mode, state.stage, state.suggesting, state.userAnswer, state.llmSuggestedAnswer]);

  const critique = state.critiqueResult;
  const counter = remainingCopy(state);
  const canShowAnswering = state.stage === 'ANSWERING' || state.stage === 'SUBMITTING' || mode === 'edit';

  // Save-success confirmation. The save lands, the form flips to DONE, and this
  // panel replaces the fields so the writer gets an unmistakable in-form
  // confirmation (the host page also fires its destination-aware toast as it
  // closes the drawer a beat later). `Save to bank` is always forced on, so the
  // create-mode baseline is always literally true regardless of sharing choices.
  if (state.stage === 'DONE') {
    return (
      <div className="space-y-5">
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-center" role="status" aria-live="polite">
          <span className="text-3xl leading-none text-[var(--success)]" aria-hidden="true">✓</span>
          <p className="m-0 text-base font-medium text-[var(--success)]">{mode === 'edit' ? 'Question updated.' : 'Saved to your bank.'}</p>
        </div>
      </div>
    );
  }
  // The form lives inside a scrollable drawer/modal (questions + knowledge
  // pages). Keep the action buttons pinned to the bottom on an opaque,
  // composited footer: the backdrop-blur layer prevents the iOS Safari
  // repaint artifact that left a ghost copy of these buttons painted over the
  // scrolling content, and sticky keeps Save/Cancel reachable on long forms.
  // `-mx-5 px-5 pb-5` full-bleeds the bar within the host's px-5 padding
  // (which drops its own bottom padding so this footer sits flush).
  const actionBarClass = 'sticky bottom-0 z-10 -mx-5 flex flex-wrap items-center gap-3 border-t bg-background/95 px-5 pb-5 pt-3 backdrop-blur';

  return (
    <div className="space-y-5">
      {orientationVisible ? (
        <div className="rounded-md border border-[var(--border-warm)] bg-[var(--cream-warm)] px-4 py-3 text-[0.88rem] leading-[1.55] text-[var(--ink)]">
          <p className="m-0">
            Heads up: writing a question opens it as a new domain in your Knowledge base. When a friend answers it correctly, it counts toward your mastery there too. You can also send it directly to specific friends — toggle that on the destinations panel below.
          </p>
          <button
            type="button"
            onClick={() => setOrientationVisible(false)}
            className="mt-2 text-[0.78rem] uppercase tracking-[0.08em] text-[var(--text-muted-warm)] underline-offset-2 hover:underline cursor-pointer bg-transparent border-0 p-0"
          >
            Got it
          </button>
        </div>
      ) : null}
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
          className="w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 py-2 text-base outline-none focus:border-[var(--brand-navy)]"
          placeholder="What is the name of Alexander the Great's horse?"
          readOnly={state.stage === 'SUBMITTING'}
        />
        <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>{state.stage === 'CRITIQUING' ? 'Reviewing your question...' : null}</span>
          <span>{state.questionText.length}/300</span>
        </div>
      </div>

      {state.stage === 'CRITIQUED' && critique && !critique.ok ? (
        <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
          <p className="font-medium">⚠ This question might be unclear:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {critique.issues.map((issue) => <li key={issue}>{issue}</li>)}
          </ul>
          <p className="mt-3 font-medium">Try one of these instead:</p>
          <div className="mt-2 space-y-2">
            {critique.reformulations.map((text) => (
              <ReformulationOption key={text} text={text} onUse={() => dispatch({ type: 'USE_REFORMULATION', text })} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="btn-ghost" onClick={() => dispatch({ type: 'KEEP_VERSION' })}>Keep my version anyway</button>
            <button type="button" className="btn-ghost" onClick={() => dispatch({ type: 'EDIT_RECHECK' })}>Edit and recheck</button>
          </div>
        </div>
      ) : null}

      {!canShowAnswering ? (
        <div className={actionBarClass}>
          <button type="button" onClick={() => void runCritique()} disabled={!state.questionText.trim() || state.stage === 'CRITIQUING'} className="btn-primary">
            {state.stage === 'CRITIQUING' ? 'Reviewing...' : 'Continue'}
          </button>
          {counter ? <span className="text-xs text-muted-foreground">{counter}</span> : null}
          {onCancel ? <button type="button" onClick={onCancel} className="btn-ghost">Cancel</button> : null}
        </div>
      ) : null}

      {canShowAnswering ? (
        state.suggesting ? (
          <InlineLoading label="Loading" />
        ) : (
        <>
          {state.stage !== 'SUBMITTING' && (counter || state.suggesting || state.suggestionError) ? (
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
              readOnly={state.stage === 'SUBMITTING'}
              className="w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 py-2 outline-none focus:border-[var(--brand-navy)]"
              placeholder="Bucephalus"
            />
          </div>

          <div>
            <label htmlFor="alternate-answers" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Alternate answers</label>
            <input id="alternate-answers" value={state.alternateText} onChange={(event) => dispatch({ type: 'FIELD', field: 'alternateText', value: event.target.value })} readOnly={state.stage === 'SUBMITTING'} className="w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 py-2 outline-none focus:border-[var(--brand-navy)]" placeholder="Accepted variations, separated by commas" />
            <p className="mt-1 text-xs text-muted-foreground">{alternateAnswers.length}/{MAX_ALTERNATE_ANSWERS} alternates</p>
          </div>

          {/* The explanation is written by Joshing's answer suggestion and is
              shown read-only — the author confirms it rather than editing it.
              Hidden until there's something to show, and hidden again if the
              chosen answer diverges from Joshing's (the explanation describes
              Joshing's answer, so it would misdescribe a different one). */}
          {state.explanation.trim() && answersMatch(state.userAnswer, state.llmSuggestedAnswer) ? (
            <div>
              <p className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Explanation</p>
              <div className="w-full whitespace-pre-wrap rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 py-2">{state.explanation}</div>
              <p className="mt-1 text-xs text-muted-foreground">Written by Joshing.</p>
            </div>
          ) : null}

          <div>
            <label htmlFor="creator-note" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">Between us text</label>
            <textarea id="creator-note" value={state.creatorNote} onChange={(event) => dispatch({ type: 'FIELD', field: 'creatorNote', value: event.target.value.slice(0, 200) })} rows={3} maxLength={200} readOnly={state.stage === 'SUBMITTING'} className="w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 py-2 outline-none focus:border-[var(--brand-navy)]" placeholder="A note just for your friends" />
            <div className="mt-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span>Only friends see this.</span>
              <span>{state.creatorNote.length}/200</span>
            </div>
          </div>

          {/* Joshing's answer is an INDEPENDENT cross-check, never a pre-fill.
              The author enters their own answer; agreement earns "verified". This
              is what stops a confidently-wrong suggestion (e.g. "Keanu Reeves" for
              a fact about Balthazar Getty) from self-certifying via auto-fill. */}
          {state.llmSuggestedAnswer ? (
            !hasAnswer ? (
              // Nothing entered yet — offer Joshing's answer as a cross-check, but
              // do not fill the field (that would manufacture a false match).
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Joshing&apos;s answer</p>
                <p className="mt-1 font-medium">{state.llmSuggestedAnswer}</p>
                <p className="mt-1 text-xs text-muted-foreground">Type the answer you have in mind above and we&apos;ll check it against this — or adopt Joshing&apos;s as-is.</p>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'USE_SUGGESTION' })}
                  disabled={state.stage === 'SUBMITTING'}
                  className="mt-2 rounded-md border px-3 py-1 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Use Joshing&apos;s answer
                </button>
              </div>
            ) : verified ? (
              <p className="text-sm text-[var(--success)]">✓ Verified — your answer matches Joshing&apos;s independent answer.</p>
            ) : usedSuggestion ? (
              // Author adopted the suggestion without supplying their own answer.
              // Coherent, but not independently corroborated — cannot broadcast.
              <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
                <p>⚠ Unverified — this is Joshing&apos;s suggested answer, not one you confirmed yourself. You can send it directly to specific friends, but it can&apos;t be shared with everyone. If you know it&apos;s right, type it into the answer field above.</p>
              </div>
            ) : (
              // Author supplied their own answer and it differs from Joshing&apos;s.
              <div className="rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] p-3 text-sm text-[var(--warning)]">
                <p className="text-xs uppercase tracking-[0.1em]">Joshing suggested a different answer</p>
                <p className="mt-1 line-through decoration-[var(--warning)]">{state.llmSuggestedAnswer}</p>
                <p className="mt-2">⚠ Unverified — your answer differs from Joshing&apos;s. Double-check which is right; recipients will see it tagged unverified.</p>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'USE_SUGGESTION' })}
                  disabled={state.stage === 'SUBMITTING'}
                  className="mt-2 rounded-md border border-[var(--warning)] px-3 py-1 text-xs font-medium text-[var(--warning)] hover:bg-[var(--warning-surface)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Use Joshing&apos;s answer instead
                </button>
              </div>
            )
          ) : null}

          {showDestinations ? (
            <div className="rounded-md border bg-muted/40 p-4">
              <p className="mb-3 text-xs uppercase tracking-[0.1em] text-muted-foreground">Destinations</p>
              <div className="mb-3">
                <p className="mb-2 text-xs uppercase tracking-[0.1em] text-muted-foreground">Who can see this</p>
                <div className="inline-flex rounded-md border bg-background p-0.5" role="group" aria-label="Question visibility">
                  {([
                    { value: 'public', label: 'Public' },
                    { value: 'friends', label: 'Followers' },
                    { value: 'private', label: 'Private' },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setVisibility(option.value)}
                      aria-pressed={state.visibility === option.value}
                      disabled={state.stage === 'SUBMITTING'}
                      className={['rounded px-3 py-1 text-sm transition', state.visibility === option.value ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted'].join(' ')}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-xs text-foreground">{scopeSignpost(state.visibility)}</p>
              </div>
              {!verified ? (
                <p className="mb-3 rounded-md border border-[var(--warning-border)] bg-[var(--warning-surface)] px-3 py-2 text-xs leading-[1.5] text-[var(--warning)]">
                  ⚠ This answer isn&apos;t verified. You can only send it directly to specific friends — it can&apos;t be shared with all friends, and the people you send it to won&apos;t be able to forward it. They&apos;ll see it tagged as unverified.
                </p>
              ) : null}
              <label className="mb-2 flex cursor-default items-center gap-2 text-sm"><input type="checkbox" checked readOnly disabled className="rounded" /><span className="text-foreground">Save to bank</span></label>
              <label className={['mb-2 flex items-center gap-2 text-sm', !verified ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'].join(' ')}><input type="checkbox" checked={verified && state.shareToFeed} onChange={(event) => toggleShareToFeed(event.target.checked)} className="rounded" disabled={state.stage === 'SUBMITTING' || state.visibility === 'private' || !verified} /><span className="text-foreground">Share with all friends{!verified ? ' (unavailable — answer not verified)' : ''}</span></label>
              <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={state.specificMode} onChange={(event) => toggleSpecificMode(event.target.checked)} className="rounded" disabled={state.stage === 'SUBMITTING' || state.visibility === 'private'} /><span className="text-foreground">Send to specific friends only</span></label>
              {state.specificMode ? (
                <div className="mt-1 space-y-3">
                  {state.sendToFriendIds.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {state.sendToFriendIds.map((id) => {
                        const friend = friendsById.get(id);
                        if (!friend) return null;
                        return (
                          <span key={id} className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary py-1 pl-3 pr-1 text-sm text-primary-foreground">
                            {friend.displayName}
                            <button
                              type="button"
                              onClick={() => dispatch({ type: 'TOGGLE_FRIEND', id })}
                              aria-label={`Remove ${friend.displayName}`}
                              className="inline-flex size-5 items-center justify-center rounded-full hover:bg-primary-foreground/20"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        );
                      })}
                    </div>
                  ) : null}

                  {state.friendsLoading ? (
                    <p className="text-xs text-muted-foreground">Loading friends...</p>
                  ) : state.friends.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No friends found.</p>
                  ) : (
                    <>
                      {state.friendSearch.trim() === '' && recents.length > 0 ? (
                        <div>
                          <p className="mb-2 text-xs uppercase tracking-[0.1em] text-muted-foreground">Recents</p>
                          <div className="flex flex-wrap gap-2">
                            {recents.map((friend) => {
                              const selected = state.sendToFriendIds.includes(friend.id);
                              return (
                                <button
                                  key={friend.id}
                                  type="button"
                                  onClick={() => dispatch({ type: 'TOGGLE_FRIEND', id: friend.id })}
                                  aria-pressed={selected}
                                  className={['rounded-full border px-3 py-1 text-sm transition', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background hover:bg-muted'].join(' ')}
                                >
                                  {friend.displayName}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      <label className="relative block">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                          type="text"
                          aria-label="Search friends"
                          value={state.friendSearch}
                          onChange={(event) => dispatch({ type: 'FRIEND_SEARCH', value: event.target.value })}
                          placeholder="Search friends..."
                          className="h-10 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] pl-9 pr-3 text-sm outline-none focus:border-[var(--brand-navy)]"
                          disabled={state.stage === 'SUBMITTING'}
                        />
                      </label>

                      <div className="max-h-64 overflow-y-auto rounded-md border">
                        {filteredFriends.length === 0 ? (
                          <p className="p-3 text-xs text-muted-foreground">No friends match &ldquo;{state.friendSearch.trim()}&rdquo;.</p>
                        ) : (
                          filteredFriends.map((friend) => {
                            const selected = state.sendToFriendIds.includes(friend.id);
                            return (
                              <button
                                key={friend.id}
                                type="button"
                                onClick={() => dispatch({ type: 'TOGGLE_FRIEND', id: friend.id })}
                                aria-pressed={selected}
                                className="flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/60"
                              >
                                <span className={['inline-flex size-4 items-center justify-center rounded-sm border', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-background'].join(' ')}>
                                  {selected ? <span aria-hidden className="text-[10px] leading-none">✓</span> : null}
                                </span>
                                <span>{friend.displayName}</span>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </>
                  )}
                </div>
              ) : null}
              <p className="mt-3 text-xs text-muted-foreground">{state.specificMode ? 'Sent directly to the friends you pick.' : verified && state.shareToFeed ? "Your friends will see this in their feed (except friends who've marked this domain as Not my focus)." : 'Saved to your bank only.'}</p>
            </div>
          ) : null}

          <div className={actionBarClass}>
            <button type="button" disabled={submitDisabled} onClick={() => void finalSave()} className="btn-primary">
              {submitDisabled ? (
                <span className="inline-flex items-center">
                  {loadingLabel.replace(/[.…]+$/, '')}
                  <span className="ml-0.5 inline-flex gap-0.5" aria-hidden="true">
                    <span className="triangle-loader-dot inline-block" style={{ animation: 'loading-dot 1.2s ease-in-out 0s infinite' }}>.</span>
                    <span className="triangle-loader-dot inline-block" style={{ animation: 'loading-dot 1.2s ease-in-out 0.2s infinite' }}>.</span>
                    <span className="triangle-loader-dot inline-block" style={{ animation: 'loading-dot 1.2s ease-in-out 0.4s infinite' }}>.</span>
                  </span>
                </span>
              ) : resolvedSubmitLabel}
            </button>
            {onCancel ? <button type="button" onClick={onCancel} className="btn-ghost" disabled={submitDisabled}>Cancel</button> : null}
          </div>
        </>
        )
      ) : null}
    </div>
  );
}
