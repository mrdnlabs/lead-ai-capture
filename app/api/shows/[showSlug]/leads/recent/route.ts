import { NextResponse, type NextRequest } from 'next/server';
import { requireRep } from '@/lib/auth/currentRep';
import { loadRecentLeads } from '@/lib/realtime/agentContext';
import { getShowMembership } from '@/lib/showAccess';

interface Params {
  params: Promise<{ showSlug: string }>;
}

/**
 * GET /api/shows/[showSlug]/leads/recent
 *
 * Lightweight endpoint feeding the LeadPickerSheet client. Returns a
 * compact list of the show's recent leads (top 50 by lastUpdatedAt) with
 * only the fields the picker UI needs.
 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { showSlug } = await params;
  let rep;
  try {
    rep = await requireRep();
  } catch {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  const membership = await getShowMembership(rep.id, showSlug);
  if (!membership) {
    return NextResponse.json({ error: 'Not a member of this show' }, { status: 403 });
  }

  const recent = await loadRecentLeads(membership.show.id, 50);
  return NextResponse.json({
    leads: recent.map((l) => ({
      opportunityCode: l.opportunityCode,
      name: l.name,
      company: l.company,
      title: l.title,
    })),
  });
}

export const runtime = 'nodejs';
