'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The reception camera (ADR-107).
 *
 * A member walks up, the screen recognises them and marks them in. No tapping, no number
 * to remember — which is the whole reason the gym asked for faces rather than a keypad.
 *
 * Three things shape how this is written:
 *
 * **It has to feel instant.** A frame goes out roughly every 700 ms while somebody is in
 * front of the camera, downscaled to 480 px and compressed hard, because what the engine
 * needs is a face, not a photograph. The round trip measured 122–233 ms, so a member is
 * usually greeted on the first or second frame.
 *
 * **It never greets the wrong person.** The server answers CONFIRM when a match is good but
 * too close to somebody else, and then this asks rather than assumes — greeting the wrong
 * member marks the wrong attendance in front of both of them, while asking costs one tap.
 *
 * **It always says what to do.** "Not recognised" to a member standing two feet away is
 * useless; "come a little closer" is not. Every refusal from the server carries a reason,
 * and every reason has words.
 */

/** The same shape the keypad renders, so the two screens cannot drift apart. */
export interface KioskGreetingView {
  readonly kind: string;
  readonly tone: string;
  readonly daysLeft?: number;
}

export type ScanOutcome =
  | { kind: 'RECORD'; memberName: string | null; greeting: KioskGreetingView | null }
  | { kind: 'WITHIN_COOLDOWN' | 'DUPLICATE_EVENT'; memberName: string | null }
  | { kind: 'CONFIRM'; memberId: string; memberName: string }
  | { kind: 'NO_MATCH'; reason: string }
  | { kind: 'NOBODY_ENROLLED' }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'ERROR' };

/** How long a greeting stays up before the camera starts looking again. */
const SHOW_RESULT_MS = 4000;
/** Between frames. Fast enough to feel immediate, slow enough not to flood the engine. */
const FRAME_INTERVAL_MS = 700;
/** What the engine is sent. A face, not a photograph. */
const FRAME_WIDTH = 480;
const FRAME_QUALITY = 0.72;

export function FaceScan({
  scan,
  confirm,
  onFallback,
}: {
  scan: (frame: Blob) => Promise<ScanOutcome>;
  confirm: (memberId: string) => Promise<ScanOutcome>;
  onFallback: () => void;
}) {
  const t = useTranslations('checkin.face');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const busyRef = useRef(false);
  // Held in a ref as well as state: the interval closure reads it, and a stale closure
  // would keep scanning over a greeting.
  const pausedRef = useRef(false);

  const [camera, setCamera] = useState<'starting' | 'running' | 'denied' | 'missing'>('starting');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const start = async () => {
      if (typeof navigator === 'undefined' || navigator.mediaDevices?.getUserMedia === undefined) {
        setCamera('missing');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The front camera, and a modest size: the frame is downscaled to 480px anyway,
          // and asking for 1080p only makes the phone work harder for the same result.
          video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current !== null) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCamera('running');
      } catch (error) {
        setCamera((error as Error).name === 'NotAllowedError' ? 'denied' : 'missing');
      }
    };
    void start();

    return () => {
      cancelled = true;
      // The light must go off when the screen does. A camera left running on a phone at a
      // reception desk is both a battery problem and a thing people are right to mind.
      for (const track of streamRef.current?.getTracks() ?? []) track.stop();
      streamRef.current = null;
    };
  }, []);

  const captureFrame = useCallback((): Promise<Blob | null> => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video === null || canvas === null || video.videoWidth === 0) return Promise.resolve(null);

    const scale = FRAME_WIDTH / video.videoWidth;
    canvas.width = FRAME_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (context === null) return Promise.resolve(null);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', FRAME_QUALITY));
  }, []);

  useEffect(() => {
    if (camera !== 'running') return;

    const tick = async () => {
      if (busyRef.current || pausedRef.current) return;
      busyRef.current = true;
      try {
        const frame = await captureFrame();
        if (frame === null) return;
        const result = await scan(frame);

        // A frame with nothing usable in it is not news: the camera is simply pointed at an
        // empty desk most of the time. Only the reason is shown, quietly, as a hint.
        if (result.kind === 'NO_MATCH') {
          setHint(result.reason);
          return;
        }
        setHint(null);
        setOutcome(result);
        // Stop scanning while the member reads their greeting — otherwise they would be
        // recognised again as they turn away, and the cooldown would answer instead.
        if (result.kind !== 'ERROR') pausedRef.current = true;
      } finally {
        busyRef.current = false;
      }
    };

    const timer = setInterval(() => void tick(), FRAME_INTERVAL_MS);
    void tick();
    return () => clearInterval(timer);
  }, [camera, captureFrame, scan]);

  // Clear a result after a few seconds and start looking again.
  useEffect(() => {
    if (outcome === null || outcome.kind === 'CONFIRM') return;
    const timer = setTimeout(() => {
      setOutcome(null);
      pausedRef.current = false;
    }, SHOW_RESULT_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  const answerConfirm = async (memberId: string) => {
    setOutcome(null);
    const result = await confirm(memberId);
    setOutcome(result);
    pausedRef.current = true;
  };

  if (camera === 'denied' || camera === 'missing') {
    return (
      <div className="grid gap-4 text-center">
        <p className="text-crm-body text-brand-stone">{t(camera === 'denied' ? 'cameraDenied' : 'cameraMissing')}</p>
        <button type="button" onClick={onFallback} className="min-h-16 rounded-button bg-brand-accent text-crm-body font-semibold text-brand-white">
          {t('useNumber')}
        </button>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="relative overflow-hidden rounded-panel bg-brand-obsidian">
        {/* Mirrored, because a member expects to see themselves the way a mirror shows them.
            Only the preview is flipped; the frame sent to the engine is not. */}
        <video ref={videoRef} playsInline muted className="h-auto w-full -scale-x-100" aria-label={t('cameraLabel')} />
        <canvas ref={canvasRef} className="hidden" />

        {outcome === null ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-brand-obsidian/70 px-4 py-3 text-center">
            <p className="text-crm-body font-semibold text-brand-white">{hint === null ? t('lookAtCamera') : t(`hint.${hint}` as never)}</p>
          </div>
        ) : (
          <div className="absolute inset-0 grid place-content-center gap-3 bg-brand-obsidian/90 px-6 text-center">
            <Result outcome={outcome} onConfirm={answerConfirm} onFallback={onFallback} />
          </div>
        )}
      </div>

      <button type="button" onClick={onFallback} className="min-h-16 rounded-button border-2 border-brand-stone/30 text-crm-body font-semibold text-brand-obsidian">
        {t('useNumber')}
      </button>
    </div>
  );
}

function Result({
  outcome,
  onConfirm,
  onFallback,
}: {
  outcome: ScanOutcome;
  onConfirm: (memberId: string) => Promise<void>;
  onFallback: () => void;
}) {
  const t = useTranslations('checkin.face');

  if (outcome.kind === 'RECORD') {
    const name = outcome.memberName ?? '';
    const greeting = outcome.greeting;
    // Withheld in shadow mode, and then the member simply sees that they were marked in —
    // which is true, and all they need. What is never shown is an amount: the next person
    // in the queue is reading this over their shoulder (BR-9.3).
    const line =
      greeting === null
        ? t('marked')
        : greeting.kind === 'SEE_RECEPTION'
          ? t('seeReception')
          : greeting.kind === 'WELCOME_DUE_SOON'
            ? t('welcomeDueSoon', { days: greeting.daysLeft ?? 0 })
            : t('welcomeBack');
    const tone = greeting?.tone === 'red' ? 'text-semantic-fee-expired' : greeting?.tone === 'amber' ? 'text-semantic-fee-due' : 'text-brand-white/90';
    return (
      <>
        <p className="font-display text-[2rem] leading-tight font-bold text-brand-white">{name}</p>
        <p className={`text-crm-body font-semibold ${tone}`}>{line}</p>
      </>
    );
  }
  if (outcome.kind === 'WITHIN_COOLDOWN' || outcome.kind === 'DUPLICATE_EVENT') {
    return (
      <>
        <p className="font-display text-[1.75rem] leading-tight font-bold text-brand-white">{outcome.memberName ?? ''}</p>
        <p className="text-crm-body text-brand-white/90">{t('alreadyMarked')}</p>
      </>
    );
  }
  if (outcome.kind === 'CONFIRM') {
    return (
      <>
        <p className="text-crm-body text-brand-white/90">{t('isThisYou')}</p>
        <p className="font-display text-[1.75rem] leading-tight font-bold text-brand-white">{outcome.memberName}</p>
        <button
          type="button"
          onClick={() => void onConfirm(outcome.memberId)}
          className="min-h-16 rounded-button bg-brand-accent px-6 text-crm-body font-semibold text-brand-white"
        >
          {t('yesThatIsMe')}
        </button>
        <button type="button" onClick={onFallback} className="min-h-14 text-crm-body font-semibold text-brand-white/80 underline">
          {t('useNumber')}
        </button>
      </>
    );
  }
  return (
    <>
      <p className="text-crm-body text-brand-white/90">
        {t(outcome.kind === 'NOBODY_ENROLLED' ? 'nobodyEnrolled' : outcome.kind === 'UNAVAILABLE' ? 'unavailable' : 'tryAgain')}
      </p>
      <button type="button" onClick={onFallback} className="min-h-16 rounded-button bg-brand-accent px-6 text-crm-body font-semibold text-brand-white">
        {t('useNumber')}
      </button>
    </>
  );
}
