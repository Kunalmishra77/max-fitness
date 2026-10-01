// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { fitWithin } from './fit-within';

/**
 * How big a picked photograph may be once it is on its way to us.
 *
 * A phone camera hands over a 4000px, 4 MB picture. Three of those — a selfie and both
 * sides of an Aadhaar — are more than the request may carry, which is how members at
 * reception met "HTTP 413" instead of a thank-you. The long edge comes down; the shape
 * does not change, because a squashed ID card cannot be read.
 */

describe('fitWithin', () => {
  it('leaves a photo that is already small enough exactly as it is', () => {
    expect(fitWithin(1200, 900, 1600)).toEqual({ width: 1200, height: 900 });
  });

  it('brings the long edge down to the limit, keeping the shape', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000, 1600)).toEqual({ width: 1200, height: 1600 });
  });

  it('rounds to whole pixels and never to nothing', () => {
    const { width, height } = fitWithin(4001, 2251, 1600);
    expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
    expect(height).toBeGreaterThanOrEqual(1);
    expect(fitWithin(10_000, 3, 1600).height).toBe(1);
  });
});
