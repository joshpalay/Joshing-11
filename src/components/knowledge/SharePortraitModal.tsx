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
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<SharePhase>('idle');
  const [fontReady, setFontReady] = useState(false);

  // Pre-captured image, produced once on mount so the Share tap can call
  // navigator.share synchronously (iOS consumes the user-gesture if we await
  // font/canvas work first, which silently aborts the native sheet).
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const captureStartedRef = useRef(false);

  const captureReady = shareFile !== null;

  // Load the portrait fonts on mount
  useEffect(() => {
    loadShareFonts().then(() => setFontReady(true)).catch(() => setFontReady(true));
  }, []);

  // Capture the card to a File (for share) and data URL (for download) exactly
  // once, after fonts are ready. The ref guard makes this safe against React's
  // double-invoke and concurrent retries; on failure the guard is released so
  // the retry affordance can re-run it.
  const runCapture = useCallback(async () => {
    if (captureStartedRef.current) return;
    captureStartedRef.current = true;
    setCaptureError(false);
    setIsCapturing(true);
    try {
      const node = cardRef.current;
      if (!node) throw new Error('Portrait card not mounted');
      const { default: html2canvas } = await import('html2canvas');
      const canvas = await html2canvas(node, {
        backgroundColor: '#faf8f2', // raw hex required: html2canvas can't resolve var(); mirrors --warm-paper
        scale: 3,
        useCORS: true,
        logging: false,
      });
      const url = canvas.toDataURL('image/png');
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], 'joshing-portrait.png', { type: 'image/png' });
      setDataUrl(url);
      setShareFile(file);
    } catch {
      captureStartedRef.current = false; // allow the retry affordance to re-run
      setCaptureError(true);
    } finally {
      setIsCapturing(false);
    }
  }, []);

  useEffect(() => {
    if (!fontReady || shareFile) return;
    runCapture();
  }, [fontReady, shareFile, runCapture]);

  // Trigger the download of the pre-captured image. Returns whether it fired so
  // callers can decide the resulting phase.
  const clickDownloadLink = useCallback(() => {
    if (!dataUrl) return false;
    const link = document.createElement('a');
    link.download = 'joshing-portrait.png';
    link.href = dataUrl;
    link.click();
    return true;
  }, [dataUrl]);

  const handleDownload = useCallback(() => {
    setPhase(clickDownloadLink() ? 'done' : 'error');
  }, [clickDownloadLink]);

  // Gesture-clean: no await before navigator.share. The pre-captured file is
  // handed straight to the native sheet.
  const handleShare = useCallback(() => {
    if (!shareFile) return;

    const canNativeShare =
      typeof navigator !== 'undefined' &&
      'share' in navigator &&
      'canShare' in navigator &&
      navigator.canShare({ files: [shareFile] });

    if (!canNativeShare) {
      // No native file share — give the user the image via download instead.
      handleDownload();
      return;
    }

    navigator
      .share({ files: [shareFile], title: 'My Joshing knowledge portrait' })
      .then(() => setPhase('done'))
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') {
          // Real user cancellation — stay silent.
          setPhase('idle');
        } else {
          // Share failed for some other reason — surface it but still get the
          // user their image via the download fallback.
          setPhase('error');
          clickDownloadLink();
        }
      });
  }, [shareFile, handleDownload, clickDownloadLink]);

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
