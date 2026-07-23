'use client';

import { useState } from 'react';

import { AdminTabs } from '@/app/admin/AdminTabs';
import { HOUSE_AUTHOR } from '@/lib/questions-types';

// Per-line error returned by /api/admin/bulk-upload-questions.
type RowError = { line: number; message: string };

type UploadResult = {
  dryRun: boolean;
  total: number;
  valid?: number;
  invalid?: number;
  created: number;
  skipped?: number;
  rowErrors: RowError[];
};

const SAMPLE_CSV = `question,answer,alternates,explanation,category,subcategory,difficulty
"Which planet is known as the Red Planet?",Mars,,"Iron oxide gives it the colour.",science,Astronomy,1
"Who wrote ""Hamlet""?","William Shakespeare","Shakespeare|Bill Shakespeare",,literature,Shakespeare,moderate`;

// A selectable admin author (resolved server-side from ADMIN_USER_IDS).
type AdminAccount = { id: string; displayName: string };

// Deliberately minimal — an internal ops tool, not a product surface.
export function BulkUploadClient({
  adminAccounts,
  currentUserId,
}: {
  adminAccounts: AdminAccount[];
  currentUserId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  // Defaults to the house identity (no personal byline) — uploads previously
  // defaulted to the uploading admin, which misattributed pool content to a
  // person. Attributing to a specific admin is now the explicit choice.
  const [authorId, setAuthorId] = useState<string>(HOUSE_AUTHOR.id);
  const [pending, setPending] = useState<'dry' | 'commit' | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A selected file wins over pasted text; otherwise the textarea is the source.
  const hasInput = file !== null || text.trim().length > 0;

  async function submit(dryRun: boolean) {
    if (!hasInput || pending) return;
    setPending(dryRun ? 'dry' : 'commit');
    setError(null);
    setResult(null);
    try {
      const res = file
        ? await fetch('/api/admin/bulk-upload-questions', {
            method: 'POST',
            credentials: 'include',
            body: (() => {
              const form = new FormData();
              form.set('file', file);
              form.set('dryRun', dryRun ? 'true' : 'false');
              form.set('authorId', authorId);
              return form;
            })(),
          })
        : await fetch('/api/admin/bulk-upload-questions', {
            method: 'POST',
            credentials: 'include',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ csv: text, dryRun, authorId }),
          });
      const data = (await res.json().catch(() => null)) as (UploadResult & { message?: string }) | null;
      if (!res.ok) {
        setError(data?.message ?? `Upload failed (${res.status}).`);
        setPending(null);
        return;
      }
      setResult(data);
    } catch {
      setError('Upload failed.');
    }
    setPending(null);
  }

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 pt-6 pb-24">
      <header className="mb-5">
        <div className="mb-3">
          <AdminTabs active="bulk-upload" />
        </div>
        <h1 className="font-serif text-2xl font-semibold text-[var(--brand-ink)]">Import CSV</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Create questions in bulk from a CSV. Attribution defaults to the House identity —
          pick a specific admin author only when a personal byline is intended.
        </p>
        <p
          className="mt-2 rounded-md px-3 py-2 text-sm font-medium"
          style={{ background: 'var(--warning-surface)', color: 'var(--brand-ink)' }}
        >
          Uploads publish immediately: every created row is saved as{' '}
          <strong>verified and public</strong> — no review step. Run{' '}
          <strong>Validate (dry run)</strong> first.
        </p>
      </header>

      <section className="rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
        <h2 className="font-medium text-[var(--brand-ink)]">CSV format</h2>
        <ul className="text-muted-foreground mt-2 list-disc space-y-1 pl-5">
          <li>
            Required columns: <code>question</code>, <code>answer</code>.
          </li>
          <li>
            Optional: <code>alternates</code> (separate with <code>|</code>), <code>explanation</code>,{' '}
            <code>category</code>, <code>subcategory</code>, <code>difficulty</code> (1–5 or
            accessible/moderate/specialist).
          </li>
          <li>Unknown categories fall back to General Knowledge. Max 1000 rows per upload.</li>
        </ul>
        <pre
          className="mt-3 overflow-x-auto rounded-md border p-3 type-metadata text-[var(--brand-ink-700)]"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
        >
          {SAMPLE_CSV}
        </pre>
      </section>

      <div className="mt-4">
        <label htmlFor="author" className="text-muted-foreground mb-1 block text-sm">
          Author
        </label>
        <select
          id="author"
          value={authorId}
          onChange={(e) => setAuthorId(e.target.value)}
          disabled={pending !== null}
          className="w-full rounded-md border px-3 py-2 text-sm disabled:opacity-50"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
        >
          <option value={HOUSE_AUTHOR.id}>House ({HOUSE_AUTHOR.displayName}) — no personal byline</option>
          {adminAccounts.length === 0 ? (
            <option value={currentUserId}>You</option>
          ) : (
            adminAccounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName}
                {account.id === currentUserId ? ' (you)' : ''}
              </option>
            ))
          )}
        </select>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
          className="min-w-0 flex-1 text-sm"
        />
      </div>

      <div className="mt-3">
        <label htmlFor="csv-text" className="text-muted-foreground mb-1 block text-sm">
          …or paste CSV directly (include the header row)
        </label>
        <textarea
          id="csv-text"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setResult(null);
            setError(null);
          }}
          rows={8}
          placeholder={SAMPLE_CSV}
          disabled={file !== null}
          className="w-full rounded-md border p-3 font-mono type-metadata disabled:opacity-50"
          style={{ borderColor: 'var(--border)', background: 'var(--brand-field)' }}
        />
        {file !== null ? (
          <p className="text-muted-foreground mt-1 text-xs">
            A file is selected, so the pasted text is ignored. Clear the file to use the text box.
          </p>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void submit(true)}
          disabled={!hasInput || pending !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--border)' }}
        >
          {pending === 'dry' ? 'Validating…' : 'Validate (dry run)'}
        </button>
        <button
          type="button"
          onClick={() => void submit(false)}
          disabled={!hasInput || pending !== null}
          className="rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
        >
          {pending === 'commit' ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm" style={{ color: 'var(--danger)' }}>
          {error}
        </p>
      ) : null}

      {result ? (
        <section className="mt-4 rounded-md border p-4 text-sm" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-medium text-[var(--brand-ink)]">
            {result.dryRun ? 'Dry run results' : 'Upload complete'}
          </h2>
          <p className="text-muted-foreground mt-1">
            {result.dryRun ? (
              <>
                {result.valid ?? 0} valid · {result.invalid ?? 0} with errors · {result.total} total rows
              </>
            ) : (
              <>
                Created {result.created} · skipped {result.skipped ?? 0} · {result.total} total rows
              </>
            )}
          </p>
          {result.rowErrors.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium text-[var(--brand-ink)]">Row errors</p>
              <ul className="mt-1 space-y-1">
                {result.rowErrors.map((err) => (
                  <li key={err.line} style={{ color: 'var(--danger)' }}>
                    Line {err.line}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-2 text-[var(--brand-ink-700)]">No row errors.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
