'use client';

import { useRef, useState, useCallback, useEffect, type CSSProperties } from 'react';
import type { PortraitEntry } from '@/components/knowledge/PortraitCircles';
import { SharePortraitCard } from '@/components/knowledge/SharePortraitCard';

// ── Design tokens ──────────────────────────────────────────────────────────────

const INK = '#0e0e0e';
const INK2 = '#3a3a3a';
const INK3 = '#8a8a8a';
const CREAM = '#faf8f2';
const FM = "'Courier New', monospace";

const PLAYFAIR_URL =
  'https://fonts.gstatic.com/s/playfairdisplay/v37/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvXDXbtY.woff2';

async function loadPlayfairDisplay(): Promise<void> {
  if (typeof document === 'undefined') return;
  // Check if already loaded
  if (document.fonts.check("italic 16px 'Playfair Display'")) return;
  try {
    const font = new FontFace('Playfair Display', `url(${PLAYFAIR_URL})`, {
      style: 'italic',
      weight: '400',
    });
    await font.load();
    document.fonts.add(font);
    // Also load non-italic variant for robustness
    const fontNormal = new FontFace('Playfair Display', `url(${PLAYFAIR_URL})`, {
      weight: '400',
    });
    await fontNormal.load();
    document.fonts.add(fontNormal);
  } catch {
    // Font load failure is non-fatal; Georgia will render instead
  }
}

type SharePhase = 'idle' | 'sharing' | 'done' | 'error';

export type SharePortraitModalProps = {
  entries: PortraitEntry[];
  playerDisplayName: string;
  onClose: () => void;
};

export function SharePortraitModal({
  entries,
  playerDisplayName,
  onClose,
}: SharePortraitModalProps) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<SharePhase>('idle');
  const [fontReady, setFontReady] = useState(false);

  // Load Playfair Display on mount
  useEffect(() => {
    loadPlayfairDisplay().then(() => setFontReady(true)).catch(() => setFontReady(true));
  }, []);

  const captureCanvas = useCallback(async () => {
    const node = cardRef.current;
    if (!node) return null;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(node, {
      backgroundColor: '#faf8f2',
      scale: 3,
      useCORS: true,
      logging: false,
    });
    return canvas;
  }, []);

  const handleShare = useCallback(async () => {
    setPhase('sharing');
    try {
      if (!fontReady) await loadPlayfairDisplay();
      const canvas = await captureCanvas();
      if (!canvas) { setPhase('error'); return; }

      const dataUrl = canvas.toDataURL('image/png');

      if (
        typeof navigator !== 'undefined' &&
        'share' in navigator &&
        'canShare' in navigator
      ) {
        const blob = await (await fetch(dataUrl)).blob();
        const file = new File([blob], 'joshing-portrait.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            files: [file],
            title: 'My Joshing knowledge portrait',
          });
          setPhase('done');
          return;
        }
      }

      // Fallback: download
      const link = document.createElement('a');
      link.download = 'joshing-portrait.png';
      link.href = dataUrl;
      link.click();
      setPhase('done');
    } catch {
      // User cancelled native share — don't show error
      setPhase('idle');
    }
  }, [captureCanvas, fontReady]);

  const handleDownload = useCallback(async () => {
    setPhase('sharing');
    try {
      if (!fontReady) await loadPlayfairDisplay();
      const canvas = await captureCanvas();
      if (!canvas) { setPhase('error'); return; }
      const link = document.createElement('a');
      link.download = 'joshing-portrait.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
      setPhase('done');
    } catch {
      setPhase('error');
    }
  }, [captureCanvas, fontReady]);

  const isCapturing = phase === 'sharing';

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
          entries={entries}
          playerDisplayName={playerDisplayName}
        />

        <div style={buttonRowStyle}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isCapturing}
            style={primaryButtonStyle}
          >
            {isCapturing ? 'Saving…' : 'Download'}
          </button>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              type="button"
              onClick={handleShare}
              disabled={isCapturing}
              style={primaryButtonStyle}
            >
              {isCapturing ? 'Sharing…' : 'Share'}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={isCapturing}
            style={cancelButtonStyle}
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

const primaryButtonStyle: CSSProperties = {
  padding: '11px 32px',
  border: `1.5px solid ${INK}`,
  backgroundColor: INK,
  color: CREAM,
  fontSize: 12,
  fontFamily: FM,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
  boxShadow: `2px 2px 0 ${INK2}`,
};

const cancelButtonStyle: CSSProperties = {
  padding: '11px 24px',
  border: `1.5px solid ${INK3}`,
  backgroundColor: 'transparent',
  color: INK3,
  fontSize: 12,
  fontFamily: FM,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const errorStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: FM,
  color: INK3,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};
