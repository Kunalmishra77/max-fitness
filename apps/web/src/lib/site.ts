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
export const SITE_FALLBACK = {
  name: 'Max Fitness Gym',
  phone: '+919871406350' as E164Mobile,
  /** How the number is printed on the signboard and on Google. */
  phoneDisplay: '098714 06350',
  addressLine: 'Krishan Plaza, Plot No. 6, Abhay Khand 1, Nyay Khand I (opposite Sai Mandir)',
  city: 'Indirapuram, Ghaziabad',
  state: 'Uttar Pradesh',
  pincode: '201014',
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
