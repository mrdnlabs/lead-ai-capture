/**
 * End-to-end test harness for the realtime AI agent.
 *
 * Drives the same path a real PWA session takes:
 *   1. Authenticate as a test rep (magic link → cookies)
 *   2. POST /api/realtime/token to mint a session token + prompt
 *   3. Open a real WebSocket to Gemini Live with that token
 *   4. Send the setupMessage exactly as the client does
 *   5. For each rep "turn", send `realtimeInput.text` over the wire
 *      (instead of audio — same wire format the production text-input
 *      box uses)
 *   6. Observe serverContent + toolCall messages, reply with toolResponse
 *   7. Validate expectations
 *
 * Each scenario is archived to tests/scenario-runs/<timestamp>-<name>.json
 * so Claude can read the full transcript when debugging a failure.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loginAsTestRep, type AuthedSession } from './_helpers/auth';

const REP_EMAIL =
  process.env.AICAPTURE_TEST_REP_EMAIL ?? 'anthropic@davidnicholl.com';
const SHOW_SLUG = process.env.AICAPTURE_TEST_SHOW_SLUG ?? 'demo';
const TURN_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

interface Scenario {
  name: string;
  description: string;
  repTurns: string[];
  expected: {
    matchOpportunityCode?: string;
    noMatchExpected?: boolean;
    capturedFields?: Record<string, string | RegExp>;
  };
}

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
    expected: { matchOpportunityCode: 'TST001' },
  },
  {
    name: 'phonetic-sibling',
    description:
      'Rep says "Dave Chen" — could match either TST001 (David Chen at Acme Robotics) or TST002 (Dave Chan at Acme Software).',
    repTurns: [
      'Just talked to Dave Chen from Acme. Pretty senior.',
      'Acme Robotics specifically. He is interested in our enterprise tier.',
      'Done.',
    ],
    expected: { matchOpportunityCode: 'TST001' },
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
      matchOpportunityCode: 'TST003',
      capturedFields: { last_name: /tatum/i },
    },
  },
  {
    name: 'sparse-info-match',
    description:
      'Rep gives only first name + company; TST007 is "Marcus" at "BlueRiver Analytics".',
    repTurns: [
      'Marcus from BlueRiver Analytics is back. He brought a coworker.',
      'Wants to schedule a follow-up next month.',
      'That is it.',
    ],
    expected: { matchOpportunityCode: 'TST007' },
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
      capturedFields: { first_name: /linda/i, company: /hawthorne/i },
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
      capturedFields: { first_name: /theo/i },
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
      capturedFields: { company: /hardware/i },
    },
  },
];

// ---------------------------------------------------------------------------
// Live driver
// ---------------------------------------------------------------------------

interface TokenResponse {
  token: string;
  expiresAt: number;
  transport: 'webrtc' | 'websocket';
  endpoint: string;
  model: string;
  provider: 'gemini' | 'openai';
  providerConfigId: string;
  setupMessage?: unknown;
  requiredFields?: Array<{ key: string; label: string; required: boolean }>;
  existingLeads?: Array<{ opportunityCode: string; knownFields: Record<string, string> }>;
}

interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

interface SimResult {
  scenario: Scenario;
  transcript: Array<{ role: 'rep' | 'ai'; text?: string; toolCalls?: ToolCall[] }>;
  liveFields: Record<string, { value: string; confidence?: number }>;
  matches: Array<{ opportunityCode: string; reason: string }>;
  passed: boolean;
  notes: string[];
}

async function mintToken(session: AuthedSession): Promise<TokenResponse> {
  let lastBody = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${session.baseUrl}/api/realtime/token`, {
      method: 'POST',
      headers: { ...session.headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ showSlug: SHOW_SLUG }),
    });
    if (res.ok) return (await res.json()) as TokenResponse;
    lastBody = await res.text();
    if (res.status < 500) {
      throw new Error(`/api/realtime/token HTTP ${res.status}: ${lastBody}`);
    }
    // Transient 5xx — back off and retry.
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(`/api/realtime/token failed after 3 tries. Last body: ${lastBody}`);
}

function openLiveSocket(token: TokenResponse): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = `${token.endpoint}?key=${encodeURIComponent(token.token)}`;
    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    const onOpen = () => {
      ws.removeEventListener('error', onError);
      resolve(ws);
    };
    const onError = (e: Event) => {
      ws.removeEventListener('open', onOpen);
      reject(new Error(`ws open failed: ${(e as ErrorEvent).message ?? 'unknown'}`));
    };
    ws.addEventListener('open', onOpen, { once: true });
    ws.addEventListener('error', onError, { once: true });
  });
}

function decodeWsData(data: unknown): string | null {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return null;
}

async function waitForSetupComplete(ws: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      reject(new Error('setupComplete timeout'));
    }, 10_000);
    const handler = (ev: MessageEvent) => {
      const text = decodeWsData(ev.data);
      if (!text) return;
      try {
        const msg = JSON.parse(text);
        if (msg.setupComplete !== undefined) {
          clearTimeout(timer);
          ws.removeEventListener('message', handler);
          resolve();
        }
      } catch {
        /* ignore */
      }
    };
    ws.addEventListener('message', handler);
  });
}

interface TurnOutcome {
  text: string;
  toolCalls: ToolCall[];
  /** True if Gemini ended the turn cleanly, false if we hit the timeout. */
  turnComplete: boolean;
}

async function sendTurnAndAwaitComplete(
  ws: WebSocket,
  repText: string,
): Promise<TurnOutcome> {
  return new Promise((resolve, reject) => {
    const toolCalls: ToolCall[] = [];
    const textParts: string[] = [];

    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      // Don't reject — return partial outcome so the test can still report.
      resolve({ text: textParts.join(''), toolCalls, turnComplete: false });
    }, TURN_TIMEOUT_MS);

    const handler = (ev: MessageEvent) => {
      const text = decodeWsData(ev.data);
      if (!text) return;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }

      const sc = msg.serverContent as
        | {
            outputTranscription?: { text?: string };
            modelTurn?: { parts?: Array<{ text?: string }> };
            turnComplete?: boolean;
          }
        | undefined;
      if (sc?.outputTranscription?.text) textParts.push(sc.outputTranscription.text);
      for (const p of sc?.modelTurn?.parts ?? []) {
        if (p.text) textParts.push(p.text);
      }

      const tc = msg.toolCall as
        | { functionCalls?: Array<{ id?: string; name: string; args?: Record<string, unknown> }> }
        | undefined;
      if (tc?.functionCalls && tc.functionCalls.length > 0) {
        const responses = tc.functionCalls.map((fc) => {
          toolCalls.push({ id: fc.id, name: fc.name, args: fc.args ?? {} });
          // Acknowledge with the same shape the production client uses.
          return {
            id: fc.id,
            name: fc.name,
            response:
              fc.name === 'match_existing_lead'
                ? { ok: true, note: 'Rep notified — waiting for their confirm.' }
                : { ok: true },
          };
        });
        ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      }

      if (sc?.turnComplete) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve({ text: textParts.join(''), toolCalls, turnComplete: true });
      }
    };

    ws.addEventListener('message', handler);

    // Failure modes: the socket dies mid-turn.
    const errorHandler = (e: Event) => {
      clearTimeout(timer);
      ws.removeEventListener('message', handler);
      ws.removeEventListener('error', errorHandler);
      reject(new Error(`ws error mid-turn: ${(e as ErrorEvent).message ?? 'unknown'}`));
    };
    ws.addEventListener('error', errorHandler, { once: true });

    // Send the rep's text turn. Gemini Live treats realtimeInput.text the same
    // as transcribed voice — feeds it into the same turn-taking pipeline.
    ws.send(JSON.stringify({ realtimeInput: { text: repText } }));
  });
}

async function runScenario(
  scenario: Scenario,
  session: AuthedSession,
): Promise<SimResult> {
  const transcript: SimResult['transcript'] = [];
  const liveFields: SimResult['liveFields'] = {};
  const matches: SimResult['matches'] = [];

  const token = await mintToken(session);
  const ws = await openLiveSocket(token);
  try {
    // 1. Send setupMessage (sets system prompt, tools, response modality, etc.)
    if (token.setupMessage) ws.send(JSON.stringify(token.setupMessage));
    await waitForSetupComplete(ws);

    // 2. Drive the rep's turns one at a time, applying tool effects.
    for (const repText of scenario.repTurns) {
      transcript.push({ role: 'rep', text: repText });
      const outcome = await sendTurnAndAwaitComplete(ws, repText);
      transcript.push({
        role: 'ai',
        text: outcome.text || undefined,
        toolCalls: outcome.toolCalls.length > 0 ? outcome.toolCalls : undefined,
      });
      for (const tc of outcome.toolCalls) {
        if (tc.name === 'set_lead_field') {
          const key = String(tc.args.key ?? '');
          const value = String(tc.args.value ?? '');
          const confidence =
            typeof tc.args.confidence === 'number' ? tc.args.confidence : undefined;
          if (key) liveFields[key] = { value, confidence };
        } else if (tc.name === 'match_existing_lead') {
          const code = String(tc.args.opportunityCode ?? '');
          const reason = String(tc.args.reason ?? '');
          if (code && !matches.some((m) => m.opportunityCode === code)) {
            matches.push({ opportunityCode: code, reason });
          }
        }
      }
      if (!outcome.turnComplete) break; // Avoid sending the next turn into a stuck WSS
    }
  } finally {
    try {
      ws.close(1000, 'test-end');
    } catch {
      /* ignore */
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
        notes.push(
          `FAIL: expected field '${key}' to be captured (expected '${expectedVal}'), but none`,
        );
        continue;
      }
      const ok =
        expectedVal instanceof RegExp
          ? expectedVal.test(got)
          : got.toLowerCase().includes(String(expectedVal).toLowerCase());
      if (!ok) {
        notes.push(`FAIL: field '${key}' = '${got}', expected to match '${expectedVal}'`);
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== E2E test harness ===`);
  console.log(`Target: ${process.env.AICAPTURE_TEST_BASE_URL ?? 'https://ai-capture.vercel.app'}`);
  console.log(`Rep:    ${REP_EMAIL}`);
  console.log(`Show:   ${SHOW_SLUG}`);
  console.log(`Scenarios to run: ${SCENARIOS.length}\n`);

  process.stdout.write('• authenticating … ');
  const session = await loginAsTestRep({ email: REP_EMAIL });
  console.log('OK');

  const outDir = join(process.cwd(), 'tests', 'scenario-runs');
  mkdirSync(outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  const results: SimResult[] = [];
  for (const scenario of SCENARIOS) {
    process.stdout.write(`▶ ${scenario.name} … `);
    try {
      const r = await runScenario(scenario, session);
      results.push(r);
      console.log(r.passed ? 'PASS' : 'FAIL');
      for (const n of r.notes) console.log(`    ${n}`);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`ERROR — ${msg}`);
      results.push({
        scenario,
        transcript: [],
        liveFields: {},
        matches: [],
        passed: false,
        notes: [`ERROR: ${msg}`],
      });
    }
  }

  const summaryPath = join(outDir, `${runId}-summary.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      { runId, baseUrl: session.baseUrl, repEmail: session.email, showSlug: SHOW_SLUG, results },
      null,
      2,
    ),
  );

  console.log(`\n=== Summary ===`);
  const passed = results.filter((r) => r.passed).length;
  console.log(`${passed}/${results.length} passed`);
  console.log(`Archive: ${summaryPath}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
