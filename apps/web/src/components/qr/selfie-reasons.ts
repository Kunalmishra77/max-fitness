/**
 * What the selfie gate refused, turned into something the member can act on (ADR-107).
 *
 * "That photo will not work for attendance" is not a thing anybody can do anything about;
 * "hold the phone closer" is. The same table sign-up uses, because it is the same gate —
 * and shared between the two QR forms, which read their messages from one namespace.
 *
 * The lower-case keys come from the image processor rather than the face engine: a file that
 * was not a photograph at all never reaches the engine to be measured.
 */
export const SELFIE_REASONS: Record<string, string> = {
  NO_FACE: 'selfieNoFace',
  NOT_A_FACE: 'selfieNoFace',
  NOT_AN_IMAGE: 'selfieUnreadable',
  TOO_FAR: 'selfieTooFar',
  TOO_DARK: 'selfieTooDark',
  TOO_BRIGHT: 'selfieTooBright',
  BLURRED: 'selfieBlurred',
  ANOTHER_FACE: 'selfieAnotherFace',
  unsupported_type: 'selfieUnsupported',
  unreadable: 'selfieUnreadable',
  too_large: 'selfieTooLarge',
  too_small: 'selfieTooSmall',
};
