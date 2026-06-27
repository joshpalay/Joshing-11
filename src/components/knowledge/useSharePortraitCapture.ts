'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

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

export type SharePortraitCapture = {
  /** Attach to the off-screen / preview SharePortraitCard so it can be snapshotted. */
  cardRef: RefObject<HTMLDivElement | null>;
  /** The pre-captured PNG, ready to hand straight to navigator.share. */
  shareFile: File | null;
  /** The same snapshot as a data URL, used for the download fallback. */
  dataUrl: string | null;
  /** True once the image has been captured and a share can fire synchronously. */
  captureReady: boolean;
  captureError: boolean;
  isCapturing: boolean;
  /** Manually (re)run the capture — used by the retry affordance. */
  runCapture: () => Promise<void>;
  /** Trigger the browser download of the captured image. Returns whether it fired. */
  download: () => boolean;
  /**
   * Gesture-clean native share of the pre-captured image. Must be called from
   * within a user gesture; there is no await before navigator.share, so the
   * gesture survives. Returns false if the image isn't captured yet so the
   * caller can fall back (e.g. open the preview modal).
   */
  shareNow: () => boolean;
};

/**
 * Owns the html2canvas capture of a Knowledge Portrait card: font loading, the
 * one-shot snapshot, and the gesture-clean share/download primitives. The capture
 * runs in the background as soon as `active` is true so a later Share tap can call
 * navigator.share synchronously (iOS consumes the user-gesture if we await
 * font/canvas work first, which silently aborts the native sheet).
 */
export function useSharePortraitCapture(active = true): SharePortraitCapture {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [fontReady, setFontReady] = useState(false);
  const [shareFile, setShareFile] = useState<File | null>(null);
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);
  const captureStartedRef = useRef(false);

  const captureReady = shareFile !== null;

  // Load the portrait fonts once the capture is wanted.
  useEffect(() => {
    if (!active || fontReady) return;
    loadShareFonts()
      .then(() => setFontReady(true))
      .catch(() => setFontReady(true));
  }, [active, fontReady]);

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
    if (!active || !fontReady || shareFile) return;
    runCapture();
  }, [active, fontReady, shareFile, runCapture]);

  const download = useCallback(() => {
    if (!dataUrl) return false;
    const link = document.createElement('a');
    link.download = 'joshing-portrait.png';
    link.href = dataUrl;
    link.click();
    return true;
  }, [dataUrl]);

  const shareNow = useCallback(() => {
    if (!shareFile) return false;

    const canNativeShare =
      typeof navigator !== 'undefined' &&
      'share' in navigator &&
      'canShare' in navigator &&
      navigator.canShare({ files: [shareFile] });

    if (!canNativeShare) {
      // No native file share — give the user the image via download instead.
      download();
      return true;
    }

    navigator
      .share({ files: [shareFile], title: 'My Joshing knowledge portrait' })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === 'AbortError') return; // real cancel — stay silent
        download(); // share failed for some other reason — still get them the image
      });
    return true;
  }, [shareFile, download]);

  return {
    cardRef,
    shareFile,
    dataUrl,
    captureReady,
    captureError,
    isCapturing,
    runCapture,
    download,
    shareNow,
  };
}
