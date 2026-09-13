import { squareCrop, type Box, type FrameSize } from './selfie-geometry';

/**
 * Turns a camera frame or a picked photo into the upload (signup-and-payment-flow.md §2.4).
 *
 * A 720×720 JPEG cropped around the face, re-encoded at 0.85 and again at 0.75 if it
 * is still over 300 KB. The server decodes and re-encodes it once more; this step is
 * about upload size on a mobile connection, not about trust.
 */

const OUTPUT_PX = 720;
const TARGET_BYTES = 300 * 1024;

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob === null ? reject(new Error('Could not encode the photo')) : resolve(blob)), 'image/jpeg', quality);
  });
}

export async function renderSquareJpeg(source: CanvasImageSource, frame: FrameSize, face: Box | null): Promise<Blob> {
  const { sx, sy, size } = squareCrop(frame, face);
  const canvas = document.createElement('canvas');
  canvas.width = OUTPUT_PX;
  canvas.height = OUTPUT_PX;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('Canvas is not available');

  // Drawn un-mirrored: the preview is flipped for comfort, the photo is not.
  context.drawImage(source, sx, sy, size, size, 0, 0, OUTPUT_PX, OUTPUT_PX);

  const first = await toJpeg(canvas, 0.85);
  return first.size <= TARGET_BYTES ? first : toJpeg(canvas, 0.75);
}

/** §2.5: a photo from the phone's camera app, upright per its EXIF orientation. */
export async function renderPickedFile(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    return await renderSquareJpeg(bitmap, { width: bitmap.width, height: bitmap.height }, null);
  } finally {
    bitmap.close();
  }
}
