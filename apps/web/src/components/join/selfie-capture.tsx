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
  /**
   * `user` for a selfie (the website); `environment` when staff photograph a member at the
   * desk. Only the selfie preview is mirrored — a mirror image of someone else looks wrong.
   */
  readonly facing?: 'user' | 'environment';
  /** Whose words: the member's (`signup.camera`) or the desk's (`crm.add.camera`). Same keys. */
  readonly namespace?: 'signup.camera' | 'crm.add.camera';
}

type Phase = 'explainer' | 'starting' | 'live' | 'preparing' | 'preview' | 'denied' | 'inUse' | 'noCamera' | 'unusable';

const DETECTION_INTERVAL_MS = 200;
const DETECTOR_TIMEOUT_MS = 4_000;
const IN_APP_BROWSER = /Instagram|FBAN|FBAV|WhatsApp|Line\//i;

const defaultLoadDetector = () => import('./face-detector').then((m) => m.loadFaceDetector());

function cameraSupported(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

export function SelfieCapture({
  open,
  onOpenChange,
  onCaptured,
  loadDetector = defaultLoadDetector,
  renderPhoto = renderSquareJpeg,
  facing = 'user',
  namespace = 'signup.camera',
}: SelfieCaptureProps) {
  const t = useTranslations(namespace);
  const tc = useTranslations('selfieCheck');
  // At the desk this is a CRM screen, with the CRM's bigger targets (CLAUDE.md §2.10).
  const atDesk = namespace === 'crm.add.camera';
  const regular = atDesk ? 'crm' : 'web';
  const large = atDesk ? 'crmPrimary' : 'hero';
  const [phase, setPhase] = useState<Phase>('explainer');
  const [check, setCheck] = useState<FaceCheck | 'unavailable' | 'loading'>('loading');
  const [steady, setSteady] = useState(false);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [supported] = useState(cameraSupported);
  const [inApp] = useState(() => typeof navigator !== 'undefined' && IN_APP_BROWSER.test(navigator.userAgent));
  const [copied, setCopied] = useState(false);
  /**
   * Whether this photograph will recognise the member at the gym later (owner, 2026-10-07).
   *
   * The same gate the server runs on submission, asked here instead — while the member is
   * still looking at the picture and the camera is one tap away. It used to be asked only
   * when the whole form was sent, which told them three screens too late.
   *
   * `skip` is an answer too: an engine that cannot be reached must never stop somebody
   * joining, so the photo is accepted and the server has the last word either way.
   */
  const [verdict, setVerdict] = useState<{ state: 'checking' | 'good' | 'skip' } | { state: 'bad'; reason: string }>({ state: 'skip' });

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
    const ideal: MediaStreamConstraints = { video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false };

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
  }, [clearPreview, facing]);

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

  /**
   * Ask the server whether this photograph is good enough to be recognised by.
   *
   * Nothing is stored by the endpoint and no name goes with it, so this costs the member
   * nothing but a second. A failure of any kind — offline, slow, engine down — lands on
   * `skip`: the photograph is allowed and the real gate still runs on submission.
   */
  const checkPhoto = async (blob: Blob) => {
    setVerdict({ state: 'checking' });
    const body = new FormData();
    body.append('selfie', blob, 'selfie.jpg');
    try {
      const response = await fetch('/api/v1/selfie/check', { method: 'POST', body });
      const json = (await response.json()) as { data?: { ok?: boolean; reason?: string } };
      if (json.data?.ok === true) return setVerdict({ state: 'good' });
      if (json.data?.ok === false && typeof json.data.reason === 'string') {
        return setVerdict({ state: 'bad', reason: json.data.reason });
      }
      setVerdict({ state: 'skip' });
    } catch {
      setVerdict({ state: 'skip' });
    }
  };

  const capture = async () => {
    const video = videoRef.current;
    if (video === null) return;
    setPhase('preparing');
    try {
      const blob = await renderPhoto(video, { width: video.videoWidth, height: video.videoHeight }, lastFaceRef.current);
      stopCamera();
      setPreview({ blob, url: URL.createObjectURL(blob) });
      setPhase('preview');
      void checkPhoto(blob);
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
      void checkPhoto(blob);
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
    <button type="button" onClick={() => fileRef.current?.click()} className={buttonVariants({ variant, size: regular, full: true })}>
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
          <DialogTitle className="font-display text-title font-bold text-brand-obsidian">{t('title')}</DialogTitle>
          <DialogClose className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), atDesk && 'size-14')} aria-label={t('close')}>
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

        {/* `capture` sends the phone straight to its camera app rather than offering the
            gallery, which is the whole point: the photo has to be of the person standing
            here, now. It is the fallback for a browser whose camera we cannot drive. */}
        <input ref={fileRef} type="file" accept="image/*" capture={facing} className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => void onFilePicked(e)} />

        {phase === 'explainer' ? (
          <div className="mt-4 grid gap-4">
            <DialogDescription className="text-body leading-body">{supported ? t('explainer') : t('noCamera')}</DialogDescription>
            {supported ? (
              <button type="button" onClick={() => void startCamera()} className={buttonVariants({ variant: 'primary', size: regular, full: true })}>
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
            <div className="relative aspect-[3/4] w-full overflow-hidden rounded-panel bg-brand-obsidian">
              <video ref={videoRef} playsInline muted autoPlay className={cn('size-full object-cover', facing === 'user' && '-scale-x-100')} />
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
            <button type="button" disabled={!canCapture} onClick={() => void capture()} className={buttonVariants({ variant: 'primary', size: large, full: true })}>
              {t('capture')}
            </button>
          </div>
        ) : null}

        {phase === 'preview' && preview !== null ? (
          <div className="mt-4 grid gap-3">
            {/* A local object URL: next/image cannot optimise it and must not try. */}
            <img src={preview.url} alt={t('previewAlt')} className="mx-auto aspect-square w-full max-w-sm rounded-panel object-cover" />

            {/* The verdict sits above the buttons, because it decides which one to press. */}
            <p role="status" aria-live="polite" className="min-h-6 text-body leading-body">
              {verdict.state === 'checking' ? (
                <span className="text-brand-stone">{tc('checking')}</span>
              ) : verdict.state === 'good' ? (
                <span className="font-semibold text-semantic-fee-paid">{tc('good')}</span>
              ) : verdict.state === 'bad' ? (
                <span className="text-semantic-fee-expired">
                  <span className="block font-semibold">{tc('wontWork')}</span>
                  <span className="block">{tc(`reason.${verdict.reason}` as never)}</span>
                  <span className="mt-1 block text-small">{tc('retakeHint')}</span>
                </span>
              ) : null}
            </p>

            {/* A photograph the gym cannot recognise is not worth keeping, so taking it
                again is the loud button and using it anyway is not offered. Waiting on the
                answer only disables it — a member must never be stuck behind a slow check. */}
            {verdict.state === 'bad' ? null : (
              <button
                type="button"
                onClick={usePhoto}
                disabled={verdict.state === 'checking'}
                className={cn(buttonVariants({ variant: 'primary', size: large, full: true }), verdict.state === 'checking' && 'opacity-60')}
              >
                {t('use')}
              </button>
            )}
            <button
              type="button"
              onClick={() => (supported ? void startCamera() : fileRef.current?.click())}
              className={buttonVariants({ variant: verdict.state === 'bad' ? 'primary' : 'outlineDark', size: verdict.state === 'bad' ? large : regular, full: true })}
            >
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
              <button type="button" onClick={() => void startCamera()} className={buttonVariants({ variant: 'primary', size: regular, full: true })}>
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
