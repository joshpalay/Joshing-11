'use client';

/**
 * QuickAddQuestionModal — lightweight modal for capturing a question from the homepage.
 * Posts to POST /api/questions. The server classifies category/domain through the LLM.
 */

import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { validateBreadcrumbContext } from '@/lib/breadcrumb-validation';

type Props = {
  onClose: () => void;
  onAdded?: () => void;
};

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.65rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const inputStyle: CSSProperties = {
  width: '100%',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-md)',
  background: 'var(--bg)',
  boxShadow: 'var(--shadow-paper-rest)',
  padding: '10px 14px',
  fontFamily: 'var(--font-sans)',
  fontSize: '0.95rem',
  color: 'var(--text)',
  outline: 'none',
};

export function QuickAddQuestionModal({ onClose, onAdded }: Props) {
  const [shortLabel, setShortLabel] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [breadcrumbContext, setBreadcrumbContext] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const qt = questionText.trim();
    const at = answerText.trim();
    const bc = breadcrumbContext.trim();
    if (!qt || !at || !bc) {
      setError('Question, answer, and context are required.');
      return;
    }
    const bcErr = validateBreadcrumbContext(bc);
    if (bcErr) {
      setError(bcErr);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          question_text: qt,
          answer_text: at,
          breadcrumb_context: bc,
          short_label: shortLabel.trim() || null,
          answer_source: 'creator_written',
          verified: true,
          critiqueIterations: 0,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || 'Failed to save question.');
        return;
      }
      onAdded?.();
      onClose();
    } catch {
      setError('Something went wrong.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 100,
        }}
      />

      {/* Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-add-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 101,
          width: 'min(620px, calc(100vw - 32px))',
          background: 'var(--bg-card, var(--bg))',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: 'var(--shadow-modal)',
          padding: '24px 24px 20px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '20px' }}>
          <h2
            id="quick-add-title"
            style={{ fontFamily: 'var(--font-serif), ui-serif, Georgia, serif', fontSize: '1.35rem', fontWeight: 600, color: 'var(--text)' }}
          >
            Quick add question
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '1.25rem', lineHeight: 1, padding: '0 2px' }}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              marginBottom: '14px',
              padding: '8px 12px',
              background: 'color-mix(in srgb, var(--danger) 12%, var(--bg))',
              border: '1px solid var(--danger)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              color: 'var(--danger)',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <div>
            <label htmlFor="qqm-short-label" style={{ ...monoStyle, display: 'block', color: 'var(--text-muted)', marginBottom: '5px' }}>
              Short label <span style={{ textTransform: 'none', fontFamily: 'var(--font-sans)', letterSpacing: 'normal', color: 'var(--text-muted)', opacity: 0.7 }}>(optional)</span>
            </label>
            <input
              id="qqm-short-label"
              ref={firstInputRef}
              type="text"
              value={shortLabel}
              onChange={(e) => setShortLabel(e.target.value)}
              maxLength={80}
              placeholder="e.g. The Snorlax one"
              style={inputStyle}
            />
          </div>

          <div>
            <label htmlFor="qqm-question" style={{ ...monoStyle, display: 'block', color: 'var(--text-muted)', marginBottom: '5px' }}>
              Question
            </label>
            <textarea
              id="qqm-question"
              required
              rows={4}
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              placeholder="e.g. What Pokémon is my spirit animal?"
              style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.5 }}
            />
          </div>

          <div>
            <label htmlFor="qqm-answer" style={{ ...monoStyle, display: 'block', color: 'var(--text-muted)', marginBottom: '5px' }}>
              Answer
            </label>
            <input
              id="qqm-answer"
              type="text"
              required
              value={answerText}
              onChange={(e) => setAnswerText(e.target.value)}
              placeholder="e.g. Snorlax"
              style={inputStyle}
            />
          </div>

          <div style={{ padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', background: 'color-mix(in srgb, var(--muted, #f5f5f5) 55%, var(--bg))' }}>
            <p style={{ ...monoStyle, color: 'var(--text-muted)', marginBottom: '4px' }}>AI classification</p>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Joshing will read the question and answer when you save, then choose the category, specific area, and difficulty automatically.
            </p>
          </div>

          <div>
            <label htmlFor="qqm-context" style={{ ...monoStyle, display: 'block', color: 'var(--text-muted)', marginBottom: '5px' }}>
              Why this is special to you
            </label>
            <input
              id="qqm-context"
              type="text"
              required
              value={breadcrumbContext}
              onChange={(e) => setBreadcrumbContext(e.target.value)}
              maxLength={30}
              placeholder="e.g. First concert together, summer '19."
              style={inputStyle}
            />
          </div>

          <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '4px' }}>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Add to bank'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{ ...monoStyle, color: 'var(--text-muted)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
