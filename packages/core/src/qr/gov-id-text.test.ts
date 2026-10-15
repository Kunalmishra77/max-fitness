import { describe, expect, it } from 'vitest';
import { checkGovIdText } from './gov-id-text';

/**
 * Reading a government ID well enough to know it is one (owner, 2026-10-15).
 *
 * Members were uploading anything at all — a selfie, a product, whatever the camera had
 * last — because nothing looked inside the picture. This looks, and refuses what is
 * plainly not a card.
 *
 * **Nothing it reads is kept.** ADR-074 is why the gym holds the photograph and never the
 * number: the Aadhaar Act restricts a private company from storing one, and under DPDP it
 * is a liability with no use. So this takes text, returns a verdict, and the text is gone.
 * It never returns what it found, because a caller given the number would eventually log
 * it.
 *
 * It is forgiving on purpose. OCR misreads a letter in every other line, and a member at
 * a reception desk holding a creased Aadhaar should not be turned away over an `8` the
 * engine read as a `B`. Only the markers that identify the card are required; the name
 * and date are checked when they can be, and silence is not a refusal.
 */

const AADHAAR = `
  भारत सरकार
  Government of India
  Kunal Mishra
  DOB: 14/02/1992
  3412 7856 9012
  आधार - आम आदमी का अधिकार
`;

const PAN = `
  INCOME TAX DEPARTMENT        GOVT. OF INDIA
  Permanent Account Number Card
  ABCDE1234F
  KUNAL MISHRA
  Date of Birth 14/02/1992
`;

const claim = { fullName: 'Kunal Mishra', dob: '1992-02-14' };

describe('checkGovIdText', () => {
  it('accepts an Aadhaar that carries its markers, the name and the date', () => {
    expect(checkGovIdText('AADHAAR', AADHAAR, claim)).toEqual({ ok: true });
  });

  it('accepts a PAN card the same way', () => {
    expect(checkGovIdText('PAN', PAN, claim)).toEqual({ ok: true });
  });

  describe('what it refuses', () => {
    it('refuses a picture with no words in it at all', () => {
      expect(checkGovIdText('AADHAAR', '   \n  ', claim)).toEqual({ ok: false, reason: 'UNREADABLE' });
    });

    /** The actual complaint: members uploading a selfie, a dog, a packet of something. */
    it('refuses a picture that is not an identity card', () => {
      const notAnId = 'Protein Powder 1kg Chocolate Flavour MRP 2499 Best Before 12 months';

      expect(checkGovIdText('AADHAAR', notAnId, claim)).toEqual({ ok: false, reason: 'NOT_AN_ID' });
    });

    it('refuses a real card of the wrong kind', () => {
      expect(checkGovIdText('AADHAAR', PAN, claim)).toEqual({ ok: false, reason: 'WRONG_TYPE' });
    });

    it('refuses somebody else’s card', () => {
      expect(checkGovIdText('AADHAAR', AADHAAR, { fullName: 'Rohit Sharma', dob: '1992-02-14' })).toEqual({
        ok: false,
        reason: 'NAME_MISMATCH',
      });
    });

    it('refuses a date of birth that is not the one on the form', () => {
      expect(checkGovIdText('AADHAAR', AADHAAR, { fullName: 'Kunal Mishra', dob: '1988-07-03' })).toEqual({
        ok: false,
        reason: 'DOB_MISMATCH',
      });
    });
  });

  describe('what it forgives, because OCR is not a scanner', () => {
    it('does not mind case, extra spaces or a middle name it did not expect', () => {
      const text = AADHAAR.replace('Kunal Mishra', 'KUNAL   KUMAR  MISHRA');

      expect(checkGovIdText('AADHAAR', text, claim)).toEqual({ ok: true });
    });

    it('reads the date however the card prints it', () => {
      for (const printed of ['14/02/1992', '14-02-1992', '14.02.1992', 'DOB 14 02 1992']) {
        const text = AADHAAR.replace('DOB: 14/02/1992', printed);
        expect(checkGovIdText('AADHAAR', text, claim)).toEqual({ ok: true });
      }
    });

    /**
     * A card whose date the engine could not make out is still a card. Refusing here
     * would turn away members over a crease, and the desk sees the photograph anyway.
     */
    it('lets a card through when it cannot find a date at all', () => {
      const text = AADHAAR.replace('DOB: 14/02/1992', '');

      expect(checkGovIdText('AADHAAR', text, claim)).toEqual({ ok: true });
    });

    it('accepts a card marked only in Hindi', () => {
      const hindi = 'भारत सरकार\nकुणाल मिश्रा\n3412 7856 9012\nआधार';

      expect(checkGovIdText('AADHAAR', hindi, claim)).toMatchObject({ ok: true });
    });
  });
});
