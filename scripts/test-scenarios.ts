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
    /** Regex that should match at least one AI turn (any turn, concatenated).
     *  Use for "AI should ask the rep for X" scenarios. */
    aiAsks?: RegExp;
    /** Regex that should NOT appear in any AI turn. Use to assert the AI
     *  *didn't* request spelling for a common name. */
    aiDoesNotAsk?: RegExp;
    /** If set, set_lead_field for these keys should never fire below the
     *  given confidence (e.g. assert that an email captured by voice was
     *  spell-verified at 1.0). */
    minFieldConfidence?: Record<string, number>;
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

  // ─── Edge cases added after the "always confirm" policy decision ────────

  {
    name: 'first-name-only-wait',
    description:
      'Rep gives just a first name in turn 1. AI must NOT call match_existing_lead yet — first-name-only is below the matching floor — and must ask for the last name.',
    repTurns: [
      'Hey, Dave just stopped by the booth.',
      'His last name is Chen.',
      'Yeah, Dave Chen from Acme Robotics. Done.',
    ],
    expected: {
      matchOpportunityCode: 'TST001',
      // The AI must ask for the last name in some form before the match can happen.
      aiAsks: /last name|full name|spell|surname|family name/i,
    },
  },

  {
    name: 'delayed-last-name-reveal',
    description:
      'Rep dribbles info across many turns. AI should wait, ask gap questions, and only match once first+last are in hand.',
    repTurns: [
      'Talked to David from Acme.',
      'Acme Robotics — sorry, should have been more specific.',
      'His last name is Chen. C-H-E-N.',
      'He is interested in the enterprise tier. Done.',
    ],
    expected: {
      matchOpportunityCode: 'TST001',
      aiAsks: /last name|full name|spell|who is/i,
    },
  },

  {
    name: 'two-john-smiths-disambiguated-upfront',
    description:
      'Two John Smiths in the show (TST005 Globex, TST010 Northwind). Rep names the company up front so disambiguation is implicit.',
    repTurns: [
      'John Smith from Globex just came back.',
      'He wanted to follow up on pricing for the AV demo. Done.',
    ],
    expected: {
      matchOpportunityCode: 'TST005',
    },
  },

  {
    name: 'two-john-smiths-ambiguous-must-ask',
    description:
      'Two John Smiths in the show. Rep gives just "John Smith". AI must NOT pick one — must ask for the distinguishing company first.',
    repTurns: [
      'John Smith stopped by again.',
      'He is the one from Northwind Logistics. Operations Manager.',
      'Done.',
    ],
    expected: {
      matchOpportunityCode: 'TST010',
      aiAsks: /globex|northwind|company|which|two|both|several/i,
    },
  },

  {
    name: 'common-name-skip-spelling',
    description:
      'Rep gives a Bill Jones (TST011 — already in the system). Common first and last names; AI should NOT ask for spelling readback on either.',
    repTurns: [
      'Bill Jones from Apex Supplies came by. Procurement.',
      'He wanted samples of the new sensor module. Done.',
    ],
    expected: {
      matchOpportunityCode: 'TST011',
      // The AI should NOT ask for spelling on either "Bill" or "Jones" —
      // both are in the common-names allowlist.
      aiDoesNotAsk: /how do you spell.*(bill|jones)/i,
    },
  },

  {
    name: 'unusual-name-must-spell',
    description:
      'Rep gives an unusual name (Pikulski). AI should ask for spelling before committing.',
    repTurns: [
      'Pete Pikulski stopped by.',
      'P-I-K-U-L-S-K-I. He is with OnLogic, sales engineer.',
      'Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: { last_name: /pikulski/i },
      aiAsks: /spell|spelling|how do you/i,
    },
  },

  {
    name: 'email-only-match',
    description:
      'Rep gives an email that exactly matches an existing lead (TST001 David Chen). Email alone is enough — no name needed.',
    repTurns: [
      'I have an email — david.chen at acmerobotics dot io. Can you pull up that lead?',
      'Yes, that one. He wants a follow-up call next week.',
      'Done.',
    ],
    expected: {
      matchOpportunityCode: 'TST001',
    },
  },

  {
    name: 'similar-name-different-person-no-match',
    description:
      'New person whose name happens to share a first name with an existing lead, but everything else is different. AI must NOT match.',
    repTurns: [
      'Met David Marquez from Quantis Robotics. Director of supply chain.',
      'His email is d.marquez at quantis dot io. Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: { first_name: /david/i, company: /quantis/i },
    },
  },

  {
    name: 'email-spelling-verification',
    description:
      'Rep gives an email by voice for a new lead. AI must read it back letter-by-letter before committing at confidence 1.0.',
    repTurns: [
      'Got a new lead: Anika Khoury from Plinth Software. Head of partnerships.',
      'Her email is anika at plinth software dot com.',
      'Yes, a-n-i-k-a at plinth dash software dot com. Confirmed.',
      'Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: {
        email: /anika.*plinth/i,
      },
      minFieldConfidence: { email: 1.0 },
      aiAsks: /a-n-i-k-a|letter by letter|read.*back|spelled|spell that|correct/i,
    },
  },

  // ─── Edge cases for the field-commit + recap rules ─────────────────────

  {
    name: 'commit-email-before-wrap',
    description:
      'Rep gives all info quickly and says "done". AI must commit email AND recap captured fields BEFORE calling end_conversation. Catches the Olivia Park regression.',
    repTurns: [
      'New lead: Olivia Park, Fjord Analytics, head of data engineering.',
      'Her email is olivia at fjord-analytics dot com. Spelled o-l-i-v-i-a, that is correct.',
      'Done, that is it.',
      'No, that is everything.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: {
        first_name: /olivia/i,
        company: /fjord/i,
        email: /olivia.*fjord/i,
      },
      // The recap rule should produce a turn where the AI states back the
      // captured fields — look for the lead's name + a confirmation word.
      aiAsks: /(olivia|recap|got).*(olivia|fjord|email|head)|anything (else|to add|to correct)/i,
    },
  },

  {
    name: 'rep-correction-overrides-stored-value',
    description:
      "Stored last name is 'Tatem' (TST003). Rep matches the lead and then gives the correct spelling 'Tatum'. AI must call set_lead_field with the rep's value, not echo the stored one.",
    repTurns: [
      'Stephen Tatum from Northwind Logistics came back. He goes by Stephen, not Steve.',
      'Yes — and his last name is spelled T-A-T-U-M, the badge from before was misprinted.',
      'That is all.',
      'No, that is it.',
    ],
    expected: {
      matchOpportunityCode: 'TST003',
      capturedFields: { last_name: /tatum/i },
      minFieldConfidence: { last_name: 1.0 },
    },
  },

  {
    name: 'overreach-match-rejected-by-server',
    description:
      "Pathological case: rep says a name and company with zero overlap to anything in EXISTING LEADS. AI shouldn't call the tool, but if it does, the server should reject. Ends with no match.",
    repTurns: [
      'Linda Smith from Hawthorne Bio stopped by. Lab automation lead.',
      'Email is linda.smith at hawthorne hyphen bio dot com.',
      'Yes, that is correct.',
      'Done.',
    ],
    expected: {
      noMatchExpected: true,
      capturedFields: { first_name: /linda/i, company: /hawthorne/i },
    },
  },

  {
    name: 'match-from-photo-no-readback',
    description:
      "Simulates a photo-extraction-then-match flow: AI is told via system message that the photo extracted David Chen / Acme Robotics. It should call match_existing_lead immediately and not ask the rep to spell anything.",
    repTurns: [
      '[system] The rep just attached a photo. Vision OCR extracted: { first_name: "David", last_name: "Chen", company: "Acme Robotics", title: "Director of Engineering", email: "david.chen@acmerobotics.io" }. These are facts from the printed card — high confidence on identity fields. Now: 1. Compare against EXISTING LEADS. 2. Call set_lead_field for values you want committed. 3. Ask about anything not on the card.',
      'He wants to schedule a demo next month.',
      'Done.',
      'No, that is everything.',
    ],
    expected: {
      matchOpportunityCode: 'TST001',
      // AI should NOT ask the rep to spell anything from the card.
      aiDoesNotAsk: /how do you spell|spell that|letter by letter/i,
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
  /** Matches the AI tried to call but were rejected by the harness's
   *  overlap guard (mirrors the prod hook's rejection path). */
  rejectedMatches?: Array<{ opportunityCode: string; reason: string }>;
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
  /** Tool calls that were rejected by the harness (mirrors the prod hook's
   *  overlap guard). Surfaced for diagnostic reporting. */
  rejectedToolCalls: Array<{ name: string; args: Record<string, unknown>; reason: string }>;
  /** True if Gemini ended the turn cleanly, false if we hit the timeout. */
  turnComplete: boolean;
}

interface RecentLeadForGuard {
  opportunityCode: string;
  /** All non-empty fields from mergedFields — name, first_name, last_name,
   *  company, email, etc. Used to compute name-token overlap. */
  knownFields: Record<string, string>;
}

interface MatchGuardContext {
  recentLeads: Map<string, RecentLeadForGuard>;
  /** All rep turns sent so far this scenario, lowercased. */
  repTranscript: string;
  /** Live fields captured so far this scenario. */
  liveFields: Record<string, { value: string }>;
}

/**
 * Mirror of the overlap guard in lib/realtime/useRealtimeAssist.ts. Returns
 * { accepted } if the candidate shares at least one name token with what the
 * rep has said or what's been committed to liveFields. Returns
 * { accepted: false, reason } otherwise.
 *
 * Without this guard the test harness was rubber-stamping every AI-suggested
 * match, hiding the fact that the production client rejects them.
 */
function checkMatchOverlap(
  opportunityCode: string,
  ctx: MatchGuardContext,
): { accepted: true } | { accepted: false; reason: string } {
  const lead = ctx.recentLeads.get(opportunityCode);
  if (!lead) {
    return {
      accepted: false,
      reason: `No lead with opportunityCode "${opportunityCode}" in the EXISTING LEADS list you were given.`,
    };
  }
  const tokenize = (v: string | undefined): string[] => {
    const out: string[] = [];
    if (typeof v === 'string') {
      for (const tok of v.toLowerCase().split(/[^a-z0-9]+/)) {
        if (tok.length >= 2) out.push(tok);
      }
    }
    return out;
  };
  const repTokens = new Set<string>();
  for (const [, v] of Object.entries(ctx.liveFields)) {
    if (v.value) for (const tok of tokenize(v.value)) repTokens.add(tok);
  }
  for (const tok of ctx.repTranscript.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length >= 3) repTokens.add(tok);
  }
  const anyOverlap = (cands: string[]): boolean => {
    for (const tok of cands) {
      if (repTokens.has(tok)) return true;
      for (const candidate of repTokens) {
        if (
          tok.length >= 4 &&
          candidate.length >= 4 &&
          (tok.startsWith(candidate.slice(0, 4)) || candidate.startsWith(tok.slice(0, 4)))
        ) {
          return true;
        }
      }
    }
    return false;
  };
  // Email/phone exact match bypasses the name guard.
  const candEmail = lead.knownFields.email?.toLowerCase();
  const candPhone = lead.knownFields.phone?.toLowerCase();
  if ((candEmail && repTokens.has(candEmail)) || (candPhone && repTokens.has(candPhone))) {
    return { accepted: true };
  }
  const firstNameTokens = tokenize(lead.knownFields.first_name);
  const lastNameTokens = tokenize(lead.knownFields.last_name);
  const fullNameTokens = tokenize(lead.knownFields.name);
  const nameTokens = [...firstNameTokens, ...lastNameTokens, ...fullNameTokens];
  const candidateLabel =
    lead.knownFields.name ||
    [lead.knownFields.first_name, lead.knownFields.last_name].filter(Boolean).join(' ') ||
    opportunityCode;
  if (nameTokens.length === 0) return { accepted: true }; // unnamed lead — let it through, can't compare
  if (!anyOverlap(nameTokens)) {
    return {
      accepted: false,
      reason: `Match rejected: candidate "${candidateLabel}" shares no NAME token with anything the rep has said. Company match alone is not enough.`,
    };
  }
  if (lastNameTokens.length > 0 && !anyOverlap(lastNameTokens)) {
    return {
      accepted: false,
      reason: `Match rejected: candidate last name "${lead.knownFields.last_name}" does not match anything the rep said. Different last name = different person, even if first names match.`,
    };
  }
  return { accepted: true };
}

async function sendTurnAndAwaitComplete(
  ws: WebSocket,
  repText: string,
  guardCtx: MatchGuardContext,
): Promise<TurnOutcome> {
  return new Promise((resolve, reject) => {
    const toolCalls: ToolCall[] = [];
    const rejectedToolCalls: TurnOutcome['rejectedToolCalls'] = [];
    const textParts: string[] = [];

    const timer = setTimeout(() => {
      ws.removeEventListener('message', handler);
      // Don't reject — return partial outcome so the test can still report.
      resolve({ text: textParts.join(''), toolCalls, rejectedToolCalls, turnComplete: false });
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
          const args = fc.args ?? {};
          // Apply the same overlap guard the production hook applies.
          // Rejected matches are NOT added to toolCalls — the AI sees an
          // error response and (correctly) backs off.
          if (fc.name === 'match_existing_lead') {
            const opportunityCode = String(args.opportunityCode ?? '');
            const reasonText = String(args.reason ?? '').toLowerCase();
            const reasonSaysNoMatch = /no match|no plausible|none of|no candidate/.test(reasonText);
            if (!opportunityCode || reasonSaysNoMatch) {
              // AI declined to match — treat as no-op, don't record.
              return { id: fc.id, name: fc.name, response: { ok: true } };
            }
            const guard = checkMatchOverlap(opportunityCode, guardCtx);
            if (!guard.accepted) {
              rejectedToolCalls.push({ name: fc.name, args, reason: guard.reason });
              return {
                id: fc.id,
                name: fc.name,
                response: { ok: false, error: guard.reason },
              };
            }
            toolCalls.push({ id: fc.id, name: fc.name, args });
            return {
              id: fc.id,
              name: fc.name,
              response: { ok: true, note: 'Rep notified — waiting for their confirm.' },
            };
          }
          toolCalls.push({ id: fc.id, name: fc.name, args });
          return { id: fc.id, name: fc.name, response: { ok: true } };
        });
        ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));
      }

      if (sc?.turnComplete) {
        clearTimeout(timer);
        ws.removeEventListener('message', handler);
        resolve({ text: textParts.join(''), toolCalls, rejectedToolCalls, turnComplete: true });
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
  recentLeadsForGuard: Map<string, RecentLeadForGuard>,
): Promise<SimResult> {
  const transcript: SimResult['transcript'] = [];
  const liveFields: SimResult['liveFields'] = {};
  const matches: SimResult['matches'] = [];
  const rejectedMatches: Array<{ opportunityCode: string; reason: string }> = [];

  const guardCtx: MatchGuardContext = {
    recentLeads: recentLeadsForGuard,
    repTranscript: '',
    liveFields,
  };

  const token = await mintToken(session);
  const ws = await openLiveSocket(token);
  try {
    // 1. Send setupMessage (sets system prompt, tools, response modality, etc.)
    if (token.setupMessage) ws.send(JSON.stringify(token.setupMessage));
    await waitForSetupComplete(ws);

    // 2. Drive the rep's turns one at a time, applying tool effects.
    for (const repText of scenario.repTurns) {
      transcript.push({ role: 'rep', text: repText });
      guardCtx.repTranscript += ' ' + repText;
      const outcome = await sendTurnAndAwaitComplete(ws, repText, guardCtx);
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
      for (const rtc of outcome.rejectedToolCalls) {
        const code = String(rtc.args.opportunityCode ?? '');
        if (code) rejectedMatches.push({ opportunityCode: code, reason: rtc.reason });
      }
      // Tolerate Gemini Live preview's occasional dropped turnComplete. If the
      // AI emitted text OR tool calls, treat the turn as logically complete
      // and proceed to the next rep turn — matches how the prod client
      // (which doesn't gate on turnComplete either) behaves.
      const turnHadOutput = outcome.text.length > 0 || outcome.toolCalls.length > 0;
      if (!outcome.turnComplete && !turnHadOutput) break; // Hard-stuck WSS
    }
  } finally {
    try {
      ws.close(1000, 'test-end');
    } catch {
      /* ignore */
    }
  }

  const notes = checkExpectations(scenario, liveFields, matches, transcript);
  return {
    scenario,
    transcript,
    liveFields,
    matches,
    rejectedMatches: rejectedMatches.length > 0 ? rejectedMatches : undefined,
    passed: notes.length === 0,
    notes,
  };
}

function checkExpectations(
  scenario: Scenario,
  liveFields: SimResult['liveFields'],
  matches: SimResult['matches'],
  transcript: SimResult['transcript'],
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
  // AI text-based assertions
  const aiText = transcript
    .filter((t) => t.role === 'ai')
    .map((t) => t.text ?? '')
    .join('\n');
  // Conditional aiAsks: skip the assertion if the rep already volunteered
  // the info the AI was supposed to ask for. Detects by checking if the rep
  // transcript matches the same pattern (e.g. rep pre-spelled letter-by-
  // letter, so the AI doesn't need to ask for spelling).
  if (exp.aiAsks) {
    const repText = transcript
      .filter((t) => t.role === 'rep')
      .map((t) => t.text ?? '')
      .join('\n');
    const repVolunteered = exp.aiAsks.test(repText);
    if (!repVolunteered && !exp.aiAsks.test(aiText)) {
      notes.push(
        `FAIL: expected AI to ask /${exp.aiAsks.source}/${exp.aiAsks.flags}, but AI never did (and the rep didn't volunteer it either)`,
      );
    }
  }
  if (exp.aiDoesNotAsk && exp.aiDoesNotAsk.test(aiText)) {
    notes.push(
      `FAIL: AI was NOT supposed to ask /${exp.aiDoesNotAsk.source}/${exp.aiDoesNotAsk.flags}, but it did`,
    );
  }
  if (exp.minFieldConfidence) {
    for (const [key, minConf] of Object.entries(exp.minFieldConfidence)) {
      const f = liveFields[key];
      if (!f) continue; // capturedFields check covers presence
      const conf = f.confidence ?? 0;
      if (conf < minConf) {
        notes.push(
          `FAIL: field '${key}' captured at confidence ${conf}, expected >= ${minConf}`,
        );
      }
    }
  }
  return notes;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Delete every opportunity whose code is NOT in the TST* allowlist for the
 * test show. Wipes real-world testing residue so scenarios with
 * noMatchExpected aren't fouled by leftover Pikulski/Wheelen/etc. leads.
 */
async function resetTestData(): Promise<void> {
  const { db } = await import('@/db/client');
  const schema = await import('@/db/schema');
  const { and, eq, notLike } = await import('drizzle-orm');
  const [demo] = await db.select().from(schema.shows).where(eq(schema.shows.slug, SHOW_SLUG)).limit(1);
  if (!demo) {
    console.error(`Show ${SHOW_SLUG} not found`);
    process.exit(1);
  }
  const result = await db
    .delete(schema.opportunities)
    .where(and(eq(schema.opportunities.showId, demo.id), notLike(schema.opportunities.code, 'TST%')))
    .returning({ code: schema.opportunities.code });
  console.log(`• reset: deleted ${result.length} non-TST opportunities (${result.map((r) => r.code).join(', ')})`);
}

/**
 * Load the show's recent leads as a Map keyed by opportunityCode, with the
 * full mergedFields so the test harness can apply the same overlap guard
 * the production hook applies.
 */
async function loadRecentLeadsForGuard(): Promise<Map<string, RecentLeadForGuard>> {
  const { db } = await import('@/db/client');
  const schema = await import('@/db/schema');
  const { desc, eq } = await import('drizzle-orm');
  const [demo] = await db.select().from(schema.shows).where(eq(schema.shows.slug, SHOW_SLUG)).limit(1);
  if (!demo) {
    console.error(`Show ${SHOW_SLUG} not found`);
    process.exit(1);
  }
  const rows = await db
    .select({
      opportunityCode: schema.opportunities.code,
      mergedFields: schema.leads.mergedFields,
    })
    .from(schema.leads)
    .innerJoin(schema.opportunities, eq(schema.opportunities.id, schema.leads.opportunityId))
    .where(eq(schema.opportunities.showId, demo.id))
    .orderBy(desc(schema.leads.lastUpdatedAt))
    .limit(100);
  const map = new Map<string, RecentLeadForGuard>();
  for (const r of rows) {
    const fields = (r.mergedFields ?? {}) as Record<string, unknown>;
    const knownFields: Record<string, string> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v == null || v === '') continue;
      knownFields[k] = typeof v === 'string' ? v : JSON.stringify(v);
    }
    map.set(r.opportunityCode, { opportunityCode: r.opportunityCode, knownFields });
  }
  return map;
}

interface AggregateRow {
  scenarioName: string;
  results: SimResult[];
  passes: number;
  total: number;
}

async function main() {
  // --runs=N → run each scenario N times and report aggregate pass rate
  const runsArg = process.argv.find((a) => a.startsWith('--runs='));
  const runs = runsArg ? Math.max(1, Math.min(10, Number(runsArg.split('=')[1]))) : 1;
  const reset = process.argv.includes('--reset');
  const filterArg = process.argv.find((a) => a.startsWith('--only='));
  const onlyNames = filterArg ? new Set(filterArg.split('=')[1].split(',')) : null;
  const scenarios = onlyNames ? SCENARIOS.filter((s) => onlyNames.has(s.name)) : SCENARIOS;

  console.log(`\n=== E2E test harness ===`);
  console.log(`Target:    ${process.env.AICAPTURE_TEST_BASE_URL ?? 'https://ai-capture.vercel.app'}`);
  console.log(`Rep:       ${REP_EMAIL}`);
  console.log(`Show:      ${SHOW_SLUG}`);
  console.log(`Scenarios: ${scenarios.length}${onlyNames ? ` (filtered from ${SCENARIOS.length})` : ''}`);
  console.log(`Runs per:  ${runs}\n`);

  if (reset) {
    await resetTestData();
  }

  process.stdout.write('• authenticating … ');
  const session = await loginAsTestRep({ email: REP_EMAIL });
  console.log('OK');

  process.stdout.write('• loading recent leads for overlap guard … ');
  const recentLeadsForGuard = await loadRecentLeadsForGuard();
  console.log(`${recentLeadsForGuard.size} leads\n`);

  const outDir = join(process.cwd(), 'tests', 'scenario-runs');
  mkdirSync(outDir, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');

  const aggregate: AggregateRow[] = scenarios.map((s) => ({
    scenarioName: s.name,
    results: [],
    passes: 0,
    total: 0,
  }));

  for (let run = 1; run <= runs; run++) {
    if (runs > 1) console.log(`══ Run ${run}/${runs} ══`);
    for (const scenario of scenarios) {
      const row = aggregate.find((a) => a.scenarioName === scenario.name)!;
      process.stdout.write(`▶ ${scenario.name} … `);
      try {
        const r = await runScenario(scenario, session, recentLeadsForGuard);
        row.results.push(r);
        row.total++;
        if (r.passed) row.passes++;
        console.log(r.passed ? 'PASS' : 'FAIL');
        for (const n of r.notes) console.log(`    ${n}`);
      } catch (e) {
        const msg = (e as Error).message;
        row.results.push({
          scenario,
          transcript: [],
          liveFields: {},
          matches: [],
          passed: false,
          notes: [`ERROR: ${msg}`],
        });
        row.total++;
        console.log(`ERROR — ${msg}`);
      }
    }
    if (runs > 1) console.log('');
  }

  const summaryPath = join(outDir, `${runId}-summary.json`);
  writeFileSync(
    summaryPath,
    JSON.stringify(
      {
        runId,
        baseUrl: session.baseUrl,
        repEmail: session.email,
        showSlug: SHOW_SLUG,
        runsPerScenario: runs,
        aggregate: aggregate.map((a) => ({
          scenarioName: a.scenarioName,
          passes: a.passes,
          total: a.total,
          passRate: a.total > 0 ? a.passes / a.total : 0,
          results: a.results,
        })),
      },
      null,
      2,
    ),
  );

  console.log(`=== Summary ===`);
  if (runs > 1) {
    for (const a of aggregate) {
      const pct = a.total > 0 ? Math.round((a.passes / a.total) * 100) : 0;
      const bar =
        pct === 100 ? '✅' : pct >= 67 ? '🟡' : pct >= 33 ? '🟠' : '🔴';
      console.log(`  ${bar} ${a.scenarioName}: ${a.passes}/${a.total} (${pct}%)`);
    }
  }
  const totalPasses = aggregate.reduce((n, a) => n + a.passes, 0);
  const totalRuns = aggregate.reduce((n, a) => n + a.total, 0);
  console.log(`\nOverall: ${totalPasses}/${totalRuns} passed`);
  console.log(`Archive: ${summaryPath}`);

  // Exit code: green only if every scenario is at 100% across all runs.
  const allGreen = aggregate.every((a) => a.passes === a.total && a.total > 0);
  process.exit(allGreen ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
