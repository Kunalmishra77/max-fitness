import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { deskPhotoFromForm } from './desk-photo';
import { SelfieRejectedError } from './selfie-image';

/**
 * The photo taken at the desk (crm-ux-blueprint §7; security-plan §3.1).
 *
 * It arrives as a form field from the wizard and is treated exactly like a selfie from
 * the website: untrusted bytes, checked by signature, decoded, and re-encoded without
 * metadata. A photo is optional at the desk, so "no photo" is a normal answer.
 */

const jpeg = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#886644' } }).jpeg().toBuffer();

const formWith = (value: Blob | string) => {
  const form = new FormData();
  if (typeof value === 'string') form.set('photo', value);
  else form.set('photo', value, 'photo.jpg');
  return form;
};

describe('deskPhotoFromForm', () => {
  it('has nothing to store when staff skipped the photo', async () => {
    expect(await deskPhotoFromForm(null)).toBeNull();
    expect(await deskPhotoFromForm(new FormData())).toBeNull();
  });

  it('re-encodes the photo the desk took into a JPEG no larger than 720px', async () => {
    const photo = await deskPhotoFromForm(formWith(new Blob([await jpeg(900, 900)], { type: 'image/jpeg' })));

    expect(photo).toMatchObject({ width: 720, height: 720 });
    expect([...(photo?.body.slice(0, 3) ?? [])]).toEqual([0xff, 0xd8, 0xff]);
  });

  it('refuses text posing as a photo, bytes that are not an image, and a face too small to recognise', async () => {
    await expect(deskPhotoFromForm(formWith('not a file'))).rejects.toBeInstanceOf(SelfieRejectedError);
    await expect(deskPhotoFromForm(formWith(new Blob(['hello'], { type: 'image/jpeg' })))).rejects.toMatchObject({
      reason: 'unsupported_type',
    });
    await expect(deskPhotoFromForm(formWith(new Blob([await jpeg(100, 100)], { type: 'image/jpeg' })))).rejects.toMatchObject({
      reason: 'too_small',
    });
  });

  it('refuses a file over 2 MB', async () => {
    const big = new Blob([new Uint8Array(2 * 1024 * 1024 + 1)], { type: 'image/jpeg' });
    await expect(deskPhotoFromForm(formWith(big))).rejects.toMatchObject({ reason: 'too_large' });
  });
});
