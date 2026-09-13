import { NextResponse, type NextRequest } from 'next/server';
import { verifyToken } from '@mfp/core';
import { PrismaReceiptReader } from '@mfp/db';
import { getContainer } from '@/lib/container';

/**
 * `GET /api/v1/receipts/{token}/pdf` — the receipt PDF the worker rendered (signup-and-payment-flow.md §7).
 *
 * Served through the app, never from a public storage URL: the same signed receipt token
 * gates it, and the response is private and uncached.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: NextRequest, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  try {
    const { env, clock, prisma, storage } = getContainer();
    const verified = verifyToken({ token, purpose: 'receipt', secret: env.LINK_TOKEN_SECRET, clock });
    if (!verified.valid) return new NextResponse(null, { status: 404 });

    const receipt = await new PrismaReceiptReader(prisma).receipt(verified.subject);
    if (receipt === null || receipt.receiptPdfKey === null) return new NextResponse(null, { status: 404 });

    const bytes = await storage.get(receipt.receiptPdfKey);
    const filename = `receipt-${receipt.receiptNo.replace(/\//g, '-')}.pdf`;
    return new NextResponse(Buffer.from(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
        'Referrer-Policy': 'no-referrer',
      },
    });
  } catch (error) {
    console.error(`[receipt-pdf] failed: ${error instanceof Error ? error.name : 'Error'}`);
    return new NextResponse(null, { status: 500 });
  }
}
