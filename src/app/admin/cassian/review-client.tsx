'use client';

import { useState } from 'react';

type Reveal = { answer: string; explainer: string; result: string; gradedVia: string; submittedAnswer: string };
type Details = { model: string; arm: string; machineStatus: string; gateReasons: string[] };
type Card = { id: string; domain: string; breadth: string; difficulty: string; questionText: string; reveal?: Reveal };
type Choice = { field: keyof RatingFields; label: string; values: string[] };
type RatingFields = {
  accuracy: string; clarity: string; interest: string; difficulty: string;
  topicFit: string; appropriateness: string; repetition: string;
  answerAcceptance: string; creationSpeed: string; gateReview: string;
};

const dimensions: Choice[] = [
  { field: 'accuracy', label: 'Accuracy', values: ['Correct', 'Incorrect', 'Cannot verify'] },
  { field: 'clarity', label: 'Clarity', values: ['Clear', 'Ambiguous', 'Missing context', 'Gives answer away'] },
  { field: 'interest', label: 'Interest', values: ['Interesting', 'Fine', 'Boring or generic'] },
  { field: 'difficulty', label: 'Difficulty', values: ['Too easy', 'About right', 'Too hard', 'Cannot judge'] },
  { field: 'topicFit', label: 'Topic fit', values: ['On topic', 'Partly', 'Off topic'] },
  { field: 'appropriateness', label: 'Appropriateness', values: ['Fine', 'Inappropriate', 'Unsure'] },
  { field: 'repetition', label: 'Repetition', values: ['New', 'Already seen', 'Same-fact paraphrase'] },
  { field: 'answerAcceptance', label: 'Answer acceptance', values: ['Grading correct', 'My answer should count', 'Key or variants need correction', 'Not attempted'] },
  { field: 'creationSpeed', label: 'Creation speed', values: ['Fine', 'Noticeable wait', 'Too slow', 'Not observed'] },
];

async function post<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', cache: 'no-store', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Save failed (${response.status}). Your entry is still here; try again.`);
  return response.json() as Promise<T>;
}

export function CassianReviewClient() {
  const [card, setCard] = useState<Card | null>(null);
  const [started, setStarted] = useState(false);
  const [answer, setAnswer] = useState('');
  const [overall, setOverall] = useState('');
  const [fields, setFields] = useState<Partial<RatingFields>>({ creationSpeed: 'Not observed' });
  const [note, setNote] = useState('');
  const [correction, setCorrection] = useState({ question: '', answer: '', variants: '', explanation: '', source: '' });
  const [accuracyIssue, setAccuracyIssue] = useState('');
  const [familiarity, setFamiliarity] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState(0);
  const [revisionId, setRevisionId] = useState(() => crypto.randomUUID());
  const [gateRevisionId, setGateRevisionId] = useState(() => crypto.randomUUID());
  const [details, setDetails] = useState<Details | null>(null);
  const [candidateDisposition, setCandidateDisposition] = useState('');
  const [gateDecisionReview, setGateDecisionReview] = useState('');
  const [postGateNote, setPostGateNote] = useState('');
  const [panelArea, setPanelArea] = useState('Missing topic');
  const [panelText, setPanelText] = useState('');
  const [panelNoteId, setPanelNoteId] = useState(() => crypto.randomUUID());
  const [panelSaved, setPanelSaved] = useState(false);

  async function next() {
    setBusy(true); setError('');
    try {
      const result = await post<{ card: Card | null }>('/api/admin/cassian/next');
      setCard(result.card); setStarted(true); setAnswer(''); setOverall('');
      setFields({ creationSpeed: 'Not observed' }); setNote('');
      setCorrection({ question: '', answer: '', variants: '', explanation: '', source: '' });
      setAccuracyIssue(''); setFamiliarity('');
      setRevisionId(crypto.randomUUID());
      setGateRevisionId(crypto.randomUUID());
      setDetails(null); setCandidateDisposition(''); setGateDecisionReview(''); setPostGateNote('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load a question.'); }
    finally { setBusy(false); }
  }

  async function submitAnswer() {
    if (!card) return;
    setBusy(true); setError('');
    try {
      const result = await post<{ reveal: Reveal }>('/api/admin/cassian/answer', {
        candidateId: card.id, answer,
      });
      setCard({ ...card, reveal: result.reveal });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not check answer.'); }
    finally { setBusy(false); }
  }

  async function submitRating() {
    if (!card || !card.reveal || !overall) return;
    if ((overall === 'Fix' || overall === 'Reject') && !note.trim()) {
      setError('Please explain what should be fixed or why you reject it.'); return;
    }
    setBusy(true); setError('');
    try {
      const result = await post<{ saved: boolean; details: Details }>('/api/admin/cassian/rating', {
        candidateId: card.id,
        rating: {
          revisionId, overall, ...fields, note,
          ...(accuracyIssue ? { accuracyIssue } : {}),
          ...(familiarity ? { familiarity } : {}),
          correctedQuestion: correction.question,
          correctedAnswer: correction.answer,
          correctedVariants: correction.variants,
          correctedExplanation: correction.explanation,
          supportingSource: correction.source,
        },
      });
      setReviewed((count) => count + 1);
      setDetails(result.details);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save rating.'); }
    finally { setBusy(false); }
  }

  async function submitGateReview() {
    if (!card || !details || (!candidateDisposition && !gateDecisionReview && !postGateNote.trim())) return;
    setBusy(true); setError('');
    try {
      await post('/api/admin/cassian/rating', {
        candidateId: card.id,
        rating: {
          revisionId: gateRevisionId, overall, ...fields, note,
          ...(candidateDisposition ? { candidateDisposition } : {}),
          ...(gateDecisionReview ? { gateDecisionReview } : {}),
          ...(postGateNote.trim() ? { postGateNote: postGateNote.trim() } : {}),
          ...(accuracyIssue ? { accuracyIssue } : {}),
          ...(familiarity ? { familiarity } : {}),
          correctedQuestion: correction.question,
          correctedAnswer: correction.answer,
          correctedVariants: correction.variants,
          correctedExplanation: correction.explanation,
          supportingSource: correction.source,
        },
      });
      await next();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save gate review.'); }
    finally { setBusy(false); }
  }

  async function submitPanelNote() {
    if (!panelText.trim()) return;
    setBusy(true); setError('');
    try {
      await post('/api/admin/cassian/panel-note', { id: panelNoteId, area: panelArea, text: panelText });
      setPanelSaved(true); setPanelText(''); setPanelNoteId(crypto.randomUUID());
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save note.'); }
    finally { setBusy(false); }
  }

  return (
    <section className="mt-6 rounded-xl border p-5" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-serif text-xl font-semibold">Review questions</h2>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Rated this visit: {reviewed}</span>
      </div>
      {!started && <button type="button" disabled={busy} onClick={next} className="mt-4 rounded-md px-4 py-2 text-[var(--brand-card)]" style={{ background: 'var(--brand-navy)' }}>Start review</button>}
      {started && !card && <p className="mt-4 text-sm">No new eligible Cassian questions are available for you.</p>}
      {card && <>
        <p className="mt-5 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-navy)' }}>
          {card.domain} · {card.breadth} · {card.difficulty}
        </p>
        <p className="mt-3 font-serif text-xl leading-relaxed">{card.questionText}</p>
        {!card.reveal ? <div className="mt-5">
          <label htmlFor="cassian-answer" className="block text-sm font-semibold">Your answer</label>
          <input id="cassian-answer" value={answer} onChange={(event) => setAnswer(event.target.value)}
            className="mt-2 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} maxLength={500} />
          <button type="button" disabled={busy} onClick={submitAnswer}
            className="mt-3 rounded-md px-4 py-2 text-[var(--brand-card)]" style={{ background: 'var(--brand-navy)' }}>
            Check answer
          </button>
        </div> : <div className="mt-5 rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}>
          <p className="font-semibold">{card.reveal.gradedVia === 'invalid_candidate' ? 'Invalid pilot question' : card.reveal.result === 'correct' ? 'Correct' : card.reveal.result === 'wrong' ? 'Not accepted' : card.reveal.result === 'gave_up' ? 'Answer revealed' : 'Needs grading review'}</p>
          <p className="mt-2">Answer: <strong>{card.reveal.answer}</strong></p>
          <p className="mt-2 text-sm">{card.reveal.explainer}</p>
          {card.reveal.gradedVia === 'invalid_candidate' && <p className="mt-2 text-sm" style={{ color: 'var(--danger)' }}>
            This candidate has no usable answer key. It will be excluded from further review.
          </p>}
          {card.reveal.result === 'needs_review' && card.reveal.gradedVia !== 'invalid_candidate' && <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
            Your wording differs from the key. Mark “My answer should count” below if appropriate.
          </p>}
        </div>}
        {card.reveal && !details && <div className="mt-6">
          <h3 className="font-semibold">Overall rating</h3>
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Overall rating">
            {['Good', 'Fix', 'Reject', 'Unsure'].map((choice) => <button key={choice} type="button"
              aria-pressed={overall === choice} onClick={() => setOverall(choice)}
              className="rounded-md border px-3 py-2 text-sm"
              style={{ borderColor: overall === choice ? 'var(--brand-navy)' : 'var(--border)', background: overall === choice ? 'var(--surface)' : undefined }}>
              {choice}
            </button>)}
          </div>
          <details className="mt-4 rounded-md border p-3" style={{ borderColor: 'var(--border)' }}>
            <summary className="cursor-pointer font-semibold">Detailed ratings and corrections</summary>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {dimensions.map((dimension) => <label key={dimension.field} className="text-sm">
                <span className="block font-medium">{dimension.label}</span>
                <select value={fields[dimension.field] ?? ''} onChange={(event) => setFields({ ...fields, [dimension.field]: event.target.value })}
                  className="mt-1 w-full rounded-md border px-2 py-2" style={{ borderColor: 'var(--border)' }}>
                  <option value="">No rating</option>
                  {dimension.values.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>)}
            </div>
            {fields.accuracy === 'Incorrect' && <label className="mt-4 block text-sm">What is inaccurate?
              <select value={accuracyIssue} onChange={(event) => setAccuracyIssue(event.target.value)}
                className="mt-1 w-full rounded-md border px-2 py-2" style={{ borderColor: 'var(--border)' }}>
                <option value="">Choose an area</option>
                {['Answer', 'Premise', 'Explanation', 'Multiple'].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>}
            <label className="mt-4 block text-sm">Familiarity
              <select value={familiarity} onChange={(event) => setFamiliarity(event.target.value)}
                className="mt-1 w-full rounded-md border px-2 py-2" style={{ borderColor: 'var(--border)' }}>
                <option value="">No rating</option>
                {['Knew it', 'Recognized it', 'New to me', 'Cannot judge'].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <div className="mt-4 grid gap-3">
              <label className="text-sm">Corrected question<input value={correction.question} onChange={(event) => setCorrection({ ...correction, question: event.target.value })} maxLength={1000} className="mt-1 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} /></label>
              <label className="text-sm">Corrected answer<input value={correction.answer} onChange={(event) => setCorrection({ ...correction, answer: event.target.value })} maxLength={500} className="mt-1 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} /></label>
              <label className="text-sm">Corrected accepted variants<input value={correction.variants} onChange={(event) => setCorrection({ ...correction, variants: event.target.value })} maxLength={1000} className="mt-1 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} /></label>
              <label className="text-sm">Corrected explanation<textarea value={correction.explanation} onChange={(event) => setCorrection({ ...correction, explanation: event.target.value })} maxLength={2000} className="mt-1 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} /></label>
              <label className="text-sm">Supporting source<input value={correction.source} onChange={(event) => setCorrection({ ...correction, source: event.target.value })} maxLength={1000} className="mt-1 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} /></label>
            </div>
          </details>
          <label htmlFor="cassian-note" className="mt-4 block text-sm font-semibold">Note {overall === 'Fix' || overall === 'Reject' ? '(required)' : '(optional)'}</label>
          <textarea id="cassian-note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={4000}
            className="mt-2 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} rows={3} />
          <button type="button" disabled={busy || !overall} onClick={submitRating}
            className="mt-3 rounded-md px-4 py-2 text-[var(--brand-card)] disabled:opacity-50" style={{ background: 'var(--brand-navy)' }}>
            Save rating and continue
          </button>
        </div>}
        {details && <div className="mt-6 rounded-lg border p-4" style={{ borderColor: 'var(--border)' }}>
          <p className="font-semibold">Initial rating saved. Machine details are now visible.</p>
          <p className="mt-2 text-sm">Writer: {details.model} ({details.arm})</p>
          <p className="mt-1 text-sm">Core gate: {details.machineStatus === 'passed_core_gates' ? 'passed' : 'held'}</p>
          {details.gateReasons.length > 0 && <ul className="mt-1 list-disc pl-5 text-sm">
            {details.gateReasons.map((reason) => <li key={reason}>{reason}</li>)}
          </ul>}
          <p className="mt-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            These are separate judgments. If you cannot verify a fact, choose Unsure.
          </p>
          <label className="mt-4 block text-sm font-medium">What should happen to this question?
            <select value={candidateDisposition} onChange={(event) => setCandidateDisposition(event.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-2" style={{ borderColor: 'var(--border)' }}>
              <option value="">Choose a disposition</option>
              <option value="Keep">Keep as written</option>
              <option value="Revise">Revise question, answer, or explanation</option>
              <option value="Reject">Reject this question</option>
              <option value="Unsure">Unsure</option>
            </select>
          </label>
          <label className="mt-4 block text-sm font-medium">Was the machine&apos;s pass or hold decision correct?
            <select value={gateDecisionReview} onChange={(event) => setGateDecisionReview(event.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-2" style={{ borderColor: 'var(--border)' }}>
              <option value="">No judgment</option>
              <option value="Yes">Yes</option><option value="No">No</option><option value="Unsure">Unsure</option>
            </select>
          </label>
          <label className="mt-4 block text-sm font-medium">Correction or reason for this question (optional)
            <textarea value={postGateNote} onChange={(event) => setPostGateNote(event.target.value)}
              maxLength={4000} rows={3} className="mt-1 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} />
          </label>
          <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>This note stays with this question. Use Experiment feedback below for missing topics, variety, or interface feedback.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={busy || (!candidateDisposition && !gateDecisionReview && !postGateNote.trim())} onClick={submitGateReview}
              className="rounded-md px-4 py-2 text-[var(--brand-card)] disabled:opacity-50" style={{ background: 'var(--brand-navy)' }}>
              Save review and continue
            </button>
            <button type="button" disabled={busy} onClick={next} className="rounded-md border px-4 py-2" style={{ borderColor: 'var(--border)' }}>
              Continue without gate rating
            </button>
          </div>
        </div>}
      </>}
      {error && <p role="alert" className="mt-4 text-sm" style={{ color: 'var(--danger)' }}>{error}</p>}
      <div className="mt-8 border-t pt-5" style={{ borderColor: 'var(--border)' }}>
        <h3 className="font-semibold">Feedback about the experiment</h3>
        <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>Tell us about missing topics, variety, or this interface, even if you have no question to rate.</p>
        <select value={panelArea} onChange={(event) => setPanelArea(event.target.value)}
          className="mt-3 w-full rounded-md border px-2 py-2" style={{ borderColor: 'var(--border)' }} aria-label="Feedback area">
          {['Missing topic', 'Variety', 'UI issue'].map((value) => <option key={value}>{value}</option>)}
        </select>
        <textarea value={panelText} onChange={(event) => { setPanelText(event.target.value); setPanelSaved(false); }}
          rows={3} maxLength={4000} aria-label="Experiment feedback" className="mt-2 w-full rounded-md border px-3 py-2" style={{ borderColor: 'var(--border)' }} />
        <button type="button" disabled={busy || !panelText.trim()} onClick={submitPanelNote}
          className="mt-2 rounded-md border px-4 py-2 text-sm disabled:opacity-50" style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}>
          Save experiment note
        </button>
        {panelSaved && <p role="status" className="mt-2 text-sm">Experiment note saved.</p>}
      </div>
    </section>
  );
}
