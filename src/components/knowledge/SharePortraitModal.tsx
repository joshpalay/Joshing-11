'use client';

import { useRef, useState, useCallback, useEffect, type CSSProperties } from 'react';
import { SharePortraitCard, type ShareDomain } from '@/components/knowledge/SharePortraitCard';

// The share card mirrors the on-screen Knowledge Portrait, so the snapshot needs
// the same three concrete font files the live card resolves through its
// --font-* variables: Cormorant Garamond (the serif statement), Montserrat (the
// "Joshing" wordmark) and Josefin Sans (labels). html2canvas can't see the app's
// hashed Next-font families, so we hand-load these by literal family name.
const SHARE_FONTS: Array<{ family: string; url: string; weight: string }> = [
  {
    family: 'Cormorant Garamond',
    weight: '500',
    url: 'https://fonts.gstatic.com/s/cormorantgaramond/v21/co3umX5slCNuHLi8bLeY9MK7whWMhyjypVO7abI26QOD_s06GnM.ttf',
  },
  {
    family: 'Cormorant Garamond',
    weight: '600',
    url: 'https://fonts.gstatic.com/s/cormorantgaramond/v21/co3umX5slCNuHLi8bLeY9MK7whWMhyjypVO7abI26QOD_iE9GnM.ttf',
  },
  {
    family: 'Montserrat',
    weight: '700',
    url: 'https://fonts.gstatic.com/s/montserrat/v31/JTUHjIg1_i6t8kCHKm4532VJOt5-QNFgpCuM70w-.ttf',
  },
  {
    family: 'Josefin Sans',
    weight: '400',
    url: 'https://fonts.gstatic.com/s/josefinsans/v34/Qw3PZQNVED7rKGKxtqIqX5E-AVSJrOCfjY46_DjQXME.ttf',
  },
  {
    family: 'Josefin Sans',
    weight: '700',
    url: 'https://fonts.gstatic.com/s/josefinsans/v34/Qw3PZQNVED7rKGKxtqIqX5E-AVSJrOCfjY46_N_XXME.ttf',
  },
];

async function loadShareFonts(): Promise<void> {
  if (typeof document === 'undefined') return;
  // Already loaded? (use the serif statement font as the sentinel)
  if (document.fonts.check("500 22px 'Cormorant Garamond'")) return;
  await Promise.all(
    SHARE_FONTS.map(async ({ family, url, weight }) => {
      try {
        const font = new FontFace(family, `url(${url})`, { weight });
        await font.load();
        document.fonts.add(font);
      } catch {
        // Font load failure is non-fatal; the fallback stack renders instead.
      }
    }),
  );
}

type SharePhase = 'idle' | 'sharing' | 'done' | 'error';

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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<SharePhase>('idle');
  const [fontReady, setFontReady] = useState(false);

  // Load the portrait fonts on mount
  useEffect(() => {
    loadShareFonts().then(() => setFontReady(true)).catch(() => setFontReady(true));
  }, []);

  const captureCanvas = useCallback(async () => {
    const node = cardRef.current;
    if (!node) return null;
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(node, {
      backgroundColor: '#faf8f2', // raw hex required: html2canvas can't resolve var(); mirrors --warm-paper
      scale: 3,
      useCORS: true,
      logging: false,
    });
    return canvas;
  }, []);

  const handleShare = useCallback(async () => {
    setPhase('sharing');
    try {
      if (!fontReady) await loadShareFonts();
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
      if (!fontReady) await loadShareFonts();
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
          playerDisplayName={playerDisplayName}
          portraitStatement={portraitStatement}
          domains={domains}
          overflowCount={overflowCount}
          tierSignature={tierSignature}
        />

        <div style={buttonRowStyle}>
          <button
            type="button"
            onClick={handleDownload}
            disabled={isCapturing}
            className="btn-primary px-8"
          >
            {isCapturing ? 'Saving…' : 'Download'}
          </button>

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              type="button"
              onClick={handleShare}
              disabled={isCapturing}
              className="btn-primary px-8"
            >
              {isCapturing ? 'Sharing…' : 'Share'}
            </button>
          )}

          <button
            type="button"
            onClick={onClose}
            disabled={isCapturing}
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

const errorStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  color: 'var(--destructive)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};
