/**
 * Offline test harness for the realtime AI agent.
 *
 * Drives multi-turn conversations against Gemini's text API using the SAME
 * system prompt and tool declarations that production uses. Each "rep turn"
 * is sent as a user message; the model can call set_lead_field and
 * match_existing_lead, which we apply in-memory and feed back.
 *
 * Each scenario is archived to tests/scenario-runs/<timestamp>-<name>.json so
 * the conversation can be reviewed later (Claude reads these too).
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '@/db/schema';
// NOTE: anything that imports `@/db/client` or `lib/realtime/agentContext`
// must be loaded AFTER dotenv populates process.env. We use dynamic imports
// inside main() for those.

const MODEL_ID = 'gemini-2.5-flash';

interface Scenario {
  name: string;
  description: string;
  repTurns: string[];
  /** What we expect the agent to do. The script checks these after the run. */
  expected: {
    /** opportunityCode the AI should flag as a match, if any */
    matchOpportunityCode?: string;
    /** if true, AI should NOT call match_existing_lead at all */
    noMatchExpected?: boolean;
    /** fields the AI should have captured (subset check, not exact match) */
    capturedFields?: Record<string, string | RegExp>;
  };
}

interface SimResult {
  scenario: Scenario;
  transcript: Array<{ role: 'rep' | 'ai'; text?: string; toolCalls?: ToolCall[] }>;
  liveFields: Record<string, { value: string; confidence?: number }>;
  matches: Array<{ opportunityCode: string; reason: string }>;
  passed: boolean;
  notes: string[];
}

interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

interface GeminiTextPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiTextPart[];
}

// ---------------------------------------------------------------------------
// Simulator
// ---------------------------------------------------------------------------

type ToolDecls = Array<{ name: string; description: string; parameters: Record<string, unknown> }>;

async function simulateConversation(
  scenario: Scenario,
  systemInstruction: string,
  toolDecls: ToolDecls,
  apiKey: string,
): Promise<SimResult> {
  const transcript: SimResult['transcript'] = [];
  const liveFields: SimResult['liveFields'] = {};
  const matches: SimResult['matches'] = [];

  const contents: GeminiContent[] = [];

  for (const repTurn of scenario.repTurns) {
    transcript.push({ role: 'rep', text: repTurn });
    contents.push({ role: 'user', parts: [{ text: repTurn }] });

    // Inner loop: let the model produce a turn, then handle any toolCalls by
    // pushing functionResponse parts back, until we get a turn with no tools.
    let safety = 0;
    while (safety++ < 6) {
      const body = {
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ functionDeclarations: toolDecls }],
        generationConfig: { temperature: 0.4 },
      };
      // Retry on transient 5xx — Gemini Flash is frequently overloaded.
      let res: Response | null = null;
      let attempt = 0;
      while (attempt < 5) {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_ID}:generateContent?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          },
        );
        if (res.ok) break;
        if (res.status >= 500 || res.status === 429) {
          attempt++;
          const delay = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s, 32s
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        break;
      }
      if (!res || !res.ok) {
        throw new Error(`Gemini HTTP ${res?.status}: ${await res?.text()}`);
      }
      const data = (await res.json()) as {
        candidates?: Array<{ content?: GeminiContent }>;
      };
      const cand = data.candidates?.[0]?.content;
      if (!cand) throw new Error('No candidate in Gemini response');

      // Record the model's turn
      contents.push(cand);

      const toolCalls: ToolCall[] = [];
      const texts: string[] = [];
      for (const p of cand.parts ?? []) {
        if (p.text) texts.push(p.text);
        if (p.functionCall) toolCalls.push({ name: p.functionCall.name, args: p.functionCall.args ?? {} });
      }
      transcript.push({
        role: 'ai',
        text: texts.join(' ').trim() || undefined,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      });

      if (toolCalls.length === 0) break; // Model finished its turn

      // Apply tools and respond
      const fnResponses: GeminiTextPart[] = [];
      for (const call of toolCalls) {
        if (call.name === 'set_lead_field') {
          const key = String(call.args.key ?? '');
          const value = String(call.args.value ?? '');
          const confidence =
            typeof call.args.confidence === 'number' ? call.args.confidence : undefined;
          if (key) liveFields[key] = { value, confidence };
          fnResponses.push({
            functionResponse: { name: call.name, response: { ok: true, key } },
          });
        } else if (call.name === 'match_existing_lead') {
          const code = String(call.args.opportunityCode ?? '');
          const reason = String(call.args.reason ?? '');
          if (code && !matches.some((m) => m.opportunityCode === code)) {
            matches.push({ opportunityCode: code, reason });
          }
          fnResponses.push({
            functionResponse: {
              name: call.name,
              response: { ok: true, note: 'Rep notified — waiting for their confirm.' },
            },
          });
        } else {
          fnResponses.push({
            functionResponse: {
              name: call.name,
              response: { ok: false, error: `unknown tool ${call.name}` },
            },
          });
        }
      }
      contents.push({ role: 'user', parts: fnResponses });
    }
  }

  const notes = checkExpectations(scenario, liveFields, matches);
  return {
    scenario,
    transcript,
    liveFields,
    matches,
    passed: notes.length === 0,
    notes,
  };
}

function checkExpectations(
  scenario: Scenario,
  liveFields: SimResult['liveFields'],
  matches: SimResult['matches'],
): string[] {
  const notes: string[] = [];
  const exp = scenario.expected;

  if (exp.noMatchExpected && matches.length > 0) {
    notes.push(
      `FAIL: expected NO match, but AI flagged ${matches.map((m) => m.opportunityCode).join(', ')}`,
    );
  }
  if (exp.matchOpportunityCode) {
    const matchedCodes = matches.map((m) => m.opportunityCode);
    if (!matchedCodes.includes(exp.matchOpportunityCode)) {
      notes.push(
        `FAIL: expected match=${exp.matchOpportunityCode}, got ${matchedCodes.join(', ') || '(none)'}`,
      );
    }
  }
  if (exp.capturedFields) {
    for (const [key, expectedVal] of Object.entries(exp.capturedFields)) {
      const got = liveFields[key]?.value;
      if (!got) {
        notes.push(`FAIL: expected field '${key}' to be captured (expected '${expectedVal}'), but none`);
        continue;
      }
      const ok =
        expectedVal instanceof RegExp
          ? expectedVal.test(got)
          : got.toLowerCase().includes(String(expectedVal).toLowerCase());
      if (!ok) {
        notes.push(`FAIL: field '${key}' = '${got}', expected to contain/match '${expectedVal}'`);
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const SCENARIOS: Scenario[] = [
  {
    name: 'new-lead',
    description: 'Brand-new lead, no overlap with any existing record.',
    repTurns: [
      'Hey, just met a new lead. Her name is Olivia Park, she works at Fjord Analytics.',
      'She said she is the head of data engineering there. Her email is olivia at fjord-analytics dot com.',
      'Yeah, that is o-l-i-v-i-a at fjord-analytics dot com. Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: {
        first_name: /olivia/i,
        company: /fjord/i,
        email: /olivia.*fjord/i,
      },
    },
  },
  {
    name: 'exact-match-david-chen',
    description: 'Returning lead, same name + company as TST001.',
    repTurns: [
      'David Chen from Acme Robotics just stopped by again.',
      'He wanted to talk about pricing for their next quarter rollout. Mark him as a decision maker.',
      'That is it.',
    ],
    expected: {
      matchOpportunityCode: 'TST001',
    },
  },
  {
    name: 'phonetic-sibling',
    description: 'Rep says "Dave Chen" — could match either TST001 (David Chen) or TST002 (Dave Chan).',
    repTurns: [
      'Just talked to Dave Chen from Acme. Pretty senior.',
      'Acme Robotics specifically. He is interested in our enterprise tier.',
      'Done.',
    ],
    expected: {
      // The right answer is TST001 (David Chen at Acme Robotics) — "Dave" is the
      // phonetic sibling of David, and the company is an exact match.
      matchOpportunityCode: 'TST001',
    },
  },
  {
    name: 'typo-correction',
    description:
      'TST003 is stored as "Stephen Tatem" (badge OCR typo). Rep says correct spelling "Tatum".',
    repTurns: [
      'Stephen Tatum from Northwind Logistics came by — wants a follow-up demo.',
      'That is T-A-T-U-M, the badge was misprinted last time. He is the VP of Operations.',
      'Done.',
    ],
    expected: {
      // Should still match — same company + same first name + phonetically identical surname.
      matchOpportunityCode: 'TST003',
      capturedFields: {
        last_name: /tatum/i,
      },
    },
  },
  {
    name: 'sparse-info-match',
    description: 'Rep gives only first name + company; TST007 is "Marcus" at "BlueRiver Analytics".',
    repTurns: [
      'Marcus from BlueRiver Analytics is back. He brought a coworker.',
      'Wants to schedule a follow-up next month.',
      'That is it.',
    ],
    expected: {
      matchOpportunityCode: 'TST007',
    },
  },
  {
    name: 'same-surname-different-person',
    description: 'TST005 is John Smith at Globex. New conversation is about a different Smith.',
    repTurns: [
      'Met Linda Smith from Hawthorne Bio. She runs their lab automation team.',
      'Her email is linda.smith at hawthorne hyphen bio dot com.',
      'Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: {
        first_name: /linda/i,
        company: /hawthorne/i,
      },
    },
  },
  {
    name: 'shared-email-domain',
    description:
      'TST001 and TST006 both have acmerobotics.io emails. New person at the same domain — should not match.',
    repTurns: [
      'Met another Acme Robotics person — Theo Nakamura. Their email is theo at acmerobotics dot io.',
      'He is a junior engineer, interested in our hobbyist tier.',
      'Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: {
        first_name: /theo/i,
      },
    },
  },
  {
    name: 'similar-company-different-firm',
    description:
      'TST001 is at "Acme Robotics", TST002 at "Acme Software". New person at "Acme Hardware" — separate.',
    repTurns: [
      'Met Lila Mendes from Acme Hardware. Yes, different from Acme Robotics — totally separate company.',
      'She handles partnerships.',
      'Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: {
        company: /hardware/i,
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  // Dynamic-import: these read process.env at module load, which the static
  // dotenv call above has just populated.
  const { db } = await import('@/db/client');
  const { buildAgentContext, buildToolDeclarations, loadFieldDefs, loadRecentLeads } =
    await import('@/lib/realtime/agentContext');
  const { resolveProviderForKind } = await import('@/lib/providers/resolve');

  const [demo] = await db.select().from(schema.shows).where(eq(schema.shows.slug, 'demo')).limit(1);
  if (!demo) {
    console.error('Demo show not found. Seed it first.');
    process.exit(1);
  }

  // Pull the Gemini key the same way the production realtime route does.
  const resolved = await resolveProviderForKind({
    showId: demo.id,
    kind: 'realtime',
    overrideConfigId: demo.realtimeProviderConfigId,
    purpose: 'test_harness',
  });
  if (!resolved) {
    console.error(
      'No realtime provider credential available. Configure one via /admin/configs or set DEFAULT_GEMINI_API_KEY.',
    );
    process.exit(1);
  }
  const apiKey = resolved.credential.apiKey;

  const fields = await loadFieldDefs(demo.id);
  const recentLeads = await loadRecentLeads(demo.id);
  const toolDecls = buildToolDeclarations(fields, recentLeads);

  console.log(`\n=== Test harness ===`);
  console.log(`Show: ${demo.name} (${demo.slug})`);
  console.log(`Existing leads in context: ${recentLeads.length}`);
  console.log(`Scenarios to run: ${SCENARIOS.length}`);
  console.log(`Model: ${MODEL_ID}\n`);

  const outDir = join(process.cwd(), 'tests', 'scenario-runs');
  mkdirSync(outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  const results: SimResult[] = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(`▶ ${scenario.name} … `);
    const systemInstruction = await buildAgentContext({
      showId: demo.id,
      opportunityCode: undefined,
      repName: 'Test Rep',
      showName: demo.name,
      fields,
      recentLeads,
    });
    try {
      const r = await simulateConversation(scenario, systemInstruction, toolDecls, apiKey);
      results.push(r);
      console.log(r.passed ? 'PASS' : 'FAIL');
      for (const n of r.notes) console.log(`    ${n}`);
    } catch (e) {
      const errMsg = (e as Error).message;
      console.log(`ERROR — ${errMsg}`);
      results.push({
        scenario,
        transcript: [],
        liveFields: {},
        matches: [],
        passed: false,
        notes: [`ERROR: ${errMsg}`],
      });
    }
  }

  const summaryPath = join(outDir, `${runId}-summary.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        runId,
        model: MODEL_ID,
        existingLeadsCount: recentLeads.length,
        existingLeads: recentLeads.map((l) => ({
          opportunityCode: l.opportunityCode,
          name: l.name,
          company: l.company,
          title: l.title,
        })),
        results,
      },
      null,
      2,
    ),
  );

  console.log(`\n=== Summary ===`);
  const passed = results.filter((r) => r.passed).length;
  console.log(`${passed}/${results.length} passed`);
  console.log(`Full archive: ${summaryPath}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
