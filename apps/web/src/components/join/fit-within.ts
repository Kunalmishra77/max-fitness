/**
 * The size a picked photograph is scaled to before it is uploaded.
 *
 * Phones hand over 4000px, multi-megabyte pictures. A selfie and both sides of an ID
 * together are more than the request may carry, and the member meets a 413 rather than a
 * thank-you. The long edge comes down to `max`; the shape is kept, because a squashed ID
 * card cannot be read.
 */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= max) return { width, height };
  const scale = max / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
