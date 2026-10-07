'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useScreenAwake } from './use-screen-awake';

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
  | { kind: 'ALREADY_TODAY' | 'DUPLICATE_EVENT'; memberName: string | null }
  | { kind: 'CONFIRM'; memberId: string; memberName: string }
  | { kind: 'NO_MATCH'; reason: string }
  | { kind: 'NOBODY_ENROLLED' }
  | { kind: 'UNAVAILABLE' }
  | { kind: 'ERROR' };

/**
 * **The screen only reacts to somebody who came close and looked at it** (owner, 2026-10-07).
 *
 * The distinction is already made on the server, and it is the useful one. A frame is only
 * matched against the gallery once the face is big enough to be a person standing at the
 * desk; so `TOO_FAR` means "somebody is over there", and `UNKNOWN` means "somebody is right
 * here and we do not know them". The first is ignored completely — the camera watches a
 * doorway all day and most of what crosses it is not a member — and the second is worth an
 * answer, because that person is waiting for one.
 */
const IGNORED_AT_A_DISTANCE: ReadonlySet<string> = new Set(['TOO_FAR', 'NO_FACE', 'NOT_A_FACE', 'NOT_AN_IMAGE']);

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
  // Without this the phone locks after half a minute and the first member through the door
  // finds a black screen, every single time.
  useScreenAwake(camera === 'running');
  const [outcome, setOutcome] = useState<ScanOutcome | null>(null);
  /** `null` while nobody is close; otherwise why the person in front could not be placed. */
  const [mood, setMood] = useState<string | null>(null);

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

        // Somebody over there, or nobody at all: the screen keeps watching and says nothing.
        if (result.kind === 'NO_MATCH' && IGNORED_AT_A_DISTANCE.has(result.reason)) {
          setMood(null);
          return;
        }
        // Somebody close, whom we could not place — or could not see properly. They are
        // standing there waiting, so the face answers them.
        if (result.kind === 'NO_MATCH') {
          setMood(result.reason);
          return;
        }
        setMood(null);
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
    // Full screen. This phone has one job and sits on a desk doing it; a camera in a little
    // box with the page's margins around it is a web page, and a member walking up to a web
    // page does not know it is for them.
    <div className="fixed inset-0 z-50 overflow-hidden bg-brand-obsidian">
      {/* Mirrored, because a member expects to see themselves the way a mirror shows them.
          Only the preview is flipped; the frame sent to the engine is not. */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="absolute inset-0 h-full w-full -scale-x-100 object-cover"
        aria-label={t('cameraLabel')}
      />
      <canvas ref={canvasRef} className="hidden" />

      {outcome === null ? (
        <Waiting mood={mood} />
      ) : (
        <div className="absolute inset-0 grid place-content-center gap-4 bg-brand-obsidian/90 px-8 text-center">
          <Result outcome={outcome} onConfirm={answerConfirm} onFallback={onFallback} />
        </div>
      )}

      {/* Small, out of the way, and always there — the way out for anybody the camera
          cannot help. */}
      <button
        type="button"
        onClick={onFallback}
        className="absolute right-4 bottom-4 min-h-14 rounded-button bg-brand-obsidian/70 px-5 text-crm-body font-semibold text-brand-white backdrop-blur"
      >
        {t('useNumber')}
      </button>
    </div>
  );
}

/**
 * What the screen does while nobody it knows is in front of it.
 *
 * A face that looks slowly from side to side, as though watching the door. It is there
 * because the alternative — a live video feed of the room with no sign of life — reads as a
 * security camera, and because the owner asked for something that looks like it is paying
 * attention. It also answers the question a member actually has, which is "is this thing
 * on?", without saying anything about anybody.
 */
/**
 * The face on the screen while it waits, and how it answers somebody who is standing there.
 *
 * Three states, and the difference between them is distance:
 *
 * - **Nobody close** — eyes looking slowly from side to side, watching the door. No words.
 *   This is most of the day, and a live camera feed with no sign of life reads as CCTV.
 * - **Somebody close we cannot place** — a frown, and "try again". They came up and looked
 *   at it; being ignored at that point is the one thing that would feel broken.
 * - **Somebody close we cannot see properly** — a puzzled face and the one thing to fix.
 *
 * The emoji is `aria-hidden` and the words carry the meaning, so the screen reads the same
 * to somebody who cannot see it.
 */
function Waiting({ mood }: { mood: string | null }) {
  const t = useTranslations('checkin.face');
  const unknown = mood === 'UNKNOWN';
  const emoji = mood === null ? '👀' : unknown ? '😠' : '🤔';
  const line = mood === null ? t('lookAtCamera') : unknown ? t('tryAgain') : t(`hint.${mood}` as never);

  return (
    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-end gap-6 pb-28">
      <span
        aria-hidden
        key={emoji}
        className={`${mood === null ? 'mfp-looking' : 'mfp-react'} text-[4.5rem] leading-none drop-shadow-lg select-none`}
      >
        {emoji}
      </span>
      <p className="rounded-full bg-brand-obsidian/70 px-5 py-2 text-crm-body font-semibold text-brand-white backdrop-blur">{line}</p>
      <style>{`
        @keyframes mfp-look {
          0%, 100% { transform: translateX(-22px) rotate(-7deg); }
          50%      { transform: translateX(22px)  rotate(7deg); }
        }
        @keyframes mfp-pop {
          0%   { transform: scale(0.6); opacity: 0; }
          60%  { transform: scale(1.12); opacity: 1; }
          100% { transform: scale(1); opacity: 1; }
        }
        .mfp-looking { animation: mfp-look 2.6s ease-in-out infinite; }
        .mfp-react   { animation: mfp-pop 0.32s ease-out both; }
        @media (prefers-reduced-motion: reduce) {
          .mfp-looking, .mfp-react { animation: none; }
        }
      `}</style>
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
    // A smile for somebody the gym knows. The one place on this screen where a face is
    // shown because a person did something right rather than wrong.
    const face = greeting?.kind === 'SEE_RECEPTION' ? '🙂' : '😊';
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
        <span aria-hidden className="mfp-greet text-[4rem] leading-none select-none">
          {face}
        </span>
        <p className="font-display text-[2.25rem] leading-tight font-bold text-brand-white">{name}</p>
        <p className={`text-crm-body font-semibold ${tone}`}>{line}</p>
        <style>{`
          @keyframes mfp-greet {
            0%   { transform: scale(0.5) rotate(-12deg); opacity: 0; }
            55%  { transform: scale(1.18) rotate(6deg);  opacity: 1; }
            100% { transform: scale(1) rotate(0deg);     opacity: 1; }
          }
          .mfp-greet { animation: mfp-greet 0.45s ease-out both; }
          @media (prefers-reduced-motion: reduce) { .mfp-greet { animation: none; } }
        `}</style>
      </>
    );
  }
  if (outcome.kind === 'ALREADY_TODAY' || outcome.kind === 'DUPLICATE_EVENT') {
    return (
      <>
        {/* Recognised, and nothing to do about it — a thumbs up rather than a greeting,
            because they are already in today's register. */}
        <span aria-hidden className="text-[3.5rem] leading-none select-none">
          👍
        </span>
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
