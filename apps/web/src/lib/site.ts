import { whatsappLink, type E164Mobile } from '@mfp/shared';

/**
 * Contact details and outbound links.
 *
 * The gym row in the database is the source of truth; these values match the seeded
 * row and are used only when live data is unavailable, so the phone number and
 * address never disappear from the page (ADR-022).
 *
 * The map pin and place ID come from the gym's Google Business Profile, verified
 * 2026-09-11 (ADR-031), so directions and the map land on the listing itself rather
 * than on a geocoded guess of the address.
 */
/**
 * The gym's registered details, as they appear on its Udyam certificate (owner, 2026-10-04).
 *
 * A business verification — Meta's, Razorpay's — compares what the website publishes with
 * what the registration says, and rejects a discrepancy. So these match the certificate
 * word for word rather than matching the Google Business Profile, which spells the building
 * "Krishan Plaza, Plot No. 6" where the certificate says "C-6, Krishna Plaza". The Google
 * listing is what people navigate by; `directionsHref` still points at its pin, so nobody
 * loses their way over it.
 */
export const SITE_FALLBACK = {
  name: 'Max Fitness Gym',
  phone: '+919871406350' as E164Mobile,
  /** Plain ten digits, as the certificate writes it — not the signboard's leading zero. */
  phoneDisplay: '9871406350',
  addressLine: 'C-6, Krishna Plaza',
  city: 'Indirapuram, Ghaziabad',
  state: 'Uttar Pradesh',
  pincode: '201014',
  email: 'Ajaykuliyal35@gmail.com',
} as const;

/** Google Business Profile identifiers. */
export const GOOGLE_PLACE = {
  placeId: 'ChIJnaq6hDTlDDkRYcBqPGc91JU',
  cid: '10796321720318476385',
  latitude: 28.633763,
  longitude: 77.350075,
} as const;

/** Copy deck: WhatsApp click-to-chat prefill. */
export const WHATSAPP_PREFILL_EN = "Hi Max Fitness Gym, I found you on your website. I'd like to know about membership.";

export function telHref(phone: string): string {
  return `tel:${phone}`;
}

export function whatsappHref(phone: E164Mobile, text: string): string {
  return whatsappLink(phone, text);
}

/** Directions to the listing's pin, opening the Google Business Profile in Maps. */
export function directionsHref(): string {
  const { latitude, longitude, placeId } = GOOGLE_PLACE;
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&destination_place_id=${placeId}`;
}

/** The gym's Google Maps listing, for structured data `sameAs`/`hasMap`. */
export function googleMapsUrl(): string {
  return `https://maps.google.com/?cid=${GOOGLE_PLACE.cid}`;
}

/** All Google reviews for the listing. */
export function googleReviewsHref(): string {
  return `https://search.google.com/local/reviews?placeid=${GOOGLE_PLACE.placeId}`;
}

/** The Maps embed at the verified pin, loaded only after the visitor asks for it (LP-19). */
export function mapEmbedSrc(): string {
  const { latitude, longitude } = GOOGLE_PLACE;
  return `https://maps.google.com/maps?q=${latitude},${longitude}&z=17&hl=en&output=embed`;
}

/** `+919871406350` → `098714 06350` for display. */
export function displayPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? `0${digits.slice(0, 5)} ${digits.slice(5)}` : phone;
}

/**
 * The gym's own number, printed as its registration certificate writes it.
 *
 * `displayPhone` groups a member's number for reading at a desk, with the leading zero
 * India dials. The business's own number is a registered detail that a verifier compares
 * against a document, so it is printed plainly: ten digits, nothing added (ADR-102).
 */
export function registeredPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '').slice(-10);
  return digits.length === 10 ? digits : phone;
}
