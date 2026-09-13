import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WithIntl } from '@/test/intl';
import type { Box } from './selfie-geometry';
import { SelfieCapture, type FaceDetectorLike } from './selfie-capture';

const FRAME = { width: 1280, height: 720 };
/** 480 px of a 1280 px frame (37.5%), centred: passes the 35% rule. */
const CENTRED_FACE: Box = { x: 400, y: 120, width: 480, height: 480 };

function fakeStream() {
  const track = { stop: vi.fn(), kind: 'video' };
  return { stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream, track };
}

function mediaError(name: string) {
  return Object.assign(new Error(name), { name });
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  // happy-dom accepts only its own MediaStream here; a real browser gets the real stream.
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', { configurable: true, get: () => null, set: () => undefined });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoWidth', { configurable: true, get: () => FRAME.width });
  Object.defineProperty(HTMLMediaElement.prototype, 'videoHeight', { configurable: true, get: () => FRAME.height });
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderCapture(options: { detector?: FaceDetectorLike | null; detectorDelayMs?: number; userAgent?: string } = {}) {
  const onCaptured = vi.fn();
  const onOpenChange = vi.fn();
  const photo = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
  const renderPhoto = vi.fn(() => Promise.resolve(photo));
  const loadDetector = vi.fn(
    () =>
      new Promise<FaceDetectorLike | null>((resolve) => {
        if (options.detectorDelayMs === undefined) resolve(options.detector ?? null);
        else setTimeout(() => resolve(options.detector ?? null), options.detectorDelayMs);
      }),
  );
  if (options.userAgent !== undefined) vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(options.userAgent);

  const view = render(
    <WithIntl>
      <SelfieCapture open onOpenChange={onOpenChange} onCaptured={onCaptured} loadDetector={loadDetector} renderPhoto={renderPhoto} />
    </WithIntl>,
  );
  return { ...view, onCaptured, onOpenChange, renderPhoto, loadDetector, photo };
}

describe('SelfieCapture', () => {
  it('explains the camera first and asks for it only after "Open camera"', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    renderCapture();

    expect(screen.getByText(/We'll open your camera/)).toBeTruthy();
    // Someone who would rather not allow the camera can pick a photo straight away.
    expect(screen.getByRole('button', { name: 'Use phone camera' })).toBeTruthy();
    expect(getUserMedia).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: 'Open camera' }));

    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    expect(await screen.findByText('Face the light. Remove caps and sunglasses.')).toBeTruthy();
  });

  it('explains a blocked camera and offers to try again or use the phone camera', async () => {
    getUserMedia.mockRejectedValue(mediaError('NotAllowedError'));
    renderCapture();

    await userEvent.click(screen.getByRole('button', { name: 'Open camera' }));

    expect(await screen.findByText(/Camera access is blocked/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use phone camera' })).toBeTruthy();
  });

  it('says when another app is using the camera', async () => {
    getUserMedia.mockRejectedValue(mediaError('NotReadableError'));
    renderCapture();
    await userEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(await screen.findByText(/being used by another app/)).toBeTruthy();
  });

  it('falls back to the phone camera when there is no camera', async () => {
    getUserMedia.mockRejectedValue(mediaError('NotFoundError'));
    renderCapture();
    await userEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(await screen.findByText(/couldn't use a camera/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use phone camera' })).toBeTruthy();
  });

  it('retries with a plain video request when the ideal size is not available', async () => {
    const { stream } = fakeStream();
    getUserMedia.mockRejectedValueOnce(mediaError('OverconstrainedError')).mockResolvedValueOnce(stream);
    renderCapture();

    await userEvent.click(screen.getByRole('button', { name: 'Open camera' }));

    expect(await screen.findByText('Face the light. Remove caps and sunglasses.')).toBeTruthy();
    expect(getUserMedia).toHaveBeenLastCalledWith({ video: true, audio: false });
  });

  it('offers only the phone camera where the browser cannot open a camera', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
    renderCapture();

    expect(screen.queryByRole('button', { name: 'Open camera' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Use phone camera' })).toBeTruthy();
  });

  it('warns inside Instagram or WhatsApp, and still offers the camera', () => {
    renderCapture({ userAgent: 'Mozilla/5.0 (Linux; Android 14) Instagram 312.0.0' });
    expect(screen.getByText(/Open this page in Chrome/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open camera' })).toBeTruthy();
  });

  it('enables "Take photo" once one centred face holds for half a second, then returns the photo', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const detector: FaceDetectorLike = { detect: vi.fn(() => [CENTRED_FACE]), close: vi.fn() };
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const { onCaptured, renderPhoto, photo } = renderCapture({ detector });

    await user.click(screen.getByRole('button', { name: 'Open camera' }));
    const capture = await screen.findByRole('button', { name: 'Take photo' });
    expect((capture as HTMLButtonElement).disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByText('Face found')).toBeTruthy();
    expect((capture as HTMLButtonElement).disabled).toBe(false);

    await user.click(capture);
    expect(renderPhoto).toHaveBeenCalledWith(expect.any(HTMLVideoElement), FRAME, CENTRED_FACE);
    // The camera turns off while the member looks at the preview.
    expect(track.stop).toHaveBeenCalled();

    await user.click(await screen.findByRole('button', { name: 'Use this photo' }));
    expect(onCaptured).toHaveBeenCalledWith(photo);
  });

  it('guides the member while the face is not yet right', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const detector: FaceDetectorLike = { detect: vi.fn(() => [{ ...CENTRED_FACE, width: 200, height: 200 }]), close: vi.fn() };
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderCapture({ detector });

    await user.click(screen.getByRole('button', { name: 'Open camera' }));
    await screen.findByRole('button', { name: 'Take photo' });
    await act(() => vi.advanceTimersByTimeAsync(1_000));

    expect(screen.getByText('Come a little closer.')).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Take photo' }).disabled).toBe(true);
  });

  it('allows a photo without the face check when the detector has not loaded within 4 seconds', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    renderCapture({ detector: { detect: vi.fn(() => []), close: vi.fn() }, detectorDelayMs: 60_000 });

    await user.click(screen.getByRole('button', { name: 'Open camera' }));
    const capture = await screen.findByRole('button', { name: 'Take photo' });
    expect((capture as HTMLButtonElement).disabled).toBe(true);

    await act(() => vi.advanceTimersByTimeAsync(4_100));
    expect((capture as HTMLButtonElement).disabled).toBe(false);
  });

  it('stops the camera when the sheet is closed', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    const { unmount } = renderCapture();

    await userEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    await screen.findByText('Face the light. Remove caps and sunglasses.');
    unmount();

    expect(track.stop).toHaveBeenCalled();
  });
});
