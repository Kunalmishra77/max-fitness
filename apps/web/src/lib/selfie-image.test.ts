// @vitest-environment node
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAX_SELFIE_BYTES, SelfieRejectedError, detectImageType, processSelfie } from './selfie-image';

const image = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: { r: 180, g: 140, b: 120 } } });

async function rejection(bytes: Uint8Array): Promise<string> {
  try {
    await processSelfie(bytes);
  } catch (error) {
    if (error instanceof SelfieRejectedError) return error.reason;
    throw error;
  }
  return 'accepted';
}

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their magic bytes, whatever the file claims to be', async () => {
    expect(detectImageType(await image(8, 8).jpeg().toBuffer())).toBe('jpeg');
    expect(detectImageType(await image(8, 8).png().toBuffer())).toBe('png');
    expect(detectImageType(await image(8, 8).webp().toBuffer())).toBe('webp');
  });

  it('rejects anything else', () => {
    expect(detectImageType(Buffer.from('GIF89a......'))).toBeNull();
    expect(detectImageType(Buffer.from('%PDF-1.7\n'))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(new Uint8Array())).toBeNull();
  });
});

describe('processSelfie', () => {
  it('re-encodes to a JPEG no larger than 720px, keeping the aspect ratio', async () => {
    const result = await processSelfie(await image(1200, 1600).png().toBuffer());

    expect(detectImageType(result.body)).toBe('jpeg');
    expect({ width: result.width, height: result.height }).toEqual({ width: 540, height: 720 });
    const meta = await sharp(result.body).metadata();
    expect({ width: meta.width, height: meta.height, format: meta.format }).toEqual({ width: 540, height: 720, format: 'jpeg' });
  });

  it('strips EXIF, including any location, from the stored photo', async () => {
    const withExif = await image(800, 800)
      .jpeg()
      .withExif({ IFD0: { Make: 'PhoneMaker', Copyright: 'someone' }, IFD3: { GPSLatitudeRef: 'N' } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();

    const result = await processSelfie(withExif);

    const meta = await sharp(result.body).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.icc).toBeUndefined();
  });

  it('turns the photo upright from its EXIF orientation before the tag is dropped', async () => {
    // Stored 800×400 landscape, tagged "rotate 90°": a portrait photo from a phone.
    const tagged = await image(800, 400).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const result = await processSelfie(tagged);

    expect({ width: result.width, height: result.height }).toEqual({ width: 360, height: 720 });
  });

  it('does not enlarge a small but usable photo', async () => {
    const result = await processSelfie(await image(480, 640).jpeg().toBuffer());
    expect({ width: result.width, height: result.height }).toEqual({ width: 480, height: 640 });
  });

  it('refuses a file that is not an image, an image it cannot decode, one too large or too small', async () => {
    expect(await rejection(Buffer.from('%PDF-1.7\n'))).toBe('unsupported_type');
    // JPEG magic bytes followed by garbage: a polyglot or a truncated upload.
    expect(await rejection(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(512, 7)]))).toBe('unreadable');
    expect(await rejection(new Uint8Array(MAX_SELFIE_BYTES + 1))).toBe('too_large');
    expect(await rejection(await image(160, 160).jpeg().toBuffer())).toBe('too_small');
  });
});
