'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Dialog, DialogClose, DialogDescription, DialogTitle, SheetContent } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';
import { renderPickedFile, renderSquareJpeg } from './render-photo';
import { FACE_STEADY_MS, faceCheck, steadySince, type Box, type FaceCheck, type FrameSize } from './selfie-geometry';

/**
 * The selfie sheet (signup-and-payment-flow.md §2; copy deck `signup.camera`).
 *
 * Explainer first, so the browser's permission prompt never arrives unannounced. Then a
 * mirrored live preview with an oval guide and a face check that enables "Take photo"
 * once one face has held inside the oval for half a second. When the check cannot load
 * in 4 seconds, capture is allowed anyway — the server validates the image regardless.
 *
 * Every failure has a way forward: a blocked or missing camera leads to the phone's own
 * camera app through a file input. The camera is switched off on preview, on close and
 * on unmount; a member should never wonder whether it is still on.
 */

export interface FaceDetectorLike {
  detect(video: HTMLVideoElement, timestampMs: number): Box[];
  close(): void;
}

export interface SelfieCaptureProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onCaptured: (photo: Blob) => void;
  /** Injected in tests; defaults to the self-hosted MediaPipe detector. */
  readonly loadDetector?: () => Promise<FaceDetectorLike | null>;
  /** Injected in tests; defaults to the canvas JPEG renderer. */
  readonly renderPhoto?: (source: HTMLVideoElement, frame: FrameSize, face: Box | null) => Promise<Blob>;
}

type Phase = 'explainer' | 'starting' | 'live' | 'preparing' | 'preview' | 'denied' | 'inUse' | 'noCamera' | 'unusable';

const DETECTION_INTERVAL_MS = 200;
const DETECTOR_TIMEOUT_MS = 4_000;
const IN_APP_BROWSER = /Instagram|FBAN|FBAV|WhatsApp|Line\//i;

const defaultLoadDetector = () => import('./face-detector').then((m) => m.loadFaceDetector());

function cameraSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function SelfieCapture({ open, onOpenChange, onCaptured, loadDetector = defaultLoadDetector, renderPhoto = renderSquareJpeg }: SelfieCaptureProps) {
  const t = useTranslations('signup.camera');
  const [phase, setPhase] = useState<Phase>('explainer');
  const [check, setCheck] = useState<FaceCheck | 'unavailable' | 'loading'>('loading');
  const [steady, setSteady] = useState(false);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [supported] = useState(cameraSupported);
  const [inApp] = useState(() => typeof navigator !== 'undefined' && IN_APP_BROWSER.test(navigator.userAgent));
  const [copied, setCopied] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<FaceDetectorLike | null>(null);
  const lastFaceRef = useRef<Box | null>(null);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const clearPreview = useCallback(() => {
    setPreview((current) => {
      if (current !== null) URL.revokeObjectURL(current.url);
      return null;
    });
  }, []);

  // Camera off and detector released whenever the sheet closes or unmounts.
  useEffect(() => {
    if (!open) {
      stopCamera();
      setPhase('explainer');
    }
    return stopCamera;
  }, [open, stopCamera]);

  useEffect(
    () => () => {
      detectorRef.current?.close();
      detectorRef.current = null;
    },
    [],
  );

  const startCamera = useCallback(async () => {
    setPhase('starting');
    clearPreview();
    const ideal: MediaStreamConstraints = { video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(ideal);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'OverconstrainedError') {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } catch {
          setPhase('noCamera');
          return;
        }
      } else {
        setPhase(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : name === 'NotReadableError' ? 'inUse' : 'noCamera');
        return;
      }
    }

    streamRef.current = stream;
    setSteady(false);
    setCheck(detectorRef.current === null ? 'loading' : 'none');
    setPhase('live');
  }, [clearPreview]);

  // Attach the stream once the video element exists.
  useEffect(() => {
    const video = videoRef.current;
    if (phase !== 'live' || video === null || streamRef.current === null) return;
    video.srcObject = streamRef.current;
    void video.play().catch(() => undefined);
  }, [phase]);

  // Load the detector when the camera goes live; give up on it after 4 seconds.
  useEffect(() => {
    if (phase !== 'live' || detectorRef.current !== null) return;
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled && detectorRef.current === null) setCheck('unavailable');
    }, DETECTOR_TIMEOUT_MS);

    void loadDetector().then((detector) => {
      if (cancelled) {
        detector?.close();
        return;
      }
      if (detector === null) {
        setCheck('unavailable');
        return;
      }
      detectorRef.current = detector;
      setCheck((current) => (current === 'loading' || current === 'unavailable' ? 'none' : current));
    });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [phase, loadDetector]);

  // ~5 fps face check while live.
  useEffect(() => {
    if (phase !== 'live') return;
    let since: number | null = null;
    const interval = setInterval(() => {
      const video = videoRef.current;
      const detector = detectorRef.current;
      if (video === null || detector === null) return;
      const frame = { width: video.videoWidth, height: video.videoHeight };
      if (frame.width === 0) return;

      let faces: Box[];
      try {
        faces = detector.detect(video, performance.now());
      } catch {
        setCheck('unavailable');
        return;
      }
      const result = faceCheck(faces, frame);
      lastFaceRef.current = result === 'ok' ? (faces[0] ?? null) : null;
      const now = Date.now();
      since = steadySince(since, result === 'ok', now);
      setCheck(result);
      setSteady(since !== null && now - since >= FACE_STEADY_MS);
    }, DETECTION_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [phase]);

  const capture = async () => {
    const video = videoRef.current;
    if (video === null) return;
    setPhase('preparing');
    try {
      const blob = await renderPhoto(video, { width: video.videoWidth, height: video.videoHeight }, lastFaceRef.current);
      stopCamera();
      setPreview({ blob, url: URL.createObjectURL(blob) });
      setPhase('preview');
    } catch {
      stopCamera();
      setPhase('unusable');
    }
  };

  const onFilePicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    stopCamera();
    setPhase('preparing');
    try {
      const blob = await renderPickedFile(file);
      setPreview({ blob, url: URL.createObjectURL(blob) });
      setPhase('preview');
    } catch {
      setPhase('unusable');
    }
  };

  const usePhoto = () => {
    if (preview === null) return;
    onCaptured(preview.blob);
    onOpenChange(false);
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const phoneCameraButton = (variant: 'primary' | 'outlineDark') => (
    <button type="button" onClick={() => fileRef.current?.click()} className={buttonVariants({ variant, full: true })}>
      {t('usePhoneCamera')}
    </button>
  );

  const canCapture = phase === 'live' && (check === 'unavailable' || steady);
  const guidance =
    check === 'ok' && steady ? t('faceFound') : check === 'multiple' ? t('oneFace') : check === 'small' ? t('closer') : check === 'none' || check === 'offCentre' ? t('moveInside') : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SheetContent className="mx-auto max-h-[95dvh] max-w-lg md:bottom-auto md:top-1/2 md:-translate-y-1/2 md:rounded-[var(--radius-modal)]">
        <div className="flex items-center justify-between gap-4">
          <DialogTitle className="font-display text-title font-bold text-brand-plate-navy">{t('title')}</DialogTitle>
          <DialogClose className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={t('close')}>
            <span aria-hidden className="text-2xl leading-none">×</span>
          </DialogClose>
        </div>

        {inApp ? (
          <div className="mt-4 rounded-input bg-tint-fee-due-soon-bg p-3 text-small text-brand-ink">
            <p>{t('inApp')}</p>
            <button type="button" onClick={() => void copyLink()} className={cn(buttonVariants({ variant: 'link' }), 'min-h-11 px-0')}>
              {copied ? t('linkCopied') : t('copyLink')}
            </button>
          </div>
        ) : null}

        <input ref={fileRef} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFilePicked(e)} />

        {phase === 'explainer' ? (
          <div className="mt-4 grid gap-4">
            <DialogDescription className="text-body leading-body">{supported ? t('explainer') : t('noCamera')}</DialogDescription>
            {supported ? (
              <button type="button" onClick={() => void startCamera()} className={buttonVariants({ variant: 'primary', full: true })}>
                {t('open')}
              </button>
            ) : null}
            {phoneCameraButton(supported ? 'outlineDark' : 'primary')}
          </div>
        ) : null}

        {phase === 'starting' || phase === 'preparing' ? (
          <p role="status" className="mt-6 text-body">
            {phase === 'starting' ? t('starting') : t('preparing')}
          </p>
        ) : null}

        {phase === 'live' ? (
          <div className="mt-4 grid gap-3">
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-panel bg-brand-plate-navy">
              <video ref={videoRef} playsInline muted autoPlay className="size-full -scale-x-100 object-cover" />
              {/* The oval guide: a transparent ellipse with the rest of the frame dimmed. */}
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute top-1/2 left-1/2 h-[62%] w-[58%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-4',
                  'shadow-[0_0_0_9999px_rgb(15_27_45/0.45)]',
                  steady ? 'border-semantic-fee-paid' : 'border-brand-white',
                )}
              />
            </div>
            <p className="text-body">{t('guidance')}</p>
            <p role="status" aria-live="polite" className={cn('min-h-6 text-body font-semibold', steady ? 'text-semantic-fee-paid' : 'text-brand-ink')}>
              {guidance}
            </p>
            <button type="button" disabled={!canCapture} onClick={() => void capture()} className={buttonVariants({ variant: 'primary', size: 'hero', full: true })}>
              {t('capture')}
            </button>
          </div>
        ) : null}

        {phase === 'preview' && preview !== null ? (
          <div className="mt-4 grid gap-3">
            {/* A local object URL: next/image cannot optimise it and must not try. */}
            <img src={preview.url} alt={t('previewAlt')} className="mx-auto aspect-square w-full max-w-sm rounded-panel object-cover" />
            <button type="button" onClick={usePhoto} className={buttonVariants({ variant: 'primary', size: 'hero', full: true })}>
              {t('use')}
            </button>
            <button type="button" onClick={() => (supported ? void startCamera() : fileRef.current?.click())} className={buttonVariants({ variant: 'outlineDark', full: true })}>
              {t('retake')}
            </button>
          </div>
        ) : null}

        {phase === 'denied' || phase === 'inUse' || phase === 'noCamera' || phase === 'unusable' ? (
          <div className="mt-4 grid gap-3">
            <p role="alert" className="text-body leading-body">
              {t(phase === 'denied' ? 'denied' : phase === 'inUse' ? 'inUse' : phase === 'noCamera' ? 'noCamera' : 'unusable')}
            </p>
            {phase === 'noCamera' ? null : (
              <button type="button" onClick={() => void startCamera()} className={buttonVariants({ variant: 'primary', full: true })}>
                {t('tryAgain')}
              </button>
            )}
            {phoneCameraButton(phase === 'noCamera' ? 'primary' : 'outlineDark')}
          </div>
        ) : null}
      </SheetContent>
    </Dialog>
  );
}
