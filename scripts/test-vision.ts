/**
 * End-to-end vision/extraction test.
 *
 * Same path a real PWA capture takes:
 *   1. Authenticate (magic link → cookies)
 *   2. POST multipart/form-data to /api/captures with the fixture image as
 *      `photo` and no audio
 *   3. Poll the captures row until status='processed' (the `after()` hook
 *      in /api/captures kicks off processCapture asynchronously)
 *   4. Read the resulting lead's mergedFields and verify against expected
 *   5. Clean up: delete the lead + opportunity + capture rows we created
 *
 * Skip badge fixtures that intentionally have no extractable text
 * (`british-library`, `andres-rincon`) by giving them an empty expectation.
 */
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local', quiet: true });

import { readFileSync } from 'fs';
import { join } from 'path';
import { eq, inArray } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { loginAsTestRep, type AuthedSession } from './_helpers/auth';

const SHOW_SLUG = process.env.AICAPTURE_TEST_SHOW_SLUG ?? 'demo';
const REP_EMAIL = process.env.AICAPTURE_TEST_REP_EMAIL ?? 'anthropic@davidnicholl.com';
const POLL_TIMEOUT_MS = 180_000;
const POLL_INTERVAL_MS = 2_000;

interface VisionCase {
  fixture: string; // relative to tests/fixtures/
  description: string;
  expected: {
    /** True if the image truly has nothing extractable (logo only, illegible). */
    emptyOk?: boolean;
    /** Fields that SHOULD appear (substring/regex match). */
    capturedFields?: Record<string, string | RegExp>;
  };
}

const CASES: VisionCase[] = [
  {
    fixture: 'badges/fake-badge-sarah-chen.png',
    description: 'Generated baseline badge with known fields.',
    expected: {
      capturedFields: {
        // The custom lead form uses first_name/last_name; vision may emit "name".
        // Accept either by checking the field that exists.
        first_name: /sarah/i,
        last_name: /chen/i,
        company: /acme robotics/i,
        title: /vp.*engineering/i,
        email: /sarah\.chen@acmerobotics\.io/i,
      },
    },
  },
  {
    fixture: 'badges/name-badges.jpg',
    description: 'Magnetic name badges — Milly Francis, Dental Nurse, Smiles Dentists.',
    expected: {
      capturedFields: {
        first_name: /milly/i,
        last_name: /francis/i,
        title: /dental nurse/i,
        company: /smiles dentists/i,
      },
    },
  },
  {
    fixture: 'badges/employee-name-badge.jpg',
    description: 'Conference badge Paul Smith / Stictly Ltd / 4th Online Services Conference.',
    expected: {
      capturedFields: {
        first_name: /paul/i,
        last_name: /smith/i,
        // Accept either "Stictly" (literal OCR — correct) or "Strictly" (corrected)
        company: /st(r)?ictly/i,
      },
    },
  },
  {
    fixture: 'badges/wikiconf-uk-2012.jpg',
    description: 'Cluttered table of badges from distance — should mostly come back empty.',
    expected: { emptyOk: true },
  },
  {
    fixture: 'cards/choe-kwangmo.jpg',
    description: 'Clean modern card — Choe Kwangmo, Gangwon Fire and Rescue Service.',
    expected: {
      capturedFields: {
        first_name: /choe|kwangmo/i,
        company: /gangwon.*fire/i,
        email: /choekwangmo@gmail\.com/i,
      },
    },
  },
  {
    fixture: 'cards/diplomatic-first-secretary.jpg',
    description: 'Diplomatic card — Premil Ratnayake, Embassy of Sri Lanka.',
    expected: {
      capturedFields: {
        first_name: /premil/i,
        last_name: /ratnayake/i,
        title: /first secretary/i,
        company: /embassy.*sri lanka/i,
      },
    },
  },
  {
    fixture: 'cards/british-library.jpg',
    description: 'Back of card — should yield no fields.',
    expected: { emptyOk: true },
  },
  {
    fixture: 'cards/andres-rincon.jpg',
    description: 'Logo mockup with no contact text.',
    expected: { emptyOk: true },
  },
];

interface CaptureUploadResponse {
  captureId: string;
  audioBlobKey: string | null;
  photoBlobKey: string | null;
  status: string;
  idempotent?: boolean;
}

async function uploadCapture(
  session: AuthedSession,
  fixturePath: string,
): Promise<CaptureUploadResponse> {
  const fullPath = join(process.cwd(), 'tests', 'fixtures', fixturePath);
  const bytes = readFileSync(fullPath);
  const mime = fixturePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  const fd = new FormData();
  fd.set('showSlug', SHOW_SLUG);
  fd.set('idempotencyKey', crypto.randomUUID());
  fd.set('clientCapturedAt', new Date().toISOString());
  fd.set('photo', new Blob([new Uint8Array(bytes)], { type: mime }), fixturePath.split('/').pop()!);

  const res = await fetch(`${session.baseUrl}/api/captures`, {
    method: 'POST',
    headers: { Cookie: session.cookieHeader },
    body: fd,
  });
  if (!res.ok) {
    throw new Error(`/api/captures HTTP ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as CaptureUploadResponse;
}

interface PolledCapture {
  status: string;
  opportunityId: string;
  mergedFields: Record<string, unknown>;
  leadId: string | null;
  opportunityCode: string;
}

async function pollUntilProcessed(
  db: ReturnType<typeof import('@/db/client').db.select>['from'] extends never
    ? never
    : import('@/db/client').DbClient,
  captureId: string,
): Promise<PolledCapture> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let lastStatus = 'unknown';

  while (Date.now() < deadline) {
    const [cap] = await db
      .select({
        status: schema.captures.status,
        opportunityId: schema.captures.opportunityId,
      })
      .from(schema.captures)
      .where(eq(schema.captures.id, captureId))
      .limit(1);
    if (!cap) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    lastStatus = cap.status;
    if (cap.status === 'processed') {
      const [opp] = await db
        .select({ code: schema.opportunities.code })
        .from(schema.opportunities)
        .where(eq(schema.opportunities.id, cap.opportunityId))
        .limit(1);
      const [lead] = await db
        .select({
          id: schema.leads.id,
          mergedFields: schema.leads.mergedFields,
        })
        .from(schema.leads)
        .where(eq(schema.leads.opportunityId, cap.opportunityId))
        .limit(1);
      return {
        status: cap.status,
        opportunityId: cap.opportunityId,
        mergedFields: (lead?.mergedFields as Record<string, unknown>) ?? {},
        leadId: lead?.id ?? null,
        opportunityCode: opp?.code ?? '?',
      };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Capture ${captureId} not processed within ${POLL_TIMEOUT_MS}ms (last=${lastStatus})`);
}

function checkExpectations(
  vc: VisionCase,
  mergedFields: Record<string, unknown>,
): string[] {
  const notes: string[] = [];
  const fieldCount = Object.values(mergedFields).filter(
    (v) => v != null && v !== '' && (!Array.isArray(v) || v.length > 0),
  ).length;

  if (vc.expected.emptyOk) {
    if (fieldCount > 2) {
      notes.push(
        `WARN: expected ~empty fields but vision extracted ${fieldCount} (${JSON.stringify(mergedFields)})`,
      );
    }
    return notes;
  }
  for (const [key, expectedVal] of Object.entries(vc.expected.capturedFields ?? {})) {
    const got = mergedFields[key];
    if (got == null || got === '') {
      notes.push(
        `FAIL: expected '${key}' to be extracted (expected '${expectedVal}'), but missing. Got fields: ${Object.keys(
          mergedFields,
        ).join(', ')}`,
      );
      continue;
    }
    const str = typeof got === 'string' ? got : JSON.stringify(got);
    const ok =
      expectedVal instanceof RegExp
        ? expectedVal.test(str)
        : str.toLowerCase().includes(String(expectedVal).toLowerCase());
    if (!ok) {
      notes.push(`FAIL: '${key}' = '${str}', expected '${expectedVal}'`);
    }
  }
  return notes;
}

async function main() {
  console.log(`\n=== Vision E2E test ===`);
  console.log(`Target: ${process.env.AICAPTURE_TEST_BASE_URL ?? 'https://ai-capture.vercel.app'}`);
  console.log(`Rep:    ${REP_EMAIL}`);
  console.log(`Show:   ${SHOW_SLUG}`);
  console.log(`Cases:  ${CASES.length}\n`);

  process.stdout.write('• authenticating … ');
  const session = await loginAsTestRep({ email: REP_EMAIL });
  console.log('OK');

  // db access for polling + cleanup
  const { db } = await import('@/db/client');

  // Snapshot pre-existing opportunities for the show. Dedupe can re-point a
  // test capture onto one of these, and we MUST NOT delete those — they're
  // the user's real data. Cleanup only nukes opportunities that didn't exist
  // before this run started.
  const [demo] = await db
    .select({ id: schema.shows.id })
    .from(schema.shows)
    .where(eq(schema.shows.slug, SHOW_SLUG))
    .limit(1);
  if (!demo) {
    console.error(`Show '${SHOW_SLUG}' not found.`);
    process.exit(1);
  }
  const preExistingRows = await db
    .select({ id: schema.opportunities.id })
    .from(schema.opportunities)
    .where(eq(schema.opportunities.showId, demo.id));
  const preExistingOppIds = new Set(preExistingRows.map((r) => r.id));
  console.log(`  (${preExistingOppIds.size} pre-existing opportunities snapshotted — won't be deleted)\n`);

  const created: Array<{ captureId: string; opportunityId: string }> = [];
  const results: Array<{
    vc: VisionCase;
    captureId: string;
    opportunityCode: string;
    mergedFields: Record<string, unknown>;
    notes: string[];
    passed: boolean;
    elapsedMs: number;
  }> = [];

  for (const vc of CASES) {
    process.stdout.write(`▶ ${vc.fixture} … `);
    const t0 = Date.now();
    try {
      const upload = await uploadCapture(session, vc.fixture);
      const polled = await pollUntilProcessed(db, upload.captureId);
      created.push({ captureId: upload.captureId, opportunityId: polled.opportunityId });
      const notes = checkExpectations(vc, polled.mergedFields);
      const passed = notes.filter((n) => n.startsWith('FAIL')).length === 0;
      results.push({
        vc,
        captureId: upload.captureId,
        opportunityCode: polled.opportunityCode,
        mergedFields: polled.mergedFields,
        notes,
        passed,
        elapsedMs: Date.now() - t0,
      });
      console.log(
        `${passed ? 'PASS' : 'FAIL'}  (${((Date.now() - t0) / 1000).toFixed(1)}s, opp=${polled.opportunityCode})`,
      );
      for (const n of notes) console.log(`    ${n}`);
    } catch (e) {
      const msg = (e as Error).message;
      console.log(`ERROR — ${msg}`);
      results.push({
        vc,
        captureId: '',
        opportunityCode: '?',
        mergedFields: {},
        notes: [`ERROR: ${msg}`],
        passed: false,
        elapsedMs: Date.now() - t0,
      });
    }
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────
  if (created.length > 0) {
    // Always delete the captures we created (cascade handles capture_extractions + media_blobs).
    const captureIds = created.map((c) => c.captureId).filter(Boolean);
    if (captureIds.length > 0) {
      await db.delete(schema.captures).where(inArray(schema.captures.id, captureIds));
    }

    // Only delete opportunities we created — never one that pre-existed and got
    // re-pointed via dedupe. Those belong to the user.
    const newOppIds = Array.from(
      new Set(created.map((c) => c.opportunityId).filter((id) => !preExistingOppIds.has(id))),
    );
    const skipped = created.length - newOppIds.length;
    if (newOppIds.length > 0) {
      // Leads cascade from opportunities.
      await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, newOppIds));
    }
    console.log(
      `• cleanup: deleted ${captureIds.length} captures + ${newOppIds.length} new opportunities (${skipped} test capture(s) had dedupe-re-pointed to a pre-existing lead and were left untouched)`,
    );
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const outDir = join(process.cwd(), 'tests', 'scenario-runs');
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const { writeFileSync, mkdirSync } = await import('fs');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${runId}-vision.json`);
  writeFileSync(path, JSON.stringify({ runId, results }, null, 2));

  console.log(`\n=== Summary ===`);
  const passed = results.filter((r) => r.passed).length;
  console.log(`${passed}/${results.length} passed`);
  console.log(`Archive: ${path}`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
