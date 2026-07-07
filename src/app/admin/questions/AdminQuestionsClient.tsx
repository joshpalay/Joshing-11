'use client';

import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { AdminTabs } from '@/app/admin/AdminTabs';
import { CATEGORIES } from '@/lib/questions-types';
import type {
  AdminQuestionDetail,
  AdminQuestionRow,
  AdminQuestionSortDir,
  AdminQuestionSortKey,
  AdminQuestionsPage,
} from '@/server/db/queries/admin-questions';

// B-ADMIN-QUESTIONS-OVERVIEW-01 Phase 1+2 — the read-only pool audit table with
// server-driven sort & filter (URL search params → server re-query, so sort and
// filter apply across the WHOLE pool, not just the loaded page). Deliberately
// plain (an internal ops tool). Interface quiet, content loud. Canon:
// house/tombstone rows carry the neutral "House" label resolved server-side
// (never a person); every flag is a TEXT badge, never color alone.

// Filter option lists. Sourced from the schema pgEnums (TrustTier,
// QuestionVisibility, QuestionVerificationVerdict) and CATEGORIES — kept as plain
// constants here so this client module pulls in no server-only schema import.
const TRUST_TIERS = ['unverified', 'machine_verified', 'human_validated', 'author_confirmed'];
const VISIBILITIES = ['public', 'friends', 'private', 'blocked'];
const VERDICTS = ['ok', 'demoted', 'unverifiable', 'skipped'];

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

function fmtRate(row: AdminQuestionRow): string {
  if (row.correctRate !== null && row.correctRate !== undefined) {
    return `${Math.round(row.correctRate * 100)}%`;
  }
  if (row.askedCount > 0) return `${Math.round((row.correctCount / row.askedCount) * 100)}%`;
  return '—';
}

// A text-labelled badge. Callers pass a semantic token for tone; the LABEL always
// carries the meaning so nothing is conveyed by color alone.
function Badge({ label, tone }: { label: string; tone?: 'muted' | 'danger' | 'navy' | 'warning' }) {
  const style =
    tone === 'danger'
      ? { color: 'var(--danger)', borderColor: 'var(--danger)' }
      : tone === 'navy'
        ? { color: 'var(--brand-navy)', borderColor: 'var(--brand-navy)' }
        : tone === 'warning'
          ? { color: 'var(--warning)', borderColor: 'var(--warning)' }
          : { color: 'var(--text-muted)', borderColor: 'var(--border)' };
  return (
    <span
      className="inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium"
      style={style}
    >
      {label}
    </span>
  );
}

function FlagBadges({ row }: { row: AdminQuestionRow }) {
  const flags: { label: string; tone: 'danger' | 'warning' | 'muted' }[] = [];
  if (row.deletedAt) flags.push({ label: 'deleted', tone: 'danger' });
  if (row.authorDeleted) flags.push({ label: 'tombstone', tone: 'muted' });
  if (row.nobodyCorrectFlag) flags.push({ label: 'nobody-correct', tone: 'warning' });
  if (row.isDuplicate) flags.push({ label: 'duplicate', tone: 'warning' });
  if (row.perishable) flags.push({ label: 'perishable', tone: 'muted' });
  if (flags.length === 0) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <Badge key={f.label} label={f.label} tone={f.tone} />
      ))}
    </span>
  );
}

const CELL = 'px-2 py-1.5 align-top text-[13px]';
const HEAD = 'px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-[0.04em]';
const CONTROL = 'rounded-md border px-2 py-1.5 text-sm';

// A sortable column header. A <button> so it is keyboard-operable; aria-sort
// exposes the current direction to assistive tech.
function SortHeader({
  label,
  columnKey,
  sortKey,
  sortDir,
  onToggle,
}: {
  label: string;
  columnKey: AdminQuestionSortKey;
  sortKey: AdminQuestionSortKey;
  sortDir: AdminQuestionSortDir;
  onToggle: (key: AdminQuestionSortKey) => void;
}) {
  const active = sortKey === columnKey;
  const arrow = active ? (sortDir === 'asc' ? '↑' : '↓') : '';
  return (
    <th className={HEAD} aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button
        type="button"
        onClick={() => onToggle(columnKey)}
        className="inline-flex items-center gap-1 uppercase tracking-[0.04em] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ color: active ? 'var(--brand-navy)' : 'inherit' }}
      >
        {label}
        {arrow ? <span aria-hidden>{arrow}</span> : null}
      </button>
    </th>
  );
}

// ── Phase 3 detail view ──────────────────────────────────────────────────────
// Read-only "look before you edit" surface. Every non-embedding column is
// inspectable. Rendered as a side sheet driven by the ?detail=<id> param.

function scalar(value: string | number | boolean | null): string {
  if (value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

function Field({ label, value }: { label: string; value: string | number | boolean | null }) {
  return (
    <div className="grid grid-cols-[minmax(120px,180px)_1fr] gap-2 py-1">
      <span className="text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="whitespace-pre-wrap break-words text-[13px]" style={{ color: 'var(--brand-ink)' }}>
        {scalar(value)}
      </span>
    </div>
  );
}

function ListField({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="grid grid-cols-[minmax(120px,180px)_1fr] gap-2 py-1">
      <span className="text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      {values.length === 0 ? (
        <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
          —
        </span>
      ) : (
        <ul className="list-disc pl-4 text-[13px]" style={{ color: 'var(--brand-ink)' }}>
          {values.map((v, i) => (
            <li key={i} className="break-words">
              {v}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--brand-navy)' }}>
        {title}
      </h3>
      <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
        {children}
      </div>
    </section>
  );
}

const EDITABLE_VISIBILITIES = ['public', 'friends', 'private'];

// Phase 4 edit form. Minimal ratified field set (Decision B). answerText and
// acceptedAlternatives are grading-adjacent — a change to either requires an
// explicit confirm before persisting (grading must fail toward the player).
function EditForm({
  detail,
  onDone,
  onCancel,
}: {
  detail: AdminQuestionDetail;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [questionText, setQuestionText] = useState(detail.questionText);
  const [answerText, setAnswerText] = useState(detail.answerText);
  const [acceptedAlternatives, setAcceptedAlternatives] = useState(detail.acceptedAlternatives.join('\n'));
  const [factualExplanation, setFactualExplanation] = useState(detail.factualExplanation ?? '');
  const [category, setCategory] = useState(detail.category);
  const [visibility, setVisibility] = useState(detail.visibility);
  // Author: 'person' keeps the current human creator; 'house' re-sources to the
  // house author. Only a person-authored row can switch (a house/LLM row has no
  // person to switch back to without a picker), so the control is read-only then.
  const [authorChoice, setAuthorChoice] = useState<'person' | 'house'>(detail.authorIsPerson ? 'person' : 'house');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const altsArray = acceptedAlternatives
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Build a patch of only the fields that actually changed.
    const patch: Record<string, unknown> = {};
    if (questionText.trim() !== detail.questionText) patch.questionText = questionText.trim();
    if (answerText.trim() !== detail.answerText) patch.answerText = answerText.trim();
    if (JSON.stringify(altsArray) !== JSON.stringify(detail.acceptedAlternatives)) {
      patch.acceptedAlternatives = altsArray;
    }
    if ((factualExplanation.trim() || null) !== (detail.factualExplanation ?? null)) {
      patch.factualExplanation = factualExplanation.trim() || null;
    }
    if (category !== detail.category) patch.category = category;
    if (visibility !== detail.visibility) patch.visibility = visibility;
    // Re-attribution: only person → house is a real transition.
    const toHouse = detail.authorIsPerson && authorChoice === 'house';
    if (toHouse) patch.attribution = 'house';

    if (Object.keys(patch).length === 0) {
      setError('No changes to save.');
      return;
    }

    // Grading-adjacent guard: confirm before changing how answers grade.
    const gradingChanged = 'answerText' in patch || 'acceptedAlternatives' in patch;
    if (gradingChanged) {
      const ok = window.confirm(
        'This changes the answer key or accepted alternatives, which changes how past and future answers grade. Save?',
      );
      if (!ok) return;
    }

    // Re-attribution guard: dropping the person link renders the question as house
    // content and is not reversible from this tool.
    if (toHouse) {
      const ok = window.confirm(
        `Change author from "${detail.authorLabel}" to House? This drops the person's authorship (it leaves their authored list and renders as house content) and can't be reversed here.`,
      );
      if (!ok) return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'edit', id: detail.id, ...patch }),
      });
      if (!res.ok) {
        setError(`Save failed (${res.status}).`);
        setBusy(false);
        return;
      }
      onDone();
    } catch {
      setError('Save failed.');
      setBusy(false);
    }
  }

  const inputClass = 'w-full rounded-md border px-2 py-1.5 text-[13px]';
  const inputStyle = { borderColor: 'var(--border)', background: 'var(--brand-field)', color: 'var(--brand-ink)' };
  const labelClass = 'mb-1 block text-[11px] uppercase tracking-[0.04em]';
  const labelStyle = { color: 'var(--text-muted)' };

  return (
    <div className="mb-4">
      <div className="mb-3">
        <label className={labelClass} style={labelStyle}>
          Question
        </label>
        <textarea rows={3} className={inputClass} style={inputStyle} value={questionText} onChange={(e) => setQuestionText(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className={labelClass} style={labelStyle}>
          Answer (grading key)
        </label>
        <input className={inputClass} style={inputStyle} value={answerText} onChange={(e) => setAnswerText(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className={labelClass} style={labelStyle}>
          Accepted alternatives (one per line)
        </label>
        <textarea rows={3} className={inputClass} style={inputStyle} value={acceptedAlternatives} onChange={(e) => setAcceptedAlternatives(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className={labelClass} style={labelStyle}>
          Factual explanation
        </label>
        <textarea rows={3} className={inputClass} style={inputStyle} value={factualExplanation} onChange={(e) => setFactualExplanation(e.target.value)} />
      </div>
      <div className="mb-3">
        <label className={labelClass} style={labelStyle}>
          Author
        </label>
        <select
          className={inputClass}
          style={inputStyle}
          value={authorChoice}
          disabled={!detail.authorIsPerson}
          onChange={(e) => setAuthorChoice(e.target.value as 'person' | 'house')}
        >
          {detail.authorIsPerson ? <option value="person">{detail.authorLabel}</option> : null}
          <option value="house">House (Joshing)</option>
        </select>
        {!detail.authorIsPerson ? (
          <p className="mt-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
            Already house/non-person — reassigning to a specific person isn&apos;t supported here.
          </p>
        ) : null}
      </div>
      <div className="mb-3 flex gap-3">
        <div className="flex-1">
          <label className={labelClass} style={labelStyle}>
            Category
          </label>
          <select className={inputClass} style={inputStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <label className={labelClass} style={labelStyle}>
            Visibility
          </label>
          <select className={inputClass} style={inputStyle} value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            {EDITABLE_VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
            {/* A blocked row keeps its value visible but can't be re-selected. */}
            {detail.visibility === 'blocked' ? <option value="blocked">blocked</option> : null}
          </select>
        </div>
      </div>

      {error ? (
        <p className="mb-2 text-[13px]" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={save}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function DetailSheet({ detail, onClose }: { detail: AdminQuestionDetail; onClose: () => void }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function mutate(action: 'delete' | 'restore') {
    if (action === 'delete' && !window.confirm('Soft-delete this question? It stays inspectable under "show deleted" and can be restored.')) {
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await fetch('/api/admin/questions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, id: detail.id }),
      });
      if (!res.ok) {
        setActionError(`${action === 'delete' ? 'Delete' : 'Restore'} failed (${res.status}).`);
        setBusy(false);
        return;
      }
      router.refresh();
    } catch {
      setActionError(`${action === 'delete' ? 'Delete' : 'Restore'} failed.`);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: 'rgba(0,0,0,0.3)' }}
      onClick={onClose}
      role="presentation"
    >
      <div
        className="h-full w-full overflow-y-auto border-l p-5 sm:max-w-xl"
        style={{ background: 'var(--brand-card)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Question detail"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-serif text-lg font-semibold" style={{ color: 'var(--brand-ink)' }}>
              Question detail
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {detail.id}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-3 py-1.5 text-sm"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
          >
            Close
          </button>
        </div>

        {/* Phase 4 actions. Deleted rows offer Restore instead of Edit/Delete. */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {detail.deletedAt ? (
            <>
              <span className="text-[13px]" style={{ color: 'var(--danger)' }}>
                Deleted {detail.deletedAt.slice(0, 10)}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => mutate('restore')}
                className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              >
                Restore
              </button>
            </>
          ) : (
            <>
              {!editing ? (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="rounded-md border px-3 py-1.5 text-sm font-medium"
                  style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                >
                  Edit
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => mutate('delete')}
                className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
              >
                Delete
              </button>
            </>
          )}
        </div>
        {actionError ? (
          <p className="mb-3 text-[13px]" style={{ color: 'var(--danger)' }}>
            {actionError}
          </p>
        ) : null}

        {editing ? (
          <EditForm
            detail={detail}
            onDone={() => {
              setEditing(false);
              router.refresh();
            }}
            onCancel={() => setEditing(false)}
          />
        ) : null}

        <Group title="Content">
          <Field label="Question" value={detail.questionText} />
          <Field label="Answer" value={detail.answerText} />
          <ListField label="Accepted alt." values={detail.acceptedAlternatives} />
          <Field label="Factual explanation" value={detail.factualExplanation} />
          <Field label="Breadcrumb" value={detail.breadcrumbContext} />
          <Field label="Creator note" value={detail.creatorNote} />
          <Field label="Inside joke" value={detail.insideJoke} />
          <Field label="Short label" value={detail.shortLabel} />
          <Field label="LLM suggested" value={detail.llmSuggestedAnswer} />
          <Field label="Answer source" value={detail.answerSource} />
        </Group>

        <Group title="Provenance">
          <Field label="Author" value={detail.authorIsPerson ? detail.authorLabel : `${detail.authorLabel} (non-person)`} />
          <Field label="Creator id" value={detail.creatorId} />
          <Field label="Source" value={detail.source} />
          <Field label="Generated question id" value={detail.generatedQuestionId} />
          <Field label="Source question id" value={detail.sourceQuestionId} />
          <Field label="Source creator id" value={detail.sourceCreatorId} />
          <Field label="Suppressed by" value={detail.suppressedBy} />
          <Field label="Subject entity" value={detail.subjectEntity} />
          <Field label="Categorize provider" value={detail.categorizeProvider} />
          <ListField label="Source refs" values={detail.sourceRefs} />
        </Group>

        <Group title="Categorization">
          <Field label="Category" value={detail.category} />
          <Field label="Broad category" value={detail.broadCategory} />
          <Field label="Subcategory" value={detail.subcategory} />
          <Field label="Canonical subcat." value={detail.canonicalSubcategory} />
          <Field label="Category overridden" value={detail.categoryOverridden} />
          <Field label="Question type" value={detail.questionType} />
          <Field label="Minimum required" value={detail.minimumRequired} />
          <Field label="Difficulty (est.)" value={detail.difficultyEstimate} />
          <Field label="Difficulty (LLM)" value={detail.llmDifficulty} />
          <Field label="Difficulty (calib.)" value={detail.calibratedDifficulty} />
        </Group>

        <Group title="Explainers">
          <Field label="Brief" value={detail.explainerBrief} />
          <Field label="Full" value={detail.explainerFull} />
          <Field label="Brief (correct)" value={detail.explainerBriefCorrect} />
          <Field label="Full (correct)" value={detail.explainerFullCorrect} />
          <Field label="Brief (wrong)" value={detail.explainerBriefWrong} />
          <Field label="Full (wrong)" value={detail.explainerFullWrong} />
          <Field label="Brief (expired)" value={detail.explainerBriefExpired} />
          <Field label="Full (expired)" value={detail.explainerFullExpired} />
        </Group>

        <Group title="Grading & lifecycle state">
          <Field label="Status" value={detail.status} />
          <Field label="Verified" value={detail.verified} />
          <Field label="Trust tier" value={detail.trustTier} />
          <Field label="Visibility" value={detail.visibility} />
          <Field label="Public status" value={detail.publicStatus} />
          <Field label="Public elig. score" value={detail.publicEligibilityScore} />
          <Field label="Public elig. reason" value={detail.publicEligibilityReason} />
          <Field label="Shared to friends" value={detail.sharedToFriendsFeed} />
          <Field label="Verification verdict" value={detail.verificationVerdict} />
          <Field label="Verification reason" value={detail.verificationReason} />
          <Field label="Critique iterations" value={detail.critiqueIterations} />
        </Group>

        <Group title="Signals & flags">
          <Field label="Asked count" value={detail.askedCount} />
          <Field label="Correct count" value={detail.correctCount} />
          <Field label="Correct rate" value={detail.correctRate} />
          <Field label="Surface priority" value={detail.surfacePriorityScore} />
          <Field label="Perishable" value={detail.perishable} />
          <Field label="Nobody correct" value={detail.nobodyCorrectFlag} />
          <Field label="Duplicate" value={detail.isDuplicate} />
          <Field label="Author deleted" value={detail.authorDeleted} />
        </Group>

        <Group title="Timestamps">
          <Field label="Created" value={detail.createdAt} />
          <Field label="Updated" value={detail.updatedAt} />
          <Field label="Verified at" value={detail.verifiedAt} />
          <Field label="Deleted at" value={detail.deletedAt} />
        </Group>
      </div>
    </div>
  );
}

export function AdminQuestionsClient({
  result,
  sortKey,
  sortDir,
  detail,
}: {
  result: AdminQuestionsPage;
  sortKey: AdminQuestionSortKey;
  sortDir: AdminQuestionSortDir;
  detail: AdminQuestionDetail | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [search, setSearch] = useState(searchParams.get('q') ?? '');

  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  // Update the given params (null deletes), always resetting to page 1 for any
  // filter/sort change so a narrowed result set never lands on an empty page.
  function navigate(next: Record<string, string | null>, { keepPage = false } = {}) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === '') params.delete(key);
      else params.set(key, value);
    }
    if (!keepPage) params.delete('page');
    router.push(`/admin/questions?${params.toString()}`);
  }

  function setFilter(key: string, value: string | null) {
    navigate({ [key]: value });
  }

  function toggleFlag(key: string, on: boolean) {
    navigate({ [key]: on ? '1' : null });
  }

  function toggleSort(key: AdminQuestionSortKey) {
    // Same column → flip direction; new column → default to desc.
    const nextDir: AdminQuestionSortDir = sortKey === key && sortDir === 'desc' ? 'asc' : 'desc';
    navigate({ sort: key, dir: nextDir });
  }

  function goToPage(page: number) {
    navigate({ page: String(page) }, { keepPage: true });
  }

  function openDetail(id: string) {
    navigate({ detail: id }, { keepPage: true });
  }

  function closeDetail() {
    navigate({ detail: null }, { keepPage: true });
  }

  function resetFilters() {
    setSearch('');
    router.push('/admin/questions');
  }

  const isDeleted = result.showDeleted;

  const boolFilters: { key: string; label: string }[] = [
    { key: 'nobodyCorrect', label: 'Nobody correct' },
    { key: 'duplicate', label: 'Duplicate' },
    { key: 'tombstone', label: 'Tombstone' },
    { key: 'perishable', label: 'Perishable' },
  ];

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6">
      <h1 className="mb-3 font-serif text-2xl font-semibold text-[var(--brand-ink)]">Questions</h1>
      <div className="mb-4">
        <AdminTabs active="questions" />
      </div>

      {/* Filter bar. Every control combines (AND) with the others server-side. */}
      <form
        className="mb-3 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setFilter('q', search.trim() || null);
        }}
      >
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
          Search
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="question or answer"
            className={CONTROL}
            style={{ borderColor: 'var(--border)', minWidth: '200px' }}
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
          Category
          <select
            value={searchParams.get('category') ?? ''}
            onChange={(e) => setFilter('category', e.target.value || null)}
            className={CONTROL}
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
          Trust tier
          <select
            value={searchParams.get('trustTier') ?? ''}
            onChange={(e) => setFilter('trustTier', e.target.value || null)}
            className={CONTROL}
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">All</option>
            {TRUST_TIERS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
          Visibility
          <select
            value={searchParams.get('visibility') ?? ''}
            onChange={(e) => setFilter('visibility', e.target.value || null)}
            className={CONTROL}
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">All</option>
            {VISIBILITIES.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-[0.04em]" style={{ color: 'var(--text-muted)' }}>
          Verdict
          <select
            value={searchParams.get('verdict') ?? ''}
            onChange={(e) => setFilter('verdict', e.target.value || null)}
            className={CONTROL}
            style={{ borderColor: 'var(--border)' }}
          >
            <option value="">All</option>
            {VERDICTS.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="rounded-md border px-3 py-1.5 text-sm font-medium"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          Apply search
        </button>
        <button
          type="button"
          onClick={resetFilters}
          className="rounded-md border px-3 py-1.5 text-sm"
          style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
        >
          Reset
        </button>
      </form>

      {/* Boolean flag filters — each carries a text label (no color-alone). */}
      <div className="mb-3 flex flex-wrap items-center gap-4 text-sm" style={{ color: 'var(--brand-ink-700)' }}>
        {boolFilters.map((f) => (
          <label key={f.key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={searchParams.get(f.key) === '1'}
              onChange={(e) => toggleFlag(f.key, e.target.checked)}
            />
            {f.label}
          </label>
        ))}
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={isDeleted} onChange={(e) => toggleFlag('showDeleted', e.target.checked)} />
          Show deleted
        </label>
      </div>

      <p className="mb-3 text-sm" style={{ color: 'var(--text-muted)' }}>
        {result.total.toLocaleString()} question{result.total === 1 ? '' : 's'}
        {isDeleted ? ' (including deleted)' : ''}
      </p>

      <div className="overflow-x-auto rounded-md border" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full border-collapse text-left">
          <thead>
            <tr style={{ background: 'var(--surface-2)', color: 'var(--text-muted)' }}>
              <th className={HEAD}>
                <span className="sr-only">Inspect</span>
              </th>
              <th className={HEAD}>Question</th>
              <th className={HEAD}>Answer</th>
              <SortHeader label="Category" columnKey="category" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <th className={HEAD}>Author</th>
              <th className={HEAD}>Source</th>
              <th className={HEAD}>Trust</th>
              <th className={HEAD}>Visibility</th>
              <th className={HEAD}>Public status</th>
              <th className={HEAD}>Verdict</th>
              <SortHeader label="Asked" columnKey="askedCount" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <th className={HEAD}>Correct</th>
              <SortHeader label="Rate" columnKey="correctRate" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              <th className={HEAD}>Flags</th>
              <SortHeader label="Created" columnKey="createdAt" sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
            </tr>
          </thead>
          <tbody>
            {result.rows.length === 0 ? (
              <tr>
                <td className={CELL} colSpan={15} style={{ color: 'var(--text-muted)' }}>
                  No questions match.
                </td>
              </tr>
            ) : (
              result.rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t"
                  style={{
                    borderColor: 'var(--border)',
                    opacity: row.deletedAt ? 0.6 : 1,
                    color: 'var(--brand-ink)',
                  }}
                >
                  <td className={`${CELL} whitespace-nowrap`}>
                    <button
                      type="button"
                      onClick={() => openDetail(row.id)}
                      className="rounded border px-2 py-0.5 text-[11px] font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ borderColor: 'var(--border)', color: 'var(--brand-navy)' }}
                    >
                      Inspect
                    </button>
                  </td>
                  <td className={`${CELL} min-w-[280px] max-w-[360px]`}>
                    <span className="line-clamp-2">{row.questionText}</span>
                  </td>
                  <td className={`${CELL} min-w-[120px] max-w-[200px]`}>
                    <span className="line-clamp-2">{row.answerText}</span>
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>
                    {row.category}
                    {row.broadCategory ? (
                      <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {row.broadCategory}
                      </span>
                    ) : null}
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>
                    {row.authorIsPerson ? row.authorLabel : <Badge label={row.authorLabel} tone="muted" />}
                  </td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.source}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.trustTier}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.visibility}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.publicStatus}</td>
                  <td className={`${CELL} whitespace-nowrap`}>{row.verificationVerdict ?? '—'}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{row.askedCount}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{row.correctCount}</td>
                  <td className={`${CELL} text-right tabular-nums`}>{fmtRate(row)}</td>
                  <td className={`${CELL} min-w-[140px]`}>
                    <FlagBadges row={row} />
                  </td>
                  <td className={`${CELL} whitespace-nowrap`} style={{ color: 'var(--text-muted)' }}>
                    {fmtDate(row.createdAt)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between text-sm">
        <span style={{ color: 'var(--text-muted)' }}>
          Page {result.page} of {totalPages}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            disabled={result.page <= 1}
            onClick={() => goToPage(result.page - 1)}
          >
            Previous
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 disabled:opacity-40"
            style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            disabled={result.page >= totalPages}
            onClick={() => goToPage(result.page + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {detail ? <DetailSheet key={detail.id} detail={detail} onClose={closeDetail} /> : null}
    </main>
  );
}
