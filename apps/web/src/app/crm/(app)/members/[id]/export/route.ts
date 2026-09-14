import { exportMemberData } from '@mfp/core';
import { currentActor, memberPrivacy } from '@/lib/crm';

/**
 * `GET /crm/members/{id}/export` — a member's data as a JSON download
 * (privacy-and-dpdp-compliance §6 "Access / information").
 *
 * The session and the fresh PIN are checked here, not only on the button that links to
 * it: a URL can be typed. Nothing is cached and nothing is indexed.
 */

export const dynamic = 'force-dynamic';

const PRIVATE = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex', 'Referrer-Policy': 'no-referrer' } as const;

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await currentActor();
  if (actor === null) return Response.json({ error: 'UNAUTHENTICATED' }, { status: 401, headers: PRIVATE });

  const { id } = await params;
  const { clock, store } = memberPrivacy();
  try {
    const document = await exportMemberData({ memberId: id }, { actor, clock, store });
    // The member code, not the name: file names end up in download folders and chat apps.
    const fileName = `${document.data.member.memberCode ?? 'member'}-${document.exportedAt.slice(0, 10)}.json`;
    return new Response(JSON.stringify(document, null, 2), {
      headers: { ...PRIVATE, 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'FORBIDDEN') return Response.json({ error: 'FORBIDDEN' }, { status: 403, headers: PRIVATE });
    if (code === 'NOT_FOUND') return Response.json({ error: 'NOT_FOUND' }, { status: 404, headers: PRIVATE });
    console.error(`[crm] member export failed: ${code ?? (error instanceof Error ? error.name : 'Error')}`);
    return Response.json({ error: 'INTERNAL' }, { status: 500, headers: PRIVATE });
  }
}
