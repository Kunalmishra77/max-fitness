/**
 * The photographs of a member's government ID (client decision, ADR-074).
 *
 * The gym keeps the **pictures** and never the number. An Aadhaar number in a gym's
 * database is a liability nobody needs: the Aadhaar Act restricts private entities
 * from storing it, and under the DPDP Act it would make the gym answerable for a
 * category of data it has no use for. The desk only ever has to see that the card
 * matches the person standing in front of it, and a photograph does that.
 *
 * So everything here is about how many sides a card has, not about what is printed
 * on it. Nothing in this file reads, parses or validates an ID number, and nothing
 * downstream is given one.
 */

export const GOV_ID_TYPES = ['AADHAAR', 'PAN', 'DL', 'VOTER'] as const;
export type GovIdType = (typeof GOV_ID_TYPES)[number];

export type GovIdSide = 'FRONT' | 'BACK';

export interface GovIdImage {
  readonly kind?: 'image';
  readonly side: GovIdSide;
  readonly body: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * The card as a file the member already has, rather than one they photograph (ADR-081).
 *
 * Plenty of members have no physical Aadhaar to hold up: they have the DigiLocker PDF on
 * their phone. That file carries the whole card — both sides — so one of it is the whole
 * answer, and asking for a "back" would be asking for something that does not exist.
 */
export interface GovIdDocument {
  readonly kind: 'document';
  readonly body: Uint8Array;
}

export type GovIdUpload = GovIdImage | GovIdDocument;

/** Smaller than this and the card cannot be read, so it is not evidence of anything. */
const MIN_EDGE_PX = 300;

export function isGovIdType(value: unknown): value is GovIdType {
  return typeof value === 'string' && (GOV_ID_TYPES as readonly string[]).includes(value);
}

/**
 * Which sides this card actually has.
 *
 * A PAN card carries nothing on the back, so asking for it would only teach members
 * that the gym asks for pointless things. Everything else has the address or the
 * signature on the reverse.
 */
export function govIdSidesFor(type: GovIdType): readonly GovIdSide[] {
  return type === 'PAN' ? ['FRONT'] : ['FRONT', 'BACK'];
}

export type GovIdProblem = 'MISSING_SIDE' | 'UNEXPECTED_SIDE' | 'TOO_SMALL' | 'EMPTY';

export function validateGovId(type: GovIdType, uploads: readonly GovIdUpload[]): { ok: true } | { ok: false; reason: GovIdProblem } {
  // One file is the whole card. Two of them, or a file beside a photograph, is somebody
  // mid-thought rather than a card with more sides than it has.
  const documents = uploads.filter((upload): upload is GovIdDocument => upload.kind === 'document');
  if (documents.length > 0) {
    if (uploads.length > 1) return { ok: false, reason: 'UNEXPECTED_SIDE' };
    return documents[0]?.body.byteLength === 0 ? { ok: false, reason: 'EMPTY' } : { ok: true };
  }

  const images = uploads as readonly GovIdImage[];
  const wanted = govIdSidesFor(type);
  const given = new Set(images.map((image) => image.side));

  // A side sent twice is not two sides; the set makes that a missing one.
  for (const side of wanted) {
    if (!given.has(side)) return { ok: false, reason: 'MISSING_SIDE' };
  }
  for (const side of given) {
    if (!wanted.includes(side)) return { ok: false, reason: 'UNEXPECTED_SIDE' };
  }

  for (const image of images) {
    // An empty file is what a camera that failed sends, and it looks like success.
    if (image.body.byteLength === 0) return { ok: false, reason: 'EMPTY' };
    if (image.width < MIN_EDGE_PX || image.height < MIN_EDGE_PX) return { ok: false, reason: 'TOO_SMALL' };
  }

  return { ok: true };
}
