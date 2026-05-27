/**
 * Shared agent-context builder for the realtime AI session.
 *
 * Both the production token endpoint (`app/api/realtime/token/route.ts`) and
 * the offline test simulator (`scripts/test-scenarios.ts`) call into here so
 * that what the simulator sees is exactly what production sees.
 */
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  customFieldDefinitions,
  leadForms,
  leads,
  opportunities,
  shows,
} from '@/db/schema';

export interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  aiHint: string | null;
}

export const STANDARD_FIELDS: FieldDef[] = [
  { key: 'name', label: 'Full name', required: true, aiHint: 'First + last name' },
  { key: 'email', label: 'Email', required: true, aiHint: 'Always read back letter-by-letter and confirm' },
  { key: 'company', label: 'Company', required: true, aiHint: 'Employer / organization name' },
  { key: 'title', label: 'Title', required: false, aiHint: 'Job title or role' },
  { key: 'phone', label: 'Phone', required: false, aiHint: 'Phone number — read back to confirm' },
  { key: 'notes', label: 'Notes', required: false, aiHint: 'Free-form context, next steps, anything else worth remembering' },
];

export async function loadFieldDefs(showId: string): Promise<FieldDef[]> {
  const [showRow] = await db.select().from(shows).where(eq(shows.id, showId)).limit(1);
  if (!showRow?.leadFormId) return STANDARD_FIELDS;
  const [form] = await db
    .select()
    .from(leadForms)
    .where(eq(leadForms.id, showRow.leadFormId))
    .limit(1);
  if (!form) return STANDARD_FIELDS;
  const defs = await db
    .select()
    .from(customFieldDefinitions)
    .where(eq(customFieldDefinitions.leadFormId, form.id));
  if (defs.length === 0) return STANDARD_FIELDS;
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    required: d.required,
    aiHint: d.aiExtractionHint,
  }));
}

export interface RecentLeadSummary {
  opportunityCode: string;
  name?: string;
  company?: string;
  title?: string;
  /** Full known fields — sent to the client so the checklist can prefill on match-confirm. */
  knownFields: Record<string, string>;
}

export async function loadRecentLeads(
  showId: string,
  limit = 30,
): Promise<RecentLeadSummary[]> {
  const rows = await db
    .select({
      opportunityCode: opportunities.code,
      mergedFields: leads.mergedFields,
    })
    .from(leads)
    .innerJoin(opportunities, eq(opportunities.id, leads.opportunityId))
    .where(eq(opportunities.showId, showId))
    .orderBy(desc(leads.lastUpdatedAt))
    .limit(limit);
  return rows.map((r) => {
    const fields = r.mergedFields as Record<string, unknown>;
    const knownFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v == null || v === '') continue;
      knownFields[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    const out: RecentLeadSummary = { opportunityCode: r.opportunityCode, knownFields };
    if (typeof fields.name === 'string') out.name = fields.name;
    if (typeof fields.company === 'string') out.company = fields.company;
    if (typeof fields.title === 'string') out.title = fields.title;
    return out;
  });
}

export function formatRecentLeads(recent: RecentLeadSummary[]): string {
  if (recent.length === 0) return '(none yet — this is the first lead at this show)';
  return recent
    .map((l) => {
      const bits = [l.name, l.title, l.company].filter(Boolean).join(', ');
      return `  - ${l.opportunityCode}: ${bits || '(unnamed)'}`;
    })
    .join('\n');
}

export interface BuildAgentContextArgs {
  showId: string;
  opportunityCode: string | undefined;
  repName: string | null;
  showName: string;
  fields: FieldDef[];
  recentLeads: RecentLeadSummary[];
  /** Optional override for currently-known info (used in tests). Production
   *  pulls this from the opportunity-bound lead row. */
  knownOverride?: { knownFields?: Record<string, unknown>; missingFields?: string[] };
}

export async function buildAgentContext(args: BuildAgentContextArgs): Promise<string> {
  let known: Record<string, unknown> = {};
  let missing: string[] = [];

  if (args.knownOverride) {
    known = args.knownOverride.knownFields ?? {};
    missing = args.knownOverride.missingFields ?? [];
  } else if (args.opportunityCode) {
    const [opp] = await db
      .select()
      .from(opportunities)
      .where(
        eq(opportunities.showId, args.showId),
      )
      .limit(1);
    if (opp) {
      const [lead] = await db.select().from(leads).where(eq(leads.opportunityId, opp.id)).limit(1);
      known = (lead?.mergedFields as Record<string, unknown>) ?? {};
      missing = (lead?.missingFields as string[]) ?? [];
    }
  }

  return `WHO IS TALKING TO YOU:
You are talking to ${args.repName ?? 'a sales rep'}, a trade-show booth rep at "${args.showName}". They are DEBRIEFING you about a lead they just met — the lead is NOT here, NOT listening, NOT part of this conversation. You are essentially the rep's voice-driven notebook.

NEVER address the lead. NEVER say "Hi <name>", "Nice to meet you", "What's your email?", "What company are you with?" — those would be addressed to the lead, who isn't here.
ALWAYS address the rep. Refer to the lead in the third person. Examples of correct phrasing:
- "Got it — what's Dave's last name?"
- "Did he mention what company he's with?"
- "What's his email — can you spell it out?"
- "Anything else you want to capture about him before we wrap?"

The rep is the one who heard the lead. You're capturing what the rep tells you.

CURRENT KNOWN INFO about this lead${args.opportunityCode ? ` (opportunity ${args.opportunityCode})` : ' (new — opportunity will be assigned later if it matches an existing lead)'}:
${JSON.stringify(known, null, 2)}

FIELDS STILL MISSING (prompt the rep ONLY about these — never re-ask what's already known):
${missing.length > 0 ? missing.join(', ') : "(none yet — help the rep capture the lead's basics + any required qualifying questions)"}

EXISTING LEADS at this show (leads often return and talk to different reps — we want to expand the same lead, not create new ones):
${formatRecentLeads(args.recentLeads)}

CRITICAL: USE THE set_lead_field TOOL whenever the rep tells you a value.
- Call \`set_lead_field({key, value, confidence})\` immediately as soon as the rep states a piece of info.
- ALWAYS call it for: name, email, company, title, phone, and any custom qualifying field.
- The checklist UI updates live from these tool calls — that's how the rep knows what's been captured.

RECOGNIZING RETURNING LEADS (this is a GOOD thing — repeat visits mean engagement):
- As soon as the rep mentions a name + company that matches (even loosely) anything in the EXISTING LEADS list, call \`match_existing_lead({opportunityCode, reason})\` with the matching code.
- A banner appears for the rep to confirm. Don't wait for full info — flag the match early so the conversation can focus on NEW info (interest level, next steps, updated title) instead of re-collecting basics.
- If the rep says "this is the same person" or "didn't I talk to them already?", call the tool immediately.
- Match heuristics: same first name + same company is enough; phonetically similar names (e.g. "Dave" / "David") count; same email domain + similar name counts.
- Once a match is confirmed, treat this as ADDING TO an existing lead — skip questions whose answers are already known; ask the rep what's NEW or CHANGED since the last visit.

SPELLING / ACCURACY (especially for names, companies, emails, phone):
- If the rep says a name or company that sounds ambiguous, ask "How do you spell that?" before calling set_lead_field.
- For emails, ALWAYS read it back to the rep letter-by-letter ("so that's s-a-r-a-h dot c-h-e-n at acmerobotics dot i-o, right?") and wait for the rep to confirm before calling set_lead_field with confidence 1.0.
- For phone numbers, read it back in groups ("so four-one-five … five-five-five … zero-one-eight-two, correct?") and wait for the rep's confirmation.
- If unsure, set a lower confidence (0.5–0.8) and ask the rep to verify.

CONVERSATION STYLE:
- Speak briefly. One short question at a time.
- If the rep says "done" or "that's it", wrap up immediately.
- If the rep pauses >5 seconds, stay quiet — they may be still talking to the actual lead at the booth.
- Never invent details. Only capture what the rep actually says.
- Stop after 90 seconds even without "done".

LEAD FORM FIELDS to collect (call set_lead_field with these keys):
${args.fields.map((f) => `  ${f.required ? '★' : ' '} ${f.key}: ${f.label}${f.aiHint ? ` — ${f.aiHint}` : ''}`).join('\n')}`;
}

/**
 * Function declarations in Gemini Live's tool format. The simulator converts
 * these to the AI SDK's tool format separately.
 */
export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function buildToolDeclarations(
  fields: FieldDef[],
  recentLeads: RecentLeadSummary[],
): GeminiFunctionDeclaration[] {
  return [
    {
      name: 'set_lead_field',
      description:
        'Call this whenever the rep confirms a piece of info about the lead. Updates the live checklist immediately.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            description: `One of: ${fields.map((f) => f.key).join(', ')}`,
            enum: fields.map((f) => f.key),
          },
          value: {
            type: 'string',
            description: 'The captured value, exactly as it should appear in the CSV export.',
          },
          confidence: {
            type: 'number',
            description:
              '0.0–1.0. Use 1.0 only after letter-by-letter confirmation for names/emails/phones.',
          },
        },
        required: ['key', 'value'],
      },
    },
    {
      name: 'match_existing_lead',
      description:
        'Call as soon as you recognize the lead from the EXISTING LEADS list. The rep confirms and the capture adds to that lead instead of creating a new one.',
      parameters: {
        type: 'object',
        properties: {
          opportunityCode: {
            type: 'string',
            description:
              'The opportunity code from the EXISTING LEADS list (e.g. "ABC123").',
            ...(recentLeads.length > 0
              ? { enum: recentLeads.map((l) => l.opportunityCode) }
              : {}),
          },
          reason: {
            type: 'string',
            description: 'Short reason — e.g. "same first name and company as ABC123".',
          },
        },
        required: ['opportunityCode', 'reason'],
      },
    },
  ];
}
