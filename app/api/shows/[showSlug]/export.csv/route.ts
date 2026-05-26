import { asc, desc, eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db/client';
import {
  captures,
  csvExports,
  customFieldDefinitions,
  leadForms,
  leads,
  opportunities,
  reps,
} from '@/db/schema';
import { requireRep } from '@/lib/auth/currentRep';
import { getShowMembership } from '@/lib/showAccess';

interface Params {
  params: Promise<{ showSlug: string }>;
}

function csvEscape(value: unknown): string {
  if (value == null) return '';
  let s: string;
  if (Array.isArray(value)) s = value.join('; ');
  else if (typeof value === 'boolean') s = value ? 'Yes' : 'No';
  else s = String(value);
  // Escape per RFC 4180: wrap in quotes if it contains , " \r \n
  if (/[,"\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const DIAG_HEADERS = ['_capture_count', '_first_captured_at', '_rep_emails'];

export async function GET(request: NextRequest, { params }: Params): Promise<Response> {
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
  const show = membership.show;

  if (!show.leadFormId) {
    return NextResponse.json(
      { error: 'No lead form configured for this show. Set one up at /admin/shows.' },
      { status: 400 },
    );
  }
  const [form] = await db.select().from(leadForms).where(eq(leadForms.id, show.leadFormId)).limit(1);
  if (!form) {
    return NextResponse.json({ error: 'Lead form row missing' }, { status: 500 });
  }
  const fieldDefs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.leadFormId, form.id))
    .orderBy(asc(customFieldDefinitions.ordering));

  const leadRows = await db
    .select({ lead: leads, opportunity: opportunities })
    .from(leads)
    .innerJoin(opportunities, eq(opportunities.id, leads.opportunityId))
    .where(eq(opportunities.showId, show.id))
    .orderBy(desc(leads.lastUpdatedAt));

  const allCaptures = await db
    .select({ capture: captures, rep: reps })
    .from(captures)
    .innerJoin(reps, eq(reps.id, captures.repId))
    .where(eq(captures.showId, show.id));
  const capturesByOpp = new Map<string, typeof allCaptures>();
  for (const row of allCaptures) {
    const arr = capturesByOpp.get(row.capture.opportunityId) ?? [];
    arr.push(row);
    capturesByOpp.set(row.capture.opportunityId, arr);
  }

  // Build the CSV
  const headers = [...fieldDefs.map((f) => f.csvHeader), ...DIAG_HEADERS];
  const headerRow = headers.map(csvEscape).join(',');

  const dataRows: string[] = [];
  for (const { lead, opportunity } of leadRows) {
    const fields = lead.mergedFields as Record<string, unknown>;
    const vals: string[] = fieldDefs.map((f) => csvEscape(fields[f.key]));
    const oppCaps = capturesByOpp.get(opportunity.id) ?? [];
    const firstAt = oppCaps
      .map(({ capture }) => capture.serverReceivedAt)
      .sort((a, b) => +new Date(a) - +new Date(b))[0];
    const emails = Array.from(new Set(oppCaps.map(({ rep: r }) => r.email))).join(';');
    vals.push(
      csvEscape(oppCaps.length),
      csvEscape(firstAt ? new Date(firstAt).toISOString() : ''),
      csvEscape(emails),
    );
    dataRows.push(vals.join(','));
  }

  const body = [headerRow, ...dataRows].join('\r\n') + '\r\n';

  // Audit export (don't block on insert)
  void db
    .insert(csvExports)
    .values({
      showId: show.id,
      generatedByRepId: rep.id,
      rowCount: dataRows.length,
      blobKey: `inline-stream-${Date.now()}`, // not stored in blob storage for v1
    })
    .catch(() => {});

  const filename = `${show.slug}-leads-${new Date().toISOString().slice(0, 10)}.csv`;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}

export const runtime = 'nodejs';
