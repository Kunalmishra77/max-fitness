import { checkGovIdText, type GovIdTextProblem, type GovIdType } from '@mfp/core';
import { FaceEngineUnavailableError } from '@mfp/integrations/face';
import { getContainer } from '@/lib/container';

/**
 * Is the photograph the member uploaded actually their government ID? (ADR-120)
 *
 * Members were uploading whatever the camera had last — a selfie, a product, a dog —
 * because nothing looked inside the picture. This reads the front of the card and asks
 * the domain whether what it says amounts to the card they chose, in their name, with
 * their date of birth.
 *
 * **Only the front.** The back of an Aadhaar is an address and the back of a licence is
 * a table of vehicle classes; neither carries the name or the markers, so reading them
 * costs seconds at a reception desk and answers nothing.
 *
 * **It never blocks on the engine being down**, exactly as the selfie gate does not: a
 * gym that cannot take a member because a container is restarting is a worse failure
 * than one whose newest member handed over a photograph nobody read. A PDF is let
 * through too — DigiLocker gives members one, and it is not an image to read.
 *
 * **Nothing it reads is kept.** The text reaches a verdict and goes out of scope; the
 * gym holds the picture of a card and never the number (ADR-074).
 */
export type GovIdVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: GovIdTextProblem };

export async function checkGovIdPhoto(
  type: GovIdType,
  front: Uint8Array,
  claimed: { readonly fullName: string; readonly dob: string },
): Promise<GovIdVerdict> {
  const { face } = getContainer();
  if (!face.configured) return { ok: true };

  let text: string;
  try {
    text = await face.readId(Buffer.from(front), 'id-front.jpg');
  } catch (error) {
    if (error instanceof FaceEngineUnavailableError) {
      // Logged without anything about the member or the card.
      console.warn('[gov-id-gate] the reader was unavailable; accepting the card unchecked');
      return { ok: true };
    }
    throw error;
  }

  return checkGovIdText(type, text, claimed);
}
