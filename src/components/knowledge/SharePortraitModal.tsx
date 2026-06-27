'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { SharePortraitCard, type ShareDomain } from '@/components/knowledge/SharePortraitCard';
import { useSharePortraitCapture } from '@/components/knowledge/useSharePortraitCapture';

type SharePhase = 'idle' | 'done' | 'error';

export type SharePortraitModalProps = {
  playerDisplayName: string;
  portraitStatement: string;
  domains: ShareDomain[];
  overflowCount: number;
  tierSignature: string;
  onClose: () => void;
};

export function SharePortraitModal({
  playerDisplayName,
  portraitStatement,
  domains,
  overflowCount,
  tierSignature,
  onClose,
}: SharePortraitModalProps) {
  const [phase, setPhase] = useState<SharePhase>('idle');

  // The capture runs in the background as soon as the modal mounts so the Share
  // tap can call navigator.share synchronously (see useSharePortraitCapture).
  const {
    cardRef,
    captureReady,
    captureError,
    isCapturing,
    runCapture,
    download,
    shareNow,
  } = useSharePortraitCapture(true);

  const handleDownload = useCallback(() => {
    setPhase(download() ? 'done' : 'error');
  }, [download]);

  const handleShare = useCallback(() => {
    // shareNow is gesture-clean (no await before navigator.share) and falls back
    // to a download itself if the native sheet is unavailable or errors.
    if (!shareNow()) setPhase('error');
  }, [shareNow]);

  // Close on overlay click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div style={overlayStyle} onClick={handleOverlayClick} role="dialog" aria-modal="true" aria-label="Share portrait">
      <div style={contentStyle}>
        <SharePortraitCard
          ref={cardRef}
          playerDisplayName={playerDisplayName}
          portraitStatement={portraitStatement}
          domains={domains}
          overflowCount={overflowCount}
          tierSignature={tierSignature}
        />

        <div style={buttonRowStyle}>
          {captureError ? (
            <button
              type="button"
              onClick={runCapture}
              style={shareButtonStyle}
              className="btn-primary px-8"
            >
              Couldn&rsquo;t prepare image — try again
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleDownload}
                disabled={!captureReady || isCapturing}
                style={shareButtonStyle}
                className="btn-primary px-8"
              >
                {captureReady ? 'Download' : 'Preparing…'}
              </button>

              {typeof navigator !== 'undefined' && 'share' in navigator && (
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={!captureReady || isCapturing}
                  style={shareButtonStyle}
                  className="btn-primary px-8"
                >
                  {captureReady ? 'Share' : 'Preparing…'}
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={onClose}
            className="btn-ghost px-6"
          >
            Cancel
          </button>
        </div>

        {phase === 'error' && (
          <p style={errorStyle}>Something went wrong. Try again.</p>
        )}
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
  padding: '16px',
  overflowY: 'auto',
};

const contentStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 16,
  maxWidth: '100%',
};

const buttonRowStyle: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  justifyContent: 'center',
};

// Fixed min-width so the box stays the same size across the "Preparing…",
// "Download"/"Share", and retry labels — no layout shift when capture completes.
const shareButtonStyle: CSSProperties = {
  minWidth: 150,
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  color: 'var(--destructive)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};
